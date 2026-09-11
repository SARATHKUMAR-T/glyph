# Glyph renderer benchmarks

Tracks the experimental Rust-grid / WebGL2 renderer effort (see
`src-tauri/src/terminal/engine/`) against the current default, xterm.js.
Updated every phase per the project process; each entry says exactly what
it does and does not cover.

Environment for all numbers below: `rustc 1.97.1`, Node `v20.20.2`, on the
development machine (not the target WebKitGTK runtime — see caveats).

## Phase 1 — parser + grid-mutation throughput only

**What this measures:** how fast raw PTY bytes can be turned into
authoritative grid state, in each implementation, with nothing else
attached (no rendering, no IPC, no DOM). This is the piece Phase 1 built:
`alacritty_terminal`-backed `GridEngine::feed` on the Rust side,
`@xterm/headless`'s `Terminal.write` (the same VT parser xterm.js uses in
the browser, just without a DOM attached) on the JS side.

**What this does NOT measure yet:** the actual WebKitGTK render path
(DOM/canvas compositing), IPC transfer cost of damage frames, or anything
about the WebGL2/Canvas2D renderer — there isn't one yet. Those numbers
land in the Phase 2 and Phase 3 updates to this file. Until then, treat
this purely as "is the new parser fast enough to be worth building a
renderer for" — not as a preview of end-user frame times.

**Method:** `src-tauri/examples/bench_engine.rs` and `scripts/bench-xterm.mjs`
build the identical payload (the Phase 1 corpus — see below — concatenated
20,000 times, ~19.5 MB) and feed it in 8 KiB chunks (matching the real PTY
read size in `terminal::reader::spawn_reader_thread`), after a warm-up pass.
Run with:

```
cargo run --release --example bench_engine   # from src-tauri/
node scripts/bench-xterm.mjs                 # from repo root
```

| Path                                  | Throughput      |
|----------------------------------------|-----------------|
| Rust `GridEngine.feed` (alacritty_terminal 0.26.0) | ~43–49 MB/s |
| `@xterm/headless` 6.0.0 `Terminal.write`           | ~15–16 MB/s |

Rust is roughly **3x** faster at turning bytes into grid state in this
harness. Three important caveats:

1. This is a single-threaded synchronous micro-benchmark on one machine,
   three runs each, not a statistically rigorous benchmark suite. Treat
   the ranges as "same order of magnitude confidence," not precise figures.
2. `@xterm/headless` is not the in-browser xterm.js path — it's the same
   parser/buffer code without a renderer, run under Node instead of
   WebKitGTK's JS engine. It's the closest fair comparison available for
   "just the parser," but the real xterm.js path Glyph ships today also
   pays DOM/canvas rendering cost on top of this number, which this
   benchmark deliberately excludes from both sides.
3. The corpus is synthetic (see below), not a real-world PTY session
   distribution. Heavy-scrollback or heavy-color workloads could shift
   this ratio in either direction.

## Corpus

Both this benchmark and the Phase 1 conformance test
(`src-tauri/tests/grid_diff.rs` + `scripts/grid-diff.mjs`) use
`src-tauri/tests/fixtures/pty_corpus/`: 8 short, deterministic byte
sequences (not spawned real shells, so neither test depends on timing or
on what happens to be installed) covering plain text, 16/256/truecolor
SGR + text attributes, cursor movement/erase, wide/CJK/emoji/combining
marks, autowrap reflow, alt-screen enter/exit, scrollback, and OSC 133
prompt markers. Regenerate with `npm run gen:corpus`.

There was no pre-existing "Phase 0" benchmark or corpus in this repository
to reuse — checked all branches and git history before starting Phase 1 —
so both were built from scratch here and are now the baseline for every
later phase.

## Conformance status

7/8 corpus cases match the xterm.js headless reference exactly (cell
chars, width, colors, all text attributes, cursor position). The 8th
(`wide_cjk_emoji`) fails on emoji column width: `alacritty_terminal`'s
`unicode-width` crate classifies emoji like 😀 as single-width, xterm.js's
internal width table classifies them as double-width. This is a
long-standing, known disagreement between terminal emulators' Unicode
tables, not a bug in either parser. It needs a deliberate decision (pick
one table and override the other, or accept the divergence) before the
Phase 3/4 renderer can claim emoji parity — tracked as an open item, not
silently resolved either way in this phase.

## Phase 2 — Canvas2D renderer

Built the frontend half of the pipeline: a binary-frame decoder
(`src/lib/terminal/engineProtocol.ts`), a Canvas2D grid renderer
(`CanvasGridRenderer.ts`), a keyboard encoder, and a terminal-pane
component wired in behind `GLYPH_RUST_ENGINE=1` at the `TerminalPanePortals`
call site (`useEngineStatus()` picks it over `TerminalView` per pane).
Confirmed working end-to-end on a real desktop run (`GLYPH_RUST_ENGINE=1
npm run tauri:dev`) — this sandboxed dev environment has no usable display
of its own for that (see the attempt log in the Phase 2 conversation), so
that confirmation came from the user's own machine, not from me. No
frame-rendering throughput numbers were produced for the same reason —
not fabricated instead.

## Phase 3 — WebGL2 renderer

Added `WebGL2GridRenderer.ts`: a glyph atlas (`webgl/glyphAtlas.ts`, glyphs
rasterized once as white-on-transparent and tinted per-cell in the
fragment shader, so one atlas slot serves every color a character is ever
drawn in) plus instanced quads — the whole grid's backgrounds redraw in
one `drawArraysInstanced` call, every visible glyph in a second, and
underline/strikethrough/cursor decorations in a sparse third, every
animation frame. `GlyphEngineTerminalView` tries WebGL2 first and falls
back to the Phase 2 Canvas2D renderer if context creation or shader
compilation fails for any reason (old GPU, WebGL disabled, etc) — both
implement the same `GridRenderer` interface and consume the identical
binary frame format, so the fallback is invisible to the rest of the app.

**Verification this phase, and why it's real evidence despite the
environment constraints:** rather than fight the same no-display/no-window-manager
wall Phase 2 hit, this phase's smoke test bypassed Tauri entirely — a
throwaway HTML page fed a synthetic decoded frame straight into
`WebGL2GridRenderer.applyFrame()` (no IPC, no PTY), served by a plain
`vite` dev instance, and captured with real Chrome in headless mode
(`--use-angle=swiftshader`, a fresh throwaway profile) via `--screenshot`.
The screenshot shows the test string rendering correctly — bold/normal
weight alternating per cell as scripted, correct green-on-near-black
colors, and the red cursor block over the first character — proving the
shader pipeline, atlas rasterization, and instanced draw calls all work.
This does not substitute for a real WebKitGTK visual check (the
smoke-test page and its harness were deleted after use, not shipped); it
covers the graphics pipeline in isolation, not the Tauri integration
Phase 2 already confirmed.

**No throughput numbers yet** — same reasoning as Phase 2: a meaningful
WebGL2-vs-xterm.js frame-time comparison needs the real app painting on a
real compositor, which this sandbox can't provide.

**What to do next:** run `GLYPH_RUST_ENGINE=1 npm run tauri:dev` again and
check the browser/webview console for `[GlyphEngineTerminalView] using
WebGL2 renderer` (confirms it didn't silently fall back to Canvas2D on
your GPU), and that the pane still looks and behaves the same as the
Canvas2D pass you already confirmed. Known cosmetic gap: the WebGL2
cursor is a flat semi-transparent red overlay rather than Canvas2D's
opaque-block-with-inverted-text treatment — close but not pixel-identical;
worth a look but not expected to be a functional problem.

## Phase 4 — feature-parity checklist

Confirmed working, backed by Rust unit tests and/or the grid-diff corpus
(not just eyeballed): mouse selection (simple, word/line via
double/triple-click, block via Alt+drag) with copy on the existing
keybinding; scrollback via mouse wheel; plain-text scrollback search
(`engine_search`, built on alacritty's own `RegexSearch`/`search_next` —
literal-text matching with smart-case, matching the existing search UI's
behavior, not a new regex feature); clickable http(s) links; and
committed-text IME input (composition start/end tracked so partial
composition fragments are never sent to the PTY, though there's no inline
composition preview glyph the way xterm.js draws one).

**A real bug was found, not just a gap: resize reflow silently drops
content.** Added a `resize_reflow` case to the grid-diff corpus (feed a
line long enough to wrap, then shrink the column count) and it failed —
not with a cosmetic mismatch like the emoji-width issue, but with 20+
characters of real content missing after the resize. Bisected with a
minimal Rust reproduction (`grid_engine.rs`'s `resize_tests` module,
`known_bug_shrink_reflow_drops_middle_segment_when_splitting_across_3_plus_rows`):
41 characters wrapped at 40 columns, shrunk to 20, should reflow to three
rows of 20+20+1 chars; `alacritty_terminal` 0.26.0 instead produces
20+1, silently dropping the middle 20 characters. Confirmed this is
specific to *shrinking* — the symmetric grow-columns case (20 → 40 cols)
reflows correctly, tested in the same module. Root-caused to
`Grid::shrink_columns`'s multi-hop carry-over logic in the crate itself
(traced via `alacritty/alacritty`'s `grid/resize.rs` source), not
anything in `GridEngine`'s resize wrapper, which does nothing but call
`Term::resize` directly. `Term::resize`'s public API gives no way to
disable reflow on the primary screen, so this can't be worked around
without vendoring or patching `alacritty_terminal` — flagging it here
rather than attempting that. Both the corpus case and the Rust regression
test assert the *current* (buggy) behavior on purpose, so a future
`alacritty_terminal` upgrade that fixes it will fail them loudly instead
of the fix going unnoticed.

**Explicitly NOT implemented:** mouse reporting to the child program — vim
and htop work fine keyboard-driven (arrow keys, page up/down, etc. were
already wired in Phase 2's key encoder), but neither sees mouse events
even when they request tracking, since forwarding X10/SGR mouse escape
sequences based on the live `TermMode` was judged too large to fold into
this pass. Also not attempted: a match-count badge for search (xterm.js's
UI shows "3/12"; this path just jumps between matches), and full visual
parity for double/triple-click selection edge cases at wrapped-line
boundaries (not specifically tested against xterm.js).
