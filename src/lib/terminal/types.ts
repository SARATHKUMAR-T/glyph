export type TerminalStatus = "starting" | "running" | "exited" | "error";

export type TerminalSessionInfo = {
  sessionId: string;
  shell: string;
  cols: number;
  rows: number;
  cwd?: string | null;
};

export type TerminalPaneModel = {
  paneId: string;
  sessionId?: string;
  shell?: string;
  cwd?: string | null;
  cols?: number;
  rows?: number;
  status: TerminalStatus;
  error?: string;
  title?: string;
  startupCommand?: string | { program: string; args: string[] } | null;
};

export type SplitDirection = "vertical" | "horizontal";

export type SplitNode =
  | {
      type: "pane";
      pane: TerminalPaneModel;
    }
  | {
      type: "split";
      id: string;
      direction: SplitDirection;
      ratio: number;
      children: [SplitNode, SplitNode];
    };

export type TerminalTabModel = {
  clientId: string;
  title: string;
  rootNode: SplitNode;
  activePaneId: string;
};

export type TerminalOutputEvent = {
  sessionId: string;
  data: string;
};

export type TerminalExitEvent = {
  sessionId: string;
  exitCode?: number | null;
  signal?: string | null;
};

export type TerminalErrorEvent = {
  sessionId?: string | null;
  code: string;
  message: string;
};

export type TerminalSemanticKind =
  | "prompt_start"
  | "command_input_start"
  | "command_execution_start"
  | "command_finished";

export type TerminalSemanticEvent = {
  sessionId: string;
  kind: TerminalSemanticKind;
  exitCode?: number | null;
  raw: string;
  timestamp: number;
};

export type TerminalBlockStatus = "running" | "success" | "error" | "interrupted";

export type TerminalBlock = {
  id: string;
  sessionId: string;
  command?: string;
  cwd?: string;
  status: TerminalBlockStatus;
  exitCode?: number | null;
  startedAt: number;
  finishedAt?: number;
};
