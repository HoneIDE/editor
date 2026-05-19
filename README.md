# Hone Editor

High-performance, cross-platform code editor surface. Designed to be embedded by other applications — markdown editors, config editors, query consoles, or full IDEs.

All editor logic is written in TypeScript and shared across every platform. Native text rendering is handled by per-platform Rust FFI crates using each OS's native text stack.

## Features

- **Piece table text buffer** with B-tree rope indexing — O(log n) for all operations
- **Multi-cursor editing** with selections, word boundaries, and cursor merging
- **Syntax highlighting** via two engines:
  - **Tree-sitter** on macOS/iOS/web (via web-tree-sitter on web) for TypeScript, JavaScript, Python, Rust, JSON, CSS
  - **Keyword tokenizer** fallback for 20+ languages — no grammar needed
- **Bracket-pair colorization** — three-color VS Code-style cycle
- **Search and replace** — literal, regex, case-sensitive, whole-word, incremental
- **Code folding** — indent-based and syntax-based
- **Undo/redo** with time-based coalescing
- **Virtual scrolling** — only visible lines are rendered
- **Word wrap** — none, word-boundary, or bounded column modes
- **Diff engine** — Myers algorithm with inline character-level diffs and hunk operations
- **LSP client** — completion, hover, go-to-definition, references, diagnostics, formatting
- **DAP client** — breakpoints, stepping, stack inspection, variable evaluation
- **Ghost text** — inline AI completion rendering
- **Overlay layers** — find highlights, Error Lens diagnostics, breakpoint gutter, fold chevrons, decorations
- **Minimap**, **find/replace widget**, **autocomplete overlays**

## Platform Support

| Platform | Renderer | Renderer language | Status |
|----------|---------|---|--------|
| macOS | Core Text + Core Animation | Rust | Working (interactive demo) |
| iOS | Core Text + UIKit | Rust | Working (interactive demo) |
| Windows | DirectWrite + Direct2D | Rust | Working (interactive demo) |
| Linux | Pango + Cairo | Rust | Scaffolded |
| Android | Canvas + Skia (JNI) | Rust | Working (interactive demo) |
| Web | DOM | TypeScript | **Working — `mount()` API, tree-sitter, full overlays** |

On every platform the editor is a single TypeScript codebase compiled by [Perry](https://github.com/PerryTS/perry); each platform provides a "dumb renderer" that implements the same `hone_editor_*` FFI contract against its native rendering primitive. On the web the rendering primitive is the DOM, so that renderer is also TypeScript (see `native/web/dom-ffi.ts`).

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

native/             Platform-specific renderers — implement hone_editor_* against the platform's rendering primitive
  macos/            Rust:       Core Text + NSView + Metal
  ios/              Rust:       Core Text + UIKit
  windows/          Rust:       DirectWrite + Direct2D + DirectComposition
  linux/            Rust:       Pango + Cairo
  android/          Rust:       Canvas + Skia via JNI
  web/              TypeScript: DOM (no Rust crate — Perry's web target compiles
                                the editor itself to WASM and imports JS FFI)
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

### Run the Web Demo

```bash
bun run examples/web/build.ts
python3 -m http.server -d examples/web/dist 8765
open http://localhost:8765/index.html
```

Produces in `examples/web/dist/`:

- `hone-editor.wasm` (~1.4 MB) — editor TypeScript compiled to WebAssembly via Perry
- `hone-editor.js` (~340 KB) — Perry runtime bridge + DOM FFI + tree-sitter bridge + `mount()` API
- `index.html` — minimal consumer page
- `tree-sitter.wasm` + per-language grammar wasms (TypeScript, JavaScript, Python, Rust, JSON, CSS)

### Use from a web project

```js
import { mount } from './hone-editor.js';

const ed = await mount(document.getElementById('editor'), {
  content: '// your code here',
  language: 'typescript',     // typescript, javascript, python, rust, json, css, markdown, …
  theme: 'dark',              // 'dark' | 'light'
  fontSize: 14,
  fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
  readOnly: false,
  treeSitter: true,           // tree-sitter parsing (default: keyword tokenizer only)
});

// The returned controller drives the overlay layers:
ed.setFindHighlights('[{"line":2,"col":13,"len":6,"current":1}]');
ed.setLineDiagnostics('5:1:#f87171:type error message\n');     // line:severity:color:message
ed.setBreakpoints('3\n7');                                       // newline-separated 1-based lines
ed.setFoldRanges('5:0\n10:1');                                   // line:collapsed pairs
ed.clearFindHighlights();
ed.clearDiagnostics();
```

The TypeScript editor runs in WebAssembly; `mount()` wires the Perry-emitted bridge to the DOM renderer in `native/web/dom-ffi.ts` and to the web-tree-sitter bridge in `native/web/tree-sitter-bridge.ts`. The renderer is the exact analog of the per-platform Rust crates everywhere else — same `hone_editor_*` FFI contract, DOM as the platform's rendering primitive.

See `examples/web/` for the full build pipeline and `examples/web/entry.ts` for the Perry-side entry point.

### Run the Android Demo

```bash
cd native/android
bash run-demo.sh
```

Builds the Rust JNI library, installs the Kotlin demo app on an Android emulator, and launches a fully interactive editor.

### Run the iOS Demo

```bash
cd native/ios
cargo run --example demo_editor_ios
```

Launches a fully interactive editor in the iOS Simulator with touch input, soft keyboard, and syntax highlighting.

## Consuming the native crates from npm

The npm tarball ships every native rendering crate's Rust source so consumers
can build them as part of their Perry-AOT pipeline. Two prerequisites apply
until upstream Perry work lands — see [`native/NATIVE_CRATES.md`](native/NATIVE_CRATES.md)
for the full story:

1. `perry-ffi` is currently an unpublished workspace crate inside Perry's
   monorepo. Either keep a Perry checkout next to your project, or add a
   `[patch.crates-io]` in your workspace root pointing at it. Tracking issue:
   [PerryTS/perry#1112](https://github.com/PerryTS/perry/issues/1112).
2. Each crate's `Cargo.toml` declares `[[example]]` blocks; the `examples/`
   directory is shipped as of `0.3.1`.

The **web target** doesn't need any of this — it compiles TypeScript → WASM
via Perry and the renderer is TypeScript, so there's no Rust crate to build.

## Design Decisions

- **No external editor dependencies** — no CodeMirror, Monaco, or ProseMirror. Fully self-contained.
- **Edits are atomic** — EditBuilder collects changes and applies them in reverse offset order.
- **Line endings normalized** to `\n` internally; original style preserved for saving.
- **Virtual scrolling** — only visible lines plus a 10-line buffer zone are rendered.
- **Identical FFI contract** across all platforms — same function signatures, platform crates are interchangeable.

## License

MIT
