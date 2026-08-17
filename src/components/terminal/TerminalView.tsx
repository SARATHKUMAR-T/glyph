import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import type { IDisposable, Terminal as XTerm } from "@xterm/xterm";
import { readText as clipboardReadText } from "@tauri-apps/plugin-clipboard-manager";

import { createNothingXterm } from "../../lib/terminal/xterm";
import {
  createTerminalSession,
  resizeTerminalSession,
  writeTerminalData,
} from "../../hooks/useTerminalSession";
import { attachMockShell } from "../../lib/terminal/mockShell";
import {
  isTauriRuntime,
  listenTerminalOutput,
  listenTerminalSemantic,
} from "../../lib/terminal/events";
import type {
  TerminalBlock as TerminalBlockModel,
  TerminalSemanticEvent,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalTabModel,
} from "../../lib/terminal/types";
import { matchesKeyCombo, type KeybindingsConfig } from "../../hooks/useKeybindings";
import type { TerminalSettings } from "../../hooks/useTerminalSettings";

import { TerminalBlock } from "./TerminalBlock";

type TerminalViewProps = {
  active: boolean;
  blocks: TerminalBlockModel[];
  keybindings: KeybindingsConfig;
  searchOpen: boolean;
  settings?: TerminalSettings;
  tab: TerminalTabModel;
  onCloseSearch: () => void;
  onCloseTerminal?: () => void;
  onNewTerminal?: () => void;
  onNewWindow?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onSearch?: () => void;
  onSemanticEvent: (clientId: string, event: TerminalSemanticEvent) => void;
  onSessionReady: (clientId: string, info: TerminalSessionInfo) => void;
  onSessionResize: (clientId: string, cols: number, rows: number) => void;
  onSessionStatus: (clientId: string, status: TerminalStatus, error?: string) => void;
  onTitleChange?: (clientId: string, title: string) => void;
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
  keybindings,
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
  onTitleChange,
  onToggleSettings,
  searchOpen,
  settings,
  tab,
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

  const propsRef = useRef({
    onSessionReady,
    onSessionStatus,
    onSessionResize,
    onSemanticEvent,
    onTitleChange,
    onNextTab,
    onPrevTab,
    onCloseTerminal,
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
      onNewTerminal,
      onNewWindow,
      onSearch,
      onToggleSettings,
    };
  });

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    try {
      const dims = fitAddon.proposeDimensions();
      if (dims && dims.cols > 10) {
        terminal.resize(dims.cols - 2, dims.rows);
      } else {
        fitAddon.fit();
      }
      terminal.scrollToBottom();
    } catch (error) {
      propsRef.current.onSessionStatus(tab.clientId, "error", formatError(error));
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
    propsRef.current.onSessionResize(tab.clientId, cols, rows);

    if (sessionId && isTauriRuntime()) {
      lastResizedSessionIdRef.current = sessionId;
      void resizeTerminalSession(sessionId, { cols, rows }).catch((error: unknown) =>
        propsRef.current.onSessionStatus(tab.clientId, "error", formatError(error)),
      );
    }
  }, [tab.clientId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = createNothingXterm({
      cursorStyle: settings?.cursorStyle,
      cursorBlink: settings?.cursorBlink,
      fontSize: settings?.fontSize,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const disposables: IDisposable[] = [];
    const unlisteners: Array<() => void> = [];
    let resizeFrame = 0;
    let disposed = false;

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
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
          // Greedy match: find the LAST shell prompt terminator ($ / # / % / >)
          // followed by a space so we skip to the user-typed input only.
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

      // Paste text (prevent duplicate xterm textarea paste)
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
            void writeTerminalData(sessionId, text);
          } else if (mockSessionRef.current) {
            mockSessionRef.current.handleData(text);
          }
        };
        void doPaste();
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
      console.log("[TerminalView] bootTerminal start", tab.clientId, { isTauri: isTauriRuntime() });

      if (!isTauriRuntime()) {
        // Run mock interactive shell in browser dev mode
        propsRef.current.onSessionReady(tab.clientId, {
          sessionId: "mock-session",
          shell: "/bin/bash",
          cwd: "/home/aximsoft/projects/glyph",
          cols: initialCols,
          rows: initialRows,
        });

        const session = attachMockShell(terminal, (event) => {
          propsRef.current.onSemanticEvent(tab.clientId, event);
        });
        mockSessionRef.current = session;
        terminal.focus();
        return;
      }

      try {
        propsRef.current.onSessionStatus(tab.clientId, "starting");

        const pendingOutput: string[] = [];
        let assignedId: string | null = null;

        // IMPORTANT: Register output listeners BEFORE spawning the PTY.
        // Buffer any output until session ID is assigned so initial prompt is never lost.
        const dataUnlisten = await listenTerminalOutput((evt) => {
          if (assignedId) {
            if (evt.sessionId === assignedId) {
              terminal.write(evt.data);
            }
          } else {
            pendingOutput.push(evt.data);
          }
        });
        unlisteners.push(dataUnlisten);

        const eventUnlisten = await listenTerminalSemantic((evt) => {
          if (assignedId && evt.sessionId === assignedId) {
            propsRef.current.onSemanticEvent(tab.clientId, evt);
          }
        });
        unlisteners.push(eventUnlisten);

        disposables.push(
          terminal.onData((data) => {
            if (sessionIdRef.current) {
              void writeTerminalData(sessionIdRef.current, data).catch((error: unknown) =>
                propsRef.current.onSessionStatus(tab.clientId, "error", formatError(error)),
              );
            }
          }),
          terminal.onTitleChange((newTitle) => {
            if (newTitle && newTitle.trim()) {
              propsRef.current.onTitleChange?.(tab.clientId, newTitle.trim());
            }
          }),
        );

        if (disposed) {
          return;
        }

        const info = await createTerminalSession({
          cols: initialCols,
          rows: initialRows,
        });
        console.log("[TerminalView] createTerminalSession resolved:", info);

        if (disposed) {
          console.warn("[TerminalView] disposed after session created — cleaning up");
          return;
        }

        assignedId = info.sessionId;
        sessionIdRef.current = info.sessionId;
        fitAndResize();

        // Flush any output received before createTerminalSession IPC resolved
        if (pendingOutput.length > 0) {
          for (const chunk of pendingOutput) {
            terminal.write(chunk);
          }
          pendingOutput.length = 0;
        }

        propsRef.current.onSessionReady(tab.clientId, info);
        terminal.focus();

        // Re-sync container size shortly after session ready
        setTimeout(() => {
          if (!disposed) {
            fitAndResize();
            terminal.focus();
          }
        }, 80);

        scheduleResize();
      } catch (error) {
        if (!disposed) {
          propsRef.current.onSessionStatus(tab.clientId, "error", formatError(error));
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
  }, [fitAndResize, tab.clientId]);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        fitAndResize();
        terminalRef.current?.scrollToBottom();
        terminalRef.current?.focus();
      }, 25);
      return () => clearTimeout(timer);
    }
  }, [active, fitAndResize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal && settings) {
      terminal.options.cursorStyle = settings.cursorStyle;
      terminal.options.cursorBlink = settings.cursorBlink;
      if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
        terminal.options.fontSize = settings.fontSize;
        fitAndResize();
      }
    }
  }, [fitAndResize, settings?.cursorBlink, settings?.cursorStyle, settings?.fontSize]);

  useEffect(() => {
    if (searchOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    } else {
      setQuery("");
      searchAddonRef.current?.clearDecorations();
      if (active) {
        terminalRef.current?.focus();
      }
    }
  }, [active, searchOpen]);

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
    terminalRef.current?.focus();
  };

  return (
    <div
      className={active ? "terminal-view is-active" : "terminal-view"}
      onClick={focusTerminal}
    >
      <nav className="block-rail" aria-label="Terminal blocks">
        {blocks.length === 0 ? (
          <div className="block-empty">no executed blocks</div>
        ) : (
          blocks.map((block) => <TerminalBlock key={block.id} block={block} />)
        )}
      </nav>

      <section className="terminal-output" aria-label="Terminal stream">
        {searchOpen && (
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
