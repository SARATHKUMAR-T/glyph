import type { TerminalTabModel } from "../../lib/terminal/types";

type TerminalStatusProps = {
  tab: TerminalTabModel;
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

export function TerminalStatus({ tab }: TerminalStatusProps) {
  const size = tab.cols && tab.rows ? `${tab.cols}×${tab.rows}` : "measuring";
  const cwdDisplay = formatCwd(tab.cwd);

  return (
    <div className="terminal-status">
      <span className={`terminal-status-dot status-${tab.status}`} aria-hidden="true" />
      <span>{tab.status}</span>
      <span>{basename(tab.shell)}</span>
      <span>{tab.title}</span>
      <span className="terminal-status-pwd" title={tab.cwd || "~"}>{cwdDisplay}</span>
      <span>{size}</span>
      {tab.error ? <span className="terminal-status-error">{tab.error}</span> : null}
    </div>
  );
}
