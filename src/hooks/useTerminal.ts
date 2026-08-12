import { useEffect } from "react";

export function useActiveFocus(active: boolean, focus: () => void) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [active, focus]);
}
