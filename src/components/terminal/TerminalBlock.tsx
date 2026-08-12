import type { TerminalBlock as TerminalBlockModel } from "../../lib/terminal/types";
import { TerminalBlockHeader } from "./TerminalBlockHeader";

type TerminalBlockProps = {
  block: TerminalBlockModel;
};

export function TerminalBlock({ block }: TerminalBlockProps) {
  return (
    <article className="terminal-block">
      <TerminalBlockHeader block={block} />
      <div className="terminal-block-command">{block.command ?? "OSC 133 command"}</div>
    </article>
  );
}
