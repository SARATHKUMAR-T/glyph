import { useCallback, useEffect, useRef, useState } from "react";
import type { SplitDirection } from "../../lib/terminal/types";

type SplitResizerProps = {
  direction: SplitDirection;
  onResize: (ratio: number) => void;
};

export function SplitResizer({ direction, onResize }: SplitResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const resizerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent("glyph:terminal-activity"));
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const resizerEl = resizerRef.current;
      if (!resizerEl) return;

      const parentEl = resizerEl.parentElement;
      if (!parentEl) return;

      const parentRect = parentEl.getBoundingClientRect();
      let newRatio = 0.5;

      if (direction === "vertical") {
        const mouseX = e.clientX - parentRect.left;
        newRatio = mouseX / parentRect.width;
      } else {
        const mouseY = e.clientY - parentRect.top;
        newRatio = mouseY / parentRect.height;
      }

      onResize(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [direction, isDragging, onResize]);

  const className = `split-resizer split-resizer-${direction} ${isDragging ? "is-dragging" : ""}`;

  return (
    <div
      ref={resizerRef}
      className={className}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation={direction === "vertical" ? "vertical" : "horizontal"}
      tabIndex={-1}
    >
      <div className="split-resizer-line" />
    </div>
  );
}
