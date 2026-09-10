import type { CompletionCandidate } from "./types.js";

/**
 * Deduplicates and ranks completion candidates according to scoring rules.
 */
export function rankAndDeduplicateCandidates(
  candidates: CompletionCandidate[],
  maxResults = 7
): CompletionCandidate[] {
  const map = new Map<string, CompletionCandidate>();

  for (const candidate of candidates) {
    const key = candidate.text.trim();
    if (!key) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...candidate });
    } else {
      // Merge: keep highest score and enrich description
      if ((candidate.score ?? 0) > (existing.score ?? 0)) {
        map.set(key, {
          ...candidate,
          description: candidate.description || existing.description,
          displayText: candidate.displayText || existing.displayText,
        });
      } else if (!existing.description && candidate.description) {
        existing.description = candidate.description;
      }
    }
  }

  const unique = Array.from(map.values());

  unique.sort((a, b) => {
    const scoreA = a.score ?? 0;
    const scoreB = b.score ?? 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    // Alphabetical fallback
    return a.text.localeCompare(b.text);
  });

  return unique.slice(0, maxResults);
}
