import { matchCandidate } from "../matching.js";
import { LocalKnowledgeManager } from "../../knowledge/manager.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

export class HistoryProvider implements CompletionProvider {
  id = "history-provider";
  name = "Command History";
  priority = 85;

  complete(
    context: CompletionContext,
    _parsed: ParsedCommandContext
  ): CompletionCandidate[] {
    if (!context.input.trim()) return [];

    const fullInput = context.input.slice(0, context.cursorPosition).trim();
    if (!fullInput) return [];

    // If the caller provides an explicit history list (e.g. from tests or first
    // load), seed the manager's in-memory index with those entries.
    if (context.history && context.history.length > 0) {
      const mgr = LocalKnowledgeManager.getInstance();
      for (const cmd of context.history) {
        if (cmd.trim()) mgr.addHistoryEntry(cmd.trim());
      }
    }

    // Use the LocalKnowledgeManager's indexed history (frequency + recency built once)
    const entries = LocalKnowledgeManager.getInstance().getHistory();
    if (entries.length === 0) return [];

    const candidates: CompletionCandidate[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (entry.command === fullInput || seen.has(entry.command)) continue;
      seen.add(entry.command);

      const match = matchCandidate(fullInput, entry.command);
      if (!match.matched) continue;

      // Recency contributes 0–50, frequency 0–40
      const recencyBonus = Math.round((entry.recencyRank / 100) * 50);
      const frequencyBonus = Math.min(40, entry.frequency * 8);

      candidates.push({
        text: entry.command,
        displayText: entry.command,
        type: "history",
        source: "History",
        score: match.score + this.priority + recencyBonus + frequencyBonus,
        replacementStart: 0,
        replacementEnd: context.input.length,
        matchedIndices: match.matchedIndices,
        description:
          entry.frequency > 1 ? `Used ${entry.frequency} times` : "Recent command",
      });
    }

    return candidates;
  }
}
