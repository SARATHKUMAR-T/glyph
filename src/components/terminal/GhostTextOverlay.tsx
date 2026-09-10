import type { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";

type GhostTextOverlayProps = {
  /** Full completion text (e.g. "Desktop/") */
  completionText: string;
  /** What the user already typed (the active token clean text) */
  typedText: string;
  /** Whether to show */
  visible: boolean;
  /** xterm Terminal instance ref */
  terminalRef: React.RefObject<XTerm | null>;
  /** The xterm-host container div ref */
  hostRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * VS Code / Fish–style inline ghost text.
 *
 * Rendered as a sibling of .xterm-host inside .terminal-main-stage
 * (which has position:relative). We offset by the host element's
 * offsetTop/Left so the text sits pixel-perfectly at the cursor.
 *
 * Accept: Tab (popup) · → Right Arrow (ghost text only)
 */
export function GhostTextOverlay({
  completionText,
  typedText,
  visible,
  terminalRef,
  hostRef,
}: GhostTextOverlayProps) {
  const spanRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const span = spanRef.current;
    const term = terminalRef.current;
    const host = hostRef.current;
    if (!span || !term || !host) return;

    if (!visible || !completionText) {
      span.style.display = "none";
      return;
    }

    // Compute the untyped suffix
    const lowerTyped = typedText.toLowerCase();
    const lowerComp = completionText.toLowerCase();

    let suffix = "";
    if (lowerComp.startsWith(lowerTyped)) {
      suffix = completionText.slice(typedText.length);
    } else {
      // Can't compute clean suffix — hide
      span.style.display = "none";
      return;
    }

    if (!suffix) {
      span.style.display = "none";
      return;
    }

    // Read xterm internal cell dimensions
    const renderService = (
      term as unknown as {
        _core?: {
          _renderService?: {
            dimensions?: { css?: { cell?: { width: number; height: number } } };
          };
        };
      }
    )._core?._renderService;

    const cellW = renderService?.dimensions?.css?.cell?.width ?? 9;
    const cellH = renderService?.dimensions?.css?.cell?.height ?? 18;

    // Cursor position within xterm's buffer
    const buffer = term.buffer.active;
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY;

    // Padding inside the host element (set in CSS as 6px top, 12px left)
    const hostStyle = window.getComputedStyle(host);
    const padLeft = parseFloat(hostStyle.paddingLeft) || 12;
    const padTop = parseFloat(hostStyle.paddingTop) || 6;

    // host's offset within its positioned parent (.terminal-main-stage)
    const hostOffsetLeft = host.offsetLeft;
    const hostOffsetTop = host.offsetTop;

    const leftPx = hostOffsetLeft + padLeft + cursorX * cellW;
    const topPx = hostOffsetTop + padTop + cursorY * cellH;

    span.textContent = suffix;
    span.style.display = "inline";
    span.style.left = `${leftPx}px`;
    span.style.top = `${topPx}px`;
    span.style.height = `${cellH}px`;
    span.style.lineHeight = `${cellH}px`;
    // Match xterm's font size exactly
    span.style.fontSize = `${(term.options.fontSize ?? 13)}px`;
  });

  return (
    <span
      ref={spanRef}
      className="ghost-text-overlay"
      aria-hidden="true"
      style={{ display: "none" }}
    />
  );
}
