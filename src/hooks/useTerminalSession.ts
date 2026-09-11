import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";
import type { TerminalSessionInfo } from "../lib/terminal/types";

const INPUT_BATCH_DELAY_MS = 4;

type PendingTerminalWrite = {
  data: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type TerminalWriteQueue = {
  flushing: boolean;
  pending: PendingTerminalWrite[];
  timer: ReturnType<typeof setTimeout> | null;
};

const terminalWriteQueues = new Map<string, TerminalWriteQueue>();

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

  if (!data) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    let queue = terminalWriteQueues.get(sessionId);
    if (!queue) {
      queue = { flushing: false, pending: [], timer: null };
      terminalWriteQueues.set(sessionId, queue);
    }

    queue.pending.push({ data, resolve, reject });
    scheduleTerminalWriteFlush(sessionId, queue);
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

function scheduleTerminalWriteFlush(sessionId: string, queue: TerminalWriteQueue) {
  if (queue.flushing || queue.timer) {
    return;
  }

  queue.timer = setTimeout(() => {
    queue.timer = null;
    void flushTerminalWrites(sessionId, queue);
  }, INPUT_BATCH_DELAY_MS);
}

async function flushTerminalWrites(sessionId: string, queue: TerminalWriteQueue) {
  if (queue.flushing || queue.pending.length === 0) {
    return;
  }

  queue.flushing = true;
  const writes = queue.pending.splice(0);
  const data = writes.map((write) => write.data).join("");

  try {
    await invoke<void>("write_terminal", { sessionId, data });
    for (const write of writes) {
      write.resolve();
    }
  } catch (error) {
    console.error("[write_terminal] IPC error:", error, "sessionId:", sessionId);
    for (const write of writes) {
      write.reject(error);
    }
  } finally {
    queue.flushing = false;

    if (queue.pending.length > 0) {
      scheduleTerminalWriteFlush(sessionId, queue);
    } else if (terminalWriteQueues.get(sessionId) === queue) {
      terminalWriteQueues.delete(sessionId);
    }
  }
}

