#!/usr/bin/env node
// Regenerates every app icon in src-tauri/icons from the three SVG sources
// in src-tauri/icons/source:
//
// - glyph-icon.svg        full tile: Windows, Linux, iOS and Android icons
// - glyph-icon-macos.svg  body on the Apple icon grid: icon.icns
// - glyph-icon-small.svg  drawn on a 16 px grid: every icon 32 px and below,
//                         including the 16, 24 and 32 px layers of icon.ico
//
// Run with `npm run icons` after editing a source; the generated files are
// committed so builds never need to regenerate them.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "src-tauri", "icons");
const SOURCE = path.join(ICONS, "source");
const FULL = path.join(SOURCE, "glyph-icon.svg");
const MACOS = path.join(SOURCE, "glyph-icon-macos.svg");
const SMALL = path.join(SOURCE, "glyph-icon-small.svg");
/** iOS icons can't be transparent; fill behind the tile with its own color. */
const TILE_COLOR = "#0B0B0E";
const SMALL_MAX = 32;
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

function tauriIcon(input, args = []) {
  execFileSync("npx", ["tauri", "icon", input, ...args], { cwd: ROOT, stdio: "inherit" });
}

/** Renders `input` at each size into a temp dir; returns size -> PNG path. */
function renderPngs(input, sizes, tmp) {
  const out = mkdtempSync(path.join(tmp, "png-"));
  tauriIcon(input, ["-o", out, "--png", sizes.join(",")]);
  return new Map(sizes.map((s) => [s, path.join(out, `${s}x${s}.png`)]));
}

/** An .ico whose entries are stored as PNG, which Windows Vista+ reads. */
function writeIco(file, pngsBySize) {
  const entries = [...pngsBySize].map(([size, png]) => ({ size, data: readFileSync(png) }));
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  writeFileSync(file, Buffer.concat([header, ...entries.map((e) => e.data)]));
}

const tmp = mkdtempSync(path.join(tmpdir(), "glyph-icons-"));
try {
  // 1. The whole default set (PNGs, Windows Store logos, iOS, Android) from the full tile.
  tauriIcon(FULL, ["--ios-color", TILE_COLOR]);

  // 2. macOS keeps the Apple grid margin, so icon.icns comes from its own source.
  const macDir = mkdtempSync(path.join(tmp, "macos-"));
  tauriIcon(MACOS, ["-o", macDir]);
  copyFileSync(path.join(macDir, "icon.icns"), path.join(ICONS, "icon.icns"));

  // 3. Small sizes: the full tile's detail turns to mush below 48 px.
  const small = renderPngs(SMALL, [16, 24, 30, 32], tmp);
  copyFileSync(small.get(32), path.join(ICONS, "32x32.png"));
  copyFileSync(small.get(30), path.join(ICONS, "Square30x30Logo.png"));

  // 4. icon.ico mixes both: small layers up to 32 px, full tile above.
  const large = renderPngs(FULL, ICO_SIZES.filter((s) => s > SMALL_MAX), tmp);
  writeIco(
    path.join(ICONS, "icon.ico"),
    ICO_SIZES.map((s) => [s, s <= SMALL_MAX ? small.get(s) : large.get(s)]),
  );

  // 5. A 1024 px render at the repo root for store pages and the README.
  copyFileSync(renderPngs(FULL, [1024], tmp).get(1024), path.join(ROOT, "app-icon.png"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
