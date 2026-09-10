import type { ParsedCommandContext, ParsedToken } from "./types.js";

/**
 * Tokenizes a shell input line respecting quotes and escaped characters,
 * identifying the active token under or immediately preceding the cursor.
 */
export function tokenizeCommandLine(input: string, cursorPosition: number): ParsedCommandContext {
  const effectiveCursor = Math.max(0, Math.min(cursorPosition, input.length));
  const tokens: ParsedToken[] = [];

  let currentRaw = "";
  let currentClean = "";
  let tokenStart = -1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let quoteChar: string | undefined = undefined;

  for (let i = 0; i < input.length; i++) {
    const char = input[i] ?? "";
    const isEscaped = i > 0 && input[i - 1] === "\\" && (i < 2 || input[i - 2] !== "\\");

    if (char === "'" && !inDoubleQuote && !isEscaped) {
      if (inSingleQuote) {
        inSingleQuote = false;
        quoteChar = undefined;
      } else {
        inSingleQuote = true;
        quoteChar = "'";
        if (tokenStart === -1) tokenStart = i;
      }
      currentRaw += char;
      continue;
    }

    if (char === '"' && !inSingleQuote && !isEscaped) {
      if (inDoubleQuote) {
        inDoubleQuote = false;
        quoteChar = undefined;
      } else {
        inDoubleQuote = true;
        quoteChar = '"';
        if (tokenStart === -1) tokenStart = i;
      }
      currentRaw += char;
      continue;
    }

    // Space delimiter outside quotes
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote && !isEscaped) {
      if (tokenStart !== -1) {
        tokens.push({
          raw: currentRaw,
          clean: currentClean,
          start: tokenStart,
          end: i,
          isQuoteClosed: !inSingleQuote && !inDoubleQuote,
          quoteChar,
        });
        currentRaw = "";
        currentClean = "";
        tokenStart = -1;
      }
      continue;
    }

    // Normal character
    if (tokenStart === -1) {
      tokenStart = i;
    }
    currentRaw += char;
    if (!isEscaped || char !== "\\") {
      currentClean += char;
    }
  }

  // Push trailing token if non-empty
  if (tokenStart !== -1) {
    tokens.push({
      raw: currentRaw,
      clean: currentClean,
      start: tokenStart,
      end: input.length,
      isQuoteClosed: !inSingleQuote && !inDoubleQuote,
      quoteChar,
    });
  }

  // Find active token at or before cursor
  let activeTokenIndex = -1;
  let activeToken: ParsedToken | undefined = undefined;

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]!;
    if (effectiveCursor >= t.start && effectiveCursor <= t.end) {
      activeTokenIndex = idx;
      activeToken = t;
      break;
    }
  }

  // If cursor is at trailing whitespace, create an empty virtual token at cursor position
  if (!activeToken) {
    activeToken = {
      raw: "",
      clean: "",
      start: effectiveCursor,
      end: effectiveCursor,
      isQuoteClosed: true,
    };
    activeTokenIndex = tokens.length;
  }

  const firstToken = tokens[0]?.clean || "";
  const isInitialCommand = activeTokenIndex === 0;
  const isFlag = activeToken.clean.startsWith("-");
  const isPathLike =
    activeToken.clean.startsWith("/") ||
    activeToken.clean.startsWith("./") ||
    activeToken.clean.startsWith("../") ||
    activeToken.clean.startsWith("~/") ||
    activeToken.clean.includes("/");

  let subcommand: string | undefined = undefined;
  if (tokens.length > 1 && !tokens[1]?.clean.startsWith("-")) {
    subcommand = tokens[1]?.clean;
  }

  return {
    command: firstToken,
    subcommand,
    tokens,
    activeToken,
    activeTokenIndex,
    isInitialCommand,
    isFlag,
    isPathLike,
  };
}
