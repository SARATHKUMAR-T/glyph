import { createId, createPaneNode } from "./splitTree";
import type { TerminalPaneModel, TerminalTabModel } from "./types";

/** Builds a single-pane tab with no split — the shape both a fresh "New
 * Terminal" and the fallback when there's no session to restore
 * (`resolveInitialSession`) start from. */
export function createTab(index: number, cwd?: string | null): TerminalTabModel {
  const rootNode = createPaneNode(cwd);
  const initialPane = (rootNode as { pane: TerminalPaneModel }).pane;
  return {
    clientId: createId(),
    title: `Terminal ${index}`,
    rootNode,
    activePaneId: initialPane.paneId,
  };
}
