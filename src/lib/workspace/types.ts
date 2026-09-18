export type CommandConfig = {
  program: string;
  args: string[];
};

export type WorkspacePaneConfig = {
  id: string;
  name: string;
  cwd?: string | null;
  command?: string | CommandConfig | null;
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
  createdAt: number;
  updatedAt: number;
};

/** One open tab's layout, for the auto-saved session — see `Session`. */
export type SessionTab = {
  title: string;
  layout: WorkspaceLayoutNode;
  panes: WorkspacePaneConfig[];
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
