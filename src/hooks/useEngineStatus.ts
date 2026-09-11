import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function fetchEngineStatus(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const status = await invoke<{ enabled: boolean }>("engine_status");
    return status.enabled;
  } catch {
    return false;
  }
}

/**
 * Whether the experimental Rust grid engine (`GLYPH_RUST_ENGINE=1`) is
 * running on the backend for this app instance. Panes use this to decide
 * between the default xterm.js renderer and the experimental Canvas2D one
 * — see `TerminalPanePortals`. Fetched once and cached for the process
 * lifetime: the flag is a backend startup-time env var, it cannot change
 * while the app is running.
 */
export function useEngineStatus(): boolean {
  const [enabled, setEnabled] = useState(cached ?? false);

  useEffect(() => {
    if (cached !== null) {
      setEnabled(cached);
      return;
    }
    if (!inflight) {
      inflight = fetchEngineStatus();
    }
    let cancelled = false;
    void inflight.then((result) => {
      cached = result;
      if (!cancelled) setEnabled(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
