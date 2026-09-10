import type { Terminal } from "@xterm/xterm";
import type { TerminalSemanticEvent } from "./types";
import { formatErrorMessage, getRandomQuote } from "../supabase";
import { AIManager } from "../ai/manager";
import { handleAIHelpCommand, handleAIStatusCommand, handleAITestCommand } from "../ai/commands";
import { generateCommandFromNaturalLanguage } from "../ai/assistant";

export type MockShellSession = {

  handleData: (data: string) => void;
  dispose: () => void;
};

export function attachMockShell(
  terminal: Terminal,
  onSemanticEvent: (event: TerminalSemanticEvent) => void,
): MockShellSession {
  const prompt = "\x1b[38;2;255;48;48muser@glyph\x1b[0m:\x1b[38;2;180;180;180m~\x1b[0m$ ";
  
  let currentBuffer = "";
  let cursorPosition = 0;
  const history: string[] = ["git status", "npm run build", "cargo check", "ls -la"];
  let historyIndex = history.length;
  let runningCommand = false;

  function printPrompt() {
    terminal.write("\r\n" + prompt);
    currentBuffer = "";
    cursorPosition = 0;
  }

  // Initial welcome screen
  terminal.writeln("\x1b[1;37mGLYPH\x1b[0m \x1b[38;2;255;48;48m[Dev Preview Mode]\x1b[0m");
  terminal.writeln("Interactive shell simulator active. Built-in command history & Up/Down arrow supported.");
  terminal.writeln("Type '\x1b[38;2;255;48;48mhelp\x1b[0m' or try \x1b[1;37mUp/Down Arrow\x1b[0m keys to cycle history.");
  terminal.write(prompt);

  const disposable = terminal.onData((data) => {
    if (runningCommand) return;

    // Handle escape sequences
    if (data === "\x1b[A") {
      // UP ARROW -> Previous command in history
      if (history.length === 0) return;
      if (historyIndex > 0) {
        historyIndex--;
      }
      const prevCmd = history[historyIndex] ?? "";
      
      // Erase current line
      while (cursorPosition > 0) {
        terminal.write("\b \b");
        cursorPosition--;
      }
      terminal.write(prevCmd);
      currentBuffer = prevCmd;
      cursorPosition = prevCmd.length;
      return;
    }

    if (data === "\x1b[B") {
      // DOWN ARROW -> Next command in history
      if (historyIndex < history.length - 1) {
        historyIndex++;
        const nextCmd = history[historyIndex] ?? "";
        while (cursorPosition > 0) {
          terminal.write("\b \b");
          cursorPosition--;
        }
        terminal.write(nextCmd);
        currentBuffer = nextCmd;
        cursorPosition = nextCmd.length;
      } else {
        historyIndex = history.length;
        while (cursorPosition > 0) {
          terminal.write("\b \b");
          cursorPosition--;
        }
        currentBuffer = "";
        cursorPosition = 0;
      }
      return;
    }

    if (data === "\r") {
      // ENTER key -> Execute command
      terminal.write("\r\n");
      const cmd = currentBuffer.trim();

      if (cmd.length > 0) {
        if (history.length === 0 || history[history.length - 1] !== cmd) {
          history.push(cmd);
        }
        historyIndex = history.length;

        // Emit OSC 133 command start
        const timestamp = Date.now();
        onSemanticEvent({
          kind: "command_execution_start",
          sessionId: "mock-session",
          raw: `OSC 133 C;${cmd}`,
          timestamp,
        });

        runningCommand = true;
        executeMockCommand(cmd, terminal, () => {
          runningCommand = false;
          // Emit OSC 133 command finished
          onSemanticEvent({
            kind: "command_finished",
            sessionId: "mock-session",
            exitCode: 0,
            raw: "OSC 133 D;0",
            timestamp: Date.now(),
          });
          printPrompt();
        });
      } else {
        printPrompt();
      }
      return;
    }

    if (data === "\x7f") {
      // BACKSPACE
      if (cursorPosition > 0) {
        currentBuffer = currentBuffer.slice(0, cursorPosition - 1) + currentBuffer.slice(cursorPosition);
        cursorPosition--;
        terminal.write("\b \b");
      }
      return;
    }

    if (data === "\x0c") {
      // CTRL + L (Clear screen)
      terminal.clear();
      terminal.write(prompt + currentBuffer);
      return;
    }

    if (data === "\t") {
      // TAB key -> Auto-completion (files, directories, commands)
      const suggestions = [
        "Desktop/",
        "Documents/",
        "Downloads/",
        "Music/",
        "Pictures/",
        "Videos/",
        "Projects/",
        "src/",
        "dist/",
        "node_modules/",
        "package.json",
        "README.md",
        "tsconfig.json",
        "ai",
        "ai status",
        "ai test",
        "ai help",
        "git",
        "git status",
        "git commit",
        "git push",
        "git pull",
        "git log",
        "git branch",
        "cargo",
        "cargo build",
        "cargo test",
        "cargo run",
        "npm",
        "npm run dev",
        "npm run build",
        "npm test",
        "clear",
        "help",
        "matrix",
        "ls",
        "cd",
        "pwd",
        "echo",
        "cat",
        "history",
      ];

      const parts = currentBuffer.split(" ");
      const lastWord = parts[parts.length - 1] ?? "";

      if (lastWord.length > 0) {
        const matches = suggestions.filter((s) => s.toLowerCase().startsWith(lastWord.toLowerCase()));
        if (matches.length === 1 && matches[0]) {
          const completion = matches[0].slice(lastWord.length);
          currentBuffer += completion + (matches[0].endsWith("/") ? "" : " ");
          cursorPosition = currentBuffer.length;
          terminal.write(completion + (matches[0].endsWith("/") ? "" : " "));
        } else if (matches.length > 1) {
          // Find common prefix or display matches
          const common = matches.reduce((acc, curr) => {
            let i = 0;
            while (i < acc.length && i < curr.length && acc[i]?.toLowerCase() === curr[i]?.toLowerCase()) {
              i++;
            }
            return acc.slice(0, i);
          });

          if (common.length > lastWord.length) {
            const completion = common.slice(lastWord.length);
            currentBuffer += completion;
            cursorPosition = currentBuffer.length;
            terminal.write(completion);
          } else {
            terminal.writeln("");
            terminal.writeln(matches.map((m) => `\x1b[36m${m}\x1b[0m`).join("  "));
            terminal.write(prompt + currentBuffer);
          }
        }
      }
      return;
    }

    if (data === "\x03") {
      // CTRL + C (Cancel)
      terminal.write("^C");
      printPrompt();
      return;
    }

    // Printable character
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      currentBuffer += data;
      cursorPosition += data.length;
      terminal.write(data);
    }
  });

  return {
    handleData: (data: string) => {
      terminal.write(data);
    },
    dispose: () => {
      disposable.dispose();
    },
  };
}

function executeMockCommand(cmd: string, terminal: Terminal, onComplete: () => void) {
  const parts = cmd.split(" ");
  const main = parts[0]?.toLowerCase();
  const sub = parts[1]?.toLowerCase();
  const normalizedCmd = cmd.trim().toLowerCase();
  const isGlyphPrefixed = normalizedCmd.startsWith("glyph ");
  const strippedCmd = isGlyphPrefixed ? normalizedCmd.slice(6).trim() : normalizedCmd;

  if (strippedCmd === "ai" || strippedCmd === "ai help" || strippedCmd === "ai --help" || strippedCmd === "ai -h") {
    handleAIHelpCommand((line) => terminal.writeln(line));
    onComplete();
    return;
  }

  if (strippedCmd === "ai status") {
    void handleAIStatusCommand(AIManager.getInstance(), (line) => terminal.writeln(line)).finally(() =>
      onComplete(),
    );
    return;
  }

  if (strippedCmd === "ai test") {
    void handleAITestCommand(AIManager.getInstance(), (line) => terminal.writeln(line)).finally(() =>
      onComplete(),
    );
    return;
  }

  // In-terminal Natural Language AI Prompting: # <prompt>, ? <prompt>, or ai <prompt>
  if (cmd.startsWith("#") || cmd.startsWith("?") || strippedCmd.startsWith("ai ")) {
    let query = "";
    if (cmd.startsWith("#") || cmd.startsWith("?")) {
      query = cmd.slice(1).trim();
    } else if (strippedCmd.startsWith("ai ")) {
      query = strippedCmd.slice(3).trim();
    }

    if (query.length > 0) {
      terminal.writeln(`\x1b[38;2;255;48;48m⠋\x1b[0m \x1b[38;2;180;180;180mAsking AI: "${query}"...\x1b[0m`);
      void generateCommandFromNaturalLanguage(query)
        .then((generated) => {
          terminal.writeln(`  \x1b[1;37m✨ Suggested Command:\x1b[0m`);
          terminal.writeln(`  \x1b[1;32m${generated.command}\x1b[0m`);
          if (generated.explanation) {
            terminal.writeln(`  \x1b[2;37m${generated.explanation}\x1b[0m`);
          }
          terminal.writeln("");
        })
        .catch((err: unknown) => {
          const msg = formatErrorMessage(err);
          terminal.writeln(`\x1b[31m  AI Error: ${msg}\x1b[0m`);
          terminal.writeln(`  \x1b[2mUse 'ai status' or press Ctrl+Shift+I to open AI Assistant.\x1b[0m`);
        })
        .finally(() => {
          onComplete();
        });
      return;
    }
  }

  switch (main) {

    case "clear":
      terminal.clear();
      onComplete();
      break;
    case "help":
      terminal.writeln("\x1b[1;37mGlyph Simulated Commands:\x1b[0m");
      terminal.writeln("  ls, pwd, whoami, uname, date, echo, history, quote, ai, clear, help");
      terminal.writeln("  Press \x1b[38;2;255;48;48mUp / Down Arrow\x1b[0m for command history.");
      onComplete();
      break;
    case "ls":
      terminal.writeln("\x1b[1;34msrc/\x1b[0m  \x1b[1;34msrc-tauri/\x1b[0m  package.json  README.md  tsconfig.json  vite.config.ts");
      onComplete();
      break;
    case "pwd":
      terminal.writeln("/home/aximsoft/projects/glyph");
      onComplete();
      break;
    case "whoami":
      terminal.writeln("aximsoft");
      onComplete();
      break;
    case "uname":
      terminal.writeln("Linux glyph 6.8.0-generic #42-Ubuntu SMP PREEMPT_DYNAMIC x86_64");
      onComplete();
      break;
    case "date":
      terminal.writeln(new Date().toString());
      onComplete();
      break;
    case "history":
      terminal.writeln("  1  git status\r\n  2  npm run build\r\n  3  cargo check\r\n  4  ls -la");
      onComplete();
      break;
    case "quote": {
      let frameIdx = 0;
      terminal.write("\r\n");
      const renderSpinner = () => {
        const frame = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][frameIdx % 10];
        frameIdx++;
        terminal.write(`\r\x1b[2K  \x1b[38;2;255;48;48m${frame}\x1b[0m \x1b[38;2;180;180;180mFetching quote...\x1b[0m`);
      };

      renderSpinner();
      const interval = setInterval(renderSpinner, 80);

      void getRandomQuote()
        .then(({ quote, author }) => {
          clearInterval(interval);
          terminal.write("\r\x1b[2K");
          terminal.writeln(`  \x1b[3m\x1b[38;2;220;220;220m"${quote}"\x1b[0m`);
          terminal.writeln(`  \x1b[38;2;160;160;160m\x1b[2m— ${author}\x1b[0m`);
          terminal.writeln("");
        })
        .catch((err: unknown) => {
          clearInterval(interval);
          terminal.write("\r\x1b[2K");
          const msg = formatErrorMessage(err);
          terminal.writeln(`\x1b[31m  Error fetching quote: ${msg}\x1b[0m`);
        })
        .finally(() => onComplete());
      break;
    }
    default:
      if (main?.startsWith("echo")) {
        terminal.writeln(parts.slice(1).join(" "));
      } else {
        terminal.writeln(`[mock shell]: executed '${cmd}' successfully.`);
      }
      onComplete();
      break;
  }
}

