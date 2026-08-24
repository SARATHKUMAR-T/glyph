import type { Terminal as XTerm } from "@xterm/xterm";
import { formatErrorMessage, getRandomQuote } from "../supabase";

/**
 * Built-in Glyph commands that are intercepted client-side
 * before reaching the shell/PTY.
 */
type BuiltinResult = {
  handled: boolean;
};

const QUOTE_STYLE = {
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  accent: "\x1b[38;2;255;48;48m",
  text: "\x1b[38;2;220;220;220m",
  author: "\x1b[38;2;160;160;160m",
};

export async function tryRunBuiltinCommand(
  cmd: string,
  terminal: XTerm,
  sessionWriter: (data: string) => void,
): Promise<BuiltinResult> {
  const trimmed = cmd.trim().toLowerCase();

  if (trimmed === "quote") {
    await handleQuoteCommand(terminal, sessionWriter);
    return { handled: true };
  }

  return { handled: false };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

async function handleQuoteCommand(
  terminal: XTerm,
  sessionWriter: (data: string) => void,
) {
  const s = QUOTE_STYLE;

  // Move to a new line in xterm below the user's typed prompt
  terminal.write("\r\n");

  // Start animated loading spinner on the new line
  let frameIdx = 0;
  const renderSpinner = () => {
    const frame = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
    frameIdx++;
    terminal.write(`\r\x1b[2K  \x1b[38;2;255;48;48m${frame}\x1b[0m \x1b[38;2;180;180;180mFetching quote...\x1b[0m`);
  };

  renderSpinner();
  const spinnerInterval = setInterval(renderSpinner, 80);

  try {
    const { quote, author } = await getRandomQuote();
    clearInterval(spinnerInterval);

    // Clear spinner line
    terminal.write("\r\x1b[2K");

    // Output formatted quote
    terminal.writeln(`  ${s.italic}${s.text}"${quote}"${s.reset}`);
    terminal.writeln(`  ${s.author}${s.dim}— ${author}${s.reset}`);
    terminal.writeln("");
  } catch (error) {
    clearInterval(spinnerInterval);

    // Clear spinner line
    terminal.write("\r\x1b[2K");

    const msg = formatErrorMessage(error);
    terminal.writeln(`\x1b[31m  Error fetching quote: ${msg}\x1b[0m`);
    terminal.writeln("");
  }

  // Clear typed 'quote' from PTY input buffer & trigger a clean new prompt
  sessionWriter("\x15\r");
}
