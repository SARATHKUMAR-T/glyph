#!/usr/bin/env node
// Companion to src-tauri/examples/bench_engine.rs: same corpus, same
// repeat count, so the two throughput numbers in BENCH.md are comparable.
// This is parser + buffer-mutation throughput only, same disclaimer as the
// Rust benchmark: no rendering (WebGL2 lands in Phase 3).

import { readFileSync } from "node:fs";
import path from "node:path";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;

const CORPUS_DIR = "src-tauri/tests/fixtures/pty_corpus";
const REPEATS = 20_000;
const CHUNK = 8192;

const manifest = JSON.parse(readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8"));
let unit = Buffer.concat(manifest.map((e) => readFileSync(path.join(CORPUS_DIR, e.file))));

const payload = Buffer.concat(Array(REPEATS).fill(unit));
const mb = payload.length / 1_000_000;
console.log(`payload: ${mb.toFixed(2)} MB (${REPEATS} repeats of the ${unit.length}-byte corpus)`);

function feedAll(term, buf) {
  return new Promise((resolve) => {
    let offset = 0;
    function pump() {
      if (offset >= buf.length) return resolve();
      const end = Math.min(offset + CHUNK, buf.length);
      term.write(buf.subarray(offset, end), () => {
        offset = end;
        pump();
      });
    }
    pump();
  });
}

// Warm up.
const warmupTerm = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
await feedAll(warmupTerm, Buffer.concat(Array(200).fill(unit)));
warmupTerm.dispose();

const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const start = performance.now();
await feedAll(term, payload);
const elapsedMs = performance.now() - start;
term.dispose();

const secs = elapsedMs / 1000;
console.log(`xterm.js headless write: ${secs.toFixed(3)}s (${(mb / secs).toFixed(1)} MB/s)`);
