import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSemanticEvent,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const TERMINAL_EVENTS = {
  output: "terminal://output",
  exit: "terminal://exit",
  error: "terminal://error",
  state: "terminal://state",
  semantic: "terminal://semantic",
} as const;

export function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function listenTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
  return listen<TerminalOutputEvent>(TERMINAL_EVENTS.output, (event) => handler(event.payload));
}

export function listenTerminalExit(handler: (event: TerminalExitEvent) => void) {
  return listen<TerminalExitEvent>(TERMINAL_EVENTS.exit, (event) => handler(event.payload));
}

export function listenTerminalError(handler: (event: TerminalErrorEvent) => void) {
  return listen<TerminalErrorEvent>(TERMINAL_EVENTS.error, (event) => handler(event.payload));
}

export function listenTerminalSemantic(handler: (event: TerminalSemanticEvent) => void) {
  return listen<TerminalSemanticEvent>(TERMINAL_EVENTS.semantic, (event) => handler(event.payload));
}

export function unlistenAll(unlisteners: UnlistenFn[]) {
  for (const unlisten of unlisteners) {
    unlisten();
  }
}
