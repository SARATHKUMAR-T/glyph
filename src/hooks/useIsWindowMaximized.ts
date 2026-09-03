import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/terminal/events";

/**
 * Tracks whether the Glyph application window is currently maximized / full window.
 * Works across both Tauri desktop runtime and browser environments.
 */
export function useIsWindowMaximized(): boolean {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const checkMaximized = async () => {
      if (isTauriRuntime()) {
        try {
          const appWindow = getCurrentWindow();
          const maximized = await appWindow.isMaximized();
          if (!cancelled) {
            setIsMaximized(maximized);
          }
        } catch {
          if (!cancelled) {
            const isFull =
              window.innerWidth >= screen.availWidth - 20 &&
              window.innerHeight >= screen.availHeight - 60;
            setIsMaximized(isFull);
          }
        }
      } else {
        if (!cancelled) {
          const isFull =
            window.innerWidth >= screen.availWidth - 20 &&
            window.innerHeight >= screen.availHeight - 60;
          setIsMaximized(isFull);
        }
      }
    };

    void checkMaximized();

    if (isTauriRuntime()) {
      try {
        const appWindow = getCurrentWindow();
        void appWindow.onResized(() => {
          void checkMaximized();
        }).then((fn) => {
          unlisten = fn;
        });
      } catch {
        window.addEventListener("resize", checkMaximized);
        unlisten = () => window.removeEventListener("resize", checkMaximized);
      }
    } else {
      window.addEventListener("resize", checkMaximized);
      unlisten = () => window.removeEventListener("resize", checkMaximized);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return isMaximized;
}

