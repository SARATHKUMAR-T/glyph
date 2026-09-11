import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";

import { TERMINAL_FONT_FAMILY } from "../../lib/constants";
import { CanvasGridRenderer, measureCellMetrics } from "../../lib/terminal/CanvasGridRenderer";
import { WebGL2GridRenderer } from "../../lib/terminal/WebGL2GridRenderer";
import type { GridRenderer, SelectionRange } from "../../lib/terminal/GridRenderer";
import { absoluteRowToViewport, displayOffsetToReveal, viewportRowToGridLine } from "../../lib/terminal/coords";
import { linkAt } from "../../lib/terminal/linkDetection";
import { encodeKeyEvent } from "../../lib/terminal/keyEncoding";
import {
  createTerminalSession,
  openExternalUrl,
  resizeTerminalSession,
  writeTerminalData,
} from "../../hooks/useTerminalSession";
import { isTauriRuntime, listenTerminalSemantic } from "../../lib/terminal/events";
import { matchesKeyCombo } from "../../hooks/useKeybindings";
import { TerminalBlock } from "./TerminalBlock";
import type { TerminalViewProps } from "./TerminalView";

const LINE_HEIGHT = 1.18;
const WHEEL_LINES_PER_TICK = 3;

interface SearchMatch {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wordBoundsAt(text: string, col: number): [number, number] {
  const isBoundary = (c: string | undefined) => c === undefined || c === " " || c === "";
  if (isBoundary(text[col])) return [col, col];
  let start = col;
  let end = col;
  while (start > 0 && !isBoundary(text[start - 1])) start--;
  while (end < text.length - 1 && !isBoundary(text[end + 1])) end++;
  return [start, end];
}

/** Tries WebGL2 first (the Phase 3 renderer: glyph atlas + instanced
 * quads), falling back to the Phase 2 Canvas2D renderer if WebGL2 context
 * creation or shader setup fails for any reason (old GPU/driver, WebGL
 * disabled, etc). Both implement the same `GridRenderer` interface and
 * consume the identical binary frame format, so the fallback is silent to
 * everything else in this component. */
function createRenderer(canvas: HTMLCanvasElement, opts: { fontFamily: string; fontSize: number; lineHeight: number }): GridRenderer {
  try {
    const renderer = new WebGL2GridRenderer(canvas, opts);
    console.info("[GlyphEngineTerminalView] using WebGL2 renderer");
    return renderer;
  } catch (err) {
    console.warn("[GlyphEngineTerminalView] WebGL2 renderer unavailable, falling back to Canvas2D:", err);
    return new CanvasGridRenderer(canvas, opts);
  }
}

/**
 * Experimental sibling to `TerminalView`: renders via the Rust grid engine
 * (`GLYPH_RUST_ENGINE=1`) instead of xterm.js, using WebGL2 (falling back
 * to Canvas2D) instead of the DOM. Chosen at the `TerminalPanePortals`
 * call site via `useEngineStatus()` — xterm.js remains the default and
 * this never runs unless the backend flag is on.
 *
 * Feature coverage as of Phase 4: mouse selection (simple, word/line via
 * double/triple-click, block via Alt+drag) with copy; scrollback via
 * mouse wheel; plain-text scrollback search (no regex, no match-count
 * badge — see `engine_search`); clickable http(s) links; committed-text
 * IME input (composition start/end tracked, but no inline composition
 * preview glyph the way xterm.js draws one). Explicitly NOT implemented:
 * mouse reporting to the child program (so vim/htop see no mouse events
 * even when they request tracking — keyboard-driven use of both already
 * works) and resize-reflow parity has not been specifically verified
 * against xterm.js. See the Phase 4 report for detail.
 */
export function GlyphEngineTerminalView({
  active,
  blocks,
  canClosePane = false,
  isPaneActive,
  isSplit = false,
  isExpanded = false,
  isWindowMaximized = false,
  keybindings,
  onClosePane,
  onCloseSearch,
  onExpandPane,
  onSemanticEvent,
  onSessionReady,
  onSessionResize,
  onSessionStatus,
  onSplitHorizontal,
  onSplitVertical,
  pane,
  searchOpen,
  settings,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<GridRenderer | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  const isComposingRef = useRef(false);
  const selectedTextRef = useRef<string | null>(null);
  const lastMatchRef = useRef<SearchMatch | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const dragRef = useRef<{
    row: number;
    col: number;
    block: boolean;
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    if (!isTauriRuntime()) {
      onSessionStatus(pane.paneId, "error", "Rust engine renderer requires the Tauri runtime");
      return;
    }

    let disposed = false;
    let resizeFrame = 0;
    const unlisteners: Array<() => void> = [];
    const fontSize = settings?.fontSize ?? 14;
    const { cellWidth, cellHeight } = measureCellMetrics(TERMINAL_FONT_FAMILY, fontSize, LINE_HEIGHT);

    const computeDims = () => {
      const cols = Math.max(20, Math.floor(host.clientWidth / cellWidth));
      const rows = Math.max(5, Math.floor(host.clientHeight / cellHeight));
      return { cols, rows };
    };

    async function boot() {
      onSessionStatus(pane.paneId, "starting");
      const { cols, rows } = computeDims();
      lastSizeRef.current = { cols, rows };

      const renderer = createRenderer(canvas!, {
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize,
        lineHeight: LINE_HEIGHT,
      });
      renderer.setGrid(cols, rows);
      renderer.setBlinkEnabled(active && isPaneActive && (settings?.cursorBlink ?? true));
      rendererRef.current = renderer;

      try {
        let sessionId = pane.sessionId ?? null;
        if (sessionId) {
          sessionIdRef.current = sessionId;
          onSessionStatus(pane.paneId, "running");
        } else {
          const info = await createTerminalSession({ cols, rows, cwd: pane.cwd ?? undefined });
          if (disposed) return;
          sessionId = info.sessionId;
          sessionIdRef.current = sessionId;
          onSessionReady(pane.paneId, info);
        }

        onSessionResize(pane.paneId, cols, rows);

        const channel = new Channel<ArrayBuffer | Uint8Array>((data) => {
          try {
            rendererRef.current?.applyFrameBytes(data);
          } catch (err) {
            console.error("[GlyphEngineTerminalView] failed to apply frame:", err);
          }
        });
        await invoke("engine_attach_channel", { sessionId, channel });

        const semUnlisten = await listenTerminalSemantic((evt) => {
          if (evt.sessionId === sessionIdRef.current) {
            onSemanticEvent(pane.paneId, evt);
          }
        });
        unlisteners.push(semUnlisten);

        if (isPaneActive) inputRef.current?.focus();
      } catch (error) {
        if (!disposed) {
          onSessionStatus(pane.paneId, "error", formatError(error));
        }
      }
    }

    void boot();

    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (disposed) return;
        const { cols, rows } = computeDims();
        if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) return;
        lastSizeRef.current = { cols, rows };
        rendererRef.current?.setGrid(cols, rows);
        onSessionResize(pane.paneId, cols, rows);
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void resizeTerminalSession(sessionId, { cols, rows }).catch((error: unknown) =>
            onSessionStatus(pane.paneId, "error", formatError(error)),
          );
        }
      });
    });
    resizeObserver.observe(host);

    // Attached natively (not via JSX onWheel) so preventDefault reliably
    // stops the page from also scrolling — React can mark delegated wheel
    // listeners passive.
    const handleWheelNative = (e: WheelEvent) => {
      const renderer = rendererRef.current;
      const sessionId = sessionIdRef.current;
      if (!renderer || !sessionId) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * WHEEL_LINES_PER_TICK;
      const history = renderer.getHistorySize();
      const next = Math.max(0, Math.min(history, renderer.getDisplayOffset() + delta));
      if (next === renderer.getDisplayOffset()) return;
      void invoke("engine_set_scroll", { sessionId, displayOffset: next }).catch(() => {});
    };
    host.addEventListener("wheel", handleWheelNative, { passive: false });

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      host.removeEventListener("wheel", handleWheelNative);
      unlisteners.forEach((u) => u());
      rendererRef.current?.dispose();
      rendererRef.current = null;
      sessionIdRef.current = null;
    };
    // Re-running this effect re-creates the session; only pane identity
    // should trigger that, matching TerminalView's own dependency choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.paneId]);

  useEffect(() => {
    rendererRef.current?.setBlinkEnabled(active && isPaneActive && (settings?.cursorBlink ?? true));
  }, [active, isPaneActive, settings?.cursorBlink]);

  useEffect(() => {
    if (active && isPaneActive && !searchOpen) {
      inputRef.current?.focus();
    }
  }, [active, isPaneActive, searchOpen]);

  useEffect(() => {
    if (searchOpen && isPaneActive) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    lastMatchRef.current = null;
  }, [searchOpen, isPaneActive]);

  const sendBytes = (bytes: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void writeTerminalData(sessionId, bytes).catch((error: unknown) =>
      onSessionStatus(pane.paneId, "error", formatError(error)),
    );
  };

  const pixelToCell = (clientX: number, clientY: number): { row: number; col: number } | null => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return null;
    const rect = canvas.getBoundingClientRect();
    const { cellWidth, cellHeight } = renderer.getCellMetrics();
    if (cellWidth <= 0 || cellHeight <= 0) return null;
    const { cols, rows } = lastSizeRef.current;
    const col = Math.max(0, Math.min(cols - 1, Math.floor((clientX - rect.left) / cellWidth)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / cellHeight)));
    return { row, col };
  };

  /** Fetches the authoritative selected text from the Rust engine (it
   * alone knows how to trim wide chars/reflow correctly) for the given
   * viewport-space range, caching it for the copy keybinding. */
  const commitSelection = async (sel: SelectionRange) => {
    const sessionId = sessionIdRef.current;
    const renderer = rendererRef.current;
    if (!sessionId || !renderer) return;
    const displayOffset = renderer.getDisplayOffset();
    const text = await invoke<string | null>("engine_selection_range", {
      sessionId,
      start: { line: viewportRowToGridLine(sel.startRow, displayOffset), column: sel.startCol },
      end: { line: viewportRowToGridLine(sel.endRow, displayOffset), column: sel.endCol },
      block: sel.block,
    }).catch(() => null);
    selectedTextRef.current = text;
  };

  const clearSelection = () => {
    rendererRef.current?.setSelection(null);
    selectedTextRef.current = null;
    const sessionId = sessionIdRef.current;
    if (sessionId) void invoke("engine_clear_selection", { sessionId }).catch(() => {});
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const renderer = rendererRef.current;
    const cell = pixelToCell(event.clientX, event.clientY);
    if (!renderer || !cell) return;
    inputRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.detail >= 3) {
      const sel: SelectionRange = { startRow: cell.row, startCol: 0, endRow: cell.row, endCol: lastSizeRef.current.cols - 1, block: false };
      renderer.setSelection(sel);
      void commitSelection(sel);
      dragRef.current = null;
      return;
    }
    if (event.detail === 2) {
      const [start, end] = wordBoundsAt(renderer.getRowText(cell.row), cell.col);
      const sel: SelectionRange = { startRow: cell.row, startCol: start, endRow: cell.row, endCol: end, block: false };
      renderer.setSelection(sel);
      void commitSelection(sel);
      dragRef.current = null;
      return;
    }

    clearSelection();
    dragRef.current = { row: cell.row, col: cell.col, block: event.altKey, clientX: event.clientX, clientY: event.clientY, moved: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const drag = dragRef.current;

    if (drag) {
      const cell = pixelToCell(event.clientX, event.clientY);
      if (!cell) return;
      if (Math.abs(event.clientX - drag.clientX) > 2 || Math.abs(event.clientY - drag.clientY) > 2) {
        drag.moved = true;
      }
      if (drag.moved) {
        renderer.setSelection({ startRow: drag.row, startCol: drag.col, endRow: cell.row, endCol: cell.col, block: drag.block });
      }
      return;
    }

    // Not dragging: hover-detect links.
    const canvas = canvasRef.current;
    const cell = pixelToCell(event.clientX, event.clientY);
    if (!canvas || !cell) return;
    const link = linkAt(renderer.getRowText(cell.row), cell.col);
    canvas.style.cursor = link ? "pointer" : "text";
    canvas.dataset.hoverLink = link?.url ?? "";
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const renderer = rendererRef.current;

    if (drag && drag.moved && renderer) {
      const cell = pixelToCell(event.clientX, event.clientY) ?? { row: drag.row, col: drag.col };
      const sel: SelectionRange = { startRow: drag.row, startCol: drag.col, endRow: cell.row, endCol: cell.col, block: drag.block };
      void commitSelection(sel);
      return;
    }

    // A click (no drag): open a hovered link, or clear any selection.
    const canvas = canvasRef.current;
    const url = canvas?.dataset.hoverLink;
    if (url) {
      void openExternalUrl(url);
      return;
    }
    clearSelection();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (keybindings && matchesKeyCombo(event.nativeEvent, keybindings.copy)) {
      event.preventDefault();
      if (selectedTextRef.current) {
        void navigator.clipboard?.writeText(selectedTextRef.current);
      }
      return;
    }
    if (keybindings?.paste && matchesKeyCombo(event.nativeEvent, keybindings.paste)) {
      event.preventDefault();
      void (async () => {
        const text = isTauriRuntime() ? await clipboardReadText() : await navigator.clipboard?.readText();
        if (text) sendBytes(text);
      })();
      return;
    }

    const encoded = encodeKeyEvent(event.nativeEvent);
    if (encoded !== null) {
      event.preventDefault();
      sendBytes(encoded);
    }
  };

  // Printable input and paste surface here as the textarea's native
  // `input` event. IME composition is deferred to `compositionend` below
  // so partial composition fragments are never sent to the PTY.
  const handleInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return;
    const value = event.currentTarget.value;
    if (value) {
      sendBytes(value);
      event.currentTarget.value = "";
    }
  };

  const handleCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const target = event.currentTarget;
    // The composed text is already in the textarea's value at this point;
    // let the input handler above pick it up on the next microtask so we
    // don't double-send if a trailing `input` event also fires.
    queueMicrotask(() => {
      if (target.value) {
        sendBytes(target.value);
        target.value = "";
      }
    });
  };

  const runSearch = async (direction: "Next" | "Previous", query: string) => {
    const sessionId = sessionIdRef.current;
    const renderer = rendererRef.current;
    if (!sessionId || !renderer || !query) return;

    const last = lastMatchRef.current;
    const fromRow = last ? (direction === "Next" ? last.endRow : last.startRow) : 0;
    const fromCol = last ? (direction === "Next" ? last.endCol + 1 : Math.max(0, last.startCol - 1)) : 0;

    const match = await invoke<SearchMatch | null>("engine_search", {
      sessionId,
      pattern: query,
      direction,
      fromRow,
      fromCol,
    }).catch(() => null);

    if (!match) {
      lastMatchRef.current = null;
      renderer.setSelection(null);
      return;
    }
    lastMatchRef.current = match;

    const historySize = renderer.getHistorySize();
    const predictedOffset = displayOffsetToReveal(match.startRow, historySize);
    renderer.setSelection({
      startRow: absoluteRowToViewport(match.startRow, predictedOffset, historySize),
      startCol: match.startCol,
      endRow: absoluteRowToViewport(match.endRow, predictedOffset, historySize),
      endCol: match.endCol,
      block: false,
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    lastMatchRef.current = null;
    if (value) void runSearch("Next", value);
    else rendererRef.current?.setSelection(null);
  };

  const activeClass =
    active && isPaneActive
      ? "terminal-view is-active is-active-pane"
      : active
        ? "terminal-view is-active"
        : "terminal-view";

  return (
    <div className={activeClass} onClick={() => inputRef.current?.focus()} tabIndex={-1}>
      <div className="pane-header-bar">
        <div className="pane-header-left">
          <span className={`pane-status-dot pane-status-${pane.status}`} aria-hidden="true" />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.5px",
              color: "var(--nothing-gray-100)",
              textTransform: "uppercase",
            }}
          >
            {pane.title ?? "engine preview"}
          </span>
        </div>
        <div className="pane-header-controls">
          {isSplit && !isExpanded && isWindowMaximized && (
            <button
              type="button"
              className="pane-control-btn"
              title="Expand Pane (Full Window)"
              onClick={(e) => {
                e.stopPropagation();
                onExpandPane?.(pane.paneId);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          {!isExpanded && (
            <>
              <button
                type="button"
                className="pane-control-btn"
                title="Split Right (Ctrl+Shift+D)"
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitVertical?.(pane.paneId);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
              </button>
              <button
                type="button"
                className="pane-control-btn"
                title="Split Down (Ctrl+Shift+O)"
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitHorizontal?.(pane.paneId);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
              {canClosePane && (
                <button
                  type="button"
                  className="pane-control-btn pane-control-close"
                  title="Close Pane (Ctrl+Shift+W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClosePane?.(pane.paneId);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <nav className="block-rail" aria-label="Terminal blocks">
        {blocks.length === 0 ? (
          <div className="block-empty">no executed blocks</div>
        ) : (
          blocks.map((block) => <TerminalBlock key={block.id} block={block} />)
        )}
      </nav>

      <section className="terminal-output" aria-label="Terminal stream (Rust engine preview)">
        {searchOpen && isPaneActive && (
          <div
            className="terminal-search"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={searchInputRef}
              type="text"
              className="terminal-search-input"
              placeholder="Search buffer..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  void runSearch(e.shiftKey ? "Previous" : "Next", searchQuery);
                } else if (e.key === "Escape") {
                  onCloseSearch();
                  rendererRef.current?.setSelection(null);
                  inputRef.current?.focus();
                }
              }}
            />
            <button
              type="button"
              className="terminal-search-btn"
              onClick={(e) => {
                e.stopPropagation();
                void runSearch("Previous", searchQuery);
              }}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              className="terminal-search-btn"
              onClick={(e) => {
                e.stopPropagation();
                void runSearch("Next", searchQuery);
              }}
              title="Next match (Enter)"
              aria-label="Next match"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              type="button"
              className="terminal-search-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSearch();
                rendererRef.current?.setSelection(null);
                inputRef.current?.focus();
              }}
              title="Close search (Escape)"
              aria-label="Close search"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div ref={hostRef} className="xterm-host glyph-canvas-host">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <textarea
            ref={inputRef}
            className="glyph-canvas-input-sink"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-hidden="true"
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={handleCompositionEnd}
          />
        </div>
      </section>
    </div>
  );
}
