# Contributing to Glyph

Thanks for your interest in contributing to **Glyph**! 🖤

Glyph is an open-source terminal emulator focused on a modern UI, customizable workflows, and a native terminal experience.

Contributions are welcome — whether you're fixing a bug, improving the UI, optimizing the terminal backend, improving documentation, or proposing a new feature.

---

## Table of Contents

- [Before You Start](#before-you-start)
- [Development Requirements](#development-requirements)
- [Getting the Project](#getting-the-project)
- [Running Glyph](#running-glyph)
- [Project Architecture](#project-architecture)
- [Where Should I Make Changes?](#where-should-i-make-changes)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [New Features](#new-features)
- [Bug Reports](#bug-reports)
- [Security Issues](#security-issues)
- [Code Style](#code-style)
- [Terminal Compatibility](#terminal-compatibility)
- [Shell Integration](#shell-integration)
- [Documentation](#documentation)
- [Before Opening a Pull Request](#before-opening-a-pull-request)
- [License](#license)

---

## Before You Start

Before starting a large change, please check the existing:

- Issues
- Pull requests
- Feature requests

For major features, opening an issue first is recommended. This allows the direction and architecture to be discussed before significant implementation work begins.

---

## Development Requirements

Glyph currently targets **Linux** and is primarily tested on **Ubuntu**.

You will need:

- Ubuntu 24.04 or newer
- Node.js 22.12 or newer
- Rust (stable)
- Cargo
- Git

### Tauri Linux Dependencies

Install the common Tauri dependencies:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl \
  wget \
  file \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

---

## Getting the Project

Clone the repository:

```bash
git clone https://github.com/SARATHKUMAR-T/glyph.git
```

Enter the project:

```bash
cd glyph
```

Install frontend dependencies:

```bash
npm install
```

---

## Running Glyph

Start the Tauri development application:

```bash
npm run tauri:dev
```

For frontend-only development:

```bash
npm run dev
```

> **Note:** The browser-only Vite development server cannot provide a real PTY, since Tauri IPC is unavailable in a normal browser environment. For actual terminal development and testing, use `npm run tauri:dev`.

---

## Project Architecture

Glyph is split into a frontend application and a native Rust backend.

```
React / TypeScript
       │
       ▼
    xterm.js
       │
       │ Tauri IPC
       ▼
   Rust / Tauri
       │
       ▼
  TerminalManager
       │
       ▼
   portable-pty
       │
       ▼
   System Shell
```

### Frontend

The frontend lives under `src/` and contains:

- Application UI
- Tabs
- Panes
- Settings
- Keyboard shortcuts
- Terminal rendering (xterm.js integration)
- Styling

### Rust Backend

The native backend lives under `src-tauri/src/` and is responsible for:

- PTY creation
- Shell lifecycle
- Terminal input/output
- Session management
- Terminal resizing
- Tauri IPC commands
- OSC 133 parsing
- Native integration

---

## Where Should I Make Changes?

### UI / React

Look under `src/`, particularly:

- `src/app/`
- `src/components/`
- `src/hooks/`
- `src/lib/`
- `src/styles/`

Use these areas for UI changes, tabs, panes, settings, keyboard shortcuts, terminal rendering, frontend state, and styling.

### Terminal / PTY

Look under `src-tauri/src/terminal/`.

This is where terminal sessions, PTY handling, shell processes, and semantic terminal behavior are implemented. Changes related to PTY creation, shell processes, terminal sessions, terminal input/output, terminal lifecycle, and OSC 133 generally belong here.

### Tauri Commands

Look under `src-tauri/src/commands/`.

This is where frontend-to-Rust IPC commands are defined, for example:

- `create_terminal`
- `write_terminal`
- `resize_terminal`
- `close_terminal`
- `list_sessions`

When adding a new native capability that needs to be exposed to the frontend, this is one of the areas you may need to modify.

### Shell Integration

Look under `src-tauri/shell-integration/`.

This contains the Bash/Zsh integration used for OSC 133 semantic events. Shell integration changes should be tested carefully, since they interact with the user's shell startup environment.

### Styling

Frontend styling is primarily located under `src/styles/`.

Glyph uses CSS custom properties and modular CSS for its visual system. When changing the visual design, try to reuse existing design tokens rather than introducing unnecessary one-off values.

---

## Testing

Before submitting a pull request, run the relevant checks.

**TypeScript**

```bash
npm run typecheck
```

**Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

**Rust check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

**Production build**

For changes affecting packaging or native functionality:

```bash
npm run tauri build
```

### Manual Terminal Testing

When changing terminal functionality, test basic commands:

```bash
pwd
ls
cd /tmp
pwd
echo "hello"
printf "hello\n"
```

Test common system information commands:

```bash
node --version
npm --version
python3 --version
```

Test interactive applications where relevant:

```bash
vim
nano
less
top
```

Test terminal signals:

- `Ctrl+C`
- `Ctrl+D`
- `Ctrl+Z`

Also verify that:

- [ ] Input is forwarded correctly.
- [ ] Terminal output is rendered correctly.
- [ ] Terminal resizing works.
- [ ] Tabs create independent sessions.
- [ ] Panes maintain independent sessions.
- [ ] Closing a tab terminates its session correctly.
- [ ] Copy/paste works.
- [ ] Search works.
- [ ] Shell integration continues to work.

### UI Testing

For UI changes, verify the affected functionality manually, depending on the change:

- [ ] Tabs
- [ ] Panes
- [ ] Window resizing
- [ ] Settings
- [ ] Cursor customization
- [ ] Cursor blink
- [ ] UI styles
- [ ] Keyboard shortcuts
- [ ] Shortcut remapping
- [ ] Copy/paste
- [ ] Search
- [ ] Terminal resizing
- [ ] Matrix background settings
- [ ] Performance monitor

If the change affects the UI, include screenshots or a short screen recording in your pull request.

---

## Commit Messages

Use clear and concise commit messages. Prefer messages that describe the actual change.

**Good examples**

```
feat: add pane resize shortcuts
fix: preserve terminal cwd when creating tabs
fix: prevent terminal resize race
docs: update installation instructions
refactor: simplify terminal session manager
style: improve settings panel spacing
```

**Avoid**

```
fixed some stuff
changes
update
```

A useful commit message should make it possible to understand the purpose of the change without opening the commit.

---

## Pull Requests

When opening a pull request:

- Explain what changed.
- Explain why the change was needed.
- Describe how it was tested.
- Include screenshots for UI changes.
- Mention any breaking changes.
- Keep the pull request focused.

Avoid combining unrelated changes into a single pull request. For example, avoid a PR that simultaneously changes the terminal backend, redesigns the settings UI, changes keyboard shortcuts, and updates documentation — unless those changes are directly related.

Smaller, focused pull requests are easier to review and maintain.

---

## New Features

For significant features, please open an issue before implementing the feature. This helps ensure:

- The feature fits Glyph's direction.
- The proposed architecture is appropriate.
- Duplicate work is avoided.
- The implementation can be discussed before significant development begins.

For small improvements and obvious bug fixes, opening an issue first may not be necessary.

---

## Bug Reports

When reporting a bug, please include as much relevant information as possible:

- Glyph version
- Linux distribution and version
- Shell (bash, zsh, etc.)
- Steps to reproduce
- Expected behavior
- Actual behavior
- Relevant logs
- Screenshots or recordings when useful

**Example:**

```
Glyph version: v0.1.0
OS: Ubuntu 24.04
Shell: zsh
```

Then provide the exact steps that reproduce the problem.

---

## Security Issues

Please do not report security vulnerabilities through public GitHub issues.

Security vulnerabilities should be reported privately. See [`SECURITY.md`](./SECURITY.md) for the security reporting process.

---

## Code Style

Keep changes focused and consistent with the existing codebase.

### Frontend

- Prefer TypeScript.
- Follow existing React patterns.
- Reuse existing components and hooks where appropriate.
- Avoid unnecessary dependencies.
- Keep state management predictable.
- Preserve existing keyboard and terminal behavior.

### Rust

- Keep ownership and concurrency behavior explicit.
- Avoid blocking the UI/event path.
- Handle PTY errors carefully.
- Add tests where practical.
- Preserve terminal compatibility.
- Avoid unnecessary dependencies.
- Keep native operations isolated from frontend concerns where possible.

---

## Terminal Compatibility

Glyph is a terminal emulator, so changes affecting terminal input/output should be treated carefully.

Avoid making assumptions about terminal output being plain text. Terminal applications may use:

- ANSI escape sequences
- OSC sequences
- Cursor movement
- Alternate screen buffers
- Color sequences
- Control characters
- Interactive input

When modifying terminal behavior, test with both simple shell commands and interactive applications.

---

## Shell Integration

Glyph supports OSC 133 shell integration.

Changes to shell integration should be tested with the supported shells, especially:

- bash
- zsh

Do not modify a contributor's personal shell configuration automatically. Shell integration should remain opt-in and should not overwrite existing shell startup files.

---

## Documentation

Documentation improvements are always welcome, including:

- README improvements
- Installation instructions
- Architecture documentation
- Troubleshooting guides
- Screenshots
- Examples
- Developer documentation

When changing behavior, update the relevant documentation where appropriate.

---

## Before Opening a Pull Request

Please make sure you have:

- [ ] Tested the change locally.
- [ ] Run `npm run typecheck`.
- [ ] Run Rust tests where relevant.
- [ ] Run `cargo check` where relevant.
- [ ] Tested the affected terminal functionality.
- [ ] Tested affected UI functionality.
- [ ] Added screenshots for UI changes.
- [ ] Updated documentation where necessary.
- [ ] Checked that no secrets or `.env` files are committed.
- [ ] Kept the PR focused.

---

## License

By contributing to Glyph, you agree that your contributions will be licensed under the project's MIT License.

---

### Thank You

Thank you for taking the time to contribute to Glyph. 🖤

Whether you're fixing a small bug, improving the UI, optimizing the terminal backend, writing documentation, or suggesting an idea, your contribution helps make Glyph better.

Happy Glyphing!