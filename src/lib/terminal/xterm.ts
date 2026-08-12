import { Terminal } from "@xterm/xterm";
import { TERMINAL_FONT_FAMILY } from "../constants";
import type { CursorStyleOption } from "../../hooks/useTerminalSettings";

type CreateXtermOptions = {
  cursorStyle?: CursorStyleOption;
  cursorBlink?: boolean;
};

export function createNothingXterm(options?: CreateXtermOptions) {
  return new Terminal({
    allowTransparency: true,
    convertEol: true,
    cursorBlink: options?.cursorBlink ?? true,
    cursorStyle: options?.cursorStyle ?? "block",
    drawBoldTextInBrightColors: false,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 1.18,
    macOptionIsMeta: false,
    scrollback: 10000,
    tabStopWidth: 8,
    theme: {
      background: "#00000000",
      foreground: "#f5f5f5",
      cursor: "#ff3030",
      cursorAccent: "#000000",
      selectionBackground: "rgba(255, 48, 48, 0.45)",
      black: "#000000",
      red: "#d71921",
      green: "#b6f2bd",
      yellow: "#f3e7a1",
      blue: "#9cc9ff",
      magenta: "#e4b2ff",
      cyan: "#9ee7e5",
      white: "#f5f5f5",
      brightBlack: "#777777",
      brightRed: "#ff3030",
      brightGreen: "#d2ffd6",
      brightYellow: "#fff4b8",
      brightBlue: "#b8dcff",
      brightMagenta: "#f0caff",
      brightCyan: "#c1fffb",
      brightWhite: "#ffffff",
    },
  });
}
