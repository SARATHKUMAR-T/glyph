import type { TerminalTabModel } from "./types";

export function reorderTabs<T extends TerminalTabModel>(
  tabs: T[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
): T[] {
  if (draggedId === targetId) return tabs;

  const dragged = tabs.find((tab) => tab.clientId === draggedId);
  if (!dragged) return tabs;

  const rest = tabs.filter((tab) => tab.clientId !== draggedId);
  const targetIndex = rest.findIndex((tab) => tab.clientId === targetId);
  if (targetIndex === -1) return tabs;

  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  return [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)];
}
