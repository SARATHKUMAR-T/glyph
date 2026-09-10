import { matchCandidate } from "../matching.js";
import { LocalKnowledgeManager } from "../../knowledge/manager.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

export class CommandProvider implements CompletionProvider {
  id = "command-provider";
  name = "System Commands";
  priority = 100;

  async complete(
    _context: CompletionContext,
    parsed: ParsedCommandContext
  ): Promise<CompletionCandidate[]> {
    // Only suggest commands at the beginning of the command line
    if (!parsed.isInitialCommand) {
      return [];
    }

    const query = parsed.activeToken.clean;
    // Delegate to LocalKnowledgeManager — returns cached data or fetches once
    const commands = await LocalKnowledgeManager.getInstance().getCommands();
    const candidates: CompletionCandidate[] = [];

    for (const cmd of commands) {
      const match = matchCandidate(query, cmd);
      if (match.matched) {
        candidates.push({
          text: cmd,
          displayText: cmd,
          type: "command",
          source: "$PATH",
          score: match.score + this.priority,
          replacementStart: parsed.activeToken.start,
          replacementEnd: parsed.activeToken.end,
          matchedIndices: match.matchedIndices,
          description: "Executable binary",
        });
      }
    }

    return candidates;
  }
}
