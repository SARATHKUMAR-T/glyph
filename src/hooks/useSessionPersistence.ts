import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";
import { reconnectCommand } from "../lib/session/reconnectCommand";
import { getAllPanesInTree } from "../lib/terminal/splitTree";
import { splitNodeToWorkspaceLayout } from "../lib/workspace/treeConverter";
import type { Session, SessionTab, WorkspacePaneConfig } from "../lib/workspace/types";
import type { TerminalTabModel } from "../lib/terminal/types";
import { getForegroundArgv, getTerminalCwd } from "./useTerminalSession";

const DEBOUNCE_MS = 1000;
// A connection typed by hand (`ssh host`) changes no React state, so while a
// Preserve Panes tab is open the session is also re-checked on a timer and
// saved whenever what would be restored has changed.
const SNAPSHOT_MS = 5000;
// Quitting waits this long at most for the final save.
const FLUSH_TIMEOUT_MS = 1500;

function hasCommand(command: WorkspacePaneConfig["command"]): boolean {
  return typeof command === "string" ? command.trim() !== "" : Boolean(command?.program);
}

/** Sessions seen running a captured connection since launch. */
const connectedSessions = new Set<string>();

async function buildSessionTab(tab: TerminalTabModel): Promise<SessionTab> {
  const { layout, panes } = splitNodeToWorkspaceLayout(tab.rootNode);
  const paneModels = new Map(getAllPanesInTree(tab.rootNode).map((pane) => [pane.paneId, pane]));
  // Restoring the last session after a restart must not replay startup
  // commands (a dev server, a deploy, a migration) the user never asked to
  // run again — only explicitly opening a saved workspace does that, or a
  // tab from a workspace the user marked "Preserve Panes", whose commands
  // are what reconnect it (an `ssh`, a `docker exec`, ...).
  const preservePanes = tab.preservePanes ?? false;

  const savedPanes = await Promise.all(
    panes.map(async (pane): Promise<WorkspacePaneConfig> => {
      const model = paneModels.get(pane.id);
      const sessionId = model?.sessionId;
      const liveCwd = sessionId ? await getTerminalCwd(sessionId) : null;
      const saved = liveCwd ? { ...pane, cwd: liveCwd } : pane;
      if (!preservePanes) return { ...saved, command: null };
      // A configured startup command is what reconnects the pane.
      if (hasCommand(pane.command) && !model?.startupCommandCaptured) return saved;
      // Otherwise reconnect whatever the user connected to by hand, for as
      // long as that connection is open.
      const captured = sessionId ? reconnectCommand(await getForegroundArgv(sessionId)) : null;
      if (sessionId && captured) {
        connectedSessions.add(sessionId);
        return { ...saved, command: captured, commandCaptured: true };
      }
      // A connection restored from the last session is kept until it has
      // been seen running: the pane types it only once its shell is up, and
      // if it can't connect yet (offline at login) the next launch retries.
      if (model?.startupCommandCaptured && !(sessionId && connectedSessions.has(sessionId))) {
        return { ...saved, commandCaptured: true };
      }
      return { ...saved, command: null };
    }),
  );

  return { title: tab.title, layout, panes: savedPanes, preservePanes, workspaceId: tab.workspaceId ?? null };
}

let flushActiveSession: (() => Promise<void>) | null = null;

/** Saves the session right away — called before quitting, so connections
 * opened since the last save are restored too. Never hangs a quit. */
export function flushSession(): Promise<void> {
  if (!flushActiveSession) return Promise.resolve();
  return Promise.race([
    flushActiveSession(),
    new Promise<void>((resolve) => window.setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ]);
}

/** Auto-saves the full open-tab state (debounced) on every structural
 * change, so `resolveInitialSession` has something to restore after a
 * crash or restart. With `restoreAllTabs` off, only "Preserve Panes"
 * workspace tabs are saved — those come back regardless of that setting. Deliberately keyed on `tabs`/`activeTabId` only — those
 * change on tab/pane add/remove/split/title updates, not on every
 * keystroke (terminal byte output never touches this React state, see
 * `GlyphEngineTerminalView`), so this doesn't fire anywhere near as often
 * as it might look. */
export function useSessionPersistence(tabs: TerminalTabModel[], activeTabId: string, restoreAllTabs: boolean) {
  const timerRef = useRef<number | undefined>(undefined);
  const stateRef = useRef({ tabs, activeTabId, restoreAllTabs });
  const lastSavedRef = useRef<string | null>(null);
  // Saves run one at a time, each reading the latest state, so an older
  // snapshot can never land on disk after a newer one.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const saveRef = useRef(() => {
    chainRef.current = chainRef.current.then(async () => {
      const { tabs, activeTabId, restoreAllTabs } = stateRef.current;
      const savedTabs = restoreAllTabs ? tabs : tabs.filter((tab) => tab.preservePanes);
      const sessionTabs = await Promise.all(savedTabs.map(buildSessionTab));
      const activeTabIndex = Math.max(
        0,
        savedTabs.findIndex((tab) => tab.clientId === activeTabId),
      );
      const snapshot = JSON.stringify({ sessionTabs, activeTabIndex });
      if (snapshot === lastSavedRef.current) return;
      const session: Session = {
        tabs: sessionTabs,
        activeTabIndex,
        savedAt: Date.now(),
      };
      try {
        await invoke("save_session", { session });
        lastSavedRef.current = snapshot;
      } catch (err: unknown) {
        console.error("[useSessionPersistence] save_session failed:", err);
      }
    });
    return chainRef.current;
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;
    stateRef.current = { tabs, activeTabId, restoreAllTabs };

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveRef.current(), DEBOUNCE_MS);

    return () => window.clearTimeout(timerRef.current);
  }, [tabs, activeTabId, restoreAllTabs]);

  const hasPreservedTab = tabs.some((tab) => tab.preservePanes);
  useEffect(() => {
    if (!isTauriRuntime() || !hasPreservedTab) return;
    const interval = window.setInterval(() => void saveRef.current(), SNAPSHOT_MS);
    return () => window.clearInterval(interval);
  }, [hasPreservedTab]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const flush = () => saveRef.current();
    flushActiveSession = flush;
    return () => {
      if (flushActiveSession === flush) flushActiveSession = null;
    };
  }, []);
}
