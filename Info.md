# Glyph Terminal - Project Overview & Technical Architecture

**Glyph** is a modern, Nothing OS-inspired Linux desktop terminal emulator built with high-performance desktop technologies (Tauri v2, Rust, React 19, TypeScript, xterm.js, and portable-pty).

---

## 🛠️ Stack & Technologies Used

### Frontend Architecture
- **Framework**: React 19 (`react`, `react-dom`)
- **Language**: TypeScript (`^5.0`)
- **Build Tool / Bundler**: Vite 8 (`vite`)
- **Terminal Emulator Core**:
  - `@xterm/xterm` (v6.0) - High-performance canvas-based terminal rendering engine
  - `@xterm/addon-fit` - Auto-calculates row and column dimensions according to container bounds
  - `@xterm/addon-search` - In-memory scrollback buffer search
  - `@xterm/addon-webgl` - Hardware-accelerated WebGL rendering
- **State Management & Hooks**: Custom React hooks (`useTerminalSession`, `useTerminalBlocks`, `useTerminalSettings`, `useKeybindings`, `useKeyboardShortcuts`)

### Backend & Native Integration (Rust / Tauri v2)
- **Desktop Framework**: Tauri v2 (`tauri` v2.11, `@tauri-apps/api`)
- **PTY Engine**: `portable-pty` (v0.9) - Native Pseudo-Terminal allocation and shell management
- **Native Plugins**: `@tauri-apps/plugin-clipboard-manager` (`tauri-plugin-clipboard-manager`) - Secure cross-platform system clipboard access
- **Concurrency & Serialization**: `serde`, `serde_json`, `uuid` v4, Rust `std::sync::{Arc, Mutex}` and OS thread pools

### Design & Styling System
- **Styling Paradigm**: Modular Vanilla CSS with CSS Custom Properties (Variables)
- **Theme Concept**: Nothing OS aesthetics — industrial monochrome palette, subtle background dot matrix patterns, glowing red highlights (`#ff3030`), dot-matrix typography, and glassmorphism.
- **Canvas Animations**: HTML5 Canvas 2D engine (`MatrixDotBackground.tsx`) for dynamic background particle field rendering with interactive cursor light diffusion.

---

## 🔄 System Flow & Architecture

```mermaid
sequenceDiagram
    participant FE as React Frontend (xterm.js)
    participant IPC as Tauri IPC Bridge
    participant Backend as Rust Backend (Manager)
    participant PTY as Linux PTY / Shell (/bin/bash)

    %% Session Creation
    FE->>IPC: invoke("create_terminal", { cols, rows, cwd })
    IPC->>Backend: create_terminal(request)
    Backend->>Backend: Resolve CWD (e.g., /proc/{pid}/cwd)
    Backend->>PTY: spawn_shell() via portable-pty
    PTY-->>Backend: SpawnedPty (master, reader, writer, pid)
    Backend->>Backend: Spawn Reader & Waiter Threads
    Backend-->>FE: TerminalSessionInfo (sessionId, shell, cols, rows, cwd, pid)

    %% Output Flow
    loop PTY Reader Thread
        PTY->>Backend: Read stdout/stderr bytes
        Backend->>Backend: Parse OSC 133 Shell Integration
        Backend->>IPC: emit("terminal:output") & emit("terminal:semantic")
        IPC->>FE: listenTerminalOutput() & listenTerminalSemantic()
        FE->>FE: xterm.write(data)
    end

    %% Input Flow
    FE->>FE: Keypress / Paste Event in xterm
    FE->>IPC: invoke("write_terminal", { sessionId, data })
    IPC->>Backend: write_terminal(&session_id, bytes)
    Backend->>PTY: Write bytes to PTY stdin
```

### Key Workflow Breakdown

1. **Terminal Session Lifecycle**:
   - When a user opens a new tab, `addTerminal()` asynchronously queries the current active process's working directory (`/proc/{pid}/cwd` via Rust) to ensure directory inheritance.
   - Frontend calls `create_terminal` IPC, passing viewport columns, rows, and optional initial CWD.
   - The Rust backend allocates a PTY master/slave pair using `portable-pty` and launches the default shell (e.g. `/bin/bash`).
   - Rust spawns a background thread dedicated to reading stdout/stderr streams from the master PTY.

2. **Data Streaming & Shell Integration**:
   - The reader thread parses raw byte streams for ANSI escape sequences and **OSC 133** shell integration events (`PromptStart`, `CommandExecutionStart`, `CommandFinished`).
   - Events and output chunks are emitted to the webview asynchronously via Tauri events (`terminal:output`, `terminal:semantic`).
   - The React frontend receives output and renders it via xterm.js while building structured execution blocks.

3. **Input Handling & Clipboard**:
   - Keyboard events inside xterm.js pass through custom keybinding interceptors (`matchesKeyCombo`).
   - Shortcut actions (Copy, Paste, New Tab, Close Tab, Find) are captured.
   - **Paste**: Directly fetches text via the native `tauri-plugin-clipboard-manager` to bypass browser sandbox limitations.
   - **Select All**: Grep regex matches prompt terminators (`$ `, `# `, `% `, `> `) to select only the active user command input.
   - Standard user input is forwarded back to Rust PTY stdin via `write_terminal` IPC.

4. **Window Management & Frameless Chrome**:
   - Configured with `"decorations": false` in `tauri.conf.json`.
   - Custom `TitleBar` handles window dragging (`data-tauri-drag-region`) and window controls (minimize, maximize, close).
   - Custom `WindowResizeHandles` component allows multi-directional window resizing.
   - Native dark canvas color (`#040406`) prevents white flash artifacts during window resizing.

---

## 🎨 Styles & Design System

### 1. Color Palette (`src/styles/nothing.css`)
| Token Name | Hex / Value | Usage |
|---|---|---|
| `--nothing-black` | `#000000` | Pure dark background surfaces |
| `--nothing-surface` | `#0d0d0d` | Secondary container backgrounds |
| `--nothing-surface-raised` | `#141414` | Elevates panels, dropdowns, and cards |
| `--nothing-white` | `#ffffff` | Primary text and bright icons |
| `--nothing-gray-100` | `#f5f5f5` | Standard body text |
| `--nothing-gray-300` | `#b3b3b3` | Muted secondary labels |
| `--nothing-gray-500` | `#777777` | Subtle borders, inactive elements |
| `--nothing-red` | `#d71921` | Error states and warnings |
| `--nothing-red-bright` | `#ff3030` | Core accent, glowing cursors, active states |

### 2. Typography
- **Primary Monospace**: `"Lettera Mono"`, `"JetBrains Mono"`, `"SFMono-Regular"`, `"Cascadia Mono"`, `"Liberation Mono"`, `monospace`
- Dotted aesthetics applied via uppercase dot-matrix headers and sleek letter-spacing.

### 3. Custom Visual Effects (`src/styles/terminal.css`)
- **Glowing Red Cursor**: Animated glowing bar/block cursor with `filter: drop-shadow(0 0 5px rgba(255, 48, 48, 0.85))` and pulse animations.
- **Thin Glow Scrollbars**: Custom 5px thin WebKit scrollbars styled with translucent red thumbs on hover (`rgba(255, 48, 48, 0.45)`).
- **Matrix Background Engine**: Canvas-based reactive dot grid rendering custom matrix effects (Matrix rain, subtle grid, dynamic mouse glow).

---

## 📁 Key File Structure

```
glyph/
├── src/                         # React Frontend Source
│   ├── app/
│   │   └── App.tsx              # Main App layout, shortcut handling, tab management
│   ├── components/
│   │   ├── settings/            # Settings modal & keybindings remap UI
│   │   ├── tabs/                # Tab bar & tab item component
│   │   ├── terminal/            # TerminalView, xterm host wrapper, Matrix background
│   │   └── window/              # Custom frameless TitleBar & WindowResizeHandles
│   ├── hooks/                   # Custom hooks for PTY session, shortcuts, settings
│   ├── lib/
│   │   └── terminal/            # xterm setup, Tauri event listeners, types
│   └── styles/
│       ├── nothing.css          # Design tokens, global UI styles, controls
│       └── terminal.css         # xterm theme overrides, glowing cursors, scrollbar
├── src-tauri/                   # Rust Tauri Desktop Backend
│   ├── capabilities/            # Tauri security permissions (clipboard, windowing)
│   ├── src/
│   │   ├── commands/            # Tauri IPC command definitions
│   │   ├── terminal/            # PTY spawner, session manager, OSC 133 parser
│   │   ├── lib.rs               # App entrypoint & plugin registration
│   │   └── main.rs              # Binary main executable
│   └── tauri.conf.json          # Tauri app manifest & window configuration
└── package.json                 # Node dependencies & scripts
```
