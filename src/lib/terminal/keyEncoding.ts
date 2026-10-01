/**
 * Keydown -> PTY byte-sequence encoder, following xterm's conventions (the
 * de-facto standard every TUI — shells, vim, and agent CLIs like Claude
 * Code, Codex and Gemini — is written against):
 *
 * - Modified cursor / navigation / function keys use the xterm
 *   `CSI 1 ; <mod> X` and `CSI <n> ; <mod> ~` forms, where
 *   `<mod> = 1 + shift + 2*alt + 4*ctrl` (Ctrl+Left, Shift+Up, ...).
 * - Shift+Tab is back-tab, `CSI Z` (Claude Code's mode switch, menu
 *   navigation in most TUIs).
 * - Alt acts as Meta: it ESC-prefixes whatever the key would send.
 * - Shift+Enter sends ESC CR, the same thing Alt+Enter does — which agent
 *   CLIs treat as "insert newline" rather than "submit".
 * - Cursor keys honor DECCKM (application cursor mode, `ESC O A` instead
 *   of `ESC [ A`) when the running program has enabled it.
 *
 * No kitty keyboard protocol. Plain printable characters return `null` so
 * the hidden textarea's `input` event delivers them, keeping the browser's
 * IME and dead-key composition intact.
 */

export interface KeyEncodingOptions {
  /** The running program has enabled application cursor keys (DECCKM,
   * `CSI ? 1 h`). */
  appCursor?: boolean;
}

/** Final byte of the `CSI 1 ; <mod> X` form; `SS3 X` / `CSI X` unmodified. */
const CURSOR_KEYS: Record<string, string> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

/** F1-F4 are `SS3 P..S` unmodified and `CSI 1 ; <mod> P..S` modified. */
const SS3_FUNCTION_KEYS: Record<string, string> = {
  F1: "P",
  F2: "Q",
  F3: "R",
  F4: "S",
};

/** Number in the `CSI <n> ~` / `CSI <n> ; <mod> ~` form. */
const TILDE_KEYS: Record<string, number> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
};

/**
 * Whether this keydown is the Tab key, in any of the spellings it arrives
 * under. With Shift held, GTK (and therefore WebKitGTK) reports Tab as
 * `ISO_Left_Tab`, which some builds surface as `event.key` instead of
 * `"Tab"` — matching on `key` alone let Shift+Tab fall through unhandled
 * and move DOM focus to the UI's buttons instead of reaching the PTY.
 */
export function isTabKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return key === "tab" || key === "iso_left_tab" || key === "backtab" || event.code === "Tab";
}

/**
 * Returns the byte sequence to send to the PTY for this keydown, or `null`
 * if the key should be left for the hidden textarea's `input` event to
 * handle instead (plain printable characters — letting the browser's IME
 * and dead-key composition run normally rather than fighting it here).
 */
export function encodeKeyEvent(event: KeyboardEvent, options: KeyEncodingOptions = {}): string | null {
  if (event.isComposing) return null;
  // Super/Cmd combos belong to the desktop, not the PTY.
  if (event.metaKey) return null;

  // AltGr composes a character (e.g. `@` on German layouts) and reports as
  // Ctrl+Alt on some platforms — leave it to the `input` event.
  if (event.getModifierState?.("AltGraph")) return null;

  const { shiftKey: shift, altKey: alt, ctrlKey: ctrl } = event;
  const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const meta = (seq: string) => (alt ? "\x1b" + seq : seq);

  if (isTabKey(event)) {
    return shift ? meta("\x1b[Z") : meta("\t");
  }

  switch (event.key) {
    case "Enter":
      // Shift+Enter / Alt+Enter: ESC CR, the "newline, don't submit" chord
      // agent CLIs and readline-style prompts recognise.
      return shift || alt ? "\x1b\r" : "\r";
    case "Backspace":
      if (ctrl) return meta("\x08");
      return meta("\x7f");
    case "Escape":
      return meta("\x1b");
    case " ":
      if (ctrl) return meta("\x00");
      return alt ? "\x1b " : null;
  }

  const cursor = CURSOR_KEYS[event.key];
  if (cursor) {
    if (mod > 1) return `\x1b[1;${mod}${cursor}`;
    return (options.appCursor ? "\x1bO" : "\x1b[") + cursor;
  }

  const ss3 = SS3_FUNCTION_KEYS[event.key];
  if (ss3) {
    return mod > 1 ? `\x1b[1;${mod}${ss3}` : `\x1bO${ss3}`;
  }

  const tilde = TILDE_KEYS[event.key];
  if (tilde !== undefined) {
    return mod > 1 ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`;
  }

  if (ctrl) {
    const code = ctrlCombo(event);
    if (code !== null) return meta(code);
    return null;
  }

  // Alt+<printable> as Meta: ESC-prefix the character it would type.
  if (alt && event.key.length === 1) {
    return "\x1b" + event.key;
  }

  return null;
}

function ctrlCombo(event: KeyboardEvent): string | null {
  // Prefer the physical key for letters so Ctrl+C etc. still work on
  // non-Latin layouts, where `event.key` is e.g. a Cyrillic letter.
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) return String.fromCharCode(letter.charCodeAt(0) - 64);

  const key = event.key;
  if (key.length !== 1) return null;
  const lower = key.toLowerCase();
  if (lower >= "a" && lower <= "z") {
    return String.fromCharCode(lower.charCodeAt(0) - 96);
  }
  switch (key) {
    case "@":
    case "2":
      return "\x00";
    case "[":
    case "3":
      return "\x1b";
    case "\\":
    case "4":
      return "\x1c";
    case "]":
    case "5":
      return "\x1d";
    case "^":
    case "6":
      return "\x1e";
    case "_":
    case "-":
    case "/":
    case "7":
      return "\x1f";
    case "?":
    case "8":
      return "\x7f";
    default:
      return null;
  }
}
