import { useEffect } from "react";

/**
 * Automatically dismisses the Settings panel on any external activity:
 * 1. Pointer clicks / touches outside the settings drawer (e.g. terminal panes, tabs, titlebar).
 * 2. Typing commands or text in the terminal.
 * 3. Terminal focus changes to any element outside settings.
 * 4. Terminal pane split resizing.
 * 5. Pressing Escape (closes open select dropdowns first, or dismisses Settings).
 */
export function useSettingsAutoDismiss(
  isOpen: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;

    // 1. Pointerdown / mousedown outside the settings panel
    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      // Keep settings open if clicking inside the settings panel
      const panel = document.querySelector(".settings-panel");
      if (panel?.contains(target)) {
        return;
      }

      // If clicking the titlebar settings toggle button, let its own onClick handle toggling
      const toggleBtn = (target as Element).closest?.("[data-settings-toggle]");
      if (toggleBtn) {
        return;
      }

      onDismiss();
    };

    // 2. Keystroke detection (typing in terminal or pressing Escape)
    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape key handling
      if (event.key === "Escape") {
        const panel = document.querySelector(".settings-panel");
        const hasOpenSelect = panel?.querySelector(".custom-select-trigger.is-open");
        if (hasOpenSelect) {
          // Let custom select close first
          return;
        }
        onDismiss();
        return;
      }

      const target = event.target as Node | null;
      if (!target) return;

      // Allow typing inside inputs within the settings panel (e.g. shortcut recording, hex inputs)
      const panel = document.querySelector(".settings-panel");
      if (panel?.contains(target)) {
        return;
      }

      // Ignore standalone modifier keys (Control, Shift, Alt, Meta)
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
        return;
      }

      // Allow the settings toggle shortcut (Ctrl+,) to be handled by global shortcuts
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        return;
      }

      // Any typing outside settings (e.g. typing commands into terminal) dismisses settings
      onDismiss();
    };

    // 3. Custom terminal activity (xterm onData, split drag handle mousedown)
    const handleTerminalActivity = () => {
      onDismiss();
    };

    // 4. Focus shifting outside settings into terminal
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const panel = document.querySelector(".settings-panel");
      if (panel?.contains(target)) {
        return;
      }

      const toggleBtn = (target as Element).closest?.("[data-settings-toggle]");
      if (toggleBtn) {
        return;
      }

      onDismiss();
    };

    // Attach capture-phase listeners so child stopPropagation cannot block them
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("mousedown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("focusin", handleFocusIn, { capture: true });
    window.addEventListener("glyph:terminal-activity", handleTerminalActivity);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("mousedown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("focusin", handleFocusIn, { capture: true });
      window.removeEventListener("glyph:terminal-activity", handleTerminalActivity);
    };
  }, [isOpen, onDismiss]);
}

