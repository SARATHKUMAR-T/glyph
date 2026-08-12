import type { TerminalBlock } from "../../lib/terminal/types";

type TerminalBlockHeaderProps = {
  block: TerminalBlock;
};

function duration(block: TerminalBlock) {
  if (!block.finishedAt) {
    return "running";
  }

  const ms = block.finishedAt - block.startedAt;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function TerminalBlockHeader({ block }: TerminalBlockHeaderProps) {
  const exit = block.exitCode === null || block.exitCode === undefined ? "…" : block.exitCode;

  return (
    <div className="terminal-block-header">
      <span className={`block-dot block-${block.status}`} aria-hidden="true" />
      <span>{block.status}</span>
      <span>{duration(block)}</span>
      <span>{exit}</span>
    </div>
  );
}
