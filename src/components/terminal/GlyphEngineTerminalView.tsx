import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";

import { TERMINAL_FONT_FAMILY } from "../../lib/constants";
import { CanvasGridRenderer, measureCellMetrics } from "../../lib/terminal/CanvasGridRenderer";
import { WebGL2GridRenderer } from "../../lib/terminal/WebGL2GridRenderer";
import type { GridRenderer, SelectionRange } from "../../lib/terminal/GridRenderer";
import { absoluteRowToViewport, displayOffsetToReveal, viewportRowToGridLine } from "../../lib/terminal/coords";
import { linkAt } from "../../lib/terminal/linkDetection";
import { encodeKeyEvent } from "../../lib/terminal/keyEncoding";
import { encodeMouseReport } from "../../lib/terminal/mouseReporting";
import { MouseTrackingLevel } from "../../lib/terminal/engineProtocol";
import {
  closeTerminalSession,
  createTerminalSession,
  openExternalUrl,
  pasteTerminalData,
  resizeTerminalSession,
  writeTerminalData,
} from "../../hooks/useTerminalSession";
import { isTauriRuntime, listenTerminalSemantic } from "../../lib/terminal/events";
import { matchesKeyCombo, type KeybindingsConfig } from "../../hooks/useKeybindings";
import type { TerminalSettings } from "../../hooks/useTerminalSettings";
import { formatErrorMessage, getRandomQuote } from "../../lib/supabase";
import type {
  TerminalBlock as TerminalBlockModel,
  TerminalPaneModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../lib/terminal/types";
import { TerminalBlock } from "./TerminalBlock";

export type TerminalViewProps = {
  active: boolean;
  isPaneActive: boolean;
  isSplit?: boolean;
  /** True when this pane is currently shown enlarged in the expanded-pane modal. */
  isExpanded?: boolean;
  pane: TerminalPaneModel;
  tabId: string;
  blocks: TerminalBlockModel[];
  keybindings: KeybindingsConfig;
  searchOpen: boolean;
  settings?: TerminalSettings;
  canClosePane?: boolean;
  onActivatePane: (paneId: string) => void;
  onCloseSearch: () => void;
  onCloseTerminal?: () => void;
  onClosePane?: (paneId: string) => void;
  onExpandPane?: (paneId: string) => void;
  onSplitVertical?: (paneId: string) => void;
  onSplitHorizontal?: (paneId: string) => void;
  onNewTerminal?: () => void;
  onNewWindow?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onSearch?: () => void;
  onSemanticEvent: (paneId: string, event: TerminalSemanticEvent) => void;
  onSessionReady: (paneId: string, info: TerminalSessionInfo) => void;
  onSessionResize: (paneId: string, cols: number, rows: number) => void;
  onSessionStatus: (paneId: string, status: TerminalStatus, error?: string) => void;
  onTitleChange?: (paneId: string, title: string) => void;
  isWindowMaximized?: boolean;
  onToggleSettings?: () => void;
};

const LINE_HEIGHT = 1.18;
const WHEEL_LINES_PER_TICK = 3;
const SCROLLBAR_MIN_THUMB_PX = 24;
const MULTI_CLICK_MS = 500;

interface SearchMatch {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  index: number;
  count: number;
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

/** Splits a rendered line into its shell-prompt prefix (matched by the
 * same heuristic the old xterm.js-based TerminalView used: text up to and
 * including the last `$ `/`# `/`% `/`> ` prompt terminator) and whatever
 * follows it — the "active input" both Select All and the `quote`
 * built-in below care about.
 *
 * `getRowText` returns the row padded out to the full column width (blank
 * cells are literal spaces), unlike xterm.js's `translateToString(true)`
 * which trims trailing whitespace — so trailing spaces are trimmed here
 * first, or the computed range would always run to the last column
 * instead of stopping at the actual end of what was typed. */
function activeInputRange(lineText: string): { start: number; text: string } {
  const trimmed = lineText.replace(/\s+$/, "");
  const match = trimmed.match(/^(.*(?:\$\s|#\s|%\s|>\s))/);
  const start = match ? match[1].length : 0;
  return { start, text: trimmed.slice(start) };
}

const QUOTE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** The `quote` built-in: typing `quote` + Enter at a shell prompt shows a
 * short animated fetch, then a quote, without the shell ever seeing the
 * command. Ported from the old xterm.js-based `builtinCommands.ts`,
 * adapted for a renderer with no client-side-only "just paint this text"
 * API — `engine_feed_local` fills that role, injecting bytes straight
 * into this session's `GridEngine` the same way real PTY output would,
 * but bypassing the PTY (and therefore the real shell process) entirely.
 *
 * Ordering matters here: every local write below happens synchronously
 * (in issue order, well before the round trip a real PTY write needs) so
 * they're guaranteed to land in the grid before the final real PTY write
 * in `finally` — sending that first would race the local writes and could
 * interleave with them.
 */
async function runQuoteEasterEgg(sessionId: string, sendBytes: (bytes: string) => void) {
  const feedLocal = (text: string) => void invoke("engine_feed_local", { sessionId, data: text }).catch(() => {});

  feedLocal("\r\n");
  let frame = 0;
  const renderSpinnerFrame = () =>
    feedLocal(
      `\r\x1b[2K  \x1b[38;2;255;48;48m${QUOTE_SPINNER_FRAMES[frame % QUOTE_SPINNER_FRAMES.length]}\x1b[0m \x1b[38;2;180;180;180mFetching quote...\x1b[0m`,
    );
  renderSpinnerFrame();
  const interval = setInterval(() => {
    frame++;
    renderSpinnerFrame();
  }, 80);

  try {
    const { quote, author } = await getRandomQuote();
    clearInterval(interval);
    feedLocal("\r\x1b[2K");
    feedLocal(`  \x1b[3m\x1b[38;2;220;220;220m"${quote}"\x1b[0m\r\n`);
    feedLocal(`  \x1b[38;2;160;160;160m\x1b[2m— ${author}\x1b[0m\r\n`);
  } catch (error) {
    clearInterval(interval);
    feedLocal("\r\x1b[2K");
    feedLocal(`\x1b[31m  Error fetching quote: ${formatErrorMessage(error)}\x1b[0m\r\n`);
  } finally {
    // The real shell's readline echoed "quote" back as it was typed but
    // never actually received this Enter (see the interception in
    // handleKeyDown), so it's still sitting in its input buffer: Ctrl+U
    // clears it, and the bare Enter submits the now-empty line for a
    // genuine, correctly-formatted fresh prompt — landing right after the
    // local output above since that's wherever the engine's cursor now is.
    sendBytes("\x15\r");
  }
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
 * Renders a terminal pane via the Rust grid engine, using WebGL2 (falling
 * back to Canvas2D) instead of the DOM — the terminal's only rendering
 * pipeline (see `BENCH.md` for the phased history of this effort).
 *
 * Feature coverage: mouse selection (simple, word/line via double/triple-
 * click, block via Alt+drag) with copy; a themed, drag-to-scroll scrollbar
 * thumb (`updateScrollbarThumb`) alongside wheel scrollback; plain-text
 * scrollback search (no regex) with a "3/12"-style match-count badge,
 * matching xterm.js's `SearchAddon`; clickable http(s) links; text input
 * with a live IME composition preview overlay (`handleCompositionUpdate`,
 * the closest equivalent to xterm.js's inline ghost glyph without teaching
 * the grid renderers about IME state); Select All (`selectActiveLine`) and
 * the `quote` built-in (`runQuoteEasterEgg`), both ported from the old
 * xterm.js-based `TerminalView`; and mouse reporting to the child program
 * (clicks, drags, motion and the wheel forwarded as `CSI M`/SGR escape
 * sequences whenever it has requested tracking via `?1000`/`?1002`/`?1003`,
 * so vim/htop/tmux see mouse events — see `mouseReporting.ts`). Holding
 * Shift always bypasses reporting in favor of local selection/scrollback,
 * matching xterm's own convention, so copying text out of a mouse-aware
 * program stays possible. Known upstream limitation, not fixable from this
 * component: shrinking the terminal can silently drop reflowed content —
 * see `GridEngine`'s `resize_tests` module in `grid_engine.rs`.
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
  onActivatePane,
  onClosePane,
  onCloseSearch,
  onCloseTerminal,
  onExpandPane,
  onNewTerminal,
  onNewWindow,
  onNextTab,
  onPrevTab,
  onSearch,
  onSemanticEvent,
  onSessionReady,
  onSessionResize,
  onSessionStatus,
  onSplitHorizontal,
  onSplitVertical,
  onToggleSettings,
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
  // Mirrors of the `active`/`isPaneActive` props for the semantic-event
  // listener registered once in the mount effect below (its closure would
  // otherwise only ever see the values from the first render — see that
  // effect's `[pane.paneId]`-only dependency array).
  const activeRef = useRef(active);
  const isPaneActiveRef = useRef(isPaneActive);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchInfo, setMatchInfo] = useState<{ index: number; count: number } | null>(null);
  const [regexMode, setRegexMode] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const imeOverlayRef = useRef<HTMLSpanElement | null>(null);
  /** Cursor cell the current IME composition started at, so the preview
   * overlay stays anchored there as the composed text changes length. */
  const imeAnchorRef = useRef<{ row: number; col: number } | null>(null);

  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const scrollbarDragRef = useRef<{
    startClientY: number;
    startOffset: number;
    trackHeight: number;
    thumbHeight: number;
  } | null>(null);

  const dragRef = useRef<{
    row: number;
    col: number;
    block: boolean;
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);
  /** True while the current press-drag-release is being forwarded to the
   * PTY as mouse reports (a mouse-aware program has requested tracking)
   * rather than treated as local text selection. */
  const mouseReportingRef = useRef(false);
  /** Tracks click count for double/triple-click word/line selection by
   * hand, rather than trusting `PointerEvent.detail`: WebKit (the webview
   * Tauri embeds on Linux/macOS) has a long-standing bug where
   * `detail` on pointer events never increments past 1, so multi-click
   * selection silently never fired there. A same-cell, same-button press
   * within 500ms of the last one bumps the count; anything else resets it. */
  const clickTrackRef = useRef<{ row: number; col: number; time: number; count: number }>({
    row: -1,
    col: -1,
    time: 0,
    count: 0,
  });

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
      // clientWidth/clientHeight include the host's own padding, so the
      // padding reserved for the scrollbar (see .terminal-host in
      // terminal.css) must be subtracted here too — otherwise columns are
      // computed as if that space were available for text, and the canvas
      // renders right up under (and past) the scrollbar track.
      const style = getComputedStyle(host);
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const cols = Math.max(20, Math.floor((host.clientWidth - paddingX) / cellWidth));
      const rows = Math.max(5, Math.floor((host.clientHeight - paddingY) / cellHeight));
      return { cols, rows };
    };

    // Fires a system notification for a command that just finished in this
    // pane, but only when the user isn't already looking at it — foreground
    // (this pane's tab selected, this pane focused within its split, and the
    // OS window itself not minimized/hidden) skips it entirely, since a
    // toast for a command whose output you're already watching is just
    // noise. Best-effort: silently does nothing outside Tauri, without a
    // granted OS permission, or if the permission check itself fails.
    function notifyCommandFinished(exitCode: number | null | undefined, commandText?: string) {
      if (!isTauriRuntime()) return;
      if (!document.hidden && activeRef.current && isPaneActiveRef.current) return;

      const failed = typeof exitCode === "number" && exitCode !== 0;
      const title = commandText || (failed ? "Command failed" : "Command finished");
      const body = failed ? `Exited with code ${exitCode}` : "Finished successfully";

      void isPermissionGranted()
        .then((granted) => granted && sendNotification({ title, body }))
        .catch(() => {});
    }

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
      renderer.setFocused(active && isPaneActive);
      renderer.setBlinkEnabled(active && isPaneActive && (settings?.cursorBlink ?? true));
      rendererRef.current = renderer;

      try {
        let sessionId = pane.sessionId ?? null;
        if (sessionId) {
          sessionIdRef.current = sessionId;
          onSessionStatus(pane.paneId, "running");
        } else {
          const info = await createTerminalSession({ cols, rows, cwd: pane.cwd ?? undefined });
          if (disposed) {
            // Unmounted while the PTY was spawning (e.g. StrictMode's
            // mount/unmount/mount in dev): nothing will ever record or
            // reattach to this session, so kill it instead of leaking a
            // shell process per new pane.
            void closeTerminalSession(info.sessionId);
            return;
          }
          sessionId = info.sessionId;
          sessionIdRef.current = sessionId;
          onSessionReady(pane.paneId, info);
        }

        onSessionResize(pane.paneId, cols, rows);

        const channel = new Channel<ArrayBuffer | Uint8Array>((data) => {
          try {
            rendererRef.current?.applyFrameBytes(data);
            updateScrollbarThumb();
          } catch (err) {
            console.error("[GlyphEngineTerminalView] failed to apply frame:", err);
          }
        });
        await invoke("engine_attach_channel", { sessionId, channel });
        if (disposed) return;

        // Tracks the in-flight command across its two boundary events so
        // `command_finished` can pair itself with the text/grid-line
        // `command_execution_start` captured — a plain closure variable is
        // fine since both events for one command arrive through this same
        // listener, in order, for the lifetime of this session.
        let pendingCommand: { text: string; startLine: number } | null = null;

        const semUnlisten = await listenTerminalSemantic((evt) => {
          if (evt.sessionId !== sessionIdRef.current) return;

          const renderer = rendererRef.current;
          let enriched: TerminalSemanticEvent = evt;

          if (evt.kind === "command_execution_start" && renderer) {
            const { row } = renderer.getCursorPosition();
            const { text } = activeInputRange(renderer.getRowText(row));
            const gridLine = viewportRowToGridLine(row, renderer.getDisplayOffset());
            pendingCommand = { text: text.trim(), startLine: gridLine };
            enriched = { ...evt, commandText: pendingCommand.text || undefined, gridLine };
          } else if (evt.kind === "command_finished") {
            const gridLine = renderer
              ? viewportRowToGridLine(renderer.getCursorPosition().row, renderer.getDisplayOffset())
              : undefined;
            enriched = { ...evt, gridLine };
            notifyCommandFinished(evt.exitCode, pendingCommand?.text);
            pendingCommand = null;
          }

          onSemanticEvent(pane.paneId, enriched);
        });
        // Cleanup may have already run while the listener was registering;
        // drop it now or it outlives this view and duplicates events.
        if (disposed) {
          semUnlisten();
          return;
        }
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
        // An inactive tab's whole subtree is `display: none` (see App.tsx),
        // which reports a zero-size box — sometimes on the way out (hiding),
        // sometimes on the way back in for one tick before layout catches
        // up. `computeDims` clamps to a minimum (20x5), so without this
        // guard a tab switch would resize the session down to 20x5 and
        // then immediately back up, a visible glitch and a real PTY
        // SIGWINCH round trip for no reason. Matches the old xterm.js
        // `TerminalView`'s `fitAndResize`, which had the same guard.
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        const { cols, rows } = computeDims();
        if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) return;
        lastSizeRef.current = { cols, rows };
        rendererRef.current?.setGrid(cols, rows);
        onSessionResize(pane.paneId, cols, rows);
        updateScrollbarThumb();
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

      // A mouse-aware program (htop, less, vim) gets the wheel reported as
      // a button click regardless of tracking level — every real terminal
      // does this even in click-only (`?1000`) mode, since otherwise the
      // wheel would silently do nothing inside such a program. Shift
      // overrides this, matching the same convention used for click/drag
      // below, so the user can still force local scrollback.
      const mouseMode = renderer.getMouseMode();
      if (mouseMode.tracking !== MouseTrackingLevel.Off && !e.shiftKey) {
        const cell = pixelToCell(e.clientX, e.clientY);
        if (cell) {
          const report = encodeMouseReport(
            {
              button: e.deltaY > 0 ? "wheelDown" : "wheelUp",
              row: cell.row,
              col: cell.col,
              modifiers: { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey },
              isMotion: false,
            },
            mouseMode,
          );
          if (report) sendBytes(report);
        }
        return;
      }

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
    activeRef.current = active;
    isPaneActiveRef.current = isPaneActive;
    rendererRef.current?.setFocused(active && isPaneActive);
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
    setMatchInfo(null);
  }, [searchOpen, isPaneActive]);

  const sendBytes = (bytes: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void writeTerminalData(sessionId, bytes).catch((error: unknown) =>
      onSessionStatus(pane.paneId, "error", formatError(error)),
    );
  };

  const pasteText = (text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !text) return;
    void pasteTerminalData(sessionId, text).catch((error: unknown) =>
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

  /** Select All: highlights the user's typed input on the cursor's current
   * line (everything after the shell prompt), matching the old xterm.js
   * `TerminalView`'s behavior. Only highlights — copying still needs the
   * `copy` keybinding, same as before. */
  const selectActiveLine = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const cursor = renderer.getCursorPosition();
    const { start, text } = activeInputRange(renderer.getRowText(cursor.row));
    if (!text.length) return;
    const sel: SelectionRange = {
      startRow: cursor.row,
      startCol: start,
      endRow: cursor.row,
      endCol: start + text.length - 1,
      block: false,
    };
    renderer.setSelection(sel);
    void commitSelection(sel);
  };

  /** Re-runs a finished block's command: clears whatever's on the current
   * input line (Ctrl+U, same as the `quote` built-in's cleanup) before
   * typing the command and pressing Enter, so a re-run from scrollback
   * never appends onto stray text already sitting at the live prompt. */
  const rerunBlock = (block: TerminalBlockModel) => {
    if (!block.command) return;
    sendBytes(`\x15${block.command}\r`);
  };

  const copyBlockCommand = (block: TerminalBlockModel) => {
    if (!block.command) return;
    void navigator.clipboard?.writeText(block.command);
  };

  /** Copies a block's output via `engine_selection_range`, using the grid
   * lines captured at its `command_execution_start`/`command_finished`
   * boundaries (see `TerminalSemanticEvent.gridLine`) — approximate (may
   * include the command's own echoed line or the next prompt line
   * depending on shell prompt formatting), not a byte-exact capture. */
  const copyBlockOutput = async (block: TerminalBlockModel) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || block.outputStartLine === undefined || block.outputEndLine === undefined) return;
    const endCol = Math.max(0, lastSizeRef.current.cols - 1);
    const text = await invoke<string | null>("engine_selection_range", {
      sessionId,
      start: { line: block.outputStartLine, column: 0 },
      end: { line: block.outputEndLine, column: endCol },
      block: false,
    }).catch(() => null);
    if (text) void navigator.clipboard?.writeText(text);
  };

  /** Repositions/resizes the scrollbar thumb from the renderer's current
   * scroll state. Mutates the thumb's DOM style directly (no React state)
   * since this runs on every applied frame — up to ~240Hz — and a re-render
   * per frame would be wasteful; the canvas itself is painted the same way. */
  const updateScrollbarThumb = () => {
    const renderer = rendererRef.current;
    const track = scrollbarTrackRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!renderer || !track || !thumb) return;

    const history = renderer.getHistorySize();
    const viewportRows = lastSizeRef.current.rows;
    if (history <= 0 || viewportRows <= 0) {
      thumb.style.display = "none";
      // Only steal pointer events (and the window-edge resize strip
      // beside it, geometrically separated — see the CSS doc comment)
      // while there's actually something to scroll/drag.
      track.style.pointerEvents = "none";
      return;
    }

    const trackHeight = track.clientHeight;
    const total = history + viewportRows;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(SCROLLBAR_MIN_THUMB_PX, Math.round((trackHeight * viewportRows) / total)),
    );
    // 0 = scrolled to the oldest line, 1 = live/bottom.
    const scrollFraction = (history - renderer.getDisplayOffset()) / history;
    const thumbTop = scrollFraction * (trackHeight - thumbHeight);

    thumb.style.display = "block";
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
    track.style.pointerEvents = "auto";
  };

  /** Handles pointerdown anywhere on the (now full-width, easy-to-hit)
   * track, not just the thumb: a press directly on the thumb starts a
   * fine-grained drag from the current position, same as before; a press
   * anywhere else on the track jumps the thumb to be centered under the
   * pointer first (a normal scrollbar "click track to jump" gesture), then
   * starts that same drag from the new position so the press-and-drag
   * motion keeps working uninterrupted. */
  const handleScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const renderer = rendererRef.current;
    const sessionId = sessionIdRef.current;
    const track = scrollbarTrackRef.current;
    const thumb = scrollbarThumbRef.current;
    if (!renderer || !sessionId || !track || !thumb || renderer.getHistorySize() <= 0) return;

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const thumbHeight = thumbRect.height;
    const history = renderer.getHistorySize();

    let startOffset = renderer.getDisplayOffset();
    const clickedThumb = event.clientY >= thumbRect.top && event.clientY <= thumbRect.bottom;
    if (!clickedThumb) {
      const travel = trackRect.height - thumbHeight;
      const targetThumbTop = Math.max(0, Math.min(travel, event.clientY - trackRect.top - thumbHeight / 2));
      const fraction = travel > 0 ? targetThumbTop / travel : 0;
      startOffset = Math.round(history * (1 - fraction));
      void invoke("engine_set_scroll", { sessionId, displayOffset: startOffset }).catch(() => {});
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    scrollbarDragRef.current = {
      startClientY: event.clientY,
      startOffset,
      trackHeight: trackRect.height,
      thumbHeight,
    };
  };

  const handleScrollbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    const renderer = rendererRef.current;
    const sessionId = sessionIdRef.current;
    if (!drag || !renderer || !sessionId) return;
    const history = renderer.getHistorySize();
    const travel = drag.trackHeight - drag.thumbHeight;
    if (travel <= 0 || history <= 0) return;

    const deltaY = event.clientY - drag.startClientY;
    const deltaOffset = Math.round((-deltaY / travel) * history);
    const next = Math.max(0, Math.min(history, drag.startOffset + deltaOffset));
    void invoke("engine_set_scroll", { sessionId, displayOffset: next }).catch(() => {});
  };

  const handleScrollbarPointerUp = () => {
    scrollbarDragRef.current = null;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const renderer = rendererRef.current;
    const cell = pixelToCell(event.clientX, event.clientY);
    if (!renderer || !cell) return;
    inputRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);

    // A mouse-aware program gets first refusal on left-button presses,
    // ahead of local double/triple-click word/line selection (the
    // reporting protocol has no concept of click count — every click just
    // reports a single left-button press). Holding Shift bypasses this and
    // forces local selection, matching xterm's own convention, so users
    // aren't locked out of copying text inside e.g. htop.
    const mouseMode = renderer.getMouseMode();
    if (mouseMode.tracking !== MouseTrackingLevel.Off && !event.shiftKey) {
      const report = encodeMouseReport(
        {
          button: "left",
          row: cell.row,
          col: cell.col,
          modifiers: { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
          isMotion: false,
        },
        mouseMode,
      );
      if (report) {
        sendBytes(report);
        mouseReportingRef.current = true;
        dragRef.current = null;
        return;
      }
    }
    mouseReportingRef.current = false;

    const now = event.timeStamp;
    const lastClick = clickTrackRef.current;
    const sameSpot = lastClick.row === cell.row && lastClick.col === cell.col;
    const clickCount = sameSpot && now - lastClick.time < MULTI_CLICK_MS ? Math.min(lastClick.count + 1, 3) : 1;
    clickTrackRef.current = { row: cell.row, col: cell.col, time: now, count: clickCount };

    if (clickCount >= 3) {
      const sel: SelectionRange = { startRow: cell.row, startCol: 0, endRow: cell.row, endCol: lastSizeRef.current.cols - 1, block: false };
      renderer.setSelection(sel);
      void commitSelection(sel);
      dragRef.current = null;
      return;
    }
    if (clickCount === 2) {
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

    if (mouseReportingRef.current) {
      const cell = pixelToCell(event.clientX, event.clientY);
      if (!cell) return;
      const mouseMode = renderer.getMouseMode();
      const report = encodeMouseReport(
        {
          button: "left",
          row: cell.row,
          col: cell.col,
          modifiers: { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
          isMotion: true,
        },
        mouseMode,
      );
      if (report) sendBytes(report);
      return;
    }

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

    // Not dragging: hover-detect links, unless the live program asked for
    // every mouse movement (`?1003`), in which case bare hover motion gets
    // reported too (button code 3 = "no button", per the wire protocol).
    const canvas = canvasRef.current;
    const cell = pixelToCell(event.clientX, event.clientY);
    if (!canvas || !cell) return;

    const mouseMode = renderer.getMouseMode();
    if (mouseMode.tracking === MouseTrackingLevel.AnyMotion && !event.shiftKey) {
      const report = encodeMouseReport(
        {
          button: "release",
          row: cell.row,
          col: cell.col,
          modifiers: { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
          isMotion: true,
        },
        mouseMode,
      );
      if (report) sendBytes(report);
      return;
    }

    const link = linkAt(renderer.getRowText(cell.row), cell.col);
    canvas.style.cursor = link ? "pointer" : "text";
    canvas.dataset.hoverLink = link?.url ?? "";
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const renderer = rendererRef.current;

    if (mouseReportingRef.current) {
      mouseReportingRef.current = false;
      const cell = pixelToCell(event.clientX, event.clientY);
      if (renderer && cell) {
        const mouseMode = renderer.getMouseMode();
        const report = encodeMouseReport(
          {
            button: "release",
            row: cell.row,
            col: cell.col,
            modifiers: { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
            isMotion: false,
          },
          mouseMode,
        );
        if (report) sendBytes(report);
      }
      return;
    }

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
    // Backspace/Delete with an active selection (e.g. from Select All)
    // erases the selected text instead of just the one char under the
    // cursor — ported from the old xterm.js-based `TerminalView`, which
    // did the same via `terminal.hasSelection()`/`getSelection()`. There's
    // no real "delete" concept over a PTY, so this approximates it the
    // same way that code did: replay enough backspaces to erase what was
    // selected, which only lands correctly when the selection sits at the
    // live, editable prompt (as Select All's does).
    if ((event.key === "Backspace" || event.key === "Delete") && selectedTextRef.current) {
      event.preventDefault();
      const count = selectedTextRef.current.length;
      clearSelection();
      if (count > 0) sendBytes("\x7f".repeat(count));
      return;
    }

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
        if (text) pasteText(text);
      })();
      return;
    }

    // App-level shortcuts, checked here (rather than relying solely on the
    // global `useKeyboardShortcuts` window listener) because that listener
    // deliberately ignores keydowns targeting a <textarea> — which this
    // pane's hidden input sink always is whenever the pane has focus, i.e.
    // almost always. Ported from the old xterm.js-based `TerminalView`'s
    // `attachCustomKeyEventHandler`, which had the same requirement for
    // the same reason (xterm.js also focuses a hidden textarea).
    if (keybindings) {
      if (matchesKeyCombo(event.nativeEvent, keybindings.split_vertical)) {
        event.preventDefault();
        onSplitVertical?.(pane.paneId);
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.split_horizontal)) {
        event.preventDefault();
        onSplitHorizontal?.(pane.paneId);
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.close_pane)) {
        event.preventDefault();
        onClosePane?.(pane.paneId);
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.new_tab)) {
        event.preventDefault();
        onNewTerminal?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.new_window)) {
        event.preventDefault();
        onNewWindow?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.close_tab)) {
        event.preventDefault();
        onCloseTerminal?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.next_tab)) {
        event.preventDefault();
        onNextTab?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.prev_tab)) {
        event.preventDefault();
        onPrevTab?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.search)) {
        event.preventDefault();
        onSearch?.();
        return;
      }
      if (matchesKeyCombo(event.nativeEvent, keybindings.toggle_settings)) {
        event.preventDefault();
        onToggleSettings?.();
        return;
      }
    }

    if (keybindings?.select_all && matchesKeyCombo(event.nativeEvent, keybindings.select_all)) {
      event.preventDefault();
      selectActiveLine();
      return;
    }

    // The `quote` built-in — see `runQuoteEasterEgg`. Checked ahead of the
    // generic encoder below since plain Enter would otherwise just encode
    // to "\r" and go straight to the PTY.
    if (
      event.key === "Enter" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !isComposingRef.current
    ) {
      const renderer = rendererRef.current;
      const sessionId = sessionIdRef.current;
      if (renderer && sessionId) {
        const cursor = renderer.getCursorPosition();
        const { text } = activeInputRange(renderer.getRowText(cursor.row));
        if (text.trim().toLowerCase() === "quote") {
          event.preventDefault();
          void runQuoteEasterEgg(sessionId, sendBytes);
          return;
        }
      }
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

  // Right-click / middle-click / Edit-menu pastes land on the textarea as
  // a native paste event. Intercept them so they go out as one paste —
  // letting them fall through to `handleInput` would send them as raw
  // keystrokes.
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    pasteText(event.clipboardData.getData("text/plain"));
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
    imeAnchorRef.current = rendererRef.current?.getCursorPosition() ?? null;
  };

  /** Live preview of the in-progress (uncommitted) IME composition,
   * drawn as a small DOM overlay anchored at the cursor cell — the
   * closest equivalent to the inline ghost glyph xterm.js draws, without
   * needing the grid renderers to know anything about IME state. */
  const handleCompositionUpdate = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    const overlay = imeOverlayRef.current;
    const renderer = rendererRef.current;
    const anchor = imeAnchorRef.current;
    if (!overlay || !renderer || !anchor) return;
    const { cellWidth, cellHeight } = renderer.getCellMetrics();
    overlay.textContent = event.data;
    overlay.style.left = `${anchor.col * cellWidth}px`;
    overlay.style.top = `${anchor.row * cellHeight}px`;
    overlay.style.minWidth = `${cellWidth}px`;
    overlay.style.height = `${cellHeight}px`;
    overlay.style.display = event.data ? "block" : "none";
  };

  const handleCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    imeAnchorRef.current = null;
    const overlay = imeOverlayRef.current;
    if (overlay) {
      overlay.style.display = "none";
      overlay.textContent = "";
    }
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

  const runSearch = async (direction: "Next" | "Previous", query: string, useRegex: boolean = regexMode) => {
    const sessionId = sessionIdRef.current;
    const renderer = rendererRef.current;
    if (!sessionId || !renderer || !query) return;

    const last = lastMatchRef.current;
    const fromRow = last ? (direction === "Next" ? last.endRow : last.startRow) : 0;
    const fromCol = last ? (direction === "Next" ? last.endCol + 1 : Math.max(0, last.startCol - 1)) : 0;

    let match: SearchMatch | null = null;
    try {
      match = await invoke<SearchMatch | null>("engine_search", {
        sessionId,
        pattern: query,
        direction,
        fromRow,
        fromCol,
        regex: useRegex,
      });
      setSearchError(null);
    } catch (err: unknown) {
      // Only a regex-mode compile failure produces an `Err` here — surface
      // it distinctly from "compiled fine, nothing matched" below.
      setSearchError(formatError(err));
      lastMatchRef.current = null;
      setMatchInfo(null);
      renderer.setSelection(null);
      return;
    }

    if (!match) {
      lastMatchRef.current = null;
      setMatchInfo(null);
      renderer.setSelection(null);
      return;
    }
    lastMatchRef.current = match;
    setMatchInfo({ index: match.index, count: match.count });

    const historySize = renderer.getHistorySize();
    const predictedOffset = displayOffsetToReveal(match.startRow, historySize);
    renderer.setSelection({
      startRow: absoluteRowToViewport(match.startRow, predictedOffset, historySize),
      startCol: match.startCol,
      endRow: absoluteRowToViewport(match.endRow, predictedOffset, historySize),
      endCol: match.endCol,
      block: false,
      kind: "search",
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    lastMatchRef.current = null;
    setMatchInfo(null);
    setSearchError(null);
    if (value) void runSearch("Next", value);
    else rendererRef.current?.setSelection(null);
  };

  const toggleRegexMode = () => {
    const next = !regexMode;
    setRegexMode(next);
    lastMatchRef.current = null;
    setMatchInfo(null);
    setSearchError(null);
    if (searchQuery) void runSearch("Next", searchQuery, next);
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

      {blocks.length > 0 && (
        <nav className="block-rail" aria-label="Terminal blocks">
          {blocks.map((block) => (
            <TerminalBlock
              key={block.id}
              block={block}
              onRerun={rerunBlock}
              onCopyCommand={copyBlockCommand}
              onCopyOutput={copyBlockOutput}
            />
          ))}
        </nav>
      )}

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
              className={`terminal-search-btn terminal-search-regex${regexMode ? " is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleRegexMode();
              }}
              title={regexMode ? "Regex search (on)" : "Regex search (off)"}
              aria-label="Toggle regex search"
              aria-pressed={regexMode}
            >
              .*
            </button>
            {searchError ? (
              <span className="terminal-search-count terminal-search-error" title={searchError}>
                invalid regex
              </span>
            ) : (
              searchQuery && (
                <span className="terminal-search-count">
                  {matchInfo ? `${matchInfo.index + 1}/${matchInfo.count}` : "0/0"}
                </span>
              )
            )}
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

        <div ref={hostRef} className="terminal-host glyph-canvas-host">
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
            onFocus={() => onActivatePane(pane.paneId)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
          />
          <span
            ref={imeOverlayRef}
            className="glyph-canvas-ime-overlay"
            aria-hidden="true"
            style={{ fontFamily: TERMINAL_FONT_FAMILY, fontSize: `${settings?.fontSize ?? 14}px`, lineHeight: LINE_HEIGHT }}
          />
          <div
            ref={scrollbarTrackRef}
            className="terminal-scrollbar-track"
            onPointerDown={handleScrollbarPointerDown}
            onPointerMove={handleScrollbarPointerMove}
            onPointerUp={handleScrollbarPointerUp}
          >
            <div ref={scrollbarThumbRef} className="terminal-scrollbar-thumb" />
          </div>
        </div>
      </section>
    </div>
  );
}
