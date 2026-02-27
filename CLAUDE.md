# hone-editor

## Project Overview
High-performance, cross-platform code editor surface published as `@honeide/editor`. Designed to be embeddable by other developers for markdown editors, config editors, query consoles, etc. Compiled to native binaries via **Perry** (TypeScript-to-native compiler, v0.2.x).

**Key constraint**: Perry's Canvas widget has no text-on-canvas capability. The editor uses custom Rust FFI crates per platform for native text rendering (Core Text on macOS/iOS, DirectWrite on Windows, Pango/Cairo on Linux, Skia on Android, DOM on Web).

## Tech Stack
- **Core logic**: TypeScript (platform-independent, shared across all 6 targets)
- **Native rendering**: Rust FFI crates (one per platform)
- **Syntax highlighting**: Lezer parser ecosystem (@lezer/*)
- **Build**: Perry compiler (`perry compile`)
- **Test runner**: `bun test`
- **Package manager**: Bun

## Architecture

```
core/           Platform-independent TypeScript
  buffer/       Piece table + B-tree rope text buffer (O(log n) ops)
  document/     EditorDocument, EditBuilder, encoding detection
  cursor/       Multi-cursor management, selections, word boundaries
  commands/     Command registry + editing/navigation/selection/clipboard/multicursor
  history/      Undo/redo with time-based coalescing
  viewport/     Virtual scrolling, line height cache, scroll controller
  tokenizer/    Lezer syntax highlighting for 10 languages
  search/       Literal + regex search/replace, incremental search
  folding/      Indent-based + syntax-based code folding
  diff/         Myers diff algorithm, inline char-level diff, hunk operations
  lsp-client/   LSP client: JSON-RPC transport, protocol types, capability negotiation
  dap-client/   DAP client: debug session lifecycle, breakpoints, stepping, variables
view-model/     Reactive state bridging core → rendering
  editor-view-model.ts   Central orchestrator, key bindings, mouse handling
  theme.ts               Dark + light themes, token color mappings
  line-layout.ts         RenderedLine computation
  cursor-state.ts        Blink controller, IME composition
  gutter.ts              Line numbers, fold indicators, breakpoints, diff markers
  find-widget.ts         Find/replace widget controller
  ghost-text.ts          AI ghost text inline completion
  minimap.ts             Minimap data generation
  overlays.ts            Autocomplete, hover, parameter hints, diagnostics overlays
  decorations.ts         Search highlights, selection, diagnostic underlines
  diff-view-model.ts     Side-by-side/inline diff view state
native/         Platform-specific Rust FFI crates (TODO)
  macos/        Core Text + Core Animation + Metal
  ios/          Core Text + UIKit (shares rendering with macOS)
  windows/      DirectWrite + Direct2D + DirectComposition
  linux/        Pango + Cairo + X11/Wayland
  android/      Canvas + Skia via JNI
  web/          DOM spans + CSS + WASM
tests/          Unit and integration tests
```

## Key Design Decisions
- **Text buffer**: Piece table with B-tree rope indexing — O(log n) for all offset/line operations
- **Line endings**: Always normalized to `\n` internally; original line ending style preserved in EditorDocument for saving
- **No external editor dependencies**: No CodeMirror, Monaco, prosemirror. Self-contained.
- **Edits are atomic**: EditBuilder collects edits, applies via `buffer.applyEdits()` in reverse offset order
- **Undo coalescing**: Single-character inserts/deletes within 500ms are grouped; newlines always start new groups
- **Multi-cursor**: Cursors sorted by position, merged when overlapping, desired column preserved across vertical movement
- **Virtual scrolling**: Only visible lines + 10-line buffer zone are rendered

## Cross-Platform Strategy
- `core/` and `view-model/` are 100% shared across all platforms
- macOS and iOS share Core Text rendering code
- Only `native/` Rust FFI crates are platform-specific
- FFI contract is identical across all platforms (same function signatures)

## Commands
Run tests: `bun test`
Run single test file: `bun test tests/buffer.test.ts`
Install deps: `bun install`

## Development Phases (from PROJECT_PLAN.md)

### Phase 0: Foundation — COMPLETE
Open a file, see monospace text, type, move cursor, undo/redo.
- [x] Piece table + rope B-tree (`core/buffer/`)
- [x] Line index with incremental updates
- [x] TextBuffer API (insert, delete, getText, getLine, applyEdits, snapshot/restore)
- [x] EditorDocument + EditBuilder + encoding detection (`core/document/`)
- [x] CursorManager with multi-cursor, word boundaries, selections (`core/cursor/`)
- [x] UndoManager with coalescing and inverse edits (`core/history/`)
- [x] ViewportManager with virtual scrolling (`core/viewport/`)
- [x] Command registry + all basic commands (`core/commands/`)
- [x] EditorViewModel central orchestrator (`view-model/`)
- [x] Theme system with dark + light themes
- [x] 128 tests passing across 5 test files

### Phase 1: Full Editor — COMPLETE
Full-featured editor, syntax highlighting, search, folding, diff.
- [x] Lezer parser integration for 10 languages (`core/tokenizer/`)
- [x] Search/replace engine with literal + regex + incremental search (`core/search/`)
- [x] Code folding — indent-based + syntax-based (`core/folding/`)
- [x] Diff engine — Myers algorithm, inline char diff, hunk merge/split/navigate (`core/diff/`)
- [x] Find/replace widget, ghost text, minimap, overlays, decorations (`view-model/`)
- [x] All Phase 1 subsystems wired into EditorViewModel
- [x] 210 tests passing across 9 test files
- [ ] macOS native FFI crate (`native/macos/`)
- [ ] Windows + Linux FFI crates

### Phase 2: Language Intelligence — COMPLETE
LSP and DAP integration for smart editor features.
- [x] JSON-RPC transport layer with Content-Length framing, request correlation, cancellation
- [x] LSP protocol types (positions, ranges, completion, hover, diagnostics, signature help, code actions, formatting)
- [x] LSP client with initialize lifecycle, document sync, completion, hover, definition, references, signature help, code actions, formatting
- [x] Capability negotiation and feature detection
- [x] DAP protocol types (breakpoints, stack frames, scopes, variables, threads)
- [x] DAP client with launch/attach, breakpoint management, execution control, stack inspection, variable inspection, evaluate
- [x] 249 tests passing across 11 test files

### Phase 3: All Platforms
- [ ] iOS, Android, Web FFI crates
