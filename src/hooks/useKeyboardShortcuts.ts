import { useEffect } from "react";
import { matchesKeyCombo, type KeybindingsConfig } from "./useKeybindings";

type ShortcutHandlers = {
  keybindings: KeybindingsConfig;
  onNewTerminal: () => void;
  onNewWindow: () => void;
  onCloseTerminal: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onSearch: () => void;
  onToggleSettings: () => void;
};

export function useKeyboardShortcuts({
  keybindings,
  onCloseTerminal,
  onNewTerminal,
  onNewWindow,
  onNextTab,
  onPrevTab,
  onSearch,
  onToggleSettings,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when user is typing inside text input fields (e.g. search box or settings inputs)
      const targetTag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
        return;
      }

      if (matchesKeyCombo(event, keybindings.new_tab)) {
        event.preventDefault();
        event.stopPropagation();
        onNewTerminal();
        return;
      }

      if (matchesKeyCombo(event, keybindings.new_window)) {
        event.preventDefault();
        event.stopPropagation();
        onNewWindow();
        return;
      }

      if (matchesKeyCombo(event, keybindings.close_tab)) {
        event.preventDefault();
        event.stopPropagation();
        onCloseTerminal();
        return;
      }

      if (matchesKeyCombo(event, keybindings.next_tab)) {
        event.preventDefault();
        event.stopPropagation();
        onNextTab?.();
        return;
      }

      if (matchesKeyCombo(event, keybindings.prev_tab)) {
        event.preventDefault();
        event.stopPropagation();
        onPrevTab?.();
        return;
      }

      if (matchesKeyCombo(event, keybindings.search)) {
        event.preventDefault();
        event.stopPropagation();
        onSearch();
        return;
      }

      if (matchesKeyCombo(event, keybindings.toggle_settings)) {
        event.preventDefault();
        event.stopPropagation();
        onToggleSettings();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    keybindings,
    onCloseTerminal,
    onNewTerminal,
    onNewWindow,
    onNextTab,
    onPrevTab,
    onSearch,
    onToggleSettings,
  ]);
}
