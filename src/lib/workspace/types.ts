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
