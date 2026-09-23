import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { TerminalStatus, TerminalTabModel } from "../../lib/terminal/types";

type TerminalTabProps = {
  active: boolean;
  canClose: boolean;
  tab: TerminalTabModel;
  status: TerminalStatus;
  paneCount: number;
  isDragging: boolean;
  dropIndicator: "before" | "after" | null;
  onActivate: (clientId: string) => void;
  onClose: (clientId: string) => void;
  onDragStart: (clientId: string) => void;
  onDragOver: (clientId: string | null, position: "before" | "after" | null) => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

// Drags at or under this many pixels of pointer movement are treated as a
// click rather than a drag, so tapping a tab to activate it still works.
const DRAG_THRESHOLD_PX = 4;

export function TerminalTab({
  active,
  canClose,
  isDragging,
  dropIndicator,
  onActivate,
  onClose,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  paneCount,
  status,
  tab,
}: TerminalTabProps) {
  const displayTitle = paneCount > 1 ? `${tab.title} (${paneCount} Panes)` : tab.title;

  const startPos = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const classNames = ["terminal-tab"];
  if (active) classNames.push("is-active");
  if (isDragging) classNames.push("is-dragging");
  if (dropIndicator) classNames.push(`drop-${dropIndicator}`);

  // Native HTML5 drag-and-drop (`draggable` + dragstart/dragover/drop) is
  // unreliable inside Tauri's Linux webview (WebKitGTK's implementation
  // doesn't consistently fire those events for in-page dragging), so
  // reordering is built on the Pointer Events API instead — plain
  // mousedown/move/up tracking that every webview supports the same way.
  // Pointer capture keeps move/up events targeted at this element even
  // once the cursor is over a sibling tab, so `elementFromPoint` is used
  // below to find whatever's actually under the cursor.
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Pointer capture is deliberately NOT taken here: capturing on every
    // pointerdown would redirect the resulting click event (browsers route
    // synthetic clicks to whichever element holds pointer capture) away
    // from the inner activate/close buttons, breaking plain taps. Capture
    // is only acquired once a real drag is confirmed, in handlePointerMove.
    startPos.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!startPos.current) return;

    if (!dragging.current) {
      const dx = event.clientX - startPos.current.x;
      const dy = event.clientY - startPos.current.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      onDragStart(tab.clientId);
    }

    const hovered = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-tab-id]");
    if (!hovered || hovered.dataset.tabId === tab.clientId) {
      onDragOver(null, null);
      return;
    }
    const bounds = hovered.getBoundingClientRect();
    const position = event.clientX - bounds.left < bounds.width / 2 ? "before" : "after";
    onDragOver(hovered.dataset.tabId ?? null, position);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      onDrop();
    }
    startPos.current = null;
    dragging.current = false;
    onDragEnd();
  };

  return (
    <div
      className={classNames.join(" ")}
      data-tab-id={tab.clientId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <button
        aria-selected={active}
        className="terminal-tab-main"
        role="tab"
        title={displayTitle}
        type="button"
        onClick={() => onActivate(tab.clientId)}
      >
        <span className={`tab-status tab-status-${status}`} aria-hidden="true" />
        <span className="tab-title">{displayTitle}</span>
      </button>
      <button
        aria-label={`Close ${tab.title}`}
        className="terminal-tab-close"
        disabled={!canClose}
        title="Close"
        type="button"
        onClick={() => onClose(tab.clientId)}
      >
        ×
      </button>
    </div>
  );
}
