export type CommandConfig = {
  program: string;
  args: string[];
};

/** What a pane does when its startup command loses its network
 * connection — see `useConnectionWatch`. */
export type ConnectionLossAction = "off" | "warn" | "restart";

export type WorkspacePaneConfig = {
  id: string;
  name: string;
  cwd?: string | null;
  command?: string | CommandConfig | null;
  onConnectionLoss?: ConnectionLossAction;
};

export type WorkspaceLayoutNode =
  | {
      type: "pane";
      paneId: string;
    }
  | {
      type: "split";
      id: string;
      direction: "vertical" | "horizontal";
      ratio: number;
      children: [WorkspaceLayoutNode, WorkspaceLayoutNode];
    };

export type Workspace = {
  id: string;
  name: string;
  description?: string | null;
  layout: WorkspaceLayoutNode;
  panes: WorkspacePaneConfig[];
  /** Bring this workspace's tab back on the next launch with each pane's
   * startup command re-run (an `ssh`, a `docker exec`, ...), so its
   * connections are restored. */
  preservePanes?: boolean;
  createdAt: number;
  updatedAt: number;
};

/** One open tab's layout, for the auto-saved session — see `Session`. */
export type SessionTab = {
  title: string;
  layout: WorkspaceLayoutNode;
  panes: WorkspacePaneConfig[];
  /** See `TerminalTabModel.preservePanes`. */
  preservePanes?: boolean;
  /** See `TerminalTabModel.workspaceId`. */
  workspaceId?: string | null;
};

/** The whole window's open tabs, auto-saved on every structural change and
 * restored on the next launch (see `useSessionPersistence` and
 * `resolveInitialSession`) — separate from user-named `Workspace`s, which
 * are saved only by explicit action. */
export type Session = {
  tabs: SessionTab[];
  activeTabIndex: number;
  savedAt: number;
};
