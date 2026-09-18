import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { CursorStyleOption } from "./useTerminalSettings";
import { isTauriRuntime } from "../lib/terminal/events";

/**
 * Pushes the user's cursor-style preference (`TerminalSettings.cursorStyle`)
 * to every running terminal session via `engine_set_cursor_style`, so it
 * actually changes what's drawn — see `GridEngine::set_cursor_style`. This
 * only sets the terminal's *default* shape: a program that explicitly
 * requests one via DECSCUSR (vim's insert-mode beam, etc.) still takes
 * precedence for as long as it's active, matching how real terminal
 * emulators treat "cursor style" as a base preference rather than an
 * unconditional override.
 */
export function useCursorStyle(cursorStyle: CursorStyleOption): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("engine_set_cursor_style", { style: cursorStyle }).catch((error: unknown) => {
      console.error("[useCursorStyle] failed to push cursor style to the engine:", error);
    });
  }, [cursorStyle]);
}
