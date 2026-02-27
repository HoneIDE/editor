# Hone Editor

High-performance, cross-platform code editor surface. Designed to be embedded by other applications — markdown editors, config editors, query consoles, or full IDEs.

All editor logic is written in TypeScript and shared across every platform. Native text rendering is handled by per-platform Rust FFI crates using each OS's native text stack.

## Features

- **Piece table text buffer** with B-tree rope indexing — O(log n) for all operations
- **Multi-cursor editing** with selections, word boundaries, and cursor merging
- **Syntax highlighting** for 10 languages via Lezer (TypeScript, JavaScript, HTML, CSS, JSON, Python, Rust, C++, Markdown, and more)
- **Search and replace** — literal, regex, case-sensitive, whole-word, incremental
- **Code folding** — indent-based and syntax-based
- **Undo/redo** with time-based coalescing
- **Virtual scrolling** — only visible lines are rendered
- **Word wrap** — none, word-boundary, or bounded column modes
- **Diff engine** — Myers algorithm with inline character-level diffs and hunk operations
- **LSP client** — completion, hover, go-to-definition, references, diagnostics, formatting
- **DAP client** — breakpoints, stepping, stack inspection, variable evaluation
- **Ghost text** — inline AI completion rendering
- **Minimap**, **find/replace widget**, **autocomplete overlays**, **diagnostic decorations**

## Platform Support

| Platform | Text Rendering | Status |
|----------|---------------|--------|
| macOS | Core Text + Core Animation | Working (interactive demo) |
| iOS | Core Text + UIKit | Scaffolded |
| Windows | DirectWrite + Direct2D | Working (interactive demo) |
| Linux | Pango + Cairo | Scaffolded |
| Android | Canvas + Skia (JNI) | Scaffolded |
| Web | DOM + CSS + WASM | Scaffolded |

## Architecture

```
core/               Platform-independent TypeScript (shared across all targets)
  buffer/           Piece table + B-tree rope text buffer
  document/         EditorDocument, EditBuilder, encoding detection
  cursor/           Multi-cursor management, selections, word boundaries
  commands/         Command registry + editing/navigation/selection/clipboard
  history/          Undo/redo with time-based coalescing
  viewport/         Virtual scrolling, line height cache
  tokenizer/        Lezer syntax highlighting
  search/           Search/replace engine
  folding/          Code folding
  diff/             Myers diff, inline char diff, hunk operations
  lsp-client/       LSP client (JSON-RPC transport, protocol types)
  dap-client/       DAP client (debug sessions, breakpoints, stepping)

view-model/         Reactive state bridging core -> rendering
  editor-view-model.ts    Central orchestrator
  theme.ts                Dark + light themes
  gutter.ts               Line numbers, fold indicators, breakpoints
  find-widget.ts          Find/replace controller
  ghost-text.ts           AI inline completions
  minimap.ts              Minimap data
  overlays.ts             Autocomplete, hover, parameter hints
  decorations.ts          Search highlights, selections, diagnostics

native/             Platform-specific rendering (Rust FFI crates)
  macos/            Core Text + NSView + Metal
  ios/              Core Text + UIKit
  windows/          DirectWrite + Direct2D + DirectComposition
  linux/            Pango + Cairo
  android/          Canvas + Skia via JNI
  web/              DOM + WASM (wasm-bindgen)
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (package manager and test runner)
- [Rust](https://rustup.rs) (for native crates)

### Install and Test

```bash
bun install
bun test
```

### Run the macOS Demo

```bash
cd native/macos
cargo run --example demo_editor
```

Opens a window with a fully interactive editor — type, navigate with arrow keys, select with Shift+arrows, copy/paste with Cmd+C/V, scroll, right-click context menu.

### Run the Windows Demo

```bash
cd native/windows
cargo run --example demo_editor
```

Opens a window with a fully interactive editor — type, navigate with arrow keys, select with Shift+arrows, copy/paste with Ctrl+C/V, scroll, right-click context menu.

## Design Decisions

- **No external editor dependencies** — no CodeMirror, Monaco, or ProseMirror. Fully self-contained.
- **Edits are atomic** — EditBuilder collects changes and applies them in reverse offset order.
- **Line endings normalized** to `\n` internally; original style preserved for saving.
- **Virtual scrolling** — only visible lines plus a 10-line buffer zone are rendered.
- **Identical FFI contract** across all platforms — same function signatures, platform crates are interchangeable.

## License

MIT
