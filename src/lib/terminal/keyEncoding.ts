/**
 * Minimal keydown -> PTY byte-sequence encoder for the experimental Canvas2D
 * renderer path. This intentionally covers the common cases (control chars,
 * arrows, navigation, function keys) the way xterm.js's internal encoder
 * does, but it is NOT a full reimplementation: no kitty keyboard protocol,
 * no application-cursor-mode-aware alternate encodings beyond arrows, and
 * no IME composition handling (see `GlyphCanvasTerminalView`, which uses a
 * hidden textarea's `input` events for committed text so basic typing and
 * paste work, but multi-keystroke composition is not specially handled).
 * Full parity with xterm.js's key table is tracked as a Phase 4 checklist
 * item, not attempted here.
 */

const NAMED_KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

/**
 * Returns the byte sequence to send to the PTY for this keydown, or `null`
 * if the key should be left for the hidden textarea's `input` event to
 * handle instead (plain printable characters — letting the browser's IME
 * and dead-key composition run normally rather than fighting it here).
 */
export function encodeKeyEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null;

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    const code = ctrlCombo(event.key);
    if (code !== null) return code;
  }

  const named = NAMED_KEYS[event.key];
  if (named) {
    // Alt+arrow etc. get an ESC prefix, matching common terminal convention.
    return event.altKey ? "\x1b" + named : named;
  }

  return null;
}

function ctrlCombo(key: string): string | null {
  if (key.length !== 1) return null;
  const lower = key.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    return String.fromCharCode(lower.charCodeAt(0) - 96);
  }
  switch (key) {
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    case "@":
      return "\x00";
    default:
      return null;
  }
}
