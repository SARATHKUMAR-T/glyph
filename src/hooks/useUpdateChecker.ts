import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { checkForUpdate } from "../lib/update/checkForUpdate";
import type { UpdateInfo } from "../lib/update/types";
import { isTauriRuntime } from "../lib/terminal/events";

const DISMISSED_VERSION_KEY = "glyph.update.dismissedVersion";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — comfortably under GitHub's 60/hr unauthenticated cap

function getDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

function setDismissedVersion(version: string) {
  try {
    localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch {
    // Best-effort only — a private window or blocked storage just means
    // the badge may reappear next launch, which is harmless.
  }
}

export type UpdateCheckerState = {
  /** `null` when there's nothing newer, or it's been dismissed for this version. */
  update: UpdateInfo | null;
  checking: boolean;
  /** The running app's own version, once resolved — `null` outside Tauri. */
  currentVersion: string | null;
  checkNow: () => void;
  dismiss: () => void;
};

/**
 * Polls GitHub Releases for a newer build than the one currently running,
 * on mount and every `CHECK_INTERVAL_MS` after. Silently no-ops outside a
 * Tauri runtime (e.g. the Vite dev preview in a plain browser tab), since
 * there's no packaged version to compare against there.
 */
export function useUpdateChecker(): UpdateCheckerState {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const currentVersionRef = useRef<string | null>(null);

  const runCheck = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setChecking(true);
    try {
      if (!currentVersionRef.current) {
        currentVersionRef.current = await getVersion();
        setCurrentVersion(currentVersionRef.current);
      }
      const found = await checkForUpdate(currentVersionRef.current);
      if (found && found.version === getDismissedVersion()) {
        setUpdate(null);
      } else {
        setUpdate(found);
      }
    } catch (err) {
      console.error("[useUpdateChecker] update check failed:", err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    runCheck();
    const interval = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runCheck]);

  const dismiss = useCallback(() => {
    if (update) setDismissedVersion(update.version);
    setUpdate(null);
  }, [update]);

  return { update, checking, currentVersion, checkNow: runCheck, dismiss };
}
