/**
 * Minimal clickable-link detection over a row's plain text, standing in
 * for `@xterm/addon-web-links`. Deliberately simple (http/https URLs
 * only, no custom protocol registration, no link-provider API) — see the
 * Phase 4 report for what full parity would still need.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

export interface LinkSpan {
  startCol: number;
  endCol: number; // exclusive
  url: string;
}

export function findLinks(rowText: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(rowText))) {
    let url = match[0];
    // Trim trailing punctuation that's almost always sentence
    // punctuation, not part of the URL (mirrors addon-web-links).
    while (url.length > 0 && /[.,;:!?)\]}'"]$/.test(url)) {
      url = url.slice(0, -1);
    }
    if (url.length === 0) continue;
    spans.push({ startCol: match.index, endCol: match.index + url.length, url });
  }
  return spans;
}

export function linkAt(rowText: string, col: number): LinkSpan | null {
  for (const span of findLinks(rowText)) {
    if (col >= span.startCol && col < span.endCol) return span;
  }
  return null;
}
