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
  /** Frontend-only enrichment, never set by the Rust-emitted event itself —
   * added by `GlyphEngineTerminalView`'s semantic listener on
   * `command_execution_start` by reading the command line's text straight
   * off the grid at the cursor's row. Powers the block rail's "re-run" and
   * "copy command" actions. */
  commandText?: string;
  /** Frontend-only enrichment: the alacritty grid `Line` (can be negative —
   * scrollback-relative, same space `engine_selection_range` expects) at
   * this event's cursor position. `command_execution_start`'s value is a
   * block's output-start bound, `command_finished`'s is its output-end
   * bound — both approximate (the cursor's row at the moment the boundary
   * fired), not byte-exact. */
  gridLine?: number;
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
  /** See `TerminalSemanticEvent.gridLine` — the pair of grid lines
   * bounding this block's output, for "Copy output" via
   * `engine_selection_range`. Unset until both boundary events land. */
  outputStartLine?: number;
  outputEndLine?: number;
};
