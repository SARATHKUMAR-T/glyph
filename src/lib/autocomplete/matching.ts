export type MatchResult = {
  matched: boolean;
  score: number;
  matchedIndices: number[];
};

/**
 * Evaluates match quality between a user query and a candidate string,
 * returning score and character indices for UI highlighting.
 */
export function matchCandidate(query: string, candidate: string): MatchResult {
  if (!query) {
    return { matched: true, score: 100, matchedIndices: [] };
  }

  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { matched: true, score: 100, matchedIndices: [] };
  }

  // 1. Exact Match
  if (candidate === cleanQuery) {
    const matchedIndices = Array.from({ length: candidate.length }, (_, i) => i);
    return { matched: true, score: 1000, matchedIndices };
  }

  // 2. Case-insensitive Exact Match
  if (candidate.toLowerCase() === cleanQuery.toLowerCase()) {
    const matchedIndices = Array.from({ length: candidate.length }, (_, i) => i);
    return { matched: true, score: 900, matchedIndices };
  }

  // 3. Case-sensitive Prefix Match
  if (candidate.startsWith(cleanQuery)) {
    const matchedIndices = Array.from({ length: cleanQuery.length }, (_, i) => i);
    return { matched: true, score: 800 - (candidate.length - cleanQuery.length), matchedIndices };
  }

  // 4. Case-insensitive Prefix Match
  if (candidate.toLowerCase().startsWith(cleanQuery.toLowerCase())) {
    const matchedIndices = Array.from({ length: cleanQuery.length }, (_, i) => i);
    return { matched: true, score: 700 - (candidate.length - cleanQuery.length), matchedIndices };
  }

  // 5. Substring Match
  const lowerCand = candidate.toLowerCase();
  const lowerQuery = cleanQuery.toLowerCase();
  const subIdx = lowerCand.indexOf(lowerQuery);
  if (subIdx !== -1) {
    const matchedIndices = Array.from({ length: cleanQuery.length }, (_, i) => subIdx + i);
    return { matched: true, score: 500 - subIdx * 5, matchedIndices };
  }

  // 6. Fuzzy Subsequence Match
  let queryIdx = 0;
  const matchedIndices: number[] = [];
  let score = 300;
  let prevMatchIdx = -2;

  for (let i = 0; i < candidate.length && queryIdx < cleanQuery.length; i++) {
    if (lowerCand[i] === lowerQuery[queryIdx]) {
      matchedIndices.push(i);

      // Bonus for consecutive matches
      if (i === prevMatchIdx + 1) {
        score += 20;
      }

      // Bonus for word boundaries (e.g. after '-' or '/')
      if (i === 0 || candidate[i - 1] === "-" || candidate[i - 1] === "_" || candidate[i - 1] === "/") {
        score += 25;
      }

      prevMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx === cleanQuery.length) {
    // Penalty for total distance spanned
    const span = matchedIndices[matchedIndices.length - 1]! - matchedIndices[0]!;
    score = Math.max(10, score - span * 2);
    return { matched: true, score, matchedIndices };
  }

  return { matched: false, score: 0, matchedIndices: [] };
}
