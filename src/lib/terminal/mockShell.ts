import type { Terminal } from "@xterm/xterm";
import type { TerminalSemanticEvent } from "./types";

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

  switch (main) {
    case "clear":
      terminal.clear();
      onComplete();
      break;
    case "help":
      terminal.writeln("\x1b[1;37mGlyph Simulated Commands:\x1b[0m");
      terminal.writeln("  ls, pwd, whoami, uname, date, echo, history, clear, help");
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
