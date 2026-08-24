# Nothing Terminal

A minimal Linux terminal emulator inspired by Nothing OS and block-oriented terminals.

This is a real terminal project: Rust owns the PTY and shell lifecycle, React owns the UI, and xterm.js owns terminal rendering and interactive application compatibility.

## Current Milestone

Implemented:

- Tauri 2 + React + TypeScript + Vite scaffold.
- Rust `TerminalManager` with managed sessions.
- Linux PTY spawning through `portable-pty`.
- `$SHELL` detection with `/bin/bash` fallback.
- Preserved base environment with `TERM=xterm-256color` and `COLORTERM=truecolor`.
- Tauri commands: `create_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`, `list_sessions`.
- Typed Tauri events: `terminal://output`, `terminal://exit`, `terminal://error`, `terminal://state`, `terminal://semantic`.
- xterm.js with Fit, Search, and WebGL fallback support.
- PTY resize propagation.
- Custom frameless title bar and scoped Tauri window permissions.
- Tabs where each tab owns a separate backend terminal session.
- Copy/paste handling for `Ctrl+Shift+C` and `Ctrl+Shift+V`.
- OSC 133 parser and sourceable bash/zsh integration snippets.
- Nothing Dark visual tokens, dot-grid background, and block metadata rail.

Not implemented yet:

- Full block command editor.
- Command text capture and reliable current-working-directory metadata.
- Persisted history/settings.
- Production packaging verification.

## Architecture

```text
React / TypeScript
  ├─ Terminal shell UI
  ├─ Tabs and block metadata
  └─ xterm.js renderer
        │
        ▼
Tauri IPC
        │
        ▼
Rust TerminalManager
  ├─ portable-pty master/slave
  ├─ shell process
  ├─ reader thread
  ├─ child wait thread
  └─ OSC 133 parser
```

The PTY remains the source of truth. React does not parse ANSI output or emulate terminal behavior.

## Requirements

- Ubuntu 24.04 or newer.
- Node.js 22.12 or newer.
- Rust stable with `cargo`.
- Tauri Linux system dependencies.

Common Ubuntu dependencies:

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Install Rust if it is missing:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Development

```bash
npm install
npm run tauri dev
```

Frontend-only preview:

```bash
npm run dev
```

The frontend-only preview renders the xterm surface but cannot attach a real PTY because Tauri IPC is unavailable in a browser tab.

## Checks

```bash
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## Shell Integration

OSC 133 block metadata is opt-in. Do not overwrite shell startup files.

Copy the snippets to a stable local location:

```bash
mkdir -p "$HOME/.local/share/nothing-terminal/shell-integration"
cp src-tauri/shell-integration/nothing-terminal.* "$HOME/.local/share/nothing-terminal/shell-integration/"
```

Then add this line manually to the shell profile you choose:

```bash
source "$HOME/.local/share/nothing-terminal/shell-integration/nothing-terminal.sh"
```

For zsh, command execution start uses `preexec`. For bash, command execution start is emitted when `bash-preexec` has already created `preexec_functions`; otherwise prompt start and command finish still work.

## Manual PTY Test Matrix

Run these inside the Tauri app:

```bash
pwd
ls
cd /tmp
pwd
echo "hello"
printf "hello\n"
git status
node --version
npm --version
python3 --version
```

Interactive smoke tests:

```bash
vim
nano
less README.md
top
```

Signals:

```text
Ctrl+C
Ctrl+D
Ctrl+Z
```

## Production

```bash
npm run tauri build
```

Production packaging should be performed only after the Rust checks, frontend typecheck, and manual PTY test matrix pass.
