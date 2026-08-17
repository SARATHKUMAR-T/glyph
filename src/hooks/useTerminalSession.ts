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

export async function createTerminalSession(request: CreateTerminalRequest) {
  ensureTauriRuntime();
  return invoke<TerminalSessionInfo>("create_terminal", { request });
}

export async function writeTerminalData(sessionId: string, data: string) {
  ensureTauriRuntime();
  return invoke<void>("write_terminal", { sessionId, data }).catch((err: unknown) => {
    console.error("[write_terminal] IPC error:", err, "sessionId:", sessionId);
    throw err;
  });
}

export async function resizeTerminalSession(sessionId: string, request: ResizeTerminalRequest) {
  ensureTauriRuntime();
  return invoke<void>("resize_terminal", { sessionId, request }).catch((err: unknown) => {
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

function ensureTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime is not available.");
  }
}
