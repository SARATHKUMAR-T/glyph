/**
 * The Linux PRIMARY selection: selecting text sets it, a middle-click
 * pastes it — the classic X11 terminal gesture, independent of the
 * Ctrl+Shift+C/V clipboard. Backed by the system selection (see
 * `src-tauri/src/commands/selection.rs`) so it works across apps, with the
 * last in-app selection as a fallback where the system one isn't available
 * (e.g. a Wayland compositor without primary-selection support).
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./events";

let lastInAppSelection = "";

export function setPrimarySelection(text: string) {
  if (!text) return;
  lastInAppSelection = text;
  if (isTauriRuntime()) void invoke("set_primary_selection", { text }).catch(() => {});
}

export async function readPrimarySelection(): Promise<string> {
  if (isTauriRuntime()) {
    const text = await invoke<string | null>("get_primary_selection").catch(() => null);
    if (text) return text;
  }
  return lastInAppSelection;
}
