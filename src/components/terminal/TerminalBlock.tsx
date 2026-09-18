import type { TerminalBlock as TerminalBlockModel } from "../../lib/terminal/types";
import { TerminalBlockHeader } from "./TerminalBlockHeader";

type TerminalBlockProps = {
  block: TerminalBlockModel;
  onRerun: (block: TerminalBlockModel) => void;
  onCopyCommand: (block: TerminalBlockModel) => void;
  onCopyOutput: (block: TerminalBlockModel) => void;
};

export function TerminalBlock({ block, onRerun, onCopyCommand, onCopyOutput }: TerminalBlockProps) {
  const hasCommand = Boolean(block.command);
  const hasOutput = block.outputStartLine !== undefined && block.outputEndLine !== undefined;

  return (
    <article className={`terminal-block terminal-block-${block.status}`}>
      <TerminalBlockHeader block={block} />
      <div className="terminal-block-command" title={block.command}>
        {block.command || "OSC 133 command"}
      </div>
      <div className="terminal-block-actions">
        <button
          type="button"
          className="terminal-block-action-btn"
          disabled={!hasCommand}
          title="Re-run command"
          aria-label="Re-run command"
          onClick={(e) => {
            e.stopPropagation();
            onRerun(block);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 1 3 6.7" />
            <path d="M3 21v-6h6" />
          </svg>
        </button>
        <button
          type="button"
          className="terminal-block-action-btn"
          disabled={!hasCommand}
          title="Copy command"
          aria-label="Copy command"
          onClick={(e) => {
            e.stopPropagation();
            onCopyCommand(block);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="8" width="13" height="13" rx="2" />
            <path d="M4 16V4a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
        <button
          type="button"
          className="terminal-block-action-btn"
          disabled={!hasOutput}
          title="Copy output"
          aria-label="Copy output"
          onClick={(e) => {
            e.stopPropagation();
            void onCopyOutput(block);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h11l5 5v11H4z" />
            <path d="M15 4v5h5" />
          </svg>
        </button>
      </div>
    </article>
  );
}
