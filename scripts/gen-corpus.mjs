#!/usr/bin/env node
// Generates the Phase 1 grid-diff corpus: small, deterministic, hermetic
// byte sequences (not spawned real shells, so the test never depends on
// timing or on what happens to be installed) that exercise the VT features
// the Rust grid engine (tests/grid_diff.rs) and the xterm.js headless
// reference (scripts/grid-diff.mjs) are compared against.
//
// Run with `node scripts/gen-corpus.mjs` whenever the corpus needs to
// change; the .bin files + manifest.json it writes are committed so CI
// doesn't need to regenerate them.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "tests",
  "fixtures",
  "pty_corpus",
);
mkdirSync(OUT_DIR, { recursive: true });

const ESC = "\x1b";
const CSI = `${ESC}[`;

/** @type {{name: string, cols: number, rows: number, bytes: string, resizeTo?: {cols:number,rows:number}, postBytes?: string}[]} */
const cases = [];

function addCase(name, cols, rows, bytes, knownIssue) {
  cases.push({ name, cols, rows, bytes, knownIssue });
}

/** Like `addCase`, but resizes the terminal to `resizeTo` after `bytes`
 * and feeds `postBytes` before snapshotting — for exercising reflow. */
function addResizeCase(name, cols, rows, bytes, resizeTo, postBytes, knownIssue) {
  cases.push({ name, cols, rows, bytes, resizeTo, postBytes, knownIssue });
}

addCase(
  "basic_text",
  80,
  24,
  "Hello, Glyph!\r\n" +
    "Tabs:\tA\tB\tC\r\n" +
    "Backspace: abcXYZ\b\b\b123\r\n" +
    "Second line\r\nThird line\r\n",
);

addCase(
  "sgr_colors",
  80,
  10,
  [
    `${CSI}31mred${CSI}0m `,
    `${CSI}42mgreenbg${CSI}0m `,
    `${CSI}1mbold${CSI}0m `,
    `${CSI}3mitalic${CSI}0m `,
    `${CSI}4munderline${CSI}0m `,
    `${CSI}9mstrike${CSI}0m `,
    `${CSI}7minverse${CSI}0m\r\n`,
    `${CSI}38;5;208mindexed208${CSI}0m `,
    `${CSI}48;5;27mindexedbg27${CSI}0m\r\n`,
    `${CSI}38;2;10;200;250mtruecolorfg${CSI}0m `,
    `${CSI}48;2;90;20;150mtruecolorbg${CSI}0m\r\n`,
  ].join(""),
);

addCase(
  "cursor_moves",
  40,
  10,
  [
    `${CSI}2J${CSI}H`,
    "0123456789",
    `${CSI}5;5H`,
    "X",
    `${CSI}3B`,
    "Y",
    `${CSI}2D`,
    "Z",
    `${CSI}1;1H${CSI}K`,
    "cleared-line",
    `${CSI}2;1H${CSI}2K`,
    `${CSI}s`,
    `${CSI}8;1Hbottom`,
    `${CSI}u`,
    "restored",
  ].join(""),
);

addCase(
  "wide_cjk_emoji",
  40,
  6,
  [
    "CJK: 日本語\r\n",
    "Emoji: 😀 family 👨‍👩‍👧‍👦\r\n",
    "Combining: éclair\r\n",
  ].join(""),
  // KNOWN ISSUE, not fixed here: alacritty_terminal's unicode-width crate
  // classifies emoji like the one above as double-width; xterm.js's
  // internal width table classifies them single-width (and, unlike
  // alacritty, does not widen a ZWJ emoji sequence like the "family" one
  // above at all — it draws each member as its own single-width glyph
  // rather than clustering or doubling them). Long-standing, known
  // disagreement between terminal emulators' Unicode tables, not a bug in
  // either parser — needs a deliberate decision before the renderer can
  // claim emoji parity. See BENCH.md.
  "alacritty_terminal's unicode-width crate classifies emoji as " +
    "double-width where xterm.js classifies them single-width \u2014 a known " +
    "cross-engine Unicode table disagreement, not a parser bug. See BENCH.md.",
);

// 40-col terminal, write a line longer than the width so it autowraps.
addCase(
  "wrap_reflow",
  40,
  6,
  `${CSI}2J${CSI}H` + "A".repeat(55) + "\r\nnext-line",
);

addCase(
  "alt_screen",
  40,
  8,
  [
    "primary line 1\r\nprimary line 2\r\n",
    `${CSI}?1049h${CSI}2J${CSI}H`,
    "alt screen content\r\nlike vim or htop",
    `${CSI}?1049l`,
    "back to primary",
  ].join(""),
);

// 10-row viewport, print 30 lines so 20+ push into scrollback history.
addCase(
  "scrollback",
  40,
  10,
  Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\r\n"),
);

// Wraps a 70-char line across 2 rows at 40 cols, then shrinks to 20 cols
// — both engines must reflow the wrapped paragraph to fit the new width
// (alacritty and xterm.js both implement this; this case exists to check
// they agree on the result, not just that neither crashes).
addResizeCase(
  "resize_reflow",
  40,
  8,
  `${CSI}2J${CSI}H` + "A".repeat(70) + "\r\nEND",
  { cols: 20, rows: 8 },
  "",
  "Investigated as a suspected data-loss bug; direct instrumentation of " +
    "alacritty_terminal 0.26.0's Grid::shrink_columns showed the content " +
    "is never actually dropped (see GridEngine's resize_tests module in " +
    "grid_engine.rs for the full corrected analysis). The real, confirmed " +
    "difference: xterm.js reclaims blank rows below the content to fit a " +
    "reflow's extra rows within the existing viewport height, while " +
    "alacritty_terminal instead grows the buffer and lets the oldest " +
    "reflowed row age into scrollback even when blank space below could " +
    "have absorbed it — a real but low-severity inefficiency (an extra " +
    "scroll to see recently-reflowed content), not lost data, and not " +
    "worth the risk of patching alacritty_terminal's core reflow " +
    "accounting to match xterm.js's approach.",
);

addCase(
  "osc133_prompts",
  60,
  10,
  [
    `${ESC}]133;A\x07`,
    "user@host:~$ ",
    `${ESC}]133;B\x07`,
    "echo hi",
    `${ESC}]133;C\x07`,
    "hi\r\n",
    `${ESC}]133;D;0\x07`,
  ].join(""),
);

const manifest = [];
for (const { name, cols, rows, bytes, resizeTo, postBytes, knownIssue } of cases) {
  const file = `${name}.bin`;
  writeFileSync(path.join(OUT_DIR, file), Buffer.from(bytes, "utf8"));
  const entry = { name, file, cols, rows };
  if (resizeTo) {
    entry.resizeTo = resizeTo;
    const postFile = `${name}.post.bin`;
    writeFileSync(path.join(OUT_DIR, postFile), Buffer.from(postBytes ?? "", "utf8"));
    entry.postFile = postFile;
  }
  if (knownIssue) entry.knownIssue = knownIssue;
  manifest.push(entry);
}

writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(`Wrote ${manifest.length} corpus fixtures to ${OUT_DIR}`);
