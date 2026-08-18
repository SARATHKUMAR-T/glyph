import { useEffect, useState } from "react";
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

export function useSystemPerfStats(enabled: boolean) {
  const [stats, setStats] = useState<SystemPerfData>({
    cpuUsage: 12,
    memUsedStr: "4.1G",
    memTotalStr: "16G",
    memPercentage: 25,
    cacheStr: "2.3G",
    swapStr: "0.1G",
    fps: 60,
  });

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let frameCount = 0;
    let lastTime = performance.now();
    let currentFps = 60;

    // Track FPS
    const updateFps = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        currentFps = Math.round((frameCount * 1000) / (now - lastTime));
        frameCount = 0;
        lastTime = now;
      }
      if (mounted && enabled) {
        requestAnimationFrame(updateFps);
      }
    };
    const animId = requestAnimationFrame(updateFps);

    const fetchStats = async () => {
      if (!mounted) return;

      if (isTauriRuntime()) {
        try {
          const raw = await invoke<RawPerfStats>("get_system_perf_stats");
          if (mounted) {
            setStats({
              cpuUsage: Math.round(raw.cpuUsage),
              memUsedStr: formatBytes(raw.memUsedBytes),
              memTotalStr: formatBytes(raw.memTotalBytes),
              memPercentage: Math.round(raw.memPercentage),
              cacheStr: formatBytes(raw.cacheBytes),
              swapStr: formatBytes(raw.swapUsedBytes),
              fps: currentFps,
            });
          }
        } catch (err) {
          console.error("[useSystemPerfStats] error:", err);
        }
      } else {
        // Mock realistic stats for web preview
        const mockCpu = Math.round(8 + Math.random() * 12);
        const mockMemUsed = 4.2 + (Math.random() * 0.4 - 0.2);
        const mockCache = 2.1 + (Math.random() * 0.2 - 0.1);
        if (mounted) {
          setStats({
            cpuUsage: mockCpu,
            memUsedStr: `${mockMemUsed.toFixed(1)}G`,
            memTotalStr: "16G",
            memPercentage: Math.round((mockMemUsed / 16) * 100),
            cacheStr: `${mockCache.toFixed(1)}G`,
            swapStr: "0.1G",
            fps: currentFps,
          });
        }
      }
    };

    void fetchStats();
    const interval = setInterval(fetchStats, 1500);

    return () => {
      mounted = false;
      cancelAnimationFrame(animId);
      clearInterval(interval);
    };
  }, [enabled]);

  return stats;
}
