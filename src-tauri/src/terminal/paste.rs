//! Encoding of clipboard text for delivery to the PTY.

const PASTE_START: &str = "\x1b[200~";
const PASTE_END: &str = "\x1b[201~";

/// Prepares pasted text the way xterm does before it reaches the PTY.
///
/// Line endings become a bare CR, the key a real Enter press sends; a raw
/// LF means something different to a program in raw mode.
///
/// When the running program has enabled bracketed paste (`?2004`), the
/// text is wrapped in `ESC [200~` … `ESC [201~` so the program receives it
/// as one paste instead of a stream of individual keypresses. Without the
/// markers, TUI programs (Ink-based CLIs such as Antigravity/Gemini, and
/// most line editors) process and redraw after every character, so a long
/// paste visibly "types" itself out, and each newline submits the input
/// early. Any end marker already inside the text is removed so clipboard
/// content can't close the paste early and have the rest of it
/// interpreted as typed commands.
pub fn encode_paste(text: &str, bracketed: bool) -> String {
    let normalized = text.replace("\r\n", "\r").replace('\n', "\r");
    if !bracketed {
        return normalized;
    }
    let sanitized = normalized.replace(PASTE_END, "");
    format!("{PASTE_START}{sanitized}{PASTE_END}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unbracketed_paste_only_normalizes_line_endings() {
        assert_eq!(encode_paste("a\nb\r\nc", false), "a\rb\rc");
    }

    #[test]
    fn bracketed_paste_is_wrapped_in_markers() {
        assert_eq!(encode_paste("line1\nline2", true), "\x1b[200~line1\rline2\x1b[201~");
    }

    #[test]
    fn embedded_end_marker_cannot_break_out_of_the_paste() {
        let hostile = "harmless\x1b[201~rm -rf ~\n";
        assert_eq!(encode_paste(hostile, true), "\x1b[200~harmlessrm -rf ~\r\x1b[201~");
    }
}
