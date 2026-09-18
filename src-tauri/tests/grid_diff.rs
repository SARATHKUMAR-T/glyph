//! Phase 1 conformance harness: feeds the recorded PTY corpus in
//! `tests/fixtures/pty_corpus/` into the Rust `GridEngine` and dumps one
//! canonical JSON snapshot per case to `target/grid_diff/<name>.rust.json`.
//!
//! This test only produces the Rust side of the comparison. The actual
//! diff against an xterm.js headless reference happens in
//! `scripts/grid-diff.mjs`, which is run right after this test as part of
//! `npm run test:grid-diff`. Keeping them separate means each half can be
//! inspected on its own (`cat target/grid_diff/basic_text.rust.json`).

use std::fs;
use std::path::PathBuf;

use nothing_terminal_lib::terminal::engine::grid_engine::GridEngine;
use serde::Deserialize;

#[derive(Deserialize)]
struct ResizeTo {
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    name: String,
    file: String,
    cols: u16,
    rows: u16,
    /// Present for cases that exercise resize reflow (see
    /// `scripts/gen-corpus.mjs`'s `addResizeCase`): the engine is resized
    /// to this size, then fed `post_file`'s bytes, before snapshotting.
    resize_to: Option<ResizeTo>,
    post_file: Option<String>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pty_corpus")
}

fn out_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/grid_diff")
}

fn load_manifest() -> Vec<ManifestEntry> {
    let raw = fs::read_to_string(fixtures_dir().join("manifest.json"))
        .expect("corpus manifest.json missing — run `node scripts/gen-corpus.mjs`");
    serde_json::from_str(&raw).expect("corpus manifest.json is not valid JSON")
}

/// Feeds `entry`'s corpus bytes into `engine`, one call per "chunk" as
/// produced by `feed_chunks`, then applies the resize step when present.
fn run_case(entry: &ManifestEntry, engine: &mut GridEngine, feed_chunks: impl Fn(&[u8], &mut dyn FnMut(&[u8]))) {
    let bytes = fs::read(fixtures_dir().join(&entry.file))
        .unwrap_or_else(|_| panic!("missing corpus fixture {}", entry.file));
    feed_chunks(&bytes, &mut |chunk| engine.feed(chunk));

    if let Some(resize) = &entry.resize_to {
        engine.resize(resize.cols, resize.rows);
        if let Some(post_file) = &entry.post_file {
            let post_bytes = fs::read(fixtures_dir().join(post_file))
                .unwrap_or_else(|_| panic!("missing corpus fixture {post_file}"));
            feed_chunks(&post_bytes, &mut |chunk| engine.feed(chunk));
        }
    }
}

#[test]
fn dump_rust_grid_snapshots_for_corpus() {
    let manifest = load_manifest();
    fs::create_dir_all(out_dir()).expect("failed to create target/grid_diff");

    for entry in manifest {
        let mut engine = GridEngine::new(entry.cols, entry.rows, 10_000);
        run_case(&entry, &mut engine, |bytes, feed| feed(bytes));
        let snapshot = engine.snapshot();

        let out_path = out_dir().join(format!("{}.rust.json", entry.name));
        fs::write(&out_path, serde_json::to_vec_pretty(&snapshot).unwrap())
            .unwrap_or_else(|e| panic!("failed to write {out_path:?}: {e}"));
    }
}

/// Same corpus, but fed one byte at a time, to catch parser bugs that only
/// show up when PTY reads fragment a multi-byte UTF-8 sequence or an escape
/// sequence across chunk boundaries (which is exactly how real PTY reads
/// behave — see `terminal::reader::spawn_reader_thread`).
#[test]
fn byte_at_a_time_feed_matches_single_shot_feed() {
    let manifest = load_manifest();

    for entry in manifest {
        let mut whole = GridEngine::new(entry.cols, entry.rows, 10_000);
        run_case(&entry, &mut whole, |bytes, feed| feed(bytes));

        let mut fragmented = GridEngine::new(entry.cols, entry.rows, 10_000);
        run_case(&entry, &mut fragmented, |bytes, feed| {
            for byte in bytes {
                feed(std::slice::from_ref(byte));
            }
        });

        assert_eq!(
            whole.snapshot(),
            fragmented.snapshot(),
            "case `{}`: byte-at-a-time feed diverged from single-shot feed",
            entry.name
        );
    }
}
