import { useCallback, useEffect, useState } from "react";

export type ShortcutAction =
  | "new_tab"
  | "new_window"
  | "close_tab"
  | "next_tab"
  | "prev_tab"
  | "copy"
  | "paste"
  | "search"
  | "select_all"
  | "toggle_settings";

export type KeyCombo = {
  key: string; // e.g. "t", "n", "w", "Tab", "c", "v", "f", "a", ","
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

export type KeybindingsConfig = Record<ShortcutAction, KeyCombo>;

export const DEFAULT_KEYBINDINGS: KeybindingsConfig = {
  new_tab: { key: "t", ctrl: true, alt: false, shift: true, meta: false },
  new_window: { key: "n", ctrl: true, alt: false, shift: true, meta: false },
  close_tab: { key: "w", ctrl: true, alt: false, shift: true, meta: false },
  next_tab: { key: "Tab", ctrl: true, alt: false, shift: false, meta: false },
  prev_tab: { key: "Tab", ctrl: true, alt: false, shift: true, meta: false },
  copy: { key: "c", ctrl: true, alt: false, shift: true, meta: false },
  paste: { key: "v", ctrl: true, alt: false, shift: true, meta: false },
  search: { key: "f", ctrl: true, alt: false, shift: true, meta: false },
  select_all: { key: "a", ctrl: true, alt: false, shift: true, meta: false },
  toggle_settings: { key: ",", ctrl: true, alt: false, shift: false, meta: false },
};

export const ACTION_LABELS: Record<ShortcutAction, { label: string; description: string }> = {
  new_tab: { label: "New Terminal (Same Window)", description: "Open a new tab in active window" },
  new_window: { label: "New Terminal (New Window)", description: "Launch a new Glyph app window" },
  close_tab: { label: "Close Terminal Tab", description: "Close the active terminal tab" },
  next_tab: { label: "Next Tab", description: "Switch to next active terminal tab" },
  prev_tab: { label: "Previous Tab", description: "Switch to previous terminal tab" },
  copy: { label: "Copy", description: "Copy selected text to clipboard" },
  paste: { label: "Paste", description: "Paste text into active shell" },
  search: { label: "Find / Search Buffer", description: "Search terminal scrollback history" },
  select_all: { label: "Select All", description: "Highlight active line text" },
  toggle_settings: { label: "Toggle Settings", description: "Open or close Settings panel" },
};

const STORAGE_KEY = "glyph_keybindings_v4";

export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Cmd");

  let keyDisplay = combo.key.toUpperCase();
  if (combo.key === ",") keyDisplay = ",";
  if (combo.key === " ") keyDisplay = "Space";
  if (combo.key.toLowerCase() === "tab") keyDisplay = "Tab";
  parts.push(keyDisplay);

  return parts.join(" + ");
}

export function matchesKeyCombo(event: KeyboardEvent, combo: KeyCombo): boolean {
  const eventKey = event.key.toLowerCase();
  const targetKey = combo.key.toLowerCase();
  const eventCode = event.code.toLowerCase();

  let keyMatches = false;

  if (targetKey === "tab") {
    keyMatches =
      eventKey === "tab" ||
      eventKey === "backtab" ||
      eventKey === "iso_left_tab" ||
      eventCode === "tab";
  } else if (targetKey === "escape" || targetKey === "esc") {
    keyMatches = eventKey === "escape" || eventCode === "escape";
  } else {
    keyMatches =
      eventKey === targetKey ||
      eventCode === targetKey ||
      eventCode === `key${targetKey}` ||
      eventCode === `digit${targetKey}`;
  }

  const ctrlMatches = !!event.ctrlKey === combo.ctrl;
  const altMatches = !!event.altKey === combo.alt;
  const shiftMatches = !!event.shiftKey === combo.shift;
  const metaMatches = !!event.metaKey === combo.meta;

  return keyMatches && ctrlMatches && altMatches && shiftMatches && metaMatches;
}

export function useKeybindings() {
  const [keybindings, setKeybindings] = useState<KeybindingsConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) };
      }
    } catch {
      // Fall back to defaults
    }
    return DEFAULT_KEYBINDINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings));
    } catch {
      // Ignore storage errors
    }
  }, [keybindings]);

  const updateKeybinding = useCallback((action: ShortcutAction, combo: KeyCombo) => {
    setKeybindings((prev) => ({
      ...prev,
      [action]: combo,
    }));
  }, []);

  const resetKeybindings = useCallback(() => {
    setKeybindings(DEFAULT_KEYBINDINGS);
  }, []);

  return {
    keybindings,
    updateKeybinding,
    resetKeybindings,
  };
}
