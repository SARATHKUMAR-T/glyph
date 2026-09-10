import type { Terminal as XTerm } from "@xterm/xterm";
import { formatErrorMessage, getRandomQuote } from "../supabase";
import { AIManager } from "../ai/manager";
import { handleAIHelpCommand, handleAIStatusCommand, handleAITestCommand } from "../ai/commands";
import { generateCommandFromNaturalLanguage } from "../ai/assistant";
import { LocalKnowledgeManager } from "../knowledge/index.js";

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
  const normalized = trimmed.startsWith("glyph ") ? trimmed.slice(6).trim() : trimmed;

  if (normalized === "quote") {
    await handleQuoteCommand(terminal, sessionWriter);
    return { handled: true };
  }

  if (normalized === "ai" || normalized === "ai help" || normalized === "ai --help" || normalized === "ai -h") {
    terminal.write("\r\n");
    handleAIHelpCommand((line) => terminal.writeln(line));
    sessionWriter("\x15\r");
    return { handled: true };
  }

  if (normalized === "ai status") {
    terminal.write("\r\n");
    await handleAIStatusCommand(AIManager.getInstance(), (line) => terminal.writeln(line));
    sessionWriter("\x15\r");
    return { handled: true };
  }

  if (normalized === "ai test") {
    terminal.write("\r\n");
    await handleAITestCommand(AIManager.getInstance(), (line) => terminal.writeln(line));
    sessionWriter("\x15\r");
    return { handled: true };
  }

  // In-terminal Natural Language AI Prompting: # <prompt>, ? <prompt>, or ai <prompt>
  if (cmd.startsWith("#") || cmd.startsWith("?") || normalized.startsWith("ai ")) {
    let query = "";
    if (cmd.startsWith("#") || cmd.startsWith("?")) {
      query = cmd.slice(1).trim();
    } else if (normalized.startsWith("ai ")) {
      query = cmd.slice(3).trim();
    }

    if (query.length > 0) {
      await handleNaturalLanguagePrompt(query, terminal, sessionWriter);
      return { handled: true };
    }
  }

  if (normalized === "knowledge" || normalized === "knowledge status") {
    terminal.write("\r\n");
    await handleKnowledgeStatusCommand(terminal);
    sessionWriter("\x15\r");
    return { handled: true };
  }

  if (normalized === "knowledge refresh") {
    terminal.write("\r\n");
    LocalKnowledgeManager.getInstance().invalidate("all");
    terminal.writeln(`  \x1b[38;2;255;48;48m✓\x1b[0m \x1b[1;37mKnowledge cache cleared.\x1b[0m Will rebuild on next completion.`);
    terminal.writeln("");
    sessionWriter("\x15\r");
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

async function handleNaturalLanguagePrompt(

  prompt: string,
  terminal: XTerm,
  sessionWriter: (data: string) => void,
) {
  terminal.write("\r\n");

  let frameIdx = 0;
  const renderSpinner = () => {
    const frame = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
    frameIdx++;
    terminal.write(`\r\x1b[2K  \x1b[38;2;255;48;48m${frame}\x1b[0m \x1b[38;2;180;180;180mAsking AI: "${prompt}"...\x1b[0m`);
  };

  renderSpinner();
  const spinnerInterval = setInterval(renderSpinner, 80);

  try {
    const generated = await generateCommandFromNaturalLanguage(prompt);
    clearInterval(spinnerInterval);
    terminal.write("\r\x1b[2K");

    // Output formatted command result
    terminal.writeln(`  \x1b[1;37m✨ Suggested Command:\x1b[0m`);
    terminal.writeln(`  \x1b[1;32m${generated.command}\x1b[0m`);
    if (generated.explanation) {
      terminal.writeln(`  \x1b[2;37m${generated.explanation}\x1b[0m`);
    }
    terminal.writeln("");

    // Clear old line from PTY buffer and insert generated command into PTY line buffer!
    sessionWriter("\x15" + generated.command);
  } catch (error) {
    clearInterval(spinnerInterval);
    terminal.write("\r\x1b[2K");
    const msg = formatErrorMessage(error);
    terminal.writeln(`\x1b[31m  AI Error: ${msg}\x1b[0m`);
    terminal.writeln(`  \x1b[2mUse 'ai status' or press Ctrl+Shift+I to open the AI Assistant.\x1b[0m`);
    terminal.writeln("");
    sessionWriter("\x15\r");
  }
}


// ── knowledge status ─────────────────────────────────────────────────────────

async function handleKnowledgeStatusCommand(terminal: XTerm): Promise<void> {
  const s = {
    accent: "\x1b[38;2;255;48;48m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    green:  "\x1b[38;2;80;200;120m",
    yellow: "\x1b[38;2;255;200;60m",
    reset:  "\x1b[0m",
    white:  "\x1b[38;2;220;220;220m",
  };

  terminal.writeln(`  ${s.accent}${s.bold}Local Knowledge${s.reset}`);
  terminal.writeln(`  ${s.dim}─────────────────────────────────────${s.reset}`);

  try {
    const status = await LocalKnowledgeManager.getInstance().getStatus();

    const cached = (v: boolean) => v
      ? `${s.green}● cached${s.reset}`
      : `${s.yellow}○ not cached${s.reset}`;

    terminal.writeln(`  ${s.white}PATH commands  :${s.reset}  ${s.bold}${status.commandCount}${s.reset}  ${cached(status.pathCommandsCached)}`);
    terminal.writeln(`  ${s.white}History total  :${s.reset}  ${s.bold}${status.historyCount}${s.reset}  ${s.dim}(${status.historyUniqueCount} unique)${s.reset}`);
    terminal.writeln(`  ${s.white}Git repo       :${s.reset}  ${status.isGitRepo
      ? `${s.green}yes${s.reset}  ${s.dim}${status.currentBranch ?? ""}  (${status.gitBranchCount} branches)${s.reset}`
      : `${s.dim}no${s.reset}`}  ${cached(status.gitCached)}`);
    terminal.writeln(`  ${s.white}Project type   :${s.reset}  ${s.bold}${status.projectType}${s.reset}  ${s.dim}(${status.projectScriptCount} scripts)${s.reset}  ${cached(status.projectCached)}`);
    terminal.writeln(`  ${s.white}Current dir    :${s.reset}  ${s.dim}${status.currentCwd}${s.reset}`);
    terminal.writeln("");
    terminal.writeln(`  ${s.dim}Run ${s.reset}${s.accent}knowledge refresh${s.reset}${s.dim} to clear all caches.${s.reset}`);
    terminal.writeln("");
  } catch {
    terminal.writeln(`  ${s.dim}(Knowledge status unavailable)${s.reset}`);
    terminal.writeln("");
  }
}
