import { useSystemPerfStats } from "../../hooks/useSystemPerfStats";

type PerformanceBarProps = {
  enabled: boolean;
};

export function PerformanceBar({ enabled }: PerformanceBarProps) {
  const stats = useSystemPerfStats(enabled);

  if (!enabled) return null;

  // CPU 10-box calculations
  const cpu = stats.cpuUsage;
  const cpuFilledCount = Math.min(10, Math.max(cpu > 0 ? 1 : 0, Math.round(cpu / 10)));

  let cpuColorClass = "cpu-box-green";
  if (cpu > 75) {
    cpuColorClass = "cpu-box-red";
  } else if (cpu > 50) {
    cpuColorClass = "cpu-box-yellow";
  }

  // RAM 10-box calculations
  const memPct = stats.memPercentage;
  const ramFilledCount = Math.min(10, Math.max(memPct > 0 ? 1 : 0, Math.round(memPct / 10)));

  let ramColorClass = "cpu-box-green";
  if (memPct > 75) {
    ramColorClass = "cpu-box-red";
  } else if (memPct > 50) {
    ramColorClass = "cpu-box-yellow";
  }

  const isHighLoad = cpu > 75 || memPct > 85;
  const isMedLoad = (cpu > 50 && cpu <= 75) || (memPct > 65 && memPct <= 85);
  const statusClass = isHighLoad ? "load-high" : isMedLoad ? "load-med" : "load-normal";

  return (
    <div className="glyph-perf-bar" data-tauri-drag-region title="System Performance Metrics">
      {/* Live Status LED */}
      <span className={`perf-status-led ${statusClass}`} title={`System Load — CPU: ${cpu}%, RAM: ${memPct}%`} />

      {/* CPU Metric with 10 Boxes */}
      <div className="perf-item" title={`CPU Usage: ${cpu}%`}>
        <span className="perf-label">CPU</span>
        <span className="perf-value">{cpu}%</span>

        <div className="cpu-boxes-container">
          {Array.from({ length: 10 }).map((_, index) => {
            const isFilled = index < cpuFilledCount;
            return (
              <span
                key={index}
                className={`cpu-box ${isFilled ? `is-filled ${cpuColorClass}` : "is-empty"}`}
              />
            );
          })}
        </div>
      </div>

      <span className="perf-sep" />

      {/* RAM Metric with Text Metric and 10-Box Progress Bar */}
      <div className="perf-item" title={`RAM Used: ${stats.memUsedStr} / Total: ${stats.memTotalStr} (${memPct}%)`}>
        <span className="perf-label">RAM</span>
        <span className="perf-value">
          {stats.memUsedStr}<span className="perf-dim">/</span>{stats.memTotalStr}
        </span>

        <div className="cpu-boxes-container">
          {Array.from({ length: 10 }).map((_, index) => {
            const isFilled = index < ramFilledCount;
            return (
              <span
                key={index}
                className={`cpu-box ${isFilled ? `is-filled ${ramColorClass}` : "is-empty"}`}
              />
            );
          })}
        </div>
      </div>

      <span className="perf-sep" />

      {/* Cache Metric */}
      <div className="perf-item" title={`Cached Memory: ${stats.cacheStr}`}>
        <span className="perf-label">CACHE</span>
        <span className="perf-value">{stats.cacheStr}</span>
      </div>
    </div>
  );
}
