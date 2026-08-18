import type { TerminalPaneModel } from "../../lib/terminal/types";

type TerminalStatusProps = {
  pane: TerminalPaneModel;
};

function basename(path?: string | null) {
  if (!path) {
    return "shell";
  }

  return path.split("/").filter(Boolean).pop() ?? path;
}

function formatCwd(path?: string | null) {
  if (!path) return "~";
  return path.replace(/\/home\/[^/]+/, "~");
}

export function TerminalStatus({ pane }: TerminalStatusProps) {
  const size = pane.cols && pane.rows ? `${pane.cols}×${pane.rows}` : "measuring";
  const cwdDisplay = formatCwd(pane.cwd);

  return (
    <div className="terminal-status">
      <span className={`terminal-status-dot status-${pane.status}`} aria-hidden="true" />
      <span>{pane.status}</span>
      <span>{basename(pane.shell)}</span>
      <span>{pane.title}</span>
      <span className="terminal-status-pwd" title={pane.cwd || "~"}>{cwdDisplay}</span>
      <span>{size}</span>
      {pane.error ? <span className="terminal-status-error">{pane.error}</span> : null}
    </div>
  );
}
