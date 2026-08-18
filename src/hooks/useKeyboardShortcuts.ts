import { useEffect } from "react";
import { matchesKeyCombo, type KeybindingsConfig } from "./useKeybindings";

type ShortcutHandlers = {
  keybindings: KeybindingsConfig;
  onNewTerminal: () => void;
  onNewWindow: () => void;
  onCloseTerminal: () => void;
  onSplitVertical?: () => void;
  onSplitHorizontal?: () => void;
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
  onSplitHorizontal,
  onSplitVertical,
  onToggleSettings,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when user is typing inside text input fields
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

      if (keybindings.split_vertical && matchesKeyCombo(event, keybindings.split_vertical)) {
        event.preventDefault();
        event.stopPropagation();
        onSplitVertical?.();
        return;
      }

      if (keybindings.split_horizontal && matchesKeyCombo(event, keybindings.split_horizontal)) {
        event.preventDefault();
        event.stopPropagation();
        onSplitHorizontal?.();
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
    onSplitHorizontal,
    onSplitVertical,
    onToggleSettings,
  ]);
}
