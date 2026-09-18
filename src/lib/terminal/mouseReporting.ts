/**
 * Encodes mouse events into the escape sequences a mouse-aware PTY program
 * (vim, htop, tmux, less) expects when it has requested mouse tracking via
 * `CSI ?1000/1002/1003 h` (+ optionally `?1006h` for SGR extended
 * coordinates) — the wire-format `mouseMode` on each decoded frame (see
 * `engineProtocol.ts`) mirrors the live `TermMode` bits the Rust grid
 * engine reads directly off `alacritty_terminal`'s `Term`.
 *
 * This was a known Phase 4 gap: mouse selection worked, but nothing was
 * ever forwarded to the child program, so vim/htop never saw mouse events
 * even after explicitly requesting them (keyboard-driven use of both
 * already worked, since key encoding is unrelated to this).
 *
 * Not attempted: legacy `?1005` (UTF-8 extended) coordinates beyond column
 * 223 — every mouse-aware program encountered in practice prefers `?1006`
 * (SGR) when both are available, and `?1005` is obsolete, so a program
 * that requests only `?1005` still gets usable reports up to column/row
 * 223 via the plain legacy encoding below.
 */

import { MouseTrackingLevel, type MouseMode } from "./engineProtocol";

export type MouseButton = "left" | "middle" | "right" | "release" | "wheelUp" | "wheelDown";

export interface MouseReportModifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface MouseReportEvent {
  button: MouseButton;
  row: number;
  col: number;
  modifiers: MouseReportModifiers;
  /** True for a motion (mousemove) event, false for press/release/wheel. */
  isMotion: boolean;
}

const BUTTON_CODES: Record<Exclude<MouseButton, "release">, number> = {
  left: 0,
  middle: 1,
  right: 2,
  wheelUp: 64,
  wheelDown: 65,
};

/**
 * Returns whether `event` should be reported at all under `mode`'s current
 * tracking level. Wheel events report regardless of tracking level once
 * mouse mode is on at all — matching every real terminal's behavior of
 * letting a mouse-aware program see the wheel even in click-only (`?1000`)
 * mode, since otherwise it would look like nothing scrolls in it.
 */
function shouldReport(event: MouseReportEvent, mode: MouseMode): boolean {
  if (mode.tracking === MouseTrackingLevel.Off) return false;
  if (!event.isMotion) return true;
  return mode.tracking === MouseTrackingLevel.Drag || mode.tracking === MouseTrackingLevel.AnyMotion;
}

/**
 * Encodes one mouse event as PTY-bound bytes, or returns `null` when the
 * current tracking level doesn't cover this event (e.g. a Drag-mode
 * program shouldn't see hover motion with no button held) — callers should
 * fall back to local text selection/scrollback in that case.
 */
export function encodeMouseReport(event: MouseReportEvent, mode: MouseMode): string | null {
  if (!shouldReport(event, mode)) return null;

  // Both coordinate spaces are 1-based, and `event.isMotion` with a wheel
  // button doesn't happen in practice (wheel events aren't motion), but is
  // encoded the same way as a press if it ever does.
  const col = event.col + 1;
  const row = event.row + 1;

  const isWheel = event.button === "wheelUp" || event.button === "wheelDown";
  const isRelease = event.button === "release";
  let code = event.button === "release" ? 3 : BUTTON_CODES[event.button];

  if (event.modifiers.shift) code |= 4;
  if (event.modifiers.alt) code |= 8;
  if (event.modifiers.ctrl) code |= 16;
  if (event.isMotion && !isWheel) code |= 32;

  if (mode.sgr) {
    const suffix = isRelease ? "m" : "M";
    return `\x1b[<${code};${col};${row}${suffix}`;
  }

  // Legacy fixed-width encoding: coordinates beyond 223 (255 - 32) can't be
  // represented and are clamped, matching xterm's own documented behavior
  // for terminals too large for this 1980s-era wire format.
  const clamp = (n: number) => Math.min(n, 223);
  return `\x1b[M${String.fromCharCode(32 + code)}${String.fromCharCode(32 + clamp(col))}${String.fromCharCode(32 + clamp(row))}`;
}
