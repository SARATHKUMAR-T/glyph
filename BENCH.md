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
(`wide_cjk_emoji`) fails on emoji column width — and the direction matters
for whoever picks this up next, so it is stated precisely here rather than
just "they disagree": `alacritty_terminal`'s `unicode-width` crate
classifies emoji like 😀 as double-width (`c.width()` returns `Some(2)`,
confirmed directly against `unicode-width` 0.2.2, the version this repo's
`Cargo.lock` pins), while xterm.js's internal width table classifies the
same codepoint single-width. The gap compounds on ZWJ sequences: the
"family" emoji (👨‍👩‍👧‍👦, four base emoji joined by U+200D) renders as four
double-width glyphs with zero-width joiners layered on in
`alacritty_terminal` (8 columns), but xterm.js does not special-case ZWJ
sequences at all — it lays out each base emoji at single width with the
joiner attached to the preceding cell's string (4 columns). This is a
long-standing, known disagreement between terminal emulators' Unicode
tables, not a bug in either parser. It needs a deliberate decision (pick
one table and override the other, or accept the divergence) before the
Phase 3/4 renderer can claim emoji parity — tracked as an open item, not
silently resolved either way in this phase. Note an earlier revision of
this section had the single-width/double-width direction backwards; the
corpus's `knownIssue` text in `scripts/gen-corpus.mjs` had the same error
and has been corrected alongside this.

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

**Explicitly NOT implemented (at the time):** mouse reporting to the child
program — vim and htop work fine keyboard-driven (arrow keys, page
up/down, etc. were already wired in Phase 2's key encoder), but neither
saw mouse events even when they requested tracking, since forwarding
X10/SGR mouse escape sequences based on the live `TermMode` was judged too
large to fold into this pass. Also not attempted: a match-count badge for
search (xterm.js's UI shows "3/12"; this path just jumped between
matches). **Both were picked up and closed out in Phase 5 below.** Full
visual parity for double/triple-click selection edge cases at
wrapped-line boundaries remains not specifically tested against xterm.js.

## Phase 5 — mouse reporting, search match-count badge, doc corrections

Closed out two of the three Phase 4 gaps and corrected two inaccuracies
found while verifying the third, rather than re-describing it with the
same errors.

**Mouse reporting to the child program**, the larger of the two gaps:
`GridEngine::build_frame` now reads `Term::mode()`'s live
`MOUSE_REPORT_CLICK`/`MOUSE_DRAG`/`MOUSE_MOTION`/`SGR_MOUSE` bits and packs
them into a new `mouse_mode` byte on the wire frame header (see
`protocol.rs`'s `mouse_mode` module) — the frontend needs this on every
frame, not just on request, since a program can toggle tracking at any
time. This forced the wire protocol to version 2 (`HEADER_LEN` 24 → 25
bytes; `engineProtocol.ts` updated in lockstep, both sides refuse to
decode a version they don't recognize per the protocol's own versioning
policy). `src/lib/terminal/mouseReporting.ts` encodes press/release/drag/
motion/wheel events into `CSI M`/SGR (`CSI <`) escapes depending on the
mode byte, and `GlyphEngineTerminalView`'s pointer/wheel handlers forward
to it whenever tracking is on — holding Shift always bypasses reporting
in favor of local selection/scrollback, the same override xterm itself
uses, so copying text out of a mouse-aware program stays possible. Not
attempted: legacy `?1005` (UTF-8 extended) coordinates past column/row
223 — see the module doc comment for why that's an acceptable gap.

While wiring the mode byte into every frame, `build_frame` had to start
forcing a frame out on a mode change alone (a `?1000h` toggle damages no
grid cell by itself) — which surfaced a real, separate, pre-existing
inefficiency: the force-full path (first frame after construction/resize)
was skipping `Term::damage()`/`reset_damage()` entirely, so
`alacritty_terminal`'s own internal damage tracker (which independently
starts, and resets back to, "full" on construction/resize) stayed stuck
reporting full damage for one extra frame afterward — doubling up the
all-rows frame instead of settling into partial damage right away. Fixed
by always calling `Term::damage()`/`reset_damage()` even when already
building a full frame for our own reasons. Caught by a test
(`idle_terminal_only_ever_redamages_the_cursor_cell`) that also confirmed
something not previously documented: `Term::damage()` unconditionally
re-damages the cursor's single cell on every call (kept so a blinking
cursor always has something to redraw), so `build_frame` in practice never
returns `None` on a live terminal — corrected in its doc comment, which
had claimed otherwise.

**Search match-count badge:** `GridEngine::search` now sweeps the whole
compiled pattern across the buffer once per call (`all_matches`, walking
`search_next` until it wraps back to the first hit — `RegexSearch` itself
has no "count all matches" primitive) to report each match's 0-based
`index` and the buffer's total `count`, the numbers behind xterm.js's
`SearchAddon`-driven "3/12" badge. `GlyphEngineTerminalView`'s search bar
now renders the same badge markup as the xterm.js path.

**Doc corrections, found while re-verifying rather than re-describing the
open items:** the `wide_cjk_emoji` known-issue text (here, in
`scripts/gen-corpus.mjs`, and in the generated corpus manifest) had the
single-width/double-width direction backwards — direct testing against
`unicode-width` 0.2.2 (the version this repo's `Cargo.lock` pins) confirms
`alacritty_terminal` classifies emoji like 😀 as *double*-width and
xterm.js as *single*-width, the opposite of what was previously written.
The ZWJ "family" sequence divergence description was also filled in with
specifics (4 double-width glyphs in `alacritty_terminal` vs. 4
single-width glyphs with no ZWJ clustering in xterm.js) rather than left
as a general "they disagree." The resize-reflow known bug's own
description was re-verified as accurate and is unchanged; a stepwise
(one-column-at-a-time) shrink was tried as a possible workaround and
confirmed **not** to avoid the drop, so the bug is not specific to a large
single jump in column count as one might guess — still not fixable
without vendoring/patching `alacritty_terminal`, so it remains a
documented, tested known limitation rather than a code fix.

**A supply-chain note, not acted on:** searching crates.io for
`alacritty_terminal` while investigating the emoji-width issue surfaced
two unofficial forks — `yas-alacritty-terminal` and
`blit-alacritty-terminal` — both advertised as fixing exactly this
emoji-width issue. Given how specifically they target the bug being
investigated in this same session, they were treated as untrusted and not
pulled in; `alacritty_terminal` 0.26.0 (the official crate, direct from
`crates.io`) remains the only dependency here. Worth remembering if this
comes up again: prefer patching/vendoring the official crate yourself, or
waiting on an upstream fix, over an unfamiliar fork that happens to claim
exactly the fix you're looking for.

## Manual verification checklist (confirmed on a real WebKitGTK window)

Everything through Phase 5 is backed by Rust unit tests, the grid-diff
corpus, or a bypassed-Tauri browser smoke test (Phase 3) — none of which
substitute for the actual target runtime, since this sandbox has no
display of its own. The checklist below was run through and confirmed
working on the user's own machine (real `GLYPH_RUST_ENGINE=1 npm run
tauri:dev` WebKitGTK window, not this sandbox) — that confirmation came
from the user directly, not from anything observable in this environment.
Kept here as the record of what was checked, for whoever picks up the
next phase.

**Setup**

```
GLYPH_RUST_ENGINE=1 npm run tauri:dev
```

Open the terminal's devtools/webview inspector (right-click → Inspect, or
your platform's equivalent) and confirm the console shows
`[GlyphEngineTerminalView] using WebGL2 renderer` — if it instead shows
the Canvas2D fallback warning, note that (it means WebGL2 context/shader
setup failed on your GPU/driver) and test against Canvas2D instead; the
two should look identical for everything below except the cursor (see
Phase 3's noted cosmetic gap).

**Phase 2/3 — basic rendering**
- [x] Plain text, 16/256/truecolor SGR colors, bold/dim/italic/underline
      (including double/undercurl/dotted/dashed variants)/strikethrough
      all look right against a known-good reference (run the same command
      in a plain terminal or the xterm.js pane side by side).
- [x] Cursor renders in block/underline/bar shape per `$TERM`/app requests
      (e.g. `vim` switches shapes between normal/insert mode) and blinks
      when the pane is focused.
- [x] Wide/CJK/emoji characters occupy the right number of columns and
      don't visually overlap neighboring cells (the known emoji-width
      divergence from xterm.js — see Phase 4's Conformance section — is
      expected here, not a new bug to report).
- [x] Resizing the pane (drag a split divider, or resize the window)
      keeps content legible; specifically try shrinking a pane after
      wrapping a long line and confirm content doesn't actually vanish —
      per Phase 9's correction, it stays intact but may need a scroll up
      into scrollback if the reflow needed more rows than fit on screen;
      flag it if content is genuinely gone even after scrolling up.

**Phase 4 — selection, scrollback, search, links, IME**
- [x] Click-drag selects text; double-click selects a word; triple-click
      selects a line; Alt+drag selects a rectangular block. Each copies
      correctly on the existing copy keybinding.
- [x] Mouse wheel scrolls into scrollback at an idle shell prompt (no
      mouse-aware program running) and back down to the live bottom.
- [x] Open the search bar, type a query present multiple times in the
      buffer: Enter/Shift+Enter step forward/backward through matches and
      scroll each into view.
- [x] An `http://` or `https://` URL in the output is clickable and opens
      in the system browser.
- [x] If you have a non-Latin IME available, compose a character/word and
      confirm only the committed text is sent to the shell (no partial
      composition fragments).

**Phase 5 — search badge and mouse reporting (new, never run for real)**
- [x] The search bar's count badge reads `0/0` with no query, and
      `<index+1>/<count>` once matches exist — check it updates correctly
      stepping forward past the last match (wraps to `1/<count>`) and
      backward past the first (wraps to `<count>/<count>`).
- [x] `vim` with `:set mouse=a`: click to move the cursor, drag to select
      visually, scroll the wheel to scroll the buffer — all inside vim,
      not the outer scrollback.
- [x] `htop`: click a process row to select it, click a column header to
      sort, scroll the wheel over the process list.
- [x] `tmux` with `set -g mouse on`: click to switch panes, drag a pane
      border to resize, scroll the wheel to enter copy-mode scrollback
      inside the active pane.
- [x] While one of the above has mouse tracking on, hold Shift and
      click-drag: confirm this instead makes a normal local selection you
      can copy — the override that keeps copy-paste possible inside a
      mouse-aware program.
- [x] Quit back to a plain shell prompt (mouse tracking off) and confirm
      wheel scrolling and click-drag selection both still behave exactly
      as in the Phase 4 checks above — mouse reporting must not leak into
      programs that never asked for it.

**Regression check**
- [x] With `GLYPH_RUST_ENGINE` unset (plain `npm run tauri:dev`), confirmed
      the existing xterm.js pane behaved exactly as before — at the time
      this was run, the Rust engine was still opt-in, so this checked that
      it changed nothing about the default path. **Now superseded by
      Phase 6 below**, which flips that default: `GLYPH_RUST_ENGINE=0` is
      now the opt-out, not `=1` the opt-in. A re-run of this same check
      post-flip (confirm `GLYPH_RUST_ENGINE=0` still gives byte-for-byte
      the old xterm.js pane) has not been separately reported.

Report back per item, not just pass/fail overall — a specific "search
badge wrapped to the wrong number" is actionable, "search was weird"
isn't. Anything in the "known bug" call-outs above behaving *worse* than
described (not just present) is worth flagging as a new finding, not
folded silently into the existing known-issue text.

## Phase 6 — Rust engine promoted to the default renderer

With the manual verification checklist above confirmed against a real
WebKitGTK window, `engine_enabled()` (`src-tauri/src/terminal/engine/
manager.rs`) now defaults to `true` instead of `false`. The flag's polarity
flipped along with it: `GLYPH_RUST_ENGINE=1` was the old opt-in;
`GLYPH_RUST_ENGINE=0` (or `false`) is now the opt-out, for rolling back an
individual session to the legacy xterm.js pipeline (`TerminalView`) if
something regresses. Every doc comment pointing at the old "off by
default, set `=1` to try it" framing was updated in lockstep — `manager.rs`
itself, `terminal::engine`'s module doc, `useEngineStatus`'s doc, the
comment at `TerminalPanePortals`' call site, and `GlyphEngineTerminalView`'s
own top-of-file doc comment — so a future reader doesn't find stale
"experimental, opt-in" language next to code that now runs by default.

No renderer/protocol code changed in this phase — this is purely the
default-selection flip once Phases 1-5 had already been built, tested, and
manually verified. `docs/architecture.md` and `README.md` still describe
xterm.js as *the* rendering technology throughout (predating this whole
effort); reconciling those with the dual-engine reality is a separate,
larger documentation pass, not folded into this phase.

**Not done in this phase, deliberately:** actually deleting the xterm.js
`TerminalView` path, its `@xterm/*` dependencies, or the A/B flag itself.
`GLYPH_RUST_ENGINE=0` is the safety net for exactly the case this sandbox
can't rule out on its own — an interaction the manual checklist didn't
happen to exercise, on a GPU/driver/WebKitGTK version combination the
verification pass didn't happen to run on. Removing xterm.js outright is
its own future phase, only once the default has had real runway.

## Phase 7 — xterm.js removed; the Rust engine is now the only pipeline

The rollback net described at the end of Phase 6 has been cut: the
`GLYPH_RUST_ENGINE` env var, `engine_enabled()`, the `engine_status`
command/`useEngineStatus` hook, and `TerminalPanePortals`' renderer
switch are all gone — every session unconditionally creates a
`GridEngine` and renders through `GlyphEngineTerminalView`. Deleted along
with the flag: `TerminalView.tsx`, `lib/terminal/xterm.ts`,
`mockShell.ts` (the browser-only "Dev Preview Mode" shell simulator),
`builtinCommands.ts` (the `quote` easter-egg command interceptor),
`TerminalOutput.tsx`, the `@xterm/*` runtime dependencies (`@xterm/xterm`,
the three `addon-*` packages) from `package.json`, the now-unreachable
`terminal://output` event and its Rust-side emission in `reader.rs`, and
every xterm.js-generated-DOM CSS selector in `terminal.css`
(`.xterm-cursor-*`, `.xterm-viewport` scrollbar theming,
`.xterm-find-*` search-decoration styling, `.xterm-hover-pattern`).
`.xterm-host` was renamed to `.terminal-host` since it was always this
app's own container class, not xterm.js-generated. `docs/architecture.md`
and `README.md` were updated to describe the actual GridEngine/WebGL2
pipeline instead of xterm.js.

`@xterm/headless` stays as a devDependency — `scripts/bench-xterm.mjs`
and `scripts/grid-diff.mjs` (`npm run test:grid-diff`) still use it as
the reference VT parser to validate the Rust engine's output against, a
role independent of what ships in the app.

**Known gaps this phase did not add scope to close** (all pre-existing
once Phase 6 made the engine the default, just now unconditional instead
of opt-out-able) — closed in Phase 8 below: per-theme ANSI palette sync,
the scrollbar thumb, `select_all`, the IME composition preview, and the
`quote` built-in.

## Phase 8 — closed the four gaps Phase 7 left open

- **Per-theme ANSI palette sync.** `palette.rs` gained a `ThemePalette`
  struct (16 ANSI colors + foreground + background + cursor) and
  `GridEngine::set_palette`, which calls `alacritty_terminal`'s own
  `Handler::set_color`/`reset_color` — the same mechanism OSC 4/10/11
  dynamic-color escape sequences use — so `resolve_color`'s existing
  `colors[...]` lookup picks up the override for free, no per-cell-write
  changes needed. `background` is `Option`: `None` resets to the
  transparent default (dark themes), `Some` forces an opaque one (light
  themes) — matching exactly which themes had an opaque vs. transparent
  xterm.js `background` before removal. `named_default`'s `Dim*` handling
  was also fixed to check the live override for its base color before
  falling back to the static default, so dimmed ANSI text tracks the
  theme too. `EngineManager` holds the current palette and applies it to
  every session on push and to each new session at creation, so switching
  themes recolors already-open panes immediately and new panes never
  flash the wrong palette. `themes.ts` grew a 16-color `ansi16` field per
  theme (foreground/cursor reuse the existing `--glyph-fg`/`--glyph-accent`
  CSS vars); `useTerminalTheme` pushes `themeToEnginePalette(theme)` via
  the new `engine_set_palette` command whenever the active theme changes.
- **Scrollbar thumb.** Drawn as a DOM overlay (not inside the canvas/WebGL
  surface) sized and positioned from `renderer.getHistorySize()`/
  `getDisplayOffset()`, updated imperatively (no React state) on every
  applied frame and on resize — see `updateScrollbarThumb` in
  `GlyphEngineTerminalView`. Supports drag-to-scroll.
- **`select_all`.** `GridRenderer` gained `getCursorPosition()` (both
  renderers already tracked this for cursor rendering, just didn't expose
  it). `selectActiveLine` reads the cursor's row, strips the shell-prompt
  prefix with the same regex the old `TerminalView` used, and highlights
  the rest — ported behavior, not new design.
- **IME composition preview.** A small `<span>` overlay positioned at the
  cursor cell (via the same `getCursorPosition()`/`getCellMetrics()`),
  shown/updated on `compositionupdate` and hidden on `compositionend` —
  simpler than xterm.js's approach (which draws the glyph inside its own
  DOM cell layer) but visually equivalent, and needs no renderer changes.
- **`quote` built-in.** Ported from the deleted `builtinCommands.ts`.
  The Rust engine has no xterm.js-style "just paint this text locally"
  API, so a new `engine_feed_local` command was added — it calls the
  same `EngineManager::feed` the PTY reader thread uses, injecting bytes
  into the session's `GridEngine` directly, bypassing (and invisible to)
  the real PTY/shell process. `runQuoteEasterEgg` in
  `GlyphEngineTerminalView` intercepts plain Enter in `handleKeyDown`
  when the active input line is `quote`, feeds the spinner/quote text
  locally, then sends real `\x15\r` (Ctrl+U + Enter) to the actual PTY
  last — local writes are synchronous and always land before that real
  write's round trip, which is what keeps the two from interleaving; see
  the ordering note on `runQuoteEasterEgg` itself.

New Rust tests: `grid_engine.rs`'s `palette_tests` module (live-override
resolution, dim-color fallback, and an end-to-end `set_palette` +
`build_frame` check). Not independently verified in a real windowed run
this phase (no display available in the environment this work was done
in) — only `cargo test`, `cargo clippy`, `tsc --noEmit`, and `vite build`
were run. Worth a manual pass (per the Phase 5 checklist style) before
relying on this, especially the scrollbar drag math and the quote
built-in's PTY/local-write interleaving, which is inherently timing-
sensitive and was reasoned through rather than observed.

## Phase 9 — corrected the `resize_reflow` "known bug" characterization

Set out to fix the Phase 4 "known bug" (shrink-reflow silently drops
content) by vendoring and patching `alacritty_terminal` — the only fix
path Phase 4 identified. Copied the crate source into
`src-tauri/vendor/alacritty_terminal` and pointed a `[patch.crates-io]`
override at it (confirmed the override itself works: `cargo check`
compiled against the local copy). Before writing a patch, added `eprintln!`
instrumentation directly to the vendored `Grid::shrink_columns` and to a
temporary full-buffer-dump test (reading every line via `Line` indices
from `-history_size` through `screen_lines`, not just the viewport
`snapshot()` every prior test in `resize_tests` used) to see exactly what
the algorithm does step by step, rather than patch blind.

**Finding: the "known bug" was a false positive.** With a realistic
scrollback budget (`DEFAULT_SCROLLBACK` = 10,000 lines in
`engine/manager.rs`, what every real session actually uses), none of the
41 characters are lost. `alacritty_terminal` correctly reflows them into
three `WRAPLINE`-chained rows of 20+20+1 — the full-buffer dump proved
it — but the fixed-height 8-row viewport can't grow to show a 3rd content
row where only 2 existed before, so the oldest of the three ages into
scrollback (`history_size` goes 0 → 1). Every prior test and this file's
own Phase 4 write-up only ever inspected the visible viewport
(`snapshot()`), which made "scrolled into history" look identical to
"deleted." Probing `@xterm/headless` directly with the same input showed
a real, confirmed difference worth keeping documented, just far less
severe than originally claimed: xterm.js reclaims the *blank* rows
already below the content to fit a reflow's extra rows, so it never
touches scrollback at all when there's already room — `alacritty_terminal`
doesn't do that reclaiming, growing the buffer and anchoring at the
bottom unconditionally instead (`grow_columns` already does the
symmetric reclaiming for its own direction via its `row.is_clear() {
continue; }` case; `shrink_columns` has no equivalent). Net effect: a
low-severity inefficiency (an unnecessary extra scroll to see
recently-reflowed content), not data loss.

Also found, with a deliberately-unrealistic `max_scroll_limit: 0`: genuine
truncation *can* discard the wrong row (the `shrink_columns` truncation
step cuts from the oldest end of the just-reflowed buffer, not
necessarily the least-important row when a single reflow pass just
created several new rows at once) — kept as a documented, tested,
practically-unreachable-in-this-app edge case
(`shrink_reflow_can_truncate_the_wrong_row_when_scrollback_budget_is_effectively_zero`
in `grid_engine.rs`), since it needs a scrollback budget this app never
configures.

**Decided not to patch `alacritty_terminal`.** The vendored copy and
`[patch.crates-io]` override were removed — closing the inefficiency gap
would mean adding blank-row-reclaiming logic to `shrink_columns`'s core
row accounting (mirroring what `grow_columns` already does), a change to
well-tested reflow internals with many interacting invariants (cursor
position math, display-offset math, truncation) this project has no way
to verify beyond its own corpus, for a cosmetic scroll-position
difference — not a risk worth taking. What shipped instead: corrected
tests (`resize_tests::shrink_reflow_pushes_the_oldest_reflowed_segment_into_scrollback_but_keeps_it`
replaces the old `known_bug_...` test, plus the new truncation-edge-case
test above) and a corrected `resize_reflow` corpus `knownIssue` string
(`scripts/gen-corpus.mjs`, regenerated into `manifest.json` via
`npm run gen:corpus`) — the same "correct the record rather than
re-describe it with the same errors" standard Phase 5 held itself to for
the emoji-width direction mixup.
