import type { SplitNode } from "../../lib/terminal/types";
import { SplitResizer } from "./SplitResizer";

type TerminalSplitViewProps = {
  node: SplitNode;
  onResizeSplit: (splitId: string, ratio: number) => void;
  /**
   * When set, the placeholder for this pane is hidden from the split tree
   * so the pane's terminal can be shown enlarged elsewhere (e.g. in a modal).
   */
  expandedPaneId?: string;
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
  expandedPaneId,
}: TerminalSplitViewProps) {
  if (node.type === "pane") {
    if (node.pane.paneId === expandedPaneId) {
      // Show styled placeholder in the split layout while enlarged elsewhere
      return (
        <div
          key={node.pane.paneId}
          className="pane-portal-target split-pane-expanded-placeholder"
        >
          <div className="expanded-placeholder-content">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Expanded in Modal</span>
          </div>
        </div>
      );
    }
    return (
      <div
        key={node.pane.paneId}
        className="pane-portal-target"
        data-pane-target={node.pane.paneId}
      />
    );
  }

  const isVertical = node.direction === "vertical";
  const flexDir = isVertical ? "row" : "column";
  const flexStyle0 = { flex: `${node.ratio} ${node.ratio} 0%` };
  const flexStyle1 = { flex: `${1 - node.ratio} ${1 - node.ratio} 0%` };

  return (
    <div
      key={node.id}
      className={`split-container split-container-${node.direction}`}
      style={{ display: "flex", flexDirection: flexDir, width: "100%", height: "100%", flex: "1 1 0%" }}
    >
      <div key={`${node.id}-0`} className="split-pane-wrapper" style={flexStyle0}>
        <TerminalSplitView
          node={node.children[0]}
          onResizeSplit={onResizeSplit}
          expandedPaneId={expandedPaneId}
        />
      </div>

      <SplitResizer
        key={`${node.id}-resizer`}
        direction={node.direction}
        onResize={(newRatio) => onResizeSplit(node.id, newRatio)}
      />

      <div key={`${node.id}-1`} className="split-pane-wrapper" style={flexStyle1}>
        <TerminalSplitView
          node={node.children[1]}
          onResizeSplit={onResizeSplit}
          expandedPaneId={expandedPaneId}
        />
      </div>
    </div>
  );
}
