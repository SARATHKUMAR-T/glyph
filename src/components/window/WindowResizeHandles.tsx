import { useCallback } from "react";
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
  const handleMouseDown = useCallback((direction: ResizeDirection, event: React.MouseEvent) => {
    // Only handle primary mouse button (left click)
    if (event.button !== 0) return;
    event.preventDefault();

    if (isTauriRuntime()) {
      void getCurrentWindow().startResizeDragging(direction);
    }
  }, []);

  return (
    <div className="window-resize-overlay" aria-hidden="true">
      <div
        className="resize-handle handle-north"
        onMouseDown={(e) => handleMouseDown("North", e)}
      />
      <div
        className="resize-handle handle-south"
        onMouseDown={(e) => handleMouseDown("South", e)}
      />
      <div
        className="resize-handle handle-east"
        onMouseDown={(e) => handleMouseDown("East", e)}
      />
      <div
        className="resize-handle handle-west"
        onMouseDown={(e) => handleMouseDown("West", e)}
      />
      <div
        className="resize-handle handle-north-west"
        onMouseDown={(e) => handleMouseDown("NorthWest", e)}
      />
      <div
        className="resize-handle handle-north-east"
        onMouseDown={(e) => handleMouseDown("NorthEast", e)}
      />
      <div
        className="resize-handle handle-south-west"
        onMouseDown={(e) => handleMouseDown("SouthWest", e)}
      />
      <div
        className="resize-handle handle-south-east"
        onMouseDown={(e) => handleMouseDown("SouthEast", e)}
      />
    </div>
  );
}
