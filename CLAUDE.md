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
native/         Platform-specific rendering bridge + Rust FFI crates
  ffi-bridge.ts          NativeEditorFFI interface, NoOpFFI test impl
  render-coordinator.ts  Bridges EditorViewModel → FFI calls with dirty tracking
  touch-input.ts         Touch gesture handler (tap, pan, pinch, long press)
  word-wrap.ts           Word wrap computation + WrapCache
  index.ts               Barrel export
  macos/        Core Text + Core Animation + Metal (Rust)
  ios/          Core Text + UIKit (Rust, shares rendering with macOS)
  windows/      DirectWrite + Direct2D + DirectComposition (Rust)
  linux/        Pango + Cairo + X11/Wayland (Rust)
  android/      Canvas + Skia via JNI (Rust)
  web/          DOM spans + CSS + WASM (Rust)
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
- **HarmonyOS** (`native/harmonyos/`) is currently a no-op stub: every
  `hone_editor_*` symbol link-resolves so Perry-compiled apps embedding
  the editor load on the device, but the surface renders blank. Real
  ArkTS-side rendering (canvas + `@ohos.pasteboard` + IME) is a follow-up.

## Perry AOT Codegen Notes
Perry v0.4.14+ compiles standard TypeScript patterns correctly, including: `?.`, `??`, `for...of`,
ES6 shorthand `{ key }`, `array.push/indexOf/map` on class fields, `obj[variable]` dynamic keys,
`/regex/.test()`, character range comparisons, and `Array.sort()` with comparators (TimSort).

**Threading**: `parallelMap`, `parallelFilter`, `spawn` from `perry/thread` for data-parallel work.
The `core/utils/parallel.ts` shim provides sequential fallback for Bun tests.

**Module-level state**: Cursor position, undo stacks, and tokenization state use module-level
variables (not class fields) as a proven pattern for cross-function mutable state in Perry.

### Input Event Architecture (Perry mode)
Perry's AOT runtime does NOT fire `setInterval` or `requestAnimationFrame` after startup. C function
pointer callbacks into Perry-compiled code crash on ARM64 (W^X: Perry functions may be in
non-executable heap memory). This means:
- Rust NSView buffers all input events in `EditorView.pending_events`
- TypeScript's `_pollEvents()` RAF loop is registered but **never fires** after startup
- **Do NOT** call Perry-compiled functions via `event_callback` from Rust — it crashes
- The `hone_editor_set_event_callback` FFI exists but must remain unused in Perry mode
- All new FFI polling functions must be listed in `package.json` `perry.nativeLibrary.functions`

### Rust-Side Rendering (Perry mode) — macOS COMPLETE, other platforms TODO
Because Perry's RAF/timer loop never fires, TypeScript only renders **twice** at startup
(from `coordinator.attach()` and `vm.onResize()`). After that, the Rust FFI layer handles
ALL interaction directly by mutating `frame_lines` in place and calling `setNeedsDisplay`.

**What every platform's Rust crate must implement:**

1. **Rust-side tokenizer** — `native/macos/src/tokenizer.rs` is the reference implementation.
   After every `on_text_input` and `on_action deleteBackward`, call:
   ```rust
   self.frame_lines[idx].tokens = crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
   ```
   Do NOT call `tokens.clear()` without retokenizing — that causes the whole line to go gray
   permanently (default color with no spans). The tokenizer ports `keyword-syntax-engine.ts`
   logic to Rust: same keyword lists, same VS Code dark theme colors.

2. **Cursor positioning** — `on_mouse_down` must use `measure_text()` per-char prefix scan
   (not `char_width` division) to find the closest byte column to the click x position.
   After positioning, set `rust_sel_anchor = Some((line, col))` so drag immediately extends
   the selection. A plain click with no drag produces anchor == cursor (no visible selection).

3. **Mouse drag selection** — Register `mouseDragged:` (or platform equivalent) and call
   `on_mouse_drag(x, y)`. It repeats the hit-test logic from `on_mouse_down`, updates
   `rust_cursor_line`/`rust_col`/`cursor`, then calls `sync_selection_rects()`.
   `sync_selection_rects()` builds one `SelectionRegion` rect per visible line in the selection
   range, measured with `measure_text()` for pixel-accurate start/end x.

4. **Scroll clamping** — `on_scroll` uses `initial_top_y` (set on first `end_frame`) to bound
   `frame_lines[0].y_offset`. Without clamping, content drifts off-screen permanently.

5. **Line height inference** — TypeScript sends `lineHeightPx = fontSize * 1.5`. Rust's native
   font metrics (`CTFont.line_height`, `Pango.line_height`, etc.) differ. Infer the TypeScript
   line height from `frame_lines[1].y_offset - frame_lines[0].y_offset` after the first frame.
   Store this in a helper `ts_line_height()` — it's used by newline insert, backspace line-join,
   and multi-line selection delete.

6. **`sync_cursor_x` must also sync Y** — After any action that changes `rust_cursor_line`
   (newline, backspace line-join, up/down movement), the cursor's pixel y must be updated to
   `frame_lines[cursor_line_idx].y_offset`. Syncing only X leaves the cursor visually stuck on
   the wrong line. The macOS implementation handles this in `sync_cursor_x()`.

7. **Newline / backspace / selection delete** — `on_action` handles `insertNewline:`,
   `deleteBackward:`, `copy:`, `cut:`, `paste:`, `selectAll:`, and all movement selectors
   (including `moveXxxAndModifySelection:` variants). See `editor_view.rs` for the full
   reference implementation with `delete_selection_if_any()`, `get_selected_text()`,
   `write_to_clipboard()`, `read_from_clipboard()`, and `sync_selection_rects()`.

8. **`user_has_clicked` flag** — After a user click, set this flag to prevent TypeScript's two
   startup re-renders from overriding the Rust-managed cursor position.

9. **Event queue** — Implement `pending_events: Vec<PendingEvent>` with the same event type
   constants (TEXT=1, ACTION=2, SCROLL=3, MOUSE_DOWN=4) and FFI polling functions
   (`hone_editor_pending_event_count`, `hone_editor_get_event_*`, `hone_editor_clear_events`).
   These are polled by TypeScript's RAF loop on platforms where it does fire (web, potentially iOS).

**Platform status:**
- macOS: ✅ Complete — `native/macos/src/editor_view.rs` + `tokenizer.rs`
- iOS: ⬜ Shares Core Text with macOS — needs `tokenizer.rs` port + same EditorView patterns
- Windows: ⬜ DirectWrite — needs `tokenizer.rs` port + same EditorView patterns
- Linux: ⬜ Pango/Cairo — needs `tokenizer.rs` port + same EditorView patterns
- Android: ⬜ Canvas/Skia JNI — needs `tokenizer.rs` port + same EditorView patterns
- Web: ✅ TypeScript DOM renderer at `native/web/dom-ffi.ts`. No Rust crate — Perry's
  web target compiles the editor TS to WASM and imports JS-side `hone_editor_*`. Find
  highlights / diagnostics / breakpoints / fold ranges render as DOM overlay layers.
  Syntax highlighting works structurally but token COLORS are blocked on Perry
  PerryTS/perry#1071 (cross-module nested-object access returns `undefined`). Build:
  `bun run examples/web/build.ts` → `examples/web/dist/{hone-editor.wasm, hone-editor.js, index.html}`.

## Commands
Run tests: `bun test`
Run single test file: `bun test tests/buffer.test.ts`
Run benchmarks: `bun run tests/benchmarks/keystroke-latency.ts`
Install deps: `bun install`
Build (Perry): `perry compile core/index.ts --target macos --bundle-ffi native/macos/`
Build macOS crate: `cd native/macos && cargo build`
Run macOS interactive demo: `cd native/macos && cargo run --example demo_editor`
Build Windows crate: `cd native/windows && cargo build`
Run Windows interactive demo: `cd native/windows && cargo run --example demo_editor`
Run iOS interactive demo: `cd native/ios && cargo run --example demo_editor_ios`
Run Android interactive demo: `cd native/android && bash run-demo.sh`
Build for web: `bun run examples/web/build.ts` — produces `examples/web/dist/{hone-editor.wasm, hone-editor.js, index.html}`. The build orchestrates: (1) `perry compile examples/web/entry.ts --target web --output hone-editor.wasm` for the raw WASM; (2) a second Perry compile to .html to extract the JS runtime bridge; (3) bundles `native/web/dom-ffi.ts` + the bridge + a `mount()` API into `hone-editor.js`. Consumers: `import { mount } from './hone-editor.js'; await mount(document.getElementById('editor'));`

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

### Phase 2: Language Intelligence — COMPLETE
LSP and DAP integration for smart editor features.
- [x] JSON-RPC transport layer with Content-Length framing, request correlation, cancellation
- [x] LSP protocol types (positions, ranges, completion, hover, diagnostics, signature help, code actions, formatting)
- [x] LSP client with initialize lifecycle, document sync, completion, hover, definition, references, signature help, code actions, formatting
- [x] Capability negotiation and feature detection
- [x] DAP protocol types (breakpoints, stack frames, scopes, variables, threads)
- [x] DAP client with launch/attach, breakpoint management, execution control, stack inspection, variable inspection, evaluate
- [x] 249 tests passing across 11 test files

### Phase 3: All Platforms — COMPLETE
Native FFI bridge, render coordinator, touch input, word wrap, all 6 platform Rust crates.
- [x] FFI bridge TypeScript abstraction (`native/ffi-bridge.ts`) with NativeEditorFFI interface and NoOpFFI test implementation
- [x] NativeRenderCoordinator: converts EditorViewModel state to FFI calls with dirty tracking, frame batching
- [x] Touch input handler: single/double/triple tap, long press, pan scroll with momentum, pinch zoom
- [x] Word wrap engine: none/word/bounded modes, WrapCache with binary-search break finding, CJK support
- [x] macOS Rust FFI crate: Core Text text renderer, NSView input handling (keyboard/mouse/scroll/context menu), EditorView with callbacks, interactive demo
- [x] iOS Rust FFI crate: Core Text rendering (shared with macOS), UIKit integration, touch handler, interactive demo
- [x] Windows Rust FFI crate: DirectWrite + Direct2D rendering, Win32 input handling, interactive demo
- [x] Linux Rust FFI crate: Pango + Cairo scaffolding
- [x] Android Rust FFI crate: Canvas/Skia via JNI, Kotlin demo app, interactive demo
- [x] Web Rust FFI crate: Canvas-based rendering, pure HTML/JS interactive demo
- [x] 293 tests passing across 12 test files

### Post-Phase: Polish & Packaging — COMPLETE
Examples, benchmarks, Perry config, package v0.2.0.
- [x] Perry configuration (`perry.config.ts`): all 6 targets with FFI crate paths, arch, frameworks
- [x] Example: minimal editor (`examples/minimal/`)
- [x] Example: markdown editor with preview (`examples/markdown-editor/`)
- [x] Example: side-by-side diff viewer (`examples/diff-viewer/`)
- [x] Benchmark: keystroke-to-render latency (`tests/benchmarks/keystroke-latency.ts`)
- [x] Benchmark: large file open — 10K/50K/100K lines (`tests/benchmarks/large-file-open.ts`)
- [x] Benchmark: scroll throughput FPS (`tests/benchmarks/scroll-perf.ts`)
- [x] Missing Rust modules: metal_blitter.rs (macOS), compositor.rs (Windows/Linux), input_handler.rs (Android), selection_overlay.rs (Web)
- [x] Package version bumped to v0.2.0
