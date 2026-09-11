//! Rust-owned VT parser + grid state (Phase 1 of the WebGL2 renderer
//! effort). Entirely additive: xterm.js remains the default renderer, this
//! module is only exercised when `GLYPH_RUST_ENGINE=1` is set in the
//! environment (see `manager::engine_enabled`).

pub mod grid_engine;
pub mod manager;
pub mod palette;
pub mod protocol;

pub use manager::EngineManager;
