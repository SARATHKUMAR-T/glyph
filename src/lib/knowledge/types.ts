/**
 * Local Knowledge Layer — Type Definitions
 *
 * Normalized knowledge model that LocalKnowledgeManager exposes to providers.
 * 100% local. No AI, no network, no external APIs.
 */

// ── Discriminated kinds ──────────────────────────────────────────────────────

export type KnowledgeKind =
  | "command"
  | "subcommand"
  | "file"
  | "directory"
  | "flag"
  | "git-branch"
  | "git-tag"
  | "git-ref"
  | "history"
  | "project-script"
  | "alias"
  | "function"
  | "builtin";

export type KnowledgeSource =
  | "PATH"
  | "Shell"
  | "Git"
  | "Filesystem"
  | "History"
  | "Project";

// ── Normalized knowledge entry ───────────────────────────────────────────────

export type KnowledgeEntry = {
  /** The completion text to insert */
  value: string;
  /** Optional label shown in the popup (defaults to value) */
  displayText?: string;
  /** Short human-readable description */
  description?: string;
  /** Category for filtering/icons */
  kind: KnowledgeKind;
  /** Where this knowledge came from */
  source: KnowledgeSource;
  /** Optional base relevance score */
  score?: number;
  /** Arbitrary extra metadata (e.g. branch commit, script body) */
  metadata?: Record<string, unknown>;
};

// ── Filesystem cache entry ───────────────────────────────────────────────────

export type FsEntry = {
  name: string;
  isDir: boolean;
  isExecutable: boolean;
  fullPath: string;
};

// ── Git cache entry ──────────────────────────────────────────────────────────

export type CachedGitData = {
  isRepo: boolean;
  currentBranch?: string;
  branches: string[];
};

// ── Project cache entry ──────────────────────────────────────────────────────

export type CachedProjectData = {
  npmScripts: string[];
  cargoTargets: string[];
  makeTargets: string[];
};

// ── History index entry ──────────────────────────────────────────────────────

export type HistoryEntry = {
  command: string;
  /** How many times this command has been run */
  frequency: number;
  /** Position of the most recent occurrence (higher = more recent) */
  recencyRank: number;
};

// ── Status report ────────────────────────────────────────────────────────────

export type KnowledgeStatus = {
  commandCount: number;
  historyCount: number;
  historyUniqueCount: number;
  currentCwd: string;
  isGitRepo: boolean;
  currentBranch?: string;
  gitBranchCount: number;
  projectType: string;
  projectScriptCount: number;
  pathCommandsCached: boolean;
  gitCached: boolean;
  projectCached: boolean;
};
