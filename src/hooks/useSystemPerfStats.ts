import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/terminal/events";

export type SystemPerfData = {
  cpuUsage: number;
  memUsedStr: string;
  memTotalStr: string;
  memPercentage: number;
  cacheStr: string;
  swapStr: string;
  fps: number;
};

type RawPerfStats = {
  cpuUsage: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercentage: number;
  cacheBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}G`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)}M`;
}

const POLL_MS = 2000;

const INITIAL_STATS: SystemPerfData = {
  cpuUsage: 12,
  memUsedStr: "4.1G",
  memTotalStr: "16G",
  memPercentage: 25,
  cacheStr: "2.3G",
  swapStr: "0.1G",
  fps: 60,
};

// One shared poller no matter how many <PerformanceBar>s are mounted (the
// title bar renders it for both its desktop and narrow layouts). It only
// runs while someone is subscribed and the window is visible, and it only
// notifies React when a displayed value actually changed.
let current: SystemPerfData = INITIAL_STATS;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: SystemPerfData) {
  if (
    next.cpuUsage === current.cpuUsage &&
    next.memUsedStr === current.memUsedStr &&
    next.memTotalStr === current.memTotalStr &&
    next.memPercentage === current.memPercentage &&
    next.cacheStr === current.cacheStr &&
    next.swapStr === current.swapStr
  ) {
    return;
  }
  current = next;
  listeners.forEach((listener) => listener());
}

async function fetchStats() {
  if (isTauriRuntime()) {
    try {
      const raw = await invoke<RawPerfStats>("get_system_perf_stats");
      publish({
        cpuUsage: Math.round(raw.cpuUsage),
        memUsedStr: formatBytes(raw.memUsedBytes),
        memTotalStr: formatBytes(raw.memTotalBytes),
        memPercentage: Math.round(raw.memPercentage),
        cacheStr: formatBytes(raw.cacheBytes),
        swapStr: formatBytes(raw.swapUsedBytes),
        fps: 60,
      });
    } catch (err) {
      console.error("[useSystemPerfStats] error:", err);
    }
    return;
  }
  // Mock realistic stats for web preview
  const mockMemUsed = 4.2 + (Math.random() * 0.4 - 0.2);
  const mockCache = 2.1 + (Math.random() * 0.2 - 0.1);
  publish({
    cpuUsage: Math.round(8 + Math.random() * 12),
    memUsedStr: `${mockMemUsed.toFixed(1)}G`,
    memTotalStr: "16G",
    memPercentage: Math.round((mockMemUsed / 16) * 100),
    cacheStr: `${mockCache.toFixed(1)}G`,
    swapStr: "0.1G",
    fps: 60,
  });
}

function startPolling() {
  if (timer !== null || document.hidden) return;
  void fetchStats();
  timer = setInterval(() => void fetchStats(), POLL_MS);
}

function stopPolling() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function onVisibilityChange() {
  if (listeners.size === 0) return;
  if (document.hidden) stopPolling();
  else startPolling();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    startPolling();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    }
  };
}

const getSnapshot = () => current;
const subscribeNone = () => () => {};

export function useSystemPerfStats(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : subscribeNone, getSnapshot);
}
