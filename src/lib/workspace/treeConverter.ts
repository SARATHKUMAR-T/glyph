import { createId } from "../terminal/splitTree";
import type { SplitNode, TerminalPaneModel } from "../terminal/types";
import type { Workspace, WorkspaceLayoutNode, WorkspacePaneConfig } from "./types";

/**
 * Converts a runtime `SplitNode` tree into a persistent `WorkspaceLayoutNode` tree
 * and extracts the array of `WorkspacePaneConfig` objects.
 */
export function splitNodeToWorkspaceLayout(
  root: SplitNode,
  paneTitles: Map<string, string> = new Map(),
  paneCwds: Map<string, string> = new Map(),
): { layout: WorkspaceLayoutNode; panes: WorkspacePaneConfig[] } {
  const panes: WorkspacePaneConfig[] = [];

  function traverse(node: SplitNode): WorkspaceLayoutNode {
    if (node.type === "pane") {
      const paneId = node.pane.paneId;
      const title = paneTitles.get(paneId) || node.pane.title || `Pane ${panes.length + 1}`;
      const cwd = paneCwds.get(paneId) || node.pane.cwd || null;

      panes.push({
        id: paneId,
        name: title,
        cwd: cwd ?? undefined,
        command: null,
      });

      return {
        type: "pane",
        paneId,
      };
    }

    return {
      type: "split",
      id: node.id || createId(),
      direction: node.direction,
      ratio: node.ratio,
      children: [traverse(node.children[0]), traverse(node.children[1])],
    };
  }

  const layout = traverse(root);
  return { layout, panes };
}

/**
 * Converts a persistent `WorkspaceLayoutNode` tree + `WorkspacePaneConfig[]`
 * into a runtime `SplitNode` tree ready to mount in `TerminalTabModel`.
 */
export function workspaceLayoutToSplitNode(
  layout: WorkspaceLayoutNode,
  paneConfigs: WorkspacePaneConfig[],
): { rootNode: SplitNode; panesById: Map<string, WorkspacePaneConfig> } {
  const panesById = new Map<string, WorkspacePaneConfig>();
  for (const pane of paneConfigs) {
    panesById.set(pane.id, pane);
  }

  function traverse(node: WorkspaceLayoutNode): SplitNode {
    if (node.type === "pane") {
      const config = panesById.get(node.paneId);
      const paneModel: TerminalPaneModel = {
        paneId: node.paneId || createId(),
        title: config?.name || "Terminal",
        cwd: config?.cwd ?? undefined,
        startupCommand: config?.command ?? undefined,
        status: "starting",
      };
      return {
        type: "pane",
        pane: paneModel,
      };
    }

    return {
      type: "split",
      id: node.id || createId(),
      direction: node.direction,
      ratio: node.ratio,
      children: [traverse(node.children[0]), traverse(node.children[1])],
    };
  }

  const rootNode = traverse(layout);
  return { rootNode, panesById };
}

/**
 * Generates a default layout for newly created workspaces (Single, 2 Panes, 4 Panes).
 */
export function createPresetWorkspaceLayout(
  preset: "single" | "two-vertical" | "two-horizontal" | "four-grid",
  workspaceName: string,
): { layout: WorkspaceLayoutNode; panes: WorkspacePaneConfig[] } {
  if (preset === "single") {
    const paneId = createId();
    return {
      layout: { type: "pane", paneId },
      panes: [{ id: paneId, name: `${workspaceName} Main`, cwd: undefined, command: null }],
    };
  }

  if (preset === "two-vertical") {
    const p1 = createId();
    const p2 = createId();
    return {
      layout: {
        type: "split",
        id: createId(),
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "pane", paneId: p1 },
          { type: "pane", paneId: p2 },
        ],
      },
      panes: [
        { id: p1, name: "Left Pane", cwd: undefined, command: null },
        { id: p2, name: "Right Pane", cwd: undefined, command: null },
      ],
    };
  }

  if (preset === "two-horizontal") {
    const p1 = createId();
    const p2 = createId();
    return {
      layout: {
        type: "split",
        id: createId(),
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "pane", paneId: p1 },
          { type: "pane", paneId: p2 },
        ],
      },
      panes: [
        { id: p1, name: "Top Pane", cwd: undefined, command: null },
        { id: p2, name: "Bottom Pane", cwd: undefined, command: null },
      ],
    };
  }

  // Four grid
  const p1 = createId();
  const p2 = createId();
  const p3 = createId();
  const p4 = createId();

  return {
    layout: {
      type: "split",
      id: createId(),
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "split",
          id: createId(),
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "pane", paneId: p1 },
            { type: "pane", paneId: p2 },
          ],
        },
        {
          type: "split",
          id: createId(),
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "pane", paneId: p3 },
            { type: "pane", paneId: p4 },
          ],
        },
      ],
    },
    panes: [
      { id: p1, name: "Frontend", cwd: undefined, command: null },
      { id: p2, name: "Backend", cwd: undefined, command: null },
      { id: p3, name: "Logs", cwd: undefined, command: null },
      { id: p4, name: "Shell", cwd: undefined, command: null },
    ],
  };
}

/**
 * Automatically builds a balanced, recursive split layout tree for any arbitrary N number of panes.
 */
export function buildNPaneLayout(panes: WorkspacePaneConfig[], depth: number = 0): WorkspaceLayoutNode {
  if (panes.length === 0) {
    const paneId = createId();
    return { type: "pane", paneId };
  }
  if (panes.length === 1) {
    return { type: "pane", paneId: panes[0].id || createId() };
  }

  const mid = Math.floor(panes.length / 2);
  const leftPanes = panes.slice(0, mid);
  const rightPanes = panes.slice(mid);
  const direction: "vertical" | "horizontal" = depth % 2 === 0 ? "vertical" : "horizontal";

  return {
    type: "split",
    id: createId(),
    direction,
    ratio: 0.5,
    children: [buildNPaneLayout(leftPanes, depth + 1), buildNPaneLayout(rightPanes, depth + 1)],
  };
}
