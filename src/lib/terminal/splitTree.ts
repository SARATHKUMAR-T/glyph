import type { SplitDirection, SplitNode, TerminalPaneModel } from "./types";

export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function createPaneNode(cwd?: string | null): SplitNode {
  return {
    type: "pane",
    pane: {
      paneId: createId(),
      status: "starting",
      cwd: cwd ?? undefined,
    },
  };
}

export function findPaneNode(root: SplitNode, paneId: string): TerminalPaneModel | null {
  if (root.type === "pane") {
    return root.pane.paneId === paneId ? root.pane : null;
  }
  return findPaneNode(root.children[0], paneId) ?? findPaneNode(root.children[1], paneId);
}

export function getAllPanesInTree(root: SplitNode): TerminalPaneModel[] {
  if (root.type === "pane") {
    return [root.pane];
  }
  return [...getAllPanesInTree(root.children[0]), ...getAllPanesInTree(root.children[1])];
}

export function updatePaneInTree(
  root: SplitNode,
  paneId: string,
  patch: Partial<TerminalPaneModel>,
): SplitNode {
  if (root.type === "pane") {
    if (root.pane.paneId === paneId) {
      return {
        ...root,
        pane: { ...root.pane, ...patch },
      };
    }
    return root;
  }
  return {
    ...root,
    children: [
      updatePaneInTree(root.children[0], paneId, patch),
      updatePaneInTree(root.children[1], paneId, patch),
    ],
  };
}

export function updateSplitRatioInTree(
  root: SplitNode,
  splitId: string,
  ratio: number,
): SplitNode {
  if (root.type === "pane") {
    return root;
  }
  const clampedRatio = Math.max(0.15, Math.min(0.85, ratio));
  if (root.id === splitId) {
    return {
      ...root,
      ratio: clampedRatio,
    };
  }
  return {
    ...root,
    children: [
      updateSplitRatioInTree(root.children[0], splitId, ratio),
      updateSplitRatioInTree(root.children[1], splitId, ratio),
    ],
  };
}

export function splitPaneInTree(
  root: SplitNode,
  targetPaneId: string,
  direction: SplitDirection,
  newPane: TerminalPaneModel,
): SplitNode {
  if (root.type === "pane") {
    if (root.pane.paneId === targetPaneId) {
      const existingChild: SplitNode = root;
      const newChild: SplitNode = { type: "pane", pane: newPane };
      return {
        type: "split",
        id: createId(),
        direction,
        ratio: 0.5,
        children: [existingChild, newChild],
      };
    }
    return root;
  }
  return {
    ...root,
    children: [
      splitPaneInTree(root.children[0], targetPaneId, direction, newPane),
      splitPaneInTree(root.children[1], targetPaneId, direction, newPane),
    ],
  };
}

export function removePaneFromTree(root: SplitNode, targetPaneId: string): SplitNode | null {
  if (root.type === "pane") {
    return root.pane.paneId === targetPaneId ? null : root;
  }

  const leftResult = removePaneFromTree(root.children[0], targetPaneId);
  const rightResult = removePaneFromTree(root.children[1], targetPaneId);

  if (leftResult === null) {
    return rightResult;
  }
  if (rightResult === null) {
    return leftResult;
  }

  return {
    ...root,
    children: [leftResult, rightResult],
  };
}
