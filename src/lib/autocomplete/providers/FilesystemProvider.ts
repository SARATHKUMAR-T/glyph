import { matchCandidate } from "../matching.js";
import { LocalKnowledgeManager } from "../../knowledge/manager.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

export class FilesystemProvider implements CompletionProvider {
  id = "filesystem-provider";
  name = "Filesystem";
  priority = 90;

  async complete(
    context: CompletionContext,
    parsed: ParsedCommandContext
  ): Promise<CompletionCandidate[]> {
    // Skip for npm/pnpm/bun run — ProjectProvider handles those
    if (
      (parsed.command === "npm" || parsed.command === "pnpm" || parsed.command === "bun") &&
      parsed.subcommand === "run" &&
      !parsed.isPathLike
    ) {
      return [];
    }

    const rawToken = parsed.activeToken.clean;
    const isCdCommand = parsed.command === "cd";

    // For `cd` we ALWAYS want filesystem completions, even without a path-like token.
    // For other commands, trigger only when the token looks like a path or we're at
    // an argument position (not the initial command itself).
    const shouldComplete =
      isCdCommand ||
      parsed.isPathLike ||
      (!parsed.isInitialCommand && !parsed.isFlag);

    if (!shouldComplete) {
      return [];
    }

    const cwd = context.cwd || "/";

    // Build the directory + prefix for the knowledge manager
    let lookupDir = cwd;
    let filePrefix = rawToken;

    if (rawToken.includes("/")) {
      // e.g. "src/com" → look inside cwd/src for "com"
      const lastSlash = rawToken.lastIndexOf("/");
      const dirPart = rawToken.slice(0, lastSlash + 1); // "src/"
      filePrefix = rawToken.slice(lastSlash + 1);       // "com"

      // Resolve relative to cwd
      if (dirPart.startsWith("~/")) {
        const home = typeof window !== "undefined"
          ? (localStorage.getItem("glyph:home") ?? "/root")
          : "/root";
        lookupDir = home + "/" + dirPart.slice(2);
      } else if (dirPart.startsWith("/")) {
        lookupDir = dirPart;
      } else {
        lookupDir = cwd + "/" + dirPart;
      }
    }

    // Delegate to LocalKnowledgeManager (cached, CWD-keyed)
    const entries = await LocalKnowledgeManager.getInstance().getFilesystemEntries(
      lookupDir,
      filePrefix
    );

    const candidates: CompletionCandidate[] = [];

    for (const entry of entries) {
      const match = matchCandidate(filePrefix || rawToken, entry.name);
      if (!match.matched) continue;

      // Reconstruct the full completion text
      let completionText = entry.name;
      if (rawToken.includes("/")) {
        const dirPart = rawToken.slice(0, rawToken.lastIndexOf("/") + 1);
        completionText = dirPart + entry.name;
      }

      // Prefer directories (especially for `cd`)
      const dirBonus = entry.isDir ? (isCdCommand ? 200 : 50) : 0;

      candidates.push({
        text: completionText,
        displayText: entry.name,
        type: entry.isDir ? "directory" : "file",
        source: "Filesystem",
        score: match.score + this.priority + dirBonus,
        replacementStart: parsed.activeToken.start,
        replacementEnd: parsed.activeToken.end,
        matchedIndices: match.matchedIndices,
        description: entry.isDir ? "Directory" : entry.isExecutable ? "Executable" : "File",
      });
    }

    return candidates;
  }
}
