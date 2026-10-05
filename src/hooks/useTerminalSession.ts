import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";
import type { TerminalSessionInfo } from "../lib/terminal/types";

type CreateTerminalRequest = {
  cols: number;
  rows: number;
  cwd?: string;
};

type ResizeTerminalRequest = {
  cols: number;
  rows: number;
};

// Backend commands run on a thread pool, so two invokes issued back to back
// are not guaranteed to execute in order. Keystrokes, pastes and resizes for
// one session must land in the order they were issued ("ab" must not become
// "ba"), so they are chained per session.
const orderedChains = new Map<string, Promise<unknown>>();

function ordered<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
  const previous = orderedChains.get(sessionId) ?? Promise.resolve();
  const result = previous.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  orderedChains.set(sessionId, tail);
  void tail.then(() => {
    if (orderedChains.get(sessionId) === tail) orderedChains.delete(sessionId);
  });
  return result;
}

// Scrollback offsets are "latest wins", so while one `engine_set_scroll` is in
// flight newer requests collapse into a single follow-up carrying the most
// recent offset instead of queueing one IPC per wheel tick.
const scrollState = new Map<string, { inFlight: boolean; next: number | null }>();

export function setEngineScroll(sessionId: string, displayOffset: number): void {
  if (!isTauriRuntime()) return;
  const state = scrollState.get(sessionId) ?? { inFlight: false, next: null };
  scrollState.set(sessionId, state);
  if (state.inFlight) {
    state.next = displayOffset;
    return;
  }
  const send = (offset: number) => {
    state.inFlight = true;
    void invoke("engine_set_scroll", { sessionId, displayOffset: offset })
      .catch(() => {})
      .then(() => {
        if (state.next !== null) {
          const queued = state.next;
          state.next = null;
          send(queued);
        } else {
          state.inFlight = false;
          scrollState.delete(sessionId);
        }
      });
  };
  send(displayOffset);
}

/** Paints text into the session's grid without involving the shell. Shares
 * the per-session ordering chain with PTY writes, so local output and the
 * real writes that follow it keep the order they were issued in. */
export function feedEngineLocal(sessionId: string, data: string): void {
  void ordered(sessionId, () => invoke("engine_feed_local", { sessionId, data })).catch(() => {});
}

export async function createTerminalSession(request: CreateTerminalRequest) {
  ensureTauriRuntime();
  return invoke<TerminalSessionInfo>("create_terminal", { request });
}

export async function writeTerminalData(sessionId: string, data: string) {
  ensureTauriRuntime();
  return ordered(sessionId, () => invoke<void>("write_terminal", { sessionId, data })).catch((err: unknown) => {
    console.error("[write_terminal] IPC error:", err, "sessionId:", sessionId);
    throw err;
  });
}

/** Sends clipboard text as one paste; the backend adds bracketed-paste
 * markers when the running program has enabled them (`?2004`). */
export async function pasteTerminalData(sessionId: string, data: string) {
  ensureTauriRuntime();
  return ordered(sessionId, () => invoke<void>("paste_terminal", { sessionId, data })).catch((err: unknown) => {
    console.error("[paste_terminal] IPC error:", err, "sessionId:", sessionId);
    throw err;
  });
}

export async function resizeTerminalSession(sessionId: string, request: ResizeTerminalRequest) {
  ensureTauriRuntime();
  return ordered(sessionId, () => invoke<void>("resize_terminal", { sessionId, request })).catch((err: unknown) => {
    console.error("[resize_terminal] IPC error:", err, "sessionId:", sessionId);
    throw err;
  });
}

export async function closeTerminalSession(sessionId: string) {
  ensureTauriRuntime();
  return invoke<void>("close_terminal", { sessionId }).catch((err: unknown) => {
    console.error("[close_terminal] IPC error:", err, "sessionId:", sessionId);
    throw err;
  });
}

export async function getTerminalCwd(sessionId: string): Promise<string | null> {
  ensureTauriRuntime();
  return invoke<string | null>("get_terminal_cwd", { sessionId }).catch(() => null);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke<void>("open_url", { url }).catch((err: unknown) => {
      console.error("[open_url] IPC error:", err, "url:", url);
    });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function ensureTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime is not available.");
  }
}

