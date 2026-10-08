import { useEffect, useLayoutEffect, useRef, useState } from "react";

type TerminalContextMenuProps = {
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
  canCopy: boolean;
  copyShortcut?: string;
  pasteShortcut?: string;
  onCopy: () => void;
  onPaste: () => void;
  onClose: () => void;
};

const EDGE_MARGIN = 8;

/** The terminal's right-click menu. Rendered into `document.body` by the
 * caller and positioned `fixed` at the pointer, nudged back inside the
 * window when it would overflow an edge. Closes on any outside press,
 * Escape, scroll, resize or window blur. */
export function TerminalContextMenu({
  x,
  y,
  canCopy,
  copyShortcut,
  pasteShortcut,
  onCopy,
  onPaste,
  onClose,
}: TerminalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - width - EDGE_MARGIN)),
      top: Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - height - EDGE_MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    // Capture phase, so the press that dismisses the menu is seen before
    // the terminal canvas handles it (and possibly captures the pointer).
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="terminal-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(e) => e.preventDefault()}
      // Keep keyboard focus on the terminal's input sink.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" className="terminal-context-item" disabled={!canCopy} onClick={() => run(onCopy)}>
        <span>Copy</span>
        {copyShortcut && <kbd>{copyShortcut}</kbd>}
      </button>
      <button type="button" role="menuitem" className="terminal-context-item" onClick={() => run(onPaste)}>
        <span>Paste</span>
        {pasteShortcut && <kbd>{pasteShortcut}</kbd>}
      </button>
    </div>
  );
}
