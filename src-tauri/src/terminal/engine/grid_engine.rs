//! Owns one `alacritty_terminal::Term` grid and turns PTY byte chunks into
//! damage frames in the wire format documented in `protocol.rs`.
//!
//! This is intentionally independent of xterm.js: it is fed the exact same
//! raw PTY bytes as the existing `Osc133Parser` (see
//! `terminal::reader::spawn_reader_thread`), but neither reads from nor
//! writes to xterm's state. It exists purely so the experimental WebGL2 /
//! Canvas2D renderer has a Rust-owned source of truth to draw from.

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Direction as SearchDir, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::search::RegexSearch;
use alacritty_terminal::term::{self, viewport_to_point, Config, Term, TermDamage, TermMode};
use alacritty_terminal::vte::ansi::{
    Color, CursorShape, CursorStyle, Handler, NamedColor, Processor, Rgb,
};

use super::palette;
use super::protocol::{
    cell_flags, encode_frame, mouse_mode, FrameHeader, FrameKind, WireCell, WireCursorShape,
    WireRow,
};

/// No-op event sink. `Event::Title`/`Event::Bell`/etc. are already handled
/// on the xterm.js path via the raw byte stream; the Rust engine does not
/// need to re-emit them until the frontend actually consumes this path.
#[derive(Clone, Default)]
pub struct GlyphEventListener;

impl EventListener for GlyphEventListener {
    fn send_event(&self, _event: Event) {}
}

struct GlyphDimensions {
    cols: usize,
    rows: usize,
}

impl Dimensions for GlyphDimensions {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

pub struct GridEngine {
    term: Term<GlyphEventListener>,
    /// Kept alongside `term` so `set_cursor_style` can flip just
    /// `default_cursor_style` and hand the whole thing back to
    /// `Term::set_options` — `Term` itself exposes no way to patch a single
    /// config field in place.
    config: Config,
    processor: Processor,
    /// Forces the next `build_frame` call to emit a Full frame (first frame
    /// after construction, and after every resize).
    force_full: bool,
    /// The `mouse_mode` byte sent in the last emitted frame's header, so
    /// `build_frame` can detect a mode change (e.g. the child program
    /// enabling `?1000`) and force a frame out even when it damaged no
    /// cells — see the comment at its one call site.
    last_mouse_mode: u8,
}

impl GridEngine {
    pub fn new(cols: u16, rows: u16, scrollback_lines: usize) -> Self {
        let config = Config {
            scrolling_history: scrollback_lines,
            ..Config::default()
        };
        let dims = GlyphDimensions {
            cols: cols.max(1) as usize,
            rows: rows.max(1) as usize,
        };
        let term = Term::new(config.clone(), &dims, GlyphEventListener);

        Self {
            term,
            config,
            processor: Processor::new(),
            force_full: true,
            last_mouse_mode: mouse_mode::TRACKING_OFF,
        }
    }

    /// Feed a chunk of raw PTY bytes (identical to what `Osc133Parser` and
    /// the xterm.js path receive) into the grid parser.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.processor.advance(&mut self.term, bytes);
    }

    /// Applies a theme's colors to this session: the 16 ANSI slots plus
    /// foreground/cursor always override, while `background` only
    /// overrides when the theme wants an opaque terminal background —
    /// `None` resets back to the transparent default (see
    /// `palette::ThemePalette`). Forces the next frame to be a full
    /// repaint so every cell picks up the new colors immediately, since
    /// existing cells store logical `Color::Named`/`Indexed` references
    /// that only re-resolve against the live palette when redrawn.
    pub fn set_palette(&mut self, palette: &palette::ThemePalette) {
        for (index, (r, g, b)) in palette.ansi16.iter().enumerate() {
            self.term.set_color(index, Rgb { r: *r, g: *g, b: *b });
        }
        let (r, g, b) = palette.foreground;
        self.term
            .set_color(NamedColor::Foreground as usize, Rgb { r, g, b });
        let (r, g, b) = palette.cursor;
        self.term
            .set_color(NamedColor::Cursor as usize, Rgb { r, g, b });
        match palette.background {
            Some((r, g, b)) => {
                self.term
                    .set_color(NamedColor::Background as usize, Rgb { r, g, b });
            }
            None => {
                self.term.reset_color(NamedColor::Background as usize);
            }
        }
        self.force_full = true;
    }

    /// Sets the terminal's *default* cursor shape — the one `cursor_style()`
    /// falls back to whenever the running program hasn't explicitly
    /// requested one via DECSCUSR. A program's own request (vim's
    /// insert-mode beam, etc.) still takes precedence for as long as it's
    /// active and until the next reset, matching how real terminals treat
    /// "cursor style" as a base preference rather than an unconditional
    /// override. Forces a full repaint so a preference change is visible
    /// immediately rather than waiting for the cursor to next move.
    pub fn set_cursor_style(&mut self, style: CursorStyleOption) {
        let shape = match style {
            CursorStyleOption::Block => CursorShape::Block,
            CursorStyleOption::Bar => CursorShape::Beam,
            CursorStyleOption::Underline => CursorShape::Underline,
        };
        self.config.default_cursor_style = CursorStyle { shape, blinking: false };
        self.term.set_options(self.config.clone());
        self.force_full = true;
    }

    /// Forces the next `build_frame` call to emit a Full frame — used when a
    /// fresh renderer attaches to an existing session (e.g. a pane's view
    /// remounting) and has none of the grid's current contents yet.
    pub fn request_full_frame(&mut self) {
        self.force_full = true;
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        let dims = GlyphDimensions {
            cols: cols.max(1) as usize,
            rows: rows.max(1) as usize,
        };
        self.term.resize(dims);
        self.force_full = true;
    }

    pub fn set_scroll_display_offset(&mut self, display_offset: usize) {
        use alacritty_terminal::grid::Scroll;
        let history = self.term.grid().history_size();
        self.term.scroll_display(Scroll::Delta(
            display_offset.min(history) as i32 - self.term.grid().display_offset() as i32,
        ));
        self.force_full = true;
    }

    /// Whether the running program has enabled bracketed paste (`?2004`).
    pub fn bracketed_paste(&self) -> bool {
        self.term.mode().contains(TermMode::BRACKETED_PASTE)
    }

    pub fn scrollback_info(&self) -> ScrollbackInfo {
        let grid = self.term.grid();
        ScrollbackInfo {
            total_lines: grid.total_lines(),
            display_offset: grid.display_offset(),
            history_size: grid.history_size(),
            viewport_rows: grid.screen_lines(),
            viewport_cols: grid.columns(),
        }
    }

    /// Sets (or clears, when `end` is `None`) the terminal selection and
    /// returns the currently selected text, mirroring what the frontend
    /// would otherwise ask xterm.js's selection manager for.
    pub fn selection_text(
        &mut self,
        block: bool,
        start: (i32, usize),
        end: (i32, usize),
    ) -> Option<String> {
        let ty = if block {
            SelectionType::Block
        } else {
            SelectionType::Simple
        };
        let start_point = Point::new(Line(start.0), Column(start.1));
        let end_point = Point::new(Line(end.0), Column(end.1));

        let mut selection = Selection::new(ty, start_point, alacritty_terminal::index::Side::Left);
        selection.update(end_point, alacritty_terminal::index::Side::Right);
        self.term.selection = Some(selection);

        self.term.selection_to_string()
    }

    pub fn clear_selection(&mut self) {
        self.term.selection = None;
    }

    /// Finds the next (or previous) match of `pattern` — treated as literal
    /// text, matching the existing xterm.js search UI's non-regex
    /// behaviour, with alacritty's built-in "smart case" (case-insensitive
    /// unless the query itself contains an uppercase letter) — starting
    /// from `(from_row, from_col)`, where `from_row` is an absolute row
    /// index counted from the top of scrollback (row 0), independent of
    /// the current scroll position. On a hit, scrolls the match into view
    /// (its row becomes the top of the viewport) and returns its bounds in
    /// the same absolute row coordinate space, plus this match's 0-based
    /// `index` and the buffer's total `count` — the numbers behind the
    /// existing xterm.js search UI's "3/12" badge (`SearchAddon`'s
    /// `onDidChangeResults`), which the Rust-engine path previously left
    /// unimplemented.
    pub fn search(
        &mut self,
        pattern: &str,
        direction: SearchDirection,
        from_row: usize,
        from_col: usize,
    ) -> Option<SearchMatch> {
        // `escape_regex` always produces a compilable pattern, so this can
        // never hit the `Err` branch `search_with_mode` added for the
        // regex-opt-in path — kept as a thin wrapper so every existing
        // caller/test of the literal-search behavior is untouched.
        self.search_with_mode(pattern, direction, from_row, from_col, false)
            .unwrap_or(None)
    }

    /// Same as `search`, but `use_regex` lets the caller treat `pattern` as
    /// a regular expression instead of literal text (still with alacritty's
    /// built-in smart-case: case-insensitive unless the pattern itself has
    /// an uppercase letter). Returns `Err` with a message safe to show the
    /// user when `use_regex` is set and the pattern fails to compile —
    /// distinct from `Ok(None)`, which means "compiled fine, no match",
    /// so the frontend can tell "bad pattern" apart from "not found".
    pub fn search_with_mode(
        &mut self,
        pattern: &str,
        direction: SearchDirection,
        from_row: usize,
        from_col: usize,
        use_regex: bool,
    ) -> Result<Option<SearchMatch>, String> {
        if pattern.is_empty() {
            return Ok(None);
        }
        let compiled_pattern = if use_regex {
            pattern.to_string()
        } else {
            escape_regex(pattern)
        };
        let mut regex = RegexSearch::new(&compiled_pattern).map_err(|e| e.to_string())?;
        let history = self.term.grid().history_size() as i32;

        let origin = Point::new(Line(from_row as i32 - history), Column(from_col));
        let dir = match direction {
            SearchDirection::Next => SearchDir::Right,
            SearchDirection::Previous => SearchDir::Left,
        };

        let Some(found) = self
            .term
            .search_next(&mut regex, origin, dir, Side::Left, None)
        else {
            return Ok(None);
        };
        let found_start = *found.start();
        let to_absolute = |p: &Point| ((p.line.0 + history).max(0) as usize, p.column.0);
        let (start_row, start_col) = to_absolute(found.start());
        let (end_row, end_col) = to_absolute(found.end());

        self.set_scroll_display_offset((history as usize).saturating_sub(start_row));

        // Re-run the same compiled pattern as a full left-to-right sweep of
        // the whole buffer (history included) to get the count and index
        // xterm.js's `SearchAddon` reports. `RegexSearch` itself has no
        // "count all matches" API, so this walks `search_next` forward from
        // the very top until it wraps back around to the first match found.
        let all = self.all_matches(&mut regex);
        let count = all.len();
        let index = all.iter().position(|(s, _)| *s == found_start).unwrap_or(0);

        Ok(Some(SearchMatch {
            start_row,
            start_col,
            end_row,
            end_col,
            index,
            count,
        }))
    }

    /// Every non-overlapping match of `regex`, scanning left-to-right from
    /// the top of scrollback. Relies on `search_next` wrapping back to the
    /// first match once nothing more matches ahead of the origin (see the
    /// `search_tests` module) to know when the sweep is complete, rather
    /// than needing to know the buffer's length up front. Capped well above
    /// any realistic scrollback's match count as a defense against an
    /// unexpected infinite loop, not as a normal exit condition.
    fn all_matches(&mut self, regex: &mut RegexSearch) -> Vec<(Point, Point)> {
        const MAX_MATCHES: usize = 20_000;
        let history = self.term.grid().history_size() as i32;
        let cols = self.term.columns();

        let mut matches: Vec<(Point, Point)> = Vec::new();
        let mut origin = Point::new(Line(-history), Column(0));

        while matches.len() < MAX_MATCHES {
            let found =
                match self
                    .term
                    .search_next(regex, origin, SearchDir::Right, Side::Left, None)
                {
                    Some(found) => found,
                    None => break,
                };
            let (start, end) = (*found.start(), *found.end());
            if matches
                .first()
                .is_some_and(|(first_start, _)| *first_start == start)
            {
                break;
            }
            matches.push((start, end));

            origin = if end.column.0 + 1 >= cols {
                Point::new(end.line + 1, Column(0))
            } else {
                Point::new(end.line, Column(end.column.0 + 1))
            };
        }

        matches
    }

    /// Encode a damage frame. In principle returns `None` when nothing
    /// changed since the last call, so callers can skip sending an
    /// (almost) empty IPC message on every idle tick — but in practice
    /// this never happens on a live terminal: `alacritty_terminal`'s own
    /// `Term::damage()` unconditionally re-damages the cursor's single cell
    /// on every call (see its "Always damage current cursor" comment, kept
    /// so a blinking cursor always has something to redraw), so an
    /// otherwise-idle terminal keeps producing a minimal one-cell partial
    /// frame every tick instead of `None` (see `mouse_mode_tests`'s
    /// `idle_terminal_only_ever_redamages_the_cursor_cell`). `None` is
    /// still reachable in principle if a future `alacritty_terminal`
    /// version changes that, so callers must keep handling it.
    pub fn build_frame(&mut self) -> Option<Vec<u8>> {
        let cols = self.term.columns();
        let rows = self.term.screen_lines();
        let display_offset = self.term.grid().display_offset();

        let (cursor_col, cursor_line, wire_shape, cursor_visible) = {
            let content = self.term.renderable_content();
            // `content.cursor.point` (`RenderableCursor::new` in
            // alacritty_terminal, straight off `term.grid.cursor.point`) is
            // in *live-screen* grid coordinates — Line(0) is always the top
            // of the live screen, completely unaffected by `display_offset`.
            // Every other piece of `build_frame` (the cell loop below, via
            // `viewport_to_point`) instead works in *viewport* coordinates,
            // where row 0 is whatever's currently scrolled into view. Without
            // this conversion, scrolling into scrollback left the cursor
            // rendered at the same on-screen row every frame — visually
            // "following" the scroll instead of scrolling away with the live
            // content it's actually attached to — because the raw
            // live-screen line number never changes as you scroll.
            let viewport_line = content.cursor.point.line.0 + display_offset as i32;
            let on_screen = viewport_line >= 0 && (viewport_line as usize) < rows;
            let visible = on_screen && !matches!(content.cursor.shape, CursorShape::Hidden);
            let shape = match content.cursor.shape {
                CursorShape::Underline => WireCursorShape::Underline,
                CursorShape::Beam => WireCursorShape::Bar,
                CursorShape::Block | CursorShape::HollowBlock => WireCursorShape::Block,
                CursorShape::Hidden => WireCursorShape::Hidden,
            };
            (
                content.cursor.point.column.0 as u16,
                viewport_line.clamp(0, rows.saturating_sub(1) as i32) as u16,
                shape,
                visible,
            )
        };

        let full = self.force_full;
        self.force_full = false;

        // `Term::damage()` must be called (and reset) on every pass, even
        // when `full` is already true from our own `force_full` flag —
        // otherwise `Term`'s own internal damage tracker (which separately
        // starts, and is reset back to, "full" on construction/resize) stays
        // stuck reporting full damage for one extra frame after this one,
        // needlessly doubling up the all-rows frame instead of settling
        // into partial damage right away.
        let term_damage = self.term.damage();
        let row_bounds: Vec<(usize, usize, usize)> = if full {
            self.term.reset_damage();
            (0..rows).map(|r| (r, 0, cols.saturating_sub(1))).collect()
        } else {
            match term_damage {
                TermDamage::Full => {
                    self.term.reset_damage();
                    (0..rows).map(|r| (r, 0, cols.saturating_sub(1))).collect()
                }
                TermDamage::Partial(iter) => {
                    let bounds: Vec<(usize, usize, usize)> = iter
                        .filter(|line| line.is_damaged())
                        .map(|line| (line.line, line.left, line.right))
                        .collect();
                    self.term.reset_damage();
                    bounds
                }
            }
        };

        // A mouse-mode change (e.g. htop enabling `?1000` on startup) never
        // damages a grid cell by itself, so it must be allowed to force a
        // (possibly row-less) frame out here — otherwise the frontend would
        // keep forwarding mouse events as local text selection until the
        // next unrelated repaint happened to piggyback the updated mode.
        let mouse_mode = wire_mouse_mode(self.term.mode());
        let mouse_mode_changed = mouse_mode != self.last_mouse_mode;

        if row_bounds.is_empty() && !mouse_mode_changed {
            return None;
        }
        self.last_mouse_mode = mouse_mode;

        let colors = *self.term.colors();
        let grid = self.term.grid();

        let wire_rows: Vec<WireRow> = row_bounds
            .into_iter()
            .map(|(row, left, right)| {
                let mut cells = Vec::with_capacity(right - left + 1);
                for col in left..=right {
                    let point = viewport_to_point(display_offset, Point::new(row, Column(col)));
                    let cell = &grid[point.line][point.column];
                    cells.push(cell_to_wire(cell, &colors));
                }
                WireRow {
                    row: row as u16,
                    start_col: left as u16,
                    cells,
                }
            })
            .collect();

        let header = FrameHeader {
            kind: if full {
                FrameKind::Full
            } else {
                FrameKind::Partial
            },
            cols: cols as u16,
            rows: rows as u16,
            cursor_col,
            cursor_line,
            cursor_shape: wire_shape,
            cursor_visible,
            display_offset: display_offset as u32,
            total_lines: self.term.total_lines() as u32,
            mouse_mode,
        };

        Some(encode_frame(&header, &wire_rows))
    }

    /// Full (non-damage-tracked) grid dump used by the headless conformance
    /// test (see `tests/grid_diff.rs`) to compare against an xterm.js
    /// headless snapshot of the same corpus.
    pub fn snapshot(&self) -> serde_json::Value {
        let grid = self.term.grid();
        let colors = self.term.colors();
        let cols = grid.columns();
        let rows = grid.screen_lines();
        let display_offset = grid.display_offset();

        let mut lines = Vec::with_capacity(rows);
        for row in 0..rows {
            let point = viewport_to_point(display_offset, Point::new(row, Column(0)));
            let grid_row = &grid[point.line];
            let mut cells = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &grid_row[Column(col)];
                let mut chars = String::new();
                chars.push(cell.c);
                if let Some(extra) = cell.zerowidth() {
                    for &c in extra {
                        chars.push(c);
                    }
                }
                cells.push(serde_json::json!({
                    "c": chars,
                    "w": if cell.flags.contains(Flags::WIDE_CHAR) { 2 }
                         else if cell.flags.contains(Flags::WIDE_CHAR_SPACER) { 0 }
                         else { 1 },
                    "bold": cell.flags.contains(Flags::BOLD),
                    "dim": cell.flags.contains(Flags::DIM),
                    "italic": cell.flags.contains(Flags::ITALIC),
                    "underline": cell.flags.intersects(Flags::ALL_UNDERLINES),
                    "strike": cell.flags.contains(Flags::STRIKEOUT),
                    "inverse": cell.flags.contains(Flags::INVERSE),
                    "invisible": cell.flags.contains(Flags::HIDDEN),
                    "fg": color_key(cell.fg, colors),
                    "bg": color_key(cell.bg, colors),
                }));
            }
            lines.push(cells);
        }

        let cursor = self.term.grid().cursor.point;
        serde_json::json!({
            "cols": cols,
            "rows": rows,
            "totalLines": self.term.total_lines(),
            "displayOffset": display_offset,
            "cursor": { "x": cursor.column.0, "y": cursor.line.0 },
            "lines": lines,
        })
    }
}

pub struct ScrollbackInfo {
    pub total_lines: usize,
    pub display_offset: usize,
    pub history_size: usize,
    pub viewport_rows: usize,
    pub viewport_cols: usize,
}

/// Deliberately not `#[serde(rename_all = "camelCase")]`: for these
/// single-word variant names camelCase would lowercase the first letter
/// ("next"/"previous"), which is easy to typo-mismatch against on the JS
/// side. The wire value is the exact Rust identifier ("Next"/"Previous").
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub enum SearchDirection {
    Next,
    Previous,
}

/// The user's cursor-style preference (`TerminalSettings.cursorStyle` on
/// the frontend) — matches that type's exact string values, since it's
/// `#[serde(rename_all = "lowercase")]` rather than the app's usual
/// `camelCase` (a no-op here, but consistent with how the frontend spells
/// it and how xterm.js's own `cursorStyle` option is written).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyleOption {
    Block,
    Bar,
    Underline,
}

/// A search match's bounds, in absolute row coordinates (row 0 = topmost
/// scrollback line, increasing downward) so they stay meaningful across a
/// scroll — the frontend doesn't need to know the display offset that was
/// active when the search ran. `index`/`count` are 0-based position and
/// total among every match in the buffer, i.e. the numbers behind a
/// "3/12"-style match badge.
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub start_row: usize,
    pub start_col: usize,
    pub end_row: usize,
    pub end_col: usize,
    pub index: usize,
    pub count: usize,
}

/// Escapes regex metacharacters so a plain search query is matched
/// literally — the existing search UI (see `TerminalView`'s `addon-search`
/// usage) is not a regex search, and this keeps the Rust-engine path
/// behaviourally identical rather than surprising users with regex syntax.
fn escape_regex(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if matches!(
            c,
            '.' | '^' | '$' | '|' | '(' | ')' | '[' | ']' | '{' | '}' | '*' | '+' | '?' | '\\'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Semantic color key used by the headless diff test: `{mode, value}` where
/// `mode` is "default" | "palette" | "rgb", independent of which concrete
/// theme is active. Standard ANSI names 0-15 collapse to `palette` with the
/// same index xterm.js reports for `CSI 3(0-7)/9(0-7) m`.
fn color_key(color: Color, colors: &term::color::Colors) -> serde_json::Value {
    match color {
        Color::Spec(Rgb { r, g, b }) => serde_json::json!({
            "mode": "rgb",
            "value": ((r as u32) << 16) | ((g as u32) << 8) | b as u32,
        }),
        Color::Indexed(idx) => serde_json::json!({ "mode": "palette", "value": idx }),
        Color::Named(named) => match named {
            NamedColor::Foreground | NamedColor::BrightForeground | NamedColor::DimForeground => {
                serde_json::json!({ "mode": "default", "value": 0 })
            }
            NamedColor::Background => serde_json::json!({ "mode": "default", "value": 0 }),
            NamedColor::Cursor => serde_json::json!({ "mode": "special", "value": 0 }),
            _ => {
                // Black..=BrightWhite (0..=15) and the Dim* variants both
                // collapse onto the 0-15 palette slot they shade.
                let base = named_to_base_index(named);
                let _ = colors; // dynamic OSC 4/10/11 overrides not modeled in the diff test
                serde_json::json!({ "mode": "palette", "value": base })
            }
        },
    }
}

fn named_to_base_index(named: NamedColor) -> u8 {
    use NamedColor::*;
    match named {
        Black => 0,
        Red => 1,
        Green => 2,
        Yellow => 3,
        Blue => 4,
        Magenta => 5,
        Cyan => 6,
        White => 7,
        BrightBlack => 8,
        BrightRed => 9,
        BrightGreen => 10,
        BrightYellow => 11,
        BrightBlue => 12,
        BrightMagenta => 13,
        BrightCyan => 14,
        BrightWhite => 15,
        DimBlack => 0,
        DimRed => 1,
        DimGreen => 2,
        DimYellow => 3,
        DimBlue => 4,
        DimMagenta => 5,
        DimCyan => 6,
        DimWhite => 7,
        Foreground | Background | Cursor | BrightForeground | DimForeground => unreachable!(),
    }
}

fn cell_to_wire(
    cell: &alacritty_terminal::term::cell::Cell,
    colors: &term::color::Colors,
) -> WireCell {
    let codepoint = if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
        0
    } else {
        cell.c as u32
    };

    let extra = cell
        .zerowidth()
        .map(|chars| chars.iter().map(|&c| c as u32).collect())
        .unwrap_or_default();

    WireCell {
        codepoint,
        fg: resolve_color(cell.fg, colors),
        bg: resolve_color(cell.bg, colors),
        flags: map_flags(cell.flags),
        extra,
    }
}

fn resolve_color(color: Color, colors: &term::color::Colors) -> u32 {
    match color {
        Color::Spec(rgb) => palette::pack(rgb.r, rgb.g, rgb.b),
        Color::Indexed(idx) => colors[idx as usize]
            .map(|rgb| palette::pack(rgb.r, rgb.g, rgb.b))
            .unwrap_or_else(|| palette::resolve_indexed(idx)),
        Color::Named(named) => colors[named]
            .map(|rgb| palette::pack(rgb.r, rgb.g, rgb.b))
            .unwrap_or_else(|| named_default(named, colors)),
    }
}

/// Resolves a `NamedColor` that has no live override in `colors` (see
/// `resolve_color`). The `Dim*` variants derive from their non-dim base
/// color, which — unlike the color they're themselves keyed under — *can*
/// have a live override (e.g. `DimRed`'s base is plain `Red`, index 1);
/// checking `colors` for that base first, not just the static
/// `palette::ANSI_16` default, keeps dimmed text following the active
/// theme too instead of only plain ANSI text.
fn named_default(named: NamedColor, colors: &term::color::Colors) -> u32 {
    use NamedColor::*;
    match named {
        Foreground | BrightForeground => palette::FOREGROUND,
        Background => palette::BACKGROUND,
        Cursor => palette::CURSOR,
        DimForeground => dim(colors[Foreground]
            .map(|rgb| palette::pack(rgb.r, rgb.g, rgb.b))
            .unwrap_or(palette::FOREGROUND)),
        DimBlack | DimRed | DimGreen | DimYellow | DimBlue | DimMagenta | DimCyan | DimWhite => {
            let base = named_to_base_index(named);
            let base_color = colors[base as usize]
                .map(|rgb| palette::pack(rgb.r, rgb.g, rgb.b))
                .unwrap_or(palette::ANSI_16[base as usize]);
            dim(base_color)
        }
        _ => palette::ANSI_16[named as usize],
    }
}

fn dim(color: u32) -> u32 {
    let r = (color >> 24) as u8;
    let g = (color >> 16) as u8;
    let b = (color >> 8) as u8;
    let a = color as u8;
    let scale = |c: u8| ((c as u16 * 2) / 3) as u8;
    ((scale(r) as u32) << 24) | ((scale(g) as u32) << 16) | ((scale(b) as u32) << 8) | (a as u32)
}

/// Packs the live mouse-tracking mode bits `Term` exposes into the wire
/// format's `mouse_mode` byte — see `protocol::mouse_mode` for the layout.
/// `alacritty_terminal` keeps `MOUSE_REPORT_CLICK`/`MOUSE_DRAG`/`MOUSE_MOTION`
/// mutually exclusive itself (setting any one of `?1000`/`?1002`/`?1003`
/// clears the others), so at most one tracking-level match below fires.
fn wire_mouse_mode(mode: &TermMode) -> u8 {
    let tracking = if mode.contains(TermMode::MOUSE_MOTION) {
        mouse_mode::TRACKING_ANY_MOTION
    } else if mode.contains(TermMode::MOUSE_DRAG) {
        mouse_mode::TRACKING_DRAG
    } else if mode.contains(TermMode::MOUSE_REPORT_CLICK) {
        mouse_mode::TRACKING_CLICK
    } else {
        mouse_mode::TRACKING_OFF
    };

    let sgr = if mode.contains(TermMode::SGR_MOUSE) {
        mouse_mode::SGR
    } else {
        0
    };

    tracking | sgr
}

fn map_flags(flags: Flags) -> u16 {
    let mut out = 0u16;
    if flags.contains(Flags::BOLD) {
        out |= cell_flags::BOLD;
    }
    if flags.contains(Flags::DIM) {
        out |= cell_flags::DIM;
    }
    if flags.contains(Flags::ITALIC) {
        out |= cell_flags::ITALIC;
    }
    if flags.contains(Flags::UNDERLINE) {
        out |= cell_flags::UNDERLINE;
    }
    if flags.contains(Flags::DOUBLE_UNDERLINE) {
        out |= cell_flags::DOUBLE_UNDERLINE;
    }
    if flags.contains(Flags::UNDERCURL) {
        out |= cell_flags::UNDERCURL;
    }
    if flags.contains(Flags::DOTTED_UNDERLINE) {
        out |= cell_flags::DOTTED_UNDERLINE;
    }
    if flags.contains(Flags::DASHED_UNDERLINE) {
        out |= cell_flags::DASHED_UNDERLINE;
    }
    if flags.contains(Flags::STRIKEOUT) {
        out |= cell_flags::STRIKETHROUGH;
    }
    if flags.contains(Flags::INVERSE) {
        out |= cell_flags::INVERSE;
    }
    if flags.contains(Flags::HIDDEN) {
        out |= cell_flags::HIDDEN;
    }
    if flags.contains(Flags::WIDE_CHAR) {
        out |= cell_flags::WIDE_CHAR;
    }
    if flags.contains(Flags::WIDE_CHAR_SPACER) {
        out |= cell_flags::WIDE_CHAR_SPACER;
    }
    out
}

#[cfg(test)]
mod search_tests {
    use super::*;

    /// Guards the exact JSON the frontend sends over the Tauri IPC
    /// boundary for `engine_search`'s `direction` parameter — a serde
    /// `rename_all` mismatch here silently fails deserialization at
    /// runtime with no type-checker to catch it, since the frontend's
    /// string literals aren't checked against the Rust enum at all.
    #[test]
    fn search_direction_deserializes_from_the_exact_strings_the_frontend_sends() {
        let next: SearchDirection = serde_json::from_str("\"Next\"").unwrap();
        assert!(matches!(next, SearchDirection::Next));
        let previous: SearchDirection = serde_json::from_str("\"Previous\"").unwrap();
        assert!(matches!(previous, SearchDirection::Previous));
    }

    /// 5-row viewport, enough scrollback to push earlier lines up, so a
    /// search has to reach into history rather than just the live screen.
    fn engine_with_lines(lines: &[&str]) -> GridEngine {
        let mut engine = GridEngine::new(20, 5, 100);
        for line in lines {
            engine.feed(line.as_bytes());
            engine.feed(b"\r\n");
        }
        engine
    }

    #[test]
    fn finds_match_in_scrollback_and_scrolls_to_it() {
        let mut engine = engine_with_lines(&[
            "alpha",
            "bravo needle here",
            "charlie",
            "delta",
            "echo",
            "foxtrot",
        ]);

        let found = engine
            .search("needle", SearchDirection::Next, 0, 0)
            .expect("expected a match");

        assert_eq!(found.start_row, 1);
        assert_eq!(found.start_col, 6);
        assert_eq!(found.end_col, 11); // inclusive end, per alacritty's Match = RangeInclusive<Point>

        // The match's row should now be the top of the viewport.
        let info = engine.scrollback_info();
        let history = info.history_size;
        assert_eq!(info.display_offset, history - 1);
    }

    #[test]
    fn is_case_insensitive_by_default_but_not_when_query_has_uppercase() {
        let mut engine = engine_with_lines(&["Needle and needle"]);

        let lower = engine.search("needle", SearchDirection::Next, 0, 0);
        assert!(lower.is_some(), "lowercase query should match either case");

        let mut engine2 = engine_with_lines(&["Needle and needle"]);
        let upper = engine2
            .search("Needle", SearchDirection::Next, 0, 0)
            .expect("expected the exact-case match");
        assert_eq!(
            upper.start_col, 0,
            "an uppercase query should only match the exact case"
        );
    }

    #[test]
    fn treats_query_as_literal_text_not_regex() {
        let mut engine = engine_with_lines(&["a.b and axb"]);

        // A regex-unsafe query like "a.b" must only match the literal
        // dot, not "axb" via regex's "any character" semantics.
        let found = engine
            .search("a.b", SearchDirection::Next, 0, 0)
            .expect("expected the literal match");
        assert_eq!(found.start_col, 0);

        // `search_next` wraps around when nothing matches ahead of the
        // origin (see alacritty's `next_match_right`'s `unwrap_or(first_match)`).
        // If "a.b" were left unescaped, "axb" (cols 8-10) would match and
        // this would land there instead of wrapping back to col 0.
        let second = engine
            .search("a.b", SearchDirection::Next, 0, found.end_col + 1)
            .expect("wraparound should still find the literal match");
        assert_eq!(
            second.start_col, 0,
            "regex metacharacters must be escaped — \"axb\" must not match \"a.b\""
        );
    }

    #[test]
    fn no_match_returns_none_without_moving_scroll() {
        let mut engine = engine_with_lines(&["alpha", "bravo"]);
        let before = engine.scrollback_info().display_offset;
        assert!(engine
            .search("zzz-not-present", SearchDirection::Next, 0, 0)
            .is_none());
        assert_eq!(engine.scrollback_info().display_offset, before);
    }

    /// Backs the "3/12"-style match badge the existing xterm.js search UI
    /// shows via `SearchAddon.onDidChangeResults` — the Rust-engine path
    /// previously returned bounds only, with no count or index.
    #[test]
    fn reports_index_and_total_count_across_the_whole_buffer() {
        let mut engine =
            engine_with_lines(&["needle one", "no match here", "needle two", "needle three"]);

        let first = engine
            .search("needle", SearchDirection::Next, 0, 0)
            .unwrap();
        assert_eq!(first.count, 3);
        assert_eq!(first.index, 0);

        let second = engine
            .search(
                "needle",
                SearchDirection::Next,
                first.end_row,
                first.end_col + 1,
            )
            .unwrap();
        assert_eq!(second.count, 3);
        assert_eq!(second.index, 1);

        let third = engine
            .search(
                "needle",
                SearchDirection::Next,
                second.end_row,
                second.end_col + 1,
            )
            .unwrap();
        assert_eq!(third.count, 3);
        assert_eq!(third.index, 2);

        // Wraps back to the first match.
        let wrapped = engine
            .search(
                "needle",
                SearchDirection::Next,
                third.end_row,
                third.end_col + 1,
            )
            .unwrap();
        assert_eq!(wrapped.count, 3);
        assert_eq!(wrapped.index, 0);
    }

    #[test]
    fn single_match_reports_count_one_index_zero() {
        let mut engine = engine_with_lines(&["only one needle here"]);
        let found = engine
            .search("needle", SearchDirection::Next, 0, 0)
            .unwrap();
        assert_eq!(found.count, 1);
        assert_eq!(found.index, 0);
    }

    #[test]
    fn regex_mode_treats_pattern_as_a_real_regex() {
        let mut engine = engine_with_lines(&["a1 a2 axb"]);

        // Unlike literal mode (see `treats_query_as_literal_text_not_regex`
        // above), "a.b" here must match "axb" via regex's "any character",
        // not just a literal dot.
        let found = engine
            .search_with_mode("a.b", SearchDirection::Next, 0, 0, true)
            .expect("valid regex should compile")
            .expect("expected a match against \"axb\"");
        assert_eq!(found.start_col, 6);

        // A digit class should also match both "a1" and "a2".
        let mut engine2 = engine_with_lines(&["a1 a2 axb"]);
        let first = engine2
            .search_with_mode("a[0-9]", SearchDirection::Next, 0, 0, true)
            .unwrap()
            .expect("expected a match against \"a1\"");
        assert_eq!(first.count, 2);
    }

    #[test]
    fn regex_mode_reports_an_error_for_an_invalid_pattern_instead_of_no_match() {
        let mut engine = engine_with_lines(&["alpha"]);
        let result = engine.search_with_mode("a(b", SearchDirection::Next, 0, 0, true);
        assert!(
            result.is_err(),
            "an unbalanced group must be a compile error, not a silent no-match"
        );
    }

    #[test]
    fn literal_mode_is_unaffected_by_the_use_regex_flag_defaulting_to_false() {
        // `search` (the pre-existing entry point every call site above uses)
        // must keep behaving exactly like `search_with_mode(..., false)`.
        let mut engine = engine_with_lines(&["a.b and axb"]);
        let via_search = engine.search("a.b", SearchDirection::Next, 0, 0);
        let mut engine2 = engine_with_lines(&["a.b and axb"]);
        let via_mode = engine2
            .search_with_mode("a.b", SearchDirection::Next, 0, 0, false)
            .unwrap();
        assert_eq!(via_search.map(|m| m.start_col), via_mode.map(|m| m.start_col));
    }
}

#[cfg(test)]
mod mouse_mode_tests {
    use super::super::protocol::{CELL_RECORD_LEN, HEADER_LEN, ROW_HEADER_LEN};
    use super::*;

    fn header_mouse_mode(frame: &[u8]) -> u8 {
        frame[24]
    }

    #[test]
    fn defaults_to_off_with_no_program_request() {
        let mut engine = GridEngine::new(20, 5, 100);
        let frame = engine.build_frame().expect("first frame is always emitted");
        assert_eq!(header_mouse_mode(&frame), mouse_mode::TRACKING_OFF);
    }

    #[test]
    fn reports_click_tracking_and_sgr_once_requested() {
        let mut engine = GridEngine::new(20, 5, 100);
        engine.build_frame(); // consume the initial full frame

        // `?1000h` (click tracking) + `?1006h` (SGR extended coordinates),
        // exactly what a mouse-aware program like htop or vim sends.
        engine.feed(b"\x1b[?1000h\x1b[?1006h");
        let frame = engine
            .build_frame()
            .expect("a mouse-mode change must force a frame even with no damaged cells");
        assert_eq!(
            header_mouse_mode(&frame),
            mouse_mode::TRACKING_CLICK | mouse_mode::SGR
        );
    }

    #[test]
    fn upgrading_to_any_motion_tracking_overrides_click() {
        let mut engine = GridEngine::new(20, 5, 100);
        engine.build_frame();

        engine.feed(b"\x1b[?1000h");
        engine.build_frame();
        engine.feed(b"\x1b[?1003h"); // any-motion supersedes click, per alacritty's own mode bits
        let frame = engine.build_frame().expect("mode change forces a frame");
        assert_eq!(header_mouse_mode(&frame), mouse_mode::TRACKING_ANY_MOTION);
    }

    #[test]
    fn disabling_tracking_reverts_to_off_and_is_reported() {
        let mut engine = GridEngine::new(20, 5, 100);
        engine.build_frame();
        engine.feed(b"\x1b[?1002h");
        engine.build_frame();

        engine.feed(b"\x1b[?1002l");
        let frame = engine.build_frame().expect("mode change forces a frame");
        assert_eq!(header_mouse_mode(&frame), mouse_mode::TRACKING_OFF);
    }

    #[test]
    fn idle_terminal_only_ever_redamages_the_cursor_cell() {
        // Confirms `alacritty_terminal`'s own `Term::damage()` always
        // re-damages the cursor's single cell on every call (see its "Always
        // damage current cursor" comment) — so with nothing else happening,
        // `build_frame` keeps producing this minimal cursor-only frame
        // rather than ever returning `None`.
        let mut engine = GridEngine::new(20, 5, 100);
        engine.build_frame();
        let idle = engine
            .build_frame()
            .expect("cursor redamage keeps producing a frame");
        assert_eq!(idle.len(), HEADER_LEN + ROW_HEADER_LEN + CELL_RECORD_LEN);
    }

    #[test]
    fn unchanged_mouse_mode_does_not_force_an_otherwise_empty_frame() {
        let mut engine = GridEngine::new(20, 5, 100);
        engine.build_frame();
        engine.feed(b"\x1b[?1000h");

        // A mode change alone (no other damage) must still ride out as the
        // same minimal cursor-only frame `build_frame` always produces on
        // an idle terminal — not a forced full-content frame — and every
        // frame after it, mode unchanged, must stay exactly that small too.
        let minimal = HEADER_LEN + ROW_HEADER_LEN + CELL_RECORD_LEN;
        let after_mode_change = engine.build_frame().unwrap();
        assert_eq!(after_mode_change.len(), minimal);

        let idle = engine
            .build_frame()
            .expect("cursor redamage keeps producing a frame");
        assert_eq!(idle.len(), minimal);
    }
}

#[cfg(test)]
mod cursor_scroll_tests {
    use super::*;

    fn header_cursor_line(frame: &[u8]) -> u16 {
        u16::from_le_bytes([frame[12], frame[13]])
    }

    fn header_cursor_visible(frame: &[u8]) -> bool {
        frame[15] != 0
    }

    /// `RenderableCursor` (`alacritty_terminal`'s `term.grid.cursor.point`)
    /// is in *live-screen* grid coordinates, unaffected by scroll — the
    /// same raw line number every frame regardless of `display_offset`.
    /// Sending that straight over the wire as `cursor_line` (as `build_frame`
    /// used to) meant the cursor visually stayed pinned to the same on-screen
    /// row while scrolling through scrollback, instead of scrolling away
    /// with the live content it's actually attached to. Fixed by converting
    /// to viewport coordinates (`+ display_offset`, matching the cell loop's
    /// own `viewport_to_point`) and marking the cursor not-visible once
    /// that puts it outside the visible rows.
    #[test]
    fn cursor_is_hidden_once_scrolled_away_from_the_live_position() {
        let mut engine = GridEngine::new(20, 4, 10_000);
        // 6 lines into a 4-row viewport pushes 2 lines into scrollback,
        // with the live cursor sitting on the last (4th) visible row.
        engine.feed(b"one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix");
        let live = engine.build_frame().expect("first frame is always emitted");
        assert!(header_cursor_visible(&live), "cursor must be visible at the live bottom");
        assert_eq!(header_cursor_line(&live), 3, "cursor sits on the last visible row");

        // Scroll all the way up into history — the cursor's live row is now
        // well below the visible window and must not be drawn there.
        engine.set_scroll_display_offset(2);
        let scrolled = engine.build_frame().expect("scrolling forces a full frame");
        assert!(
            !header_cursor_visible(&scrolled),
            "cursor must not render while scrolled away from its actual row"
        );

        // Scrolling back to the live bottom must restore it exactly.
        engine.set_scroll_display_offset(0);
        let back = engine.build_frame().expect("scrolling forces a full frame");
        assert!(header_cursor_visible(&back));
        assert_eq!(header_cursor_line(&back), 3);
    }

    /// A partial scroll that doesn't push the cursor's row out of the
    /// viewport must shift its on-screen row down by exactly the scroll
    /// amount and keep it visible — only scrolling *past* the row it's
    /// actually on (covered above) should hide it.
    #[test]
    fn cursor_shifts_down_by_the_scroll_amount_while_still_in_view() {
        let mut engine = GridEngine::new(20, 8, 10_000);
        // 10 lines into an 8-row viewport: 2 lines of scrollback, cursor
        // lands on the live-screen's last row (7) right after "line9".
        engine.feed(b"line0\r\nline1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9");
        // Move the cursor up 3 rows (to live row 4) so there's room for it
        // to shift within the viewport before going off-screen — the live
        // cursor always starts on the bottom row right after sequential
        // writes, which would otherwise leave no room to test a partial,
        // still-visible shift.
        engine.feed(b"\x1b[3A");
        let live = engine.build_frame().expect("cursor move forces a frame");
        assert_eq!(header_cursor_line(&live), 4);
        assert!(header_cursor_visible(&live));

        for offset in 1..=2u16 {
            engine.set_scroll_display_offset(offset as usize);
            let frame = engine.build_frame().expect("scrolling forces a full frame");
            assert!(header_cursor_visible(&frame), "offset {offset}: cursor row 4 + {offset} is still within 8 rows");
            assert_eq!(header_cursor_line(&frame), 4 + offset, "offset {offset}");
        }
    }
}

#[cfg(test)]
mod resize_tests {
    use super::*;

    fn row_text(snapshot: &serde_json::Value, row: usize) -> String {
        snapshot["lines"][row]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["c"].as_str().unwrap())
            .collect::<String>()
            .trim_end()
            .to_string()
    }

    /// Every non-blank row's text in the *entire* buffer (scrollback
    /// history plus the visible viewport), top to bottom, with trailing
    /// blank rows dropped — unlike `snapshot()`/`row_text`, which only ever
    /// look at the currently visible viewport. A resize that reflows a
    /// wrapped line across more rows than fit in the viewport pushes the
    /// overflow into scrollback (see
    /// `shrink_reflow_pushes_the_oldest_reflowed_segment_into_scrollback_but_keeps_it`
    /// below) — checking only the viewport there would misreport genuinely
    /// preserved content as lost, which is exactly what an earlier revision
    /// of this test suite did.
    fn full_buffer_text(engine: &GridEngine) -> Vec<String> {
        let grid = engine.term.grid();
        let history = grid.history_size() as i32;
        let mut lines: Vec<String> = (-history..grid.screen_lines() as i32)
            .map(|l| {
                let row = &grid[Line(l)];
                (0..grid.columns())
                    .map(|c| row[Column(c)].c)
                    .collect::<String>()
                    .trim_end()
                    .to_string()
            })
            .collect();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        lines
    }

    /// Investigated as a suspected data-loss bug (a resize forcing a
    /// wrapped line to split across 3+ rows appeared to silently drop the
    /// middle segment, going only by the visible viewport — see
    /// `full_buffer_text`'s doc comment). Instrumenting `Grid::shrink_columns`
    /// directly showed the content was never dropped: with 41 `'A'`s wrapped
    /// at 40 columns then shrunk to 20 columns, `alacritty_terminal`
    /// correctly reflows to three `WRAPLINE`-chained rows of 20+20+1 — it's
    /// just that the fixed-height viewport (8 rows, `self.lines` unchanged
    /// by a columns-only resize) can't grow to fit a 3rd content row where
    /// only 2 existed before, so the oldest of the three ages into
    /// scrollback instead.
    ///
    /// That's a real, confirmed difference from xterm.js, not a wash:
    /// probing `@xterm/headless` directly (see the `resize_reflow` corpus
    /// case's corrected `knownIssue` text in `scripts/gen-corpus.mjs`) with
    /// this same shape of input shows it reclaims the *blank* rows already
    /// below the content to fit a reflow's extra rows, so it never touches
    /// scrollback at all when there's already room. `alacritty_terminal`
    /// doesn't do that reclaiming — it grows the buffer and anchors at the
    /// bottom unconditionally, even when blank space below would have been
    /// enough. So this is a real, low-severity inefficiency (an unnecessary
    /// extra scroll to see recently-reflowed content), not the data loss
    /// the original "known bug" characterization claimed — and fixing the
    /// inefficiency would mean patching `shrink_columns`'s core row
    /// accounting inside `alacritty_terminal` to add the same kind of
    /// blank-row reclaiming `grow_columns` already does for its own
    /// direction, which is more risk than a cosmetic scroll-position
    /// difference justifies.
    #[test]
    fn shrink_reflow_pushes_the_oldest_reflowed_segment_into_scrollback_but_keeps_it() {
        let mut engine = GridEngine::new(40, 8, 10_000);
        engine.feed("A".repeat(41).as_bytes());
        engine.resize(20, 8);

        // Nothing lost: all 41 characters are still in the buffer, correctly
        // split 20+20+1 in top-to-bottom order.
        let full = full_buffer_text(&engine);
        assert_eq!(full, vec!["A".repeat(20), "A".repeat(20), "A".to_string()]);

        // But only the last two of those three rows fit in the 8-row
        // viewport at the live bottom (display_offset 0) — the first row
        // scrolled into history, same as narrowing a real terminal window.
        let snapshot = engine.snapshot();
        assert_eq!(row_text(&snapshot, 0), "A".repeat(20), "the 2nd reflowed row, now the top of the viewport");
        assert_eq!(row_text(&snapshot, 1), "A", "the original 1-char leftover, unaffected by the reflow");
        assert_eq!(engine.scrollback_info().history_size, 1, "the 1st reflowed row scrolled into history");
    }

    /// The narrow case where reflow overflow genuinely *can* be discarded
    /// rather than merely scrolled into history: `max_scroll_limit` (the
    /// user's configured scrollback line budget — `DEFAULT_SCROLLBACK` in
    /// `engine/manager.rs`, 10,000 lines in production, never this small in
    /// the shipped app) bounds how many rows `shrink_columns` can keep
    /// after a resize, and truncation cuts from the *oldest end of the
    /// post-reflow buffer* — which is not necessarily the least important
    /// row when a single reflow operation just created several new rows in
    /// one pass, as here. With no scrollback budget at all, the 1st of the
    /// three reflowed rows is truncated away entirely (not scrolled off,
    /// genuinely gone), leaving the 2nd and 3rd looking like a complete,
    /// un-wrapped 21-character line with no indication 20 characters are
    /// missing from the middle. Documented and asserted here as a known,
    /// practically-unreachable-in-this-app limitation (it needs a near-zero
    /// scrollback budget this app never configures), not fixed — the fix
    /// would mean patching `shrink_columns`'s truncation policy inside
    /// `alacritty_terminal` itself, which carries far more risk than this
    /// edge case's real-world reach justifies. See
    /// `shrink_reflow_pushes_the_oldest_reflowed_segment_into_scrollback_but_keeps_it`
    /// above for the (much more common) case with a realistic scrollback
    /// budget, where nothing is actually lost.
    #[test]
    fn shrink_reflow_can_truncate_the_wrong_row_when_scrollback_budget_is_effectively_zero() {
        let mut engine = GridEngine::new(40, 8, 0);
        engine.feed("A".repeat(41).as_bytes());
        engine.resize(20, 8);

        let full = full_buffer_text(&engine);
        assert_eq!(
            full,
            vec!["A".repeat(20), "A".to_string()],
            "with zero scrollback budget, the 1st reflowed row (chars 0-19) is truncated away \
             entirely rather than scrolled into history — if this now shows all three rows, the \
             truncation policy was fixed upstream and this test (and its doc comment) should be \
             deleted",
        );
        assert_eq!(engine.scrollback_info().history_size, 0);
    }

    #[test]
    fn grow_columns_reflow_is_not_affected() {
        let mut engine = GridEngine::new(20, 8, 10_000);
        engine.feed("A".repeat(41).as_bytes());
        engine.resize(40, 8);
        let snapshot = engine.snapshot();

        assert_eq!(row_text(&snapshot, 0), "A".repeat(40));
        assert_eq!(row_text(&snapshot, 1), "A");
    }
}

#[cfg(test)]
mod palette_tests {
    use super::*;
    use alacritty_terminal::term::color::Colors;

    fn colors_with_red(r: u8, g: u8, b: u8) -> Colors {
        let mut colors = Colors::default();
        colors[NamedColor::Red] = Some(Rgb { r, g, b });
        colors
    }

    #[test]
    fn named_color_resolves_against_a_live_override_before_falling_back_to_the_static_default() {
        let colors = colors_with_red(10, 20, 30);
        assert_eq!(
            resolve_color(Color::Named(NamedColor::Red), &colors),
            palette::pack(10, 20, 30),
        );
        // Blue has no override in this table, so it still falls back to the
        // static default — confirms the fallback path wasn't broken by
        // threading `colors` through `named_default`.
        assert_eq!(
            resolve_color(Color::Named(NamedColor::Blue), &colors),
            palette::ANSI_16[NamedColor::Blue as usize],
        );
    }

    #[test]
    fn dim_red_follows_reds_live_override_not_just_the_static_palette() {
        let colors = colors_with_red(10, 20, 30);
        let expected = dim(palette::pack(10, 20, 30));
        assert_eq!(
            resolve_color(Color::Named(NamedColor::DimRed), &colors),
            expected,
        );
        assert_ne!(
            expected,
            dim(palette::ANSI_16[NamedColor::Red as usize]),
            "override and static default must differ, or this test can't tell them apart",
        );
    }

    #[test]
    fn set_palette_forces_a_full_frame_that_repaints_with_the_new_colors() {
        let mut engine = GridEngine::new(10, 3, 10);
        engine.feed(b"\x1b[31mX\x1b[0m");
        engine.build_frame(); // drain the initial frame

        let mut ansi16 = [(0u8, 0u8, 0u8); 16];
        ansi16[NamedColor::Red as usize] = (200, 10, 10);
        engine.set_palette(&palette::ThemePalette {
            ansi16,
            foreground: (255, 255, 255),
            background: None,
            cursor: (255, 255, 255),
        });

        let frame = engine.build_frame();
        assert!(
            frame.is_some(),
            "a palette change must force a repaint frame even though no cell content changed",
        );
    }
}
