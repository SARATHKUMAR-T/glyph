/**
 * LocalKnowledgeManager
 *
 * Central singleton that coordinates all local knowledge providers.
 * Caches real filesystem/git/project data from the Tauri Rust backend,
 * indexes command history, and exposes fast synchronous-or-async APIs
 * that completion providers call instead of hitting IPC on every keystroke.
 *
 * Architecture:
 *   Providers → LocalKnowledgeManager → KnowledgeCache → Rust IPC / localStorage
 *
 * 100% local. No AI, no network, no external APIs.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../terminal/events.js";
import { KnowledgeCache } from "./cache.js";
import type {
  CachedGitData,
  CachedProjectData,
  FsEntry,
  HistoryEntry,
  KnowledgeStatus,
} from "./types.js";

// ── TTL constants ────────────────────────────────────────────────────────────

/** PATH executables — rarely change; 5 minutes */
const COMMANDS_TTL_MS = 5 * 60 * 1000;
/** Filesystem dir listing — changes more often; 30 seconds */
const FS_TTL_MS = 30 * 1000;
/** Git metadata — 10 seconds */
const GIT_TTL_MS = 10 * 1000;
/** Project files (package.json, etc.) — 60 seconds */
const PROJECT_TTL_MS = 60 * 1000;

// ── Fallback data (used when Tauri IPC unavailable) ─────────────────────────

const FALLBACK_COMMANDS = [
  "git", "docker", "npm", "node", "npx", "cargo", "python", "python3",
  "pip", "curl", "wget", "ssh", "tar", "gzip", "unzip", "find", "grep",
  "rg", "sed", "awk", "systemctl", "vim", "nano", "cat", "less", "head",
  "tail", "chmod", "chown", "mkdir", "touch", "rm", "cp", "mv", "ls",
  "cd", "pwd", "clear", "ps", "kill", "lsof",
];

const FALLBACK_FS: FsEntry[] = [
  { name: "Desktop/", isDir: true, isExecutable: false, fullPath: "Desktop/" },
  { name: "Documents/", isDir: true, isExecutable: false, fullPath: "Documents/" },
  { name: "Downloads/", isDir: true, isExecutable: false, fullPath: "Downloads/" },
  { name: "src/", isDir: true, isExecutable: false, fullPath: "src/" },
  { name: "dist/", isDir: true, isExecutable: false, fullPath: "dist/" },
  { name: "package.json", isDir: false, isExecutable: false, fullPath: "package.json" },
  { name: "README.md", isDir: false, isExecutable: false, fullPath: "README.md" },
];

const FALLBACK_GIT: CachedGitData = {
  isRepo: true,
  currentBranch: "main",
  branches: ["main", "develop", "feature/autocomplete", "release/v0.3.0"],
};

const FALLBACK_PROJECT: CachedProjectData = {
  npmScripts: ["dev", "build", "test", "lint", "typecheck"],
  cargoTargets: ["build", "run", "test", "check", "clippy", "fmt"],
  makeTargets: ["all", "build", "clean", "test"],
};

// ── Manager ──────────────────────────────────────────────────────────────────

export class LocalKnowledgeManager {
  private static instance: LocalKnowledgeManager | null = null;

  // ── Caches ──────────────────────────────────────────────────────────────
  /** Global: PATH executable names */
  private commandCache = new KnowledgeCache<string[]>(COMMANDS_TTL_MS);
  /** CWD+prefix keyed: directory listing */
  private fsCache = new KnowledgeCache<FsEntry[]>(FS_TTL_MS);
  /** CWD keyed: git metadata */
  private gitCache = new KnowledgeCache<CachedGitData>(GIT_TTL_MS);
  /** CWD keyed: project scripts / targets */
  private projectCache = new KnowledgeCache<CachedProjectData>(PROJECT_TTL_MS);

  // ── History index ────────────────────────────────────────────────────────
  /** Map from command text → HistoryEntry */
  private historyIndex = new Map<string, HistoryEntry>();
  private historyIndexBuilt = false;

  // ── In-flight guard ──────────────────────────────────────────────────────
  private commandsRefreshing = false;
  private gitRefreshing = new Set<string>();
  private projectRefreshing = new Set<string>();
  private fsRefreshing = new Set<string>();

  // ── Current context ──────────────────────────────────────────────────────
  private currentCwd = "/";

  private constructor() {}

  public static getInstance(): LocalKnowledgeManager {
    if (!LocalKnowledgeManager.instance) {
      LocalKnowledgeManager.instance = new LocalKnowledgeManager();
    }
    return LocalKnowledgeManager.instance;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Called once at terminal startup.
   * Warms PATH commands and project data in the background without blocking.
   */
  public initialize(cwd: string): void {
    this.currentCwd = cwd;
    // Fire-and-forget background warm-ups
    void this.refreshCommands();
    void this.refreshGit(cwd);
    void this.refreshProject(cwd);
    this.buildHistoryIndex();
  }

  /**
   * Called when the terminal changes directory.
   * Invalidates CWD-scoped caches and triggers a background refresh.
   */
  public updateCwd(newCwd: string): void {
    if (newCwd === this.currentCwd) return;
    this.currentCwd = newCwd;
    // Filesystem cache for the old dir is no longer hot — let it TTL naturally,
    // but we pre-warm the new dir in the background.
    void this.refreshGit(newCwd);
    void this.refreshProject(newCwd);
  }

  /**
   * Returns PATH executables.
   * Always returns immediately (stale or fallback) while refreshing in background.
   */
  public async getCommands(): Promise<string[]> {
    const CACHE_KEY = "__commands__";
    const live = this.commandCache.get(CACHE_KEY);
    if (live) return live;

    const stale = this.commandCache.getStale(CACHE_KEY);
    if (stale) {
      // Return stale immediately; refresh in background
      void this.refreshCommands();
      return stale;
    }

    // First call: fetch and wait
    return this.refreshCommands();
  }

  /**
   * Returns filesystem entries for a directory.
   * Key = cwd + "/" + prefix so different directories are isolated.
   */
  public async getFilesystemEntries(cwd: string, prefix: string): Promise<FsEntry[]> {
    const key = `${cwd}:${prefix}`;
    const live = this.fsCache.get(key);
    if (live) return live;

    // Return stale if available, refresh in background
    const stale = this.fsCache.getStale(key);
    if (stale && !this.fsRefreshing.has(key)) {
      void this.refreshFs(cwd, prefix, key);
      return stale;
    }

    // First call: fetch and wait
    return this.refreshFs(cwd, prefix, key);
  }

  /**
   * Returns git metadata for a directory.
   */
  public async getGitData(cwd: string): Promise<CachedGitData> {
    const live = this.gitCache.get(cwd);
    if (live) return live;

    const stale = this.gitCache.getStale(cwd);
    if (stale && !this.gitRefreshing.has(cwd)) {
      void this.refreshGit(cwd);
      return stale;
    }

    return this.refreshGit(cwd);
  }

  /**
   * Returns project metadata for a directory.
   */
  public async getProjectData(cwd: string): Promise<CachedProjectData> {
    const live = this.projectCache.get(cwd);
    if (live) return live;

    const stale = this.projectCache.getStale(cwd);
    if (stale && !this.projectRefreshing.has(cwd)) {
      void this.refreshProject(cwd);
      return stale;
    }

    return this.refreshProject(cwd);
  }

  /**
   * Returns an array of HistoryEntry objects sorted by recency (most recent first).
   * Builds the index lazily from localStorage on first call.
   */
  public getHistory(): HistoryEntry[] {
    if (!this.historyIndexBuilt) {
      this.buildHistoryIndex();
    }
    const entries = Array.from(this.historyIndex.values());
    // Sort by recency first, then frequency
    entries.sort((a, b) => {
      if (b.recencyRank !== a.recencyRank) return b.recencyRank - a.recencyRank;
      return b.frequency - a.frequency;
    });
    return entries;
  }

  /**
   * Adds a freshly-executed command to the history index.
   * Also persists to localStorage.
   */
  public addHistoryEntry(cmd: string): void {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Persist to localStorage
    try {
      const raw = localStorage.getItem("glyph:command-history");
      const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      list.push(trimmed);
      localStorage.setItem("glyph:command-history", JSON.stringify(list.slice(-300)));
    } catch {
      // ignore localStorage errors
    }

    // Update in-memory index
    const existing = this.historyIndex.get(trimmed);
    const newRecency = Date.now();
    if (existing) {
      this.historyIndex.set(trimmed, {
        ...existing,
        frequency: existing.frequency + 1,
        recencyRank: newRecency,
      });
    } else {
      this.historyIndex.set(trimmed, {
        command: trimmed,
        frequency: 1,
        recencyRank: newRecency,
      });
    }
  }

  /**
   * Explicit invalidation by scope.
   * Scope examples: "commands", "git", "project", "fs", "history", "all"
   */
  public invalidate(scope: "commands" | "git" | "project" | "fs" | "history" | "all"): void {
    switch (scope) {
      case "commands":
        this.commandCache.clear();
        break;
      case "git":
        this.gitCache.clear();
        break;
      case "project":
        this.projectCache.clear();
        break;
      case "fs":
        this.fsCache.clear();
        break;
      case "history":
        this.historyIndex.clear();
        this.historyIndexBuilt = false;
        break;
      case "all":
        this.commandCache.clear();
        this.gitCache.clear();
        this.projectCache.clear();
        this.fsCache.clear();
        this.historyIndex.clear();
        this.historyIndexBuilt = false;
        break;
    }
  }

  /**
   * Returns a snapshot of the knowledge layer's current state.
   * Used by the `knowledge status` builtin command.
   */
  public async getStatus(): Promise<KnowledgeStatus> {
    const CACHE_KEY = "__commands__";
    const commands = this.commandCache.getStale(CACHE_KEY) ?? [];
    const git = this.gitCache.getStale(this.currentCwd);
    const project = this.projectCache.getStale(this.currentCwd);

    const historyEntries = this.getHistory();
    const totalHistory = (() => {
      try {
        const raw = localStorage.getItem("glyph:command-history");
        return raw ? (JSON.parse(raw) as string[]).length : 0;
      } catch {
        return 0;
      }
    })();

    const npmCount = project?.npmScripts.length ?? 0;
    const cargoCount = project?.cargoTargets.length ?? 0;
    const makeCount = project?.makeTargets.length ?? 0;
    const totalScripts = npmCount + cargoCount + makeCount;

    const projectType = project
      ? [
          npmCount > 0 ? "Node.js" : null,
          cargoCount > 0 ? "Rust" : null,
          makeCount > 0 ? "Make" : null,
        ]
          .filter(Boolean)
          .join(", ") || "Unknown"
      : "Unknown";

    return {
      commandCount: commands.length,
      historyCount: totalHistory,
      historyUniqueCount: historyEntries.length,
      currentCwd: this.currentCwd,
      isGitRepo: git?.isRepo ?? false,
      currentBranch: git?.currentBranch,
      gitBranchCount: git?.branches.length ?? 0,
      projectType,
      projectScriptCount: totalScripts,
      pathCommandsCached: this.commandCache.has(CACHE_KEY),
      gitCached: this.gitCache.has(this.currentCwd),
      projectCached: this.projectCache.has(this.currentCwd),
    };
  }

  // ── Private refresh helpers ─────────────────────────────────────────────

  private async refreshCommands(): Promise<string[]> {
    if (this.commandsRefreshing) {
      return this.commandCache.getStale("__commands__") ?? FALLBACK_COMMANDS;
    }
    this.commandsRefreshing = true;
    try {
      if (isTauriRuntime()) {
        const binaries = await invoke<string[]>("get_path_executables", {
          forceRefresh: false,
        });
        if (Array.isArray(binaries) && binaries.length > 0) {
          this.commandCache.set("__commands__", binaries);
          return binaries;
        }
      }
    } catch {
      // Fallback silently
    } finally {
      this.commandsRefreshing = false;
    }
    this.commandCache.set("__commands__", FALLBACK_COMMANDS);
    return FALLBACK_COMMANDS;
  }

  private async refreshFs(cwd: string, prefix: string, key: string): Promise<FsEntry[]> {
    this.fsRefreshing.add(key);
    try {
      if (isTauriRuntime()) {
        const entries = await invoke<FsEntry[]>("get_fs_completions", {
          cwd,
          pathPrefix: prefix,
        });
        if (Array.isArray(entries)) {
          this.fsCache.set(key, entries);
          return entries;
        }
      }
    } catch {
      // Fallback silently
    } finally {
      this.fsRefreshing.delete(key);
    }
    this.fsCache.set(key, FALLBACK_FS);
    return FALLBACK_FS;
  }

  private async refreshGit(cwd: string): Promise<CachedGitData> {
    if (this.gitRefreshing.has(cwd)) {
      return this.gitCache.getStale(cwd) ?? FALLBACK_GIT;
    }
    this.gitRefreshing.add(cwd);
    try {
      if (isTauriRuntime()) {
        const data = await invoke<CachedGitData>("get_git_completions", { cwd });
        if (data && typeof data.isRepo === "boolean") {
          this.gitCache.set(cwd, data);
          return data;
        }
      }
    } catch {
      // Non-git directory or git unavailable — that's fine
    } finally {
      this.gitRefreshing.delete(cwd);
    }
    this.gitCache.set(cwd, FALLBACK_GIT);
    return FALLBACK_GIT;
  }

  private async refreshProject(cwd: string): Promise<CachedProjectData> {
    if (this.projectRefreshing.has(cwd)) {
      return this.projectCache.getStale(cwd) ?? FALLBACK_PROJECT;
    }
    this.projectRefreshing.add(cwd);
    try {
      if (isTauriRuntime()) {
        const data = await invoke<CachedProjectData>("get_project_completions", { cwd });
        if (data && Array.isArray(data.npmScripts)) {
          this.projectCache.set(cwd, data);
          return data;
        }
      }
    } catch {
      // No project files — that's fine
    } finally {
      this.projectRefreshing.delete(cwd);
    }
    this.projectCache.set(cwd, FALLBACK_PROJECT);
    return FALLBACK_PROJECT;
  }

  /** Builds the history frequency+recency index from localStorage.
   * If localStorage is unavailable (test env), the in-memory index built
   * via addHistoryEntry() is preserved as-is. */
  private buildHistoryIndex(): void {
    // If there are already in-memory entries (added via addHistoryEntry this session),
    // don't overwrite them with a potentially-empty localStorage read.
    if (this.historyIndex.size > 0) {
      this.historyIndexBuilt = true;
      return;
    }

    try {
      const raw = localStorage.getItem("glyph:command-history");
      if (!raw) {
        this.historyIndexBuilt = true;
        return;
      }
      const list: string[] = JSON.parse(raw) as string[];
      const total = list.length;

      list.forEach((cmd, index) => {
        const trimmed = cmd.trim();
        if (!trimmed) return;
        const existing = this.historyIndex.get(trimmed);
        const recency = index + 1;
        if (existing) {
          this.historyIndex.set(trimmed, {
            ...existing,
            frequency: existing.frequency + 1,
            recencyRank: Math.max(existing.recencyRank, recency),
          });
        } else {
          this.historyIndex.set(trimmed, {
            command: trimmed,
            frequency: 1,
            recencyRank: recency,
          });
        }
      });

      // Normalize recency ranks to 0–100
      const maxRank = total;
      for (const [key, entry] of this.historyIndex) {
        this.historyIndex.set(key, {
          ...entry,
          recencyRank: maxRank > 0 ? Math.round((entry.recencyRank / maxRank) * 100) : 50,
        });
      }
    } catch {
      // localStorage unavailable — in-memory index (populated via addHistoryEntry) is used
    }
    this.historyIndexBuilt = true;
  }
}
