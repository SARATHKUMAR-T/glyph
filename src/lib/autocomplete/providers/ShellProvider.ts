import { matchCandidate } from "../matching.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

const BUILTINS: Array<{ name: string; desc: string }> = [
  { name: "cd",        desc: "Change working directory" },
  { name: "pwd",       desc: "Print current working directory" },
  { name: "echo",      desc: "Write arguments to standard output" },
  { name: "export",    desc: "Set an environment variable" },
  { name: "alias",     desc: "Define or display aliases" },
  { name: "source",    desc: "Execute commands from a file in the current shell" },
  { name: "which",     desc: "Locate a command executable" },
  { name: "history",   desc: "Display command history list" },
  { name: "clear",     desc: "Clear terminal screen" },
  { name: "exit",      desc: "Exit the terminal session" },
  { name: "help",      desc: "Display shell & terminal help" },
  { name: "matrix",    desc: "Launch Nothing dot-matrix animation" },
  { name: "ai",        desc: "Manage AI assistant & provider" },
  { name: "knowledge", desc: "Show local knowledge index status" },
];

const COMMON_FLAGS: Array<{ flag: string; desc: string }> = [
  { flag: "--help", desc: "Display help message" },
  { flag: "-h", desc: "Display help message" },
  { flag: "--version", desc: "Display version information" },
  { flag: "-v", desc: "Verbose / version output" },
  { flag: "-a", desc: "All entries (e.g. hidden files)" },
  { flag: "-l", desc: "Long listing format" },
  { flag: "-f", desc: "Force action without confirmation" },
  { flag: "-r", desc: "Recursive operation" },
  { flag: "--verbose", desc: "Enable verbose logging" },
  { flag: "--force", desc: "Force execution" },
];

export class ShellProvider implements CompletionProvider {
  id = "shell-provider";
  name = "Shell Built-ins";
  priority = 95;

  complete(
    _context: CompletionContext,
    parsed: ParsedCommandContext
  ): CompletionCandidate[] {
    const candidates: CompletionCandidate[] = [];
    const query = parsed.activeToken.clean;

    // 1. Initial command builtins
    if (parsed.isInitialCommand) {
      for (const builtin of BUILTINS) {
        const match = matchCandidate(query, builtin.name);
        if (match.matched) {
          candidates.push({
            text: builtin.name,
            displayText: builtin.name,
            type: "command",
            source: "Shell Built-in",
            score: match.score + this.priority + 10,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: builtin.desc,
          });
        }
      }
    }

    // 2. Common command options / flags
    if (parsed.isFlag) {
      for (const flag of COMMON_FLAGS) {
        const match = matchCandidate(query, flag.flag);
        if (match.matched) {
          candidates.push({
            text: flag.flag,
            displayText: flag.flag,
            type: "option",
            source: "Flag",
            score: match.score + this.priority - 10,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: flag.desc,
          });
        }
      }
    }

    return candidates;
  }
}
