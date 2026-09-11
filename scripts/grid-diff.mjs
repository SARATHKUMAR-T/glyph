#!/usr/bin/env node
// Phase 1 conformance check: replays the same corpus used by
// `src-tauri/tests/grid_diff.rs` through xterm.js's headless reference
// implementation and diffs it, cell by cell, against the JSON snapshots
// the Rust GridEngine test just wrote to target/grid_diff/*.rust.json.
//
// Usage: cargo test --test grid_diff && node scripts/grid-diff.mjs
// (both steps are wired together as `npm run test:grid-diff`).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = path.join(ROOT, "src-tauri/tests/fixtures/pty_corpus");
const RUST_SNAPSHOT_DIR = path.join(ROOT, "src-tauri/target/grid_diff");

const manifest = JSON.parse(
  readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8"),
);

function writeToTerminal(term, bytes) {
  return new Promise((resolve) => term.write(bytes, resolve));
}

/** Normalizes an xterm.js buffer into the same {mode,value} color shape and
 * cell shape the Rust engine's `snapshot()` produces. */
function snapshotXterm(term) {
  const buffer = term.buffer.active;
  const cols = term.cols;
  const rows = term.rows;
  const lines = [];

  for (let y = 0; y < rows; y++) {
    // getLine() takes an absolute buffer index, not a viewport-relative
    // one — the visible row `y` is at `viewportY + y`.
    const line = buffer.getLine(buffer.viewportY + y);
    const cells = [];
    for (let x = 0; x < cols; x++) {
      const cell = line.getCell(x);
      let chars = cell.getChars();
      // xterm.js leaves untouched cells as '' (code 0); alacritty always
      // defaults a blank cell's char to ' '. Both are visually "blank", so
      // normalize to a single space for the diff.
      if (chars === "") chars = " ";

      cells.push({
        c: chars,
        w: cell.getWidth(),
        bold: !!cell.isBold(),
        dim: !!cell.isDim(),
        italic: !!cell.isItalic(),
        underline: !!cell.isUnderline(),
        strike: !!cell.isStrikethrough(),
        inverse: !!cell.isInverse(),
        invisible: !!cell.isInvisible(),
        fg: colorKey(cell, "Fg"),
        bg: colorKey(cell, "Bg"),
      });
    }
    lines.push(cells);
  }

  return {
    cols,
    rows,
    totalLines: buffer.length,
    displayOffset: buffer.baseY - buffer.viewportY,
    cursor: { x: buffer.cursorX, y: buffer.cursorY },
    lines,
  };
}

function colorKey(cell, side) {
  if (cell[`is${side}RGB`]()) {
    return { mode: "rgb", value: cell[`get${side}Color`]() };
  }
  if (cell[`is${side}Palette`]()) {
    return { mode: "palette", value: cell[`get${side}Color`]() };
  }
  return { mode: "default", value: 0 };
}

function diffSnapshots(name, rust, js) {
  const problems = [];

  if (rust.cols !== js.cols || rust.rows !== js.rows) {
    problems.push(`dimension mismatch: rust=${rust.cols}x${rust.rows} js=${js.cols}x${js.rows}`);
    return problems;
  }

  if (rust.cursor.x !== js.cursor.x || rust.cursor.y !== js.cursor.y) {
    problems.push(
      `cursor mismatch: rust=(${rust.cursor.x},${rust.cursor.y}) js=(${js.cursor.x},${js.cursor.y})`,
    );
  }

  const fields = [
    "c",
    "w",
    "bold",
    "dim",
    "italic",
    "underline",
    "strike",
    "inverse",
    "invisible",
  ];

  for (let y = 0; y < rust.rows; y++) {
    const rustRow = rust.lines[y];
    const jsRow = js.lines[y];
    for (let x = 0; x < rust.cols; x++) {
      const a = rustRow[x];
      const b = jsRow[x];
      for (const field of fields) {
        if (a[field] === b[field]) continue;
        // Documented, intentional divergence: alacritty stores a literal
        // '\t' in the first cell of a tab run (so copy/paste reproduces
        // the tab), xterm.js leaves that cell blank. Both render the same
        // way; this is not a parser bug on either side.
        if (field === "c" && a.c === "\t" && b.c === " ") continue;
        problems.push(
          `(${x},${y}) field '${field}' differs: rust=${JSON.stringify(a[field])} js=${JSON.stringify(b[field])}`,
        );
      }
      for (const side of ["fg", "bg"]) {
        if (a[side].mode !== b[side].mode || a[side].value !== b[side].value) {
          problems.push(
            `(${x},${y}) ${side} differs: rust=${JSON.stringify(a[side])} js=${JSON.stringify(b[side])}`,
          );
        }
      }
      if (problems.length > 20) {
        problems.push("... truncated, more mismatches follow");
        return problems;
      }
    }
  }

  return problems;
}

let failures = 0;

for (const entry of manifest) {
  const rustPath = path.join(RUST_SNAPSHOT_DIR, `${entry.name}.rust.json`);
  if (!existsSync(rustPath)) {
    console.error(
      `[${entry.name}] MISSING Rust snapshot at ${rustPath} — run \`cargo test --test grid_diff\` first`,
    );
    failures++;
    continue;
  }
  const rust = JSON.parse(readFileSync(rustPath, "utf8"));

  const term = new Terminal({ cols: entry.cols, rows: entry.rows, allowProposedApi: true });
  const bytes = readFileSync(path.join(CORPUS_DIR, entry.file));
  await writeToTerminal(term, bytes);
  if (entry.resizeTo) {
    term.resize(entry.resizeTo.cols, entry.resizeTo.rows);
    if (entry.postFile) {
      await writeToTerminal(term, readFileSync(path.join(CORPUS_DIR, entry.postFile)));
    }
  }
  const js = snapshotXterm(term);
  term.dispose();

  const problems = diffSnapshots(entry.name, rust, js);
  if (problems.length === 0) {
    if (entry.knownIssue) {
      console.log(`[${entry.name}] OK — unexpectedly! The known issue may be fixed upstream:`);
      console.log(`  ${entry.knownIssue}`);
    } else {
      console.log(`[${entry.name}] OK (${entry.cols}x${entry.rows})`);
    }
  } else if (entry.knownIssue) {
    console.log(`[${entry.name}] KNOWN ISSUE (not counted as a failure): ${entry.knownIssue}`);
  } else {
    failures++;
    console.error(`[${entry.name}] MISMATCH (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${manifest.length} corpus case(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${manifest.length} corpus cases match the xterm.js headless reference.`);
}
