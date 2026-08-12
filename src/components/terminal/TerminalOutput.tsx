import type { PropsWithChildren } from "react";

export function TerminalOutput({ children }: PropsWithChildren) {
  return <div className="terminal-output">{children}</div>;
}
