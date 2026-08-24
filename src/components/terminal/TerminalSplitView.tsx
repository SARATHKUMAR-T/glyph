import type { SplitNode } from "../../lib/terminal/types";
import { SplitResizer } from "./SplitResizer";

type TerminalSplitViewProps = {
  node: SplitNode;
  onResizeSplit: (splitId: string, ratio: number) => void;
};

/**
 * Renders the split layout tree as nested flex containers.
 *
 * Leaf (pane) nodes render an empty placeholder div with a
 * `data-pane-target` attribute. The actual TerminalView is rendered
 * elsewhere via TerminalPanePortals and projected into the placeholder
 * using React portals + imperative DOM reparenting. This ensures that
 * splitting a pane never unmounts the existing TerminalView instance.
 */
export function TerminalSplitView({
  node,
  onResizeSplit,
}: TerminalSplitViewProps) {
  if (node.type === "pane") {
    return (
      <div
        className="pane-portal-target"
        data-pane-target={node.pane.paneId}
        style={{ width: "100%", height: "100%" }}
      />
    );
  }

  const isVertical = node.direction === "vertical";
  const flexDir = isVertical ? "row" : "column";
  const flexStyle0 = { flex: `${node.ratio} ${node.ratio} 0%` };
  const flexStyle1 = { flex: `${1 - node.ratio} ${1 - node.ratio} 0%` };

  return (
    <div
      className={`split-container split-container-${node.direction}`}
      style={{ display: "flex", flexDirection: flexDir, width: "100%", height: "100%" }}
    >
      <div className="split-pane-wrapper" style={flexStyle0}>
        <TerminalSplitView
          node={node.children[0]}
          onResizeSplit={onResizeSplit}
        />
      </div>

      <SplitResizer
        direction={node.direction}
        onResize={(newRatio) => onResizeSplit(node.id, newRatio)}
      />

      <div className="split-pane-wrapper" style={flexStyle1}>
        <TerminalSplitView
          node={node.children[1]}
          onResizeSplit={onResizeSplit}
        />
      </div>
    </div>
  );
}
