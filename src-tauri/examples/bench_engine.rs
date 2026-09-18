//! Phase 1 throughput micro-benchmark for BENCH.md: how fast can the Rust
//! `GridEngine` parse a realistic mixed VT byte stream, compared to the
//! equivalent xterm.js headless run in `scripts/bench-xterm.mjs`?
//!
//! This measures parser + grid-mutation throughput only. It does NOT cover
//! end-to-end frame damage-encoding, IPC transfer, or rendering — those
//! land in the Phase 2/3 BENCH.md updates once there is a renderer to time.
//!
//! Run with: cargo run --release --example bench_engine

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use nothing_terminal_lib::terminal::engine::grid_engine::GridEngine;

const REPEATS: usize = 20_000;

fn corpus_bytes() -> Vec<u8> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pty_corpus");
    let manifest: Vec<serde_json::Value> =
        serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();

    let mut combined = Vec::new();
    for entry in manifest {
        let file = entry["file"].as_str().unwrap();
        combined.extend(fs::read(dir.join(file)).unwrap());
    }
    combined
}

fn main() {
    let unit = corpus_bytes();
    let mut payload = Vec::with_capacity(unit.len() * REPEATS);
    for _ in 0..REPEATS {
        payload.extend_from_slice(&unit);
    }

    let mb = payload.len() as f64 / 1_000_000.0;
    println!("payload: {:.2} MB ({} repeats of the {}-byte corpus)", mb, REPEATS, unit.len());

    // Feed in 8KiB chunks, matching the real PTY read buffer size in
    // terminal::reader::spawn_reader_thread, rather than one giant advance().
    const CHUNK: usize = 8192;

    // Warm up (page faults, allocator, branch predictor) before timing.
    let mut warmup = GridEngine::new(80, 24, 10_000);
    for chunk in payload[..payload.len().min(unit.len() * 200)].chunks(CHUNK) {
        warmup.feed(chunk);
    }

    let mut engine = GridEngine::new(80, 24, 10_000);
    let start = Instant::now();
    for chunk in payload.chunks(CHUNK) {
        engine.feed(chunk);
    }
    let elapsed = start.elapsed();

    let secs = elapsed.as_secs_f64();
    println!("GridEngine.feed: {:.3}s ({:.1} MB/s)", secs, mb / secs);
}
