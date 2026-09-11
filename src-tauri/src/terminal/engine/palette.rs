//! Default 16-color ANSI palette, mirroring the values in
//! `src/lib/terminal/xterm.ts` (`DEFAULT_THEME`) so the Rust engine and the
//! xterm.js path render identically until per-theme sync lands in a later
//! phase.
//!
//! Colors are stored as packed `0xRRGGBBAA` (straight alpha, alpha always
//! 0xff for palette colors).

pub const FOREGROUND: u32 = 0xf5_f5_f5_ff;
pub const BACKGROUND: u32 = 0x00_00_00_00;
pub const CURSOR: u32 = 0xff_30_30_ff;

/// Indices 0-15, matching `vte::ansi::NamedColor::Black..=BrightWhite`.
pub const ANSI_16: [u32; 16] = [
    0x00_00_00_ff, // 0 black
    0xd7_19_21_ff, // 1 red
    0xb6_f2_bd_ff, // 2 green
    0xf3_e7_a1_ff, // 3 yellow
    0x9c_c9_ff_ff, // 4 blue
    0xe4_b2_ff_ff, // 5 magenta
    0x9e_e7_e5_ff, // 6 cyan
    0xf5_f5_f5_ff, // 7 white
    0x77_77_77_ff, // 8 bright black
    0xff_30_30_ff, // 9 bright red
    0xd2_ff_d6_ff, // 10 bright green
    0xff_f4_b8_ff, // 11 bright yellow
    0xb8_dc_ff_ff, // 12 bright blue
    0xf0_ca_ff_ff, // 13 bright magenta
    0xc1_ff_fb_ff, // 14 bright cyan
    0xff_ff_ff_ff, // 15 bright white
];

/// Resolve one of the 256 indexed-color slots (0-255) to a packed RGBA.
/// 0-15 use the theme-matched `ANSI_16` table; 16-231 are the standard
/// 6x6x6 color cube; 232-255 are the standard 24-step grayscale ramp, both
/// per the well-known xterm-256color layout so truecolor-unaware programs
/// (e.g. `ls --color`, most TUIs) look the same as they do under xterm.js.
pub fn resolve_indexed(index: u8) -> u32 {
    match index {
        0..=15 => ANSI_16[index as usize],
        16..=231 => {
            let i = index - 16;
            let r = i / 36;
            let g = (i % 36) / 6;
            let b = i % 6;
            let scale = |c: u8| -> u8 {
                if c == 0 {
                    0
                } else {
                    55 + c * 40
                }
            };
            pack(scale(r), scale(g), scale(b))
        }
        232..=255 => {
            let level = 8 + (index - 232) * 10;
            pack(level, level, level)
        }
    }
}

pub const fn pack(r: u8, g: u8, b: u8) -> u32 {
    ((r as u32) << 24) | ((g as u32) << 16) | ((b as u32) << 8) | 0xff
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_cube_corners_match_known_xterm_values() {
        assert_eq!(resolve_indexed(16), pack(0, 0, 0));
        assert_eq!(resolve_indexed(231), pack(255, 255, 255));
        assert_eq!(resolve_indexed(232), pack(8, 8, 8));
        assert_eq!(resolve_indexed(255), pack(238, 238, 238));
    }
}
