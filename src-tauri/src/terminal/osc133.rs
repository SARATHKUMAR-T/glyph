#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Osc133Event {
    pub kind: Osc133Kind,
    pub exit_code: Option<i32>,
    pub raw: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Osc133Kind {
    PromptStart,
    CommandInputStart,
    CommandExecutionStart,
    CommandFinished,
}

impl Osc133Kind {
    pub fn as_wire_name(&self) -> &'static str {
        match self {
            Osc133Kind::PromptStart => "prompt_start",
            Osc133Kind::CommandInputStart => "command_input_start",
            Osc133Kind::CommandExecutionStart => "command_execution_start",
            Osc133Kind::CommandFinished => "command_finished",
        }
    }
}

#[derive(Default)]
pub struct Osc133Parser {
    buffer: String,
}

impl Osc133Parser {
    pub fn feed(&mut self, chunk: &str) -> Vec<Osc133Event> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();

        loop {
            let Some(start) = self.buffer.find("\u{1b}]133;") else {
                self.trim_unmatched_tail();
                break;
            };

            if start > 0 {
                self.buffer.drain(..start);
            }

            let body_start = "\u{1b}]133;".len();
            let Some((body_end, terminator_len)) = find_terminator(&self.buffer[body_start..]) else {
                self.trim_pending_sequence();
                break;
            };

            let body = &self.buffer[body_start..body_start + body_end];
            if let Some(event) = parse_body(body) {
                events.push(event);
            }

            self.buffer.drain(..body_start + body_end + terminator_len);
        }

        events
    }

    fn trim_unmatched_tail(&mut self) {
        const KEEP: usize = 16;
        if self.buffer.len() > KEEP {
            let target = self.buffer.len() - KEEP;
            let keep_from = self
                .buffer
                .char_indices()
                .map(|(idx, _)| idx)
                .find(|&idx| idx >= target)
                .unwrap_or(self.buffer.len());

            if keep_from > 0 && keep_from < self.buffer.len() {
                self.buffer.drain(..keep_from);
            } else if keep_from >= self.buffer.len() {
                self.buffer.clear();
            }
        }
    }

    fn trim_pending_sequence(&mut self) {
        const MAX_PENDING: usize = 4096;
        if self.buffer.len() > MAX_PENDING {
            self.buffer.clear();
        }
    }
}

fn find_terminator(input: &str) -> Option<(usize, usize)> {
    let bel = input.find('\u{7}').map(|index| (index, 1));
    let st = input.find("\u{1b}\\").map(|index| (index, 2));

    match (bel, st) {
        (Some(bel), Some(st)) => Some(if bel.0 <= st.0 { bel } else { st }),
        (Some(bel), None) => Some(bel),
        (None, Some(st)) => Some(st),
        (None, None) => None,
    }
}

fn parse_body(body: &str) -> Option<Osc133Event> {
    let parts = body.split(';').map(str::trim).collect::<Vec<_>>();
    let kind = match parts.first().copied()? {
        "A" => Osc133Kind::PromptStart,
        "B" => Osc133Kind::CommandInputStart,
        "C" => Osc133Kind::CommandExecutionStart,
        "D" => Osc133Kind::CommandFinished,
        _ => return None,
    };
    let exit_code = if kind == Osc133Kind::CommandFinished {
        parts.get(1).and_then(|value| value.parse::<i32>().ok())
    } else {
        None
    };

    Some(Osc133Event {
        kind,
        exit_code,
        raw: body.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{Osc133Kind, Osc133Parser};

    #[test]
    fn parses_bel_terminated_events() {
        let mut parser = Osc133Parser::default();
        let events = parser.feed("hello\u{1b}]133;C\u{7}world\u{1b}]133;D;0\u{7}");

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, Osc133Kind::CommandExecutionStart);
        assert_eq!(events[1].kind, Osc133Kind::CommandFinished);
        assert_eq!(events[1].exit_code, Some(0));
    }

    #[test]
    fn parses_st_terminated_events_across_chunks() {
        let mut parser = Osc133Parser::default();

        assert!(parser.feed("\u{1b}]133").is_empty());
        let events = parser.feed(";A\u{1b}\\");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, Osc133Kind::PromptStart);
    }

    #[test]
    fn ignores_unknown_osc_133_commands() {
        let mut parser = Osc133Parser::default();
        let events = parser.feed("\u{1b}]133;X\u{7}");

        assert!(events.is_empty());
    }

    #[test]
    fn handles_multibyte_utf8_in_trim_unmatched_tail() {
        let mut parser = Osc133Parser::default();
        let events = parser.feed("Hello World! 🤖😊🚀 Quantum Code Terminal Test Stream with emojis 🤖");
        assert!(events.is_empty());
    }
}
