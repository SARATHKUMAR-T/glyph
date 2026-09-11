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
use alacritty_terminal::term::{self, viewport_to_point, Config, Term, TermDamage};
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor, Processor, Rgb};

use super::palette;
use super::protocol::{
    cell_flags, encode_frame, FrameHeader, FrameKind, WireCell, WireCursorShape, WireRow,
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
    processor: Processor,
    /// Forces the next `build_frame` call to emit a Full frame (first frame
    /// after construction, and after every resize).
    force_full: bool,
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
        let term = Term::new(config, &dims, GlyphEventListener);

        Self {
            term,
            processor: Processor::new(),
            force_full: true,
        }
    }

    /// Feed a chunk of raw PTY bytes (identical to what `Osc133Parser` and
    /// the xterm.js path receive) into the grid parser.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.processor.advance(&mut self.term, bytes);
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
        self.term
            .scroll_display(Scroll::Delta(display_offset.min(history) as i32 - self.term.grid().display_offset() as i32));
        self.force_full = true;
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
    /// the same absolute row coordinate space.
    pub fn search(
        &mut self,
        pattern: &str,
        direction: SearchDirection,
        from_row: usize,
        from_col: usize,
    ) -> Option<SearchMatch> {
        if pattern.is_empty() {
            return None;
        }
        let mut regex = RegexSearch::new(&escape_regex(pattern)).ok()?;
        let history = self.term.grid().history_size() as i32;

        let origin = Point::new(Line(from_row as i32 - history), Column(from_col));
        let dir = match direction {
            SearchDirection::Next => SearchDir::Right,
            SearchDirection::Previous => SearchDir::Left,
        };

        let found = self.term.search_next(&mut regex, origin, dir, Side::Left, None)?;
        let to_absolute = |p: &Point| ((p.line.0 + history).max(0) as usize, p.column.0);
        let (start_row, start_col) = to_absolute(found.start());
        let (end_row, end_col) = to_absolute(found.end());

        self.set_scroll_display_offset((history as usize).saturating_sub(start_row));

        Some(SearchMatch {
            start_row,
            start_col,
            end_row,
            end_col,
        })
    }

    /// Encode a damage frame. Returns `None` when nothing changed since the
    /// last call (Partial frame with zero damaged rows) so callers can skip
    /// sending an (almost) empty IPC message on every idle tick.
    pub fn build_frame(&mut self) -> Option<Vec<u8>> {
        let cols = self.term.columns();
        let rows = self.term.screen_lines();
        let display_offset = self.term.grid().display_offset();

        let (cursor_col, cursor_line, wire_shape, cursor_visible) = {
            let content = self.term.renderable_content();
            let visible = !matches!(content.cursor.shape, CursorShape::Hidden);
            let shape = match content.cursor.shape {
                CursorShape::Underline => WireCursorShape::Underline,
                CursorShape::Beam => WireCursorShape::Bar,
                CursorShape::Block | CursorShape::HollowBlock => WireCursorShape::Block,
                CursorShape::Hidden => WireCursorShape::Hidden,
            };
            (
                content.cursor.point.column.0 as u16,
                content.cursor.point.line.0.max(0) as u16,
                shape,
                visible,
            )
        };

        let full = self.force_full;
        self.force_full = false;

        let row_bounds: Vec<(usize, usize, usize)> = if full {
            (0..rows).map(|r| (r, 0, cols.saturating_sub(1))).collect()
        } else {
            match self.term.damage() {
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

        if row_bounds.is_empty() {
            return None;
        }

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
            kind: if full { FrameKind::Full } else { FrameKind::Partial },
            cols: cols as u16,
            rows: rows as u16,
            cursor_col,
            cursor_line,
            cursor_shape: wire_shape,
            cursor_visible,
            display_offset: display_offset as u32,
            total_lines: self.term.total_lines() as u32,
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

/// A search match's bounds, in absolute row coordinates (row 0 = topmost
/// scrollback line, increasing downward) so they stay meaningful across a
/// scroll — the frontend doesn't need to know the display offset that was
/// active when the search ran.
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub start_row: usize,
    pub start_col: usize,
    pub end_row: usize,
    pub end_col: usize,
}

/// Escapes regex metacharacters so a plain search query is matched
/// literally — the existing search UI (see `TerminalView`'s `addon-search`
/// usage) is not a regex search, and this keeps the Rust-engine path
/// behaviourally identical rather than surprising users with regex syntax.
fn escape_regex(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if matches!(c, '.' | '^' | '$' | '|' | '(' | ')' | '[' | ']' | '{' | '}' | '*' | '+' | '?' | '\\') {
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

fn cell_to_wire(cell: &alacritty_terminal::term::cell::Cell, colors: &term::color::Colors) -> WireCell {
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
            .unwrap_or_else(|| named_default(named)),
    }
}

fn named_default(named: NamedColor) -> u32 {
    use NamedColor::*;
    match named {
        Foreground | BrightForeground => palette::FOREGROUND,
        Background => palette::BACKGROUND,
        Cursor => palette::CURSOR,
        DimForeground => dim(palette::FOREGROUND),
        DimBlack | DimRed | DimGreen | DimYellow | DimBlue | DimMagenta | DimCyan | DimWhite => {
            dim(palette::ANSI_16[named_to_base_index(named) as usize])
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
        let mut engine = engine_with_lines(&["alpha", "bravo needle here", "charlie", "delta", "echo", "foxtrot"]);

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
        assert_eq!(upper.start_col, 0, "an uppercase query should only match the exact case");
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
        assert_eq!(second.start_col, 0, "regex metacharacters must be escaped — \"axb\" must not match \"a.b\"");
    }

    #[test]
    fn no_match_returns_none_without_moving_scroll() {
        let mut engine = engine_with_lines(&["alpha", "bravo"]);
        let before = engine.scrollback_info().display_offset;
        assert!(engine.search("zzz-not-present", SearchDirection::Next, 0, 0).is_none());
        assert_eq!(engine.scrollback_info().display_offset, before);
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

    /// KNOWN BUG in `alacritty_terminal` 0.26.0's `Grid::shrink_columns`
    /// reflow (found via `src-tauri/tests/grid_diff.rs`'s `resize_reflow`
    /// corpus case diverging from the xterm.js reference): when shrinking
    /// column width forces a single old row's wrapped content to split
    /// across *three or more* new rows, the middle segment is silently
    /// dropped instead of reflowed — confirmed to need only 41 characters
    /// wrapped at 40 columns then shrunk to 20 (expected 3 new rows of
    /// 20+20+1 chars; actual is 20+1, missing 20 characters). Confirmed
    /// NOT present in the opposite (grow-columns) direction — see
    /// `grow_columns_reflow_is_not_affected` below.
    ///
    /// `Term::resize`'s public API gives no way to disable reflow on the
    /// primary screen, so this cannot be worked around from `GridEngine`
    /// without vendoring/patching the crate — tracked as a discovered,
    /// disclosed limitation (see the Phase 4 report) rather than patched.
    ///
    /// This test intentionally asserts the CURRENT (buggy) behavior, so a
    /// future `alacritty_terminal` upgrade that fixes it fails this test
    /// loudly — that failure is the signal to delete this test and the
    /// disclosure around it, not a regression to chase.
    #[test]
    fn known_bug_shrink_reflow_drops_middle_segment_when_splitting_across_3_plus_rows() {
        let mut engine = GridEngine::new(40, 8, 10_000);
        engine.feed("A".repeat(41).as_bytes());
        engine.resize(20, 8);
        let snapshot = engine.snapshot();

        assert_eq!(row_text(&snapshot, 0), "A".repeat(20));
        assert_eq!(
            row_text(&snapshot, 1),
            "A",
            "known upstream bug: expected a middle row of 20 'A's (correct reflow), \
             but alacritty_terminal 0.26.0 drops it — if this now fails, the bug may \
             be fixed upstream; see the doc comment above",
        );
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
