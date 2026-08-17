import { useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../../lib/terminal/events";

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

export function WindowResizeHandles() {
  const lastTriggerRef = useRef(0);

  const startResize = useCallback((direction: ResizeDirection, event: React.SyntheticEvent) => {
    if ("button" in event && (event as React.MouseEvent).button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (now - lastTriggerRef.current < 120) return;
    lastTriggerRef.current = now;

    if (isTauriRuntime()) {
      void getCurrentWindow().startResizeDragging(direction);
    }
  }, []);

  return (
    <div className="window-resize-overlay" aria-hidden="true">
      <div
        className="resize-handle handle-north"
        onPointerDown={(e) => startResize("North", e)}
        onMouseDown={(e) => startResize("North", e)}
      />
      <div
        className="resize-handle handle-south"
        onPointerDown={(e) => startResize("South", e)}
        onMouseDown={(e) => startResize("South", e)}
      />
      <div
        className="resize-handle handle-east"
        onPointerDown={(e) => startResize("East", e)}
        onMouseDown={(e) => startResize("East", e)}
      />
      <div
        className="resize-handle handle-west"
        onPointerDown={(e) => startResize("West", e)}
        onMouseDown={(e) => startResize("West", e)}
      />
      <div
        className="resize-handle handle-north-west"
        onPointerDown={(e) => startResize("NorthWest", e)}
        onMouseDown={(e) => startResize("NorthWest", e)}
      />
      <div
        className="resize-handle handle-north-east"
        onPointerDown={(e) => startResize("NorthEast", e)}
        onMouseDown={(e) => startResize("NorthEast", e)}
      />
      <div
        className="resize-handle handle-south-west"
        onPointerDown={(e) => startResize("SouthWest", e)}
        onMouseDown={(e) => startResize("SouthWest", e)}
      />
      <div
        className="resize-handle handle-south-east"
        onPointerDown={(e) => startResize("SouthEast", e)}
        onMouseDown={(e) => startResize("SouthEast", e)}
      />
    </div>
  );
}
