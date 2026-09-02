import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { IDisposable, ITheme, Terminal as XTerm } from "@xterm/xterm";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";

import { createNothingXterm } from "../../lib/terminal/xterm";
import {
  createTerminalSession,
  openExternalUrl,
  resizeTerminalSession,
  writeTerminalData,
} from "../../hooks/useTerminalSession";
import { attachMockShell } from "../../lib/terminal/mockShell";
import { tryRunBuiltinCommand } from "../../lib/terminal/builtinCommands";
import {
  isTauriRuntime,
  listenTerminalOutput,
  listenTerminalSemantic,
} from "../../lib/terminal/events";
import type {
  TerminalBlock as TerminalBlockModel,
  TerminalPaneModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../lib/terminal/types";
import { matchesKeyCombo, type KeybindingsConfig } from "../../hooks/useKeybindings";
import type { TerminalSettings } from "../../hooks/useTerminalSettings";
import { TerminalBlock } from "./TerminalBlock";

const pendingOutputMap = new Map<string, string[]>();

type TerminalViewProps = {
  active: boolean;
  isPaneActive: boolean;
  isSplit?: boolean;
  pane: TerminalPaneModel;
  tabId: string;
  blocks: TerminalBlockModel[];
  keybindings: KeybindingsConfig;
  searchOpen: boolean;
  settings?: TerminalSettings;
  /** Active xterm palette from useTerminalTheme — applied at creation and live on change */
  xtermTheme?: ITheme;
  canClosePane?: boolean;
  onActivatePane: (paneId: string) => void;
  onCloseSearch: () => void;
  onCloseTerminal?: () => void;
  onClosePane?: (paneId: string) => void;
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
  onToggleSettings?: () => void;
};


function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function TerminalView({
  active,
  blocks,
  canClosePane = false,
  isPaneActive,
  isSplit = false,
  keybindings,
  onActivatePane,
  onClosePane,
  onCloseSearch,
  onCloseTerminal,
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
  onTitleChange,
  onToggleSettings,
  pane,
  searchOpen,
  settings,
  xtermTheme,
  tabId,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  const lastResizedSessionIdRef = useRef<string | null>(null);
  const mockSessionRef = useRef<ReturnType<typeof attachMockShell> | null>(null);
  const keybindingsRef = useRef<KeybindingsConfig>(keybindings);
  const [query, setQuery] = useState("");

  const scrollPosRef = useRef<{ viewportY: number; isAtBottom: boolean }>({
    viewportY: 0,
    isAtBottom: true,
  });
  const activeRef = useRef(active);
  const isRestoringScrollRef = useRef(false);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const propsRef = useRef({
    onSessionReady,
    onSessionStatus,
    onSessionResize,
    onSemanticEvent,
    onTitleChange,
    onNextTab,
    onPrevTab,
    onCloseTerminal,
    onClosePane,
    onSplitVertical,
    onSplitHorizontal,
    onNewTerminal,
    onNewWindow,
    onSearch,
    onToggleSettings,
  });

  useEffect(() => {
    propsRef.current = {
      onSessionReady,
      onSessionStatus,
      onSessionResize,
      onSemanticEvent,
      onTitleChange,
      onNextTab,
      onPrevTab,
      onCloseTerminal,
      onClosePane,
      onSplitVertical,
      onSplitHorizontal,
      onNewTerminal,
      onNewWindow,
      onSearch,
      onToggleSettings,
    };
  });

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  const restoreScrollPosition = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    isRestoringScrollRef.current = true;
    if (scrollPosRef.current.isAtBottom) {
      terminal.scrollToBottom();
    } else {
      terminal.scrollToLine(scrollPosRef.current.viewportY);
    }
    setTimeout(() => {
      isRestoringScrollRef.current = false;
    }, 100);
  }, []);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const host = hostRef.current;
    if (!terminal || !fitAddon || !host) {
      return;
    }

    if (host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }

    try {
      const dims = fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        let targetRows = dims.rows;

        const renderService = (
          terminal as unknown as {
            _core?: { _renderService?: { dimensions?: { css?: { cell?: { height: number } } } } };
          }
        )._core?._renderService;
        const cellHeight = renderService?.dimensions?.css?.cell?.height;

        if (cellHeight && cellHeight > 0) {
          const style = window.getComputedStyle(host);
          const paddingTop = parseFloat(style.paddingTop) || 0;
          const paddingBottom = parseFloat(style.paddingBottom) || 0;
          const availableHeight = host.clientHeight - paddingTop - paddingBottom;
          const maxRows = Math.floor(availableHeight / cellHeight);

          if (maxRows > 0 && targetRows > maxRows) {
            targetRows = maxRows;
          }
        }

        terminal.resize(dims.cols, targetRows);
      } else {
        fitAddon.fit();
      }
      restoreScrollPosition();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    } catch {
      return;
    }

    const { cols, rows } = terminal;
    const sessionId = sessionIdRef.current;

    if (
      cols === lastSizeRef.current.cols &&
      rows === lastSizeRef.current.rows &&
      lastResizedSessionIdRef.current === sessionId
    ) {
      return;
    }

    lastSizeRef.current = { cols, rows };
    propsRef.current.onSessionResize(pane.paneId, cols, rows);

    if (sessionId && isTauriRuntime()) {
      lastResizedSessionIdRef.current = sessionId;
      void resizeTerminalSession(sessionId, { cols, rows }).catch((error: unknown) =>
        propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error)),
      );
    }
  }, [pane.paneId, restoreScrollPosition]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = createNothingXterm({
      cursorStyle: settings?.cursorStyle,
      cursorBlink: settings?.cursorBlink,
      fontSize: settings?.fontSize,
      xtermTheme,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void openExternalUrl(uri);
    });
    const disposables: IDisposable[] = [];
    const unlisteners: Array<() => void> = [];
    let resizeFrame = 0;
    let disposed = false;
    let inputLineBuffer = "";

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(host);

    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitAndResize);
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(host);
    scheduleResize();

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      const bindings = keybindingsRef.current;

      // Delete selected text on Backspace or Delete keypress
      if ((event.key === "Backspace" || event.key === "Delete") && terminal.hasSelection()) {
        const selection = terminal.getSelection();
        const count = selection ? selection.length : 0;
        terminal.clearSelection();

        if (count > 0) {
          const backspaces = "\x7f".repeat(count);
          const sessionId = sessionIdRef.current;
          if (sessionId && isTauriRuntime()) {
            void writeTerminalData(sessionId, backspaces);
          } else if (mockSessionRef.current) {
            mockSessionRef.current.handleData(backspaces);
          }
        }
        return false;
      }

      // Select user input on the current line (everything after the shell prompt)
      if (matchesKeyCombo(event, bindings.select_all)) {
        const buffer = terminal.buffer.active;
        const lineY = buffer.cursorY + buffer.viewportY;
        const line = buffer.getLine(lineY);
        const text = line?.translateToString(true) ?? "";

        if (text.length > 0) {
          const promptEnd = text.match(/^(.*(?:\$\s|#\s|%\s|>\s))/);
          const inputStart = promptEnd ? promptEnd[1].length : 0;
          const inputText = text.slice(inputStart);

          if (inputText.length > 0) {
            terminal.select(inputStart, lineY, inputText.length);
          }
        }
        return false;
      }

      // Copy selection
      if (matchesKeyCombo(event, bindings.copy)) {
        event.preventDefault();
        event.stopPropagation();
        const selection = terminal.getSelection();
        if (selection) {
          void navigator.clipboard?.writeText(selection);
        }
        return false;
      }

      // Paste text
      if (matchesKeyCombo(event, bindings.paste)) {
        event.preventDefault();
        event.stopPropagation();
        const doPaste = async () => {
          let text = "";
          if (isTauriRuntime()) {
            text = await clipboardReadText();
          } else {
            text = await navigator.clipboard?.readText();
          }
          if (!text) return;
          const sessionId = sessionIdRef.current;
          if (sessionId && isTauriRuntime()) {
            // Use xterm's paste() so bracketed paste mode (\x1b[200~...\x1b[201~) is
            // automatically applied when the active program (e.g. nano) has enabled it.
            // This preserves newlines and document structure in full-screen editors.
            terminalRef.current?.paste(text);
          } else if (mockSessionRef.current) {
            mockSessionRef.current.handleData(text);
          }
        };
        void doPaste();
        return false;
      }

      // Split Vertical (Right)
      if (bindings.split_vertical && matchesKeyCombo(event, bindings.split_vertical)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onSplitVertical?.(pane.paneId);
        return false;
      }

      // Split Horizontal (Down)
      if (bindings.split_horizontal && matchesKeyCombo(event, bindings.split_horizontal)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onSplitHorizontal?.(pane.paneId);
        return false;
      }

      // Close Pane
      if (bindings.close_pane && matchesKeyCombo(event, bindings.close_pane)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onClosePane?.(pane.paneId);
        return false;
      }

      // App-level shortcut triggers inside xterm focus
      if (matchesKeyCombo(event, bindings.new_tab)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onNewTerminal?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.new_window)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onNewWindow?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.close_tab)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onCloseTerminal?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.next_tab)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onNextTab?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.prev_tab)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onPrevTab?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.search)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onSearch?.();
        return false;
      }

      if (matchesKeyCombo(event, bindings.toggle_settings)) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onToggleSettings?.();
        return false;
      }

      return true;
    });

    async function bootTerminal() {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during initial DOM mount
      }

      const initialCols = Math.max(terminal.cols || 80, 20);
      const initialRows = Math.max(terminal.rows || 24, 5);
      lastSizeRef.current = { cols: initialCols, rows: initialRows };
      console.log("[TerminalView] bootTerminal start", pane.paneId, { isTauri: isTauriRuntime() });

      if (!isTauriRuntime()) {
        propsRef.current.onSessionReady(pane.paneId, {
          sessionId: `mock-session-${pane.paneId}`,
          shell: "/bin/bash",
          cwd: "/home/aximsoft/projects/glyph",
          cols: initialCols,
          rows: initialRows,
        });

        const session = attachMockShell(terminal, (event) => {
          propsRef.current.onSemanticEvent(pane.paneId, event);
        });
        mockSessionRef.current = session;
        if (isPaneActive) {
          terminal.focus();
        }
        return;
      }

      try {
        propsRef.current.onSessionStatus(pane.paneId, "starting");

        let assignedId: string | null = pane.sessionId ?? null;
        if (pane.sessionId) {
          sessionIdRef.current = pane.sessionId;
        }

        const dataUnlisten = await listenTerminalOutput((evt) => {
          const currentId = sessionIdRef.current;
          if (currentId && evt.sessionId === currentId) {
            terminal.write(evt.data);
          } else {
            const list = pendingOutputMap.get(evt.sessionId) ?? [];
            list.push(evt.data);
            pendingOutputMap.set(evt.sessionId, list);
          }
        });
        unlisteners.push(dataUnlisten);

        const eventUnlisten = await listenTerminalSemantic((evt) => {
          const currentId = sessionIdRef.current;
          if (currentId && evt.sessionId === currentId) {
            propsRef.current.onSemanticEvent(pane.paneId, evt);
          }
        });
        unlisteners.push(eventUnlisten);

        disposables.push(
          terminal.onScroll((newViewportY) => {
            if (!activeRef.current || isRestoringScrollRef.current) {
              return;
            }
            const buffer = terminal.buffer.active;
            const isAtBottom =
              buffer.type === "alternate" || newViewportY >= buffer.baseY - 1;
            scrollPosRef.current = {
              viewportY: newViewportY,
              isAtBottom,
            };
          }),
          terminal.onData((data) => {
            window.dispatchEvent(new CustomEvent("glyph:terminal-activity"));
            if (!sessionIdRef.current) return;
            const sid = sessionIdRef.current;

            // Track input line buffer to detect built-in commands
            if (data === "\r") {
              // Enter pressed — check for built-in command
              const cmd = inputLineBuffer.trim();
              inputLineBuffer = "";

              if (cmd.length > 0) {
                void tryRunBuiltinCommand(cmd, terminal, (d) => {
                  void writeTerminalData(sid, d).catch((error: unknown) =>
                    propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error)),
                  );
                }).then((result) => {
                  if (!result.handled) {
                    // Not a built-in — send the original Enter to the PTY
                    void writeTerminalData(sid, "\r").catch((error: unknown) =>
                      propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error)),
                    );
                  }
                });
              } else {
                // Empty input, just forward Enter
                void writeTerminalData(sid, data).catch((error: unknown) =>
                  propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error)),
                );
              }
              return;
            }

            // Track printable characters for the input buffer
            if (data === "\x7f") {
              // Backspace
              inputLineBuffer = inputLineBuffer.slice(0, -1);
            } else if (data === "\x03") {
              // Ctrl+C — reset buffer
              inputLineBuffer = "";
            } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
              inputLineBuffer += data;
            } else if (data.length > 1 && !data.startsWith("\x1b")) {
              // Pasted text
              inputLineBuffer += data;
            }

            // Forward everything else to PTY normally
            void writeTerminalData(sid, data).catch((error: unknown) =>
              propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error)),
            );
          }),
          terminal.onTitleChange((newTitle) => {
            if (newTitle && newTitle.trim()) {
              propsRef.current.onTitleChange?.(pane.paneId, newTitle.trim());
            }
          }),
        );

        if (pane.sessionId) {
          assignedId = pane.sessionId;
          sessionIdRef.current = pane.sessionId;
          propsRef.current.onSessionStatus(pane.paneId, "running");
        } else {
          propsRef.current.onSessionStatus(pane.paneId, "starting");

          const info = await createTerminalSession({
            cols: initialCols,
            rows: initialRows,
            cwd: pane.cwd ?? undefined,
          });
          console.log("[TerminalView] createTerminalSession resolved:", info);

          if (disposed) {
            return;
          }

          assignedId = info.sessionId;
          sessionIdRef.current = info.sessionId;
          lastResizedSessionIdRef.current = info.sessionId;
          propsRef.current.onSessionReady(pane.paneId, info);
        }

        if (assignedId) {
          const sessionPending = pendingOutputMap.get(assignedId);
          if (sessionPending && sessionPending.length > 0) {
            for (const chunk of sessionPending) {
              terminal.write(chunk);
            }
            pendingOutputMap.delete(assignedId);
          }

          if (pane.startupCommand) {
            let cmdStr = "";
            if (typeof pane.startupCommand === "string") {
              cmdStr = pane.startupCommand.trim();
            } else if (pane.startupCommand.program) {
              cmdStr = `${pane.startupCommand.program} ${pane.startupCommand.args.join(" ")}`.trim();
            }

            if (cmdStr) {
              const sid = assignedId;
              setTimeout(() => {
                void writeTerminalData(sid, `${cmdStr}\r`).catch((err) => {
                  console.error("[TerminalView] Startup command failed:", err);
                });
              }, 300);
            }
          }
        }

        fitAndResize();
        if (isPaneActive) {
          terminal.focus();
        } else {
          terminal.blur();
        }



        setTimeout(() => {
          if (!disposed) {
            fitAndResize();
            if (isPaneActive) {
              terminal.focus();
            }
          }
        }, 80);

        scheduleResize();
      } catch (error) {
        if (!disposed) {
          propsRef.current.onSessionStatus(pane.paneId, "error", formatError(error));
        }
      }
    }

    void bootTerminal();

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      if (mockSessionRef.current) {
        mockSessionRef.current.dispose();
        mockSessionRef.current = null;
      }
      disposables.forEach((d) => d.dispose());
      unlisteners.forEach((u) => u());
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [fitAndResize, pane.paneId]);

  // Live-update the xterm palette when the theme changes, without restarting.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !xtermTheme) return;
    terminal.options.theme = xtermTheme;
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [xtermTheme]);

  useEffect(() => {
    if (!active && terminalRef.current) {
      const terminal = terminalRef.current;
      const buffer = terminal.buffer.active;
      const isAtBottom =
        buffer.type === "alternate" || buffer.viewportY >= buffer.baseY - 1;
      scrollPosRef.current = {
        viewportY: buffer.viewportY,
        isAtBottom,
      };
    } else if (active) {
      isRestoringScrollRef.current = true;
      restoreScrollPosition();
      const timer = setTimeout(() => {
        isRestoringScrollRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [active, restoreScrollPosition]);

  useEffect(() => {
    if (active && isPaneActive) {
      const timer = setTimeout(() => {
        fitAndResize();
        terminalRef.current?.focus();
      }, 25);
      return () => clearTimeout(timer);
    } else {
      terminalRef.current?.blur();
    }
  }, [active, isPaneActive, fitAndResize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal && settings) {
      terminal.options.cursorStyle = settings.cursorStyle;
      terminal.options.cursorBlink = active && isPaneActive ? (settings.cursorBlink ?? true) : false;
      if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
        terminal.options.fontSize = settings.fontSize;
        fitAndResize();
      }
    }
  }, [active, isPaneActive, fitAndResize, settings?.cursorBlink, settings?.cursorStyle, settings?.fontSize]);

  useEffect(() => {
    if (searchOpen && isPaneActive) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    } else {
      setQuery("");
      searchAddonRef.current?.clearDecorations();
      if (active && isPaneActive) {
        terminalRef.current?.focus();
      }
    }
  }, [active, isPaneActive, searchOpen]);

  const handleSearchNext = () => {
    if (query) {
      searchAddonRef.current?.findNext(query, { incremental: true });
    }
  };

  const handleSearchPrevious = () => {
    if (query) {
      searchAddonRef.current?.findPrevious(query, { incremental: true });
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value) {
      searchAddonRef.current?.findNext(value, { incremental: true });
    } else {
      searchAddonRef.current?.clearDecorations();
    }
  };

  const focusTerminal = () => {
    onActivatePane(pane.paneId);
    terminalRef.current?.focus();
  };

  const activeClass =
    active && isPaneActive
      ? "terminal-view is-active is-active-pane"
      : active
        ? "terminal-view is-active"
        : "terminal-view";

  return (
    <div
      className={activeClass}
      onClick={focusTerminal}
      onFocus={focusTerminal}
      tabIndex={-1}
    >
      <div className="pane-header-bar">
        <div className="pane-header-left">
          <span className={`pane-status-dot pane-status-${pane.status}`} aria-hidden="true" />
          {pane.title && (
            <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.5px", color: "var(--nothing-gray-100)", textTransform: "uppercase" }}>
              {pane.title}
            </span>
          )}
        </div>
        <div className="pane-header-controls">
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
        </div>
      </div>


      <nav className="block-rail" aria-label="Terminal blocks">
        {blocks.length === 0 ? (
          <div className="block-empty">no executed blocks</div>
        ) : (
          blocks.map((block) => <TerminalBlock key={block.id} block={block} />)
        )}
      </nav>

      <section className="terminal-output" aria-label="Terminal stream">
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
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  if (e.shiftKey) {
                    handleSearchPrevious();
                  } else {
                    handleSearchNext();
                  }
                } else if (e.key === "Escape") {
                  onCloseSearch();
                }
              }}
            />
            <button type="button" className="terminal-search-btn" onClick={handleSearchPrevious} title="Previous">
              ↑
            </button>
            <button type="button" className="terminal-search-btn" onClick={handleSearchNext} title="Next">
              ↓
            </button>
            <button type="button" className="terminal-search-btn" onClick={onCloseSearch} title="Close">
              ✕
            </button>
          </div>
        )}

        <div ref={hostRef} className="xterm-host" />
      </section>
    </div>
  );
}
