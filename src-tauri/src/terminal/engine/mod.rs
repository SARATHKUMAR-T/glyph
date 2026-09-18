//! Rust-owned VT parser + grid state powering the WebGL2/Canvas2D
//! terminal renderer (see `BENCH.md` for the phased history of this
//! effort) — the terminal's only rendering pipeline.

pub mod grid_engine;
pub mod manager;
pub mod palette;
pub mod protocol;

pub use manager::EngineManager;
