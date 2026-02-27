# hone-editor — Project Plan

## 1. Overview

The **hone-editor** is the crown jewel of the Hone ecosystem: a standalone, reusable, high-performance code editing surface. It is published as `@honeide/editor` and designed to be embeddable by other developers for markdown editors, config editors, query editors, database query consoles, and any scenario requiring a rich code editing experience.

The editor is compiled to native binaries via **Perry** (TypeScript-to-native binary compiler, v0.2.162). Perry provides `perry/ui` widgets (VStack, HStack, Text, Button, Canvas, ScrollView, etc.), `perry/system` (clipboard, file dialogs, keyboard shortcuts), `State()` reactive bindings, and targets macOS, iOS, Android, Windows, Linux, and Web.

**Key architectural decision:** Perry's Canvas widget has basic drawing primitives (move_to, line_to, stroke, fill_gradient) but **no text-on-canvas capability**. Perry's Text widget is a basic platform label (NSTextField/STATIC/GtkLabel) — not suitable for code editor rendering where glyph-level positioning, ligatures, token coloring, and sub-pixel anti-aliasing are required. The solution is **custom Perry FFI crates** (Rust) that expose platform-native text rendering APIs, giving the editor direct access to Core Text (macOS/iOS), DirectWrite (Windows), Pango/Cairo (Linux), Skia (Android), and DOM (Web).

---

## 2. Dependencies

### Internal
- `@honeide/api` — types only (EditorCommand, DiagnosticSeverity, CompletionItem, etc.). No runtime dependency.

### External
- `@lezer/common` — Lezer parser runtime (Tree, TreeCursor, NodeType)
- `@lezer/highlight` — syntax highlighting integration (highlightTree, tags)
- `@lezer/generator` — grammar compilation (dev dependency only)
- `@lezer/javascript` — JavaScript/TypeScript grammar
- `@lezer/html` — HTML grammar
- `@lezer/css` — CSS grammar
- `@lezer/json` — JSON grammar
- `@lezer/markdown` — Markdown grammar
- `@lezer/python` — Python grammar
- `@lezer/rust` — Rust grammar
- `@lezer/cpp` — C/C++ grammar
- Community Lezer grammar for Go (or custom)
- Community Lezer grammar for YAML (or custom)

### No other runtime dependencies
The editor is self-contained. No CodeMirror, no Monaco, no prosemirror, no external text rendering libraries on the TypeScript side. All platform rendering is handled by the native FFI crates.

---

## 3. Repository Structure

```
hone-editor/
├── core/
│   ├── buffer/
│   │   ├── rope.ts                 # Rope data structure (piece table variant with B-tree indexing)
│   │   ├── piece-table.ts          # Piece table primitives: original buffer + add buffer + piece descriptors
│   │   ├── text-buffer.ts          # High-level TextBuffer API wrapping rope internals
│   │   └── line-index.ts           # Line-start-offset index, maintained incrementally on edits
│   ├── document/
│   │   ├── document.ts             # EditorDocument: uri, buffer, languageId, version, isDirty, encoding
│   │   ├── edit-builder.ts         # Transaction builder for atomic multi-edit operations
│   │   └── encoding.ts             # File encoding detection (UTF-8, UTF-16 LE/BE, ISO-8859-1) and conversion
│   ├── cursor/
│   │   ├── cursor-manager.ts       # Multi-cursor management: primary cursor, secondary cursors, cursor merging
│   │   ├── selection.ts            # Selection range representation, normalization, merging overlapping selections
│   │   └── word-boundary.ts        # Unicode-aware word boundary detection (UAX #29 simplified)
│   ├── commands/
│   │   ├── registry.ts             # Command registry: maps string command IDs to handler functions
│   │   ├── editing.ts              # Editing commands: insert, delete, backspace, indent, outdent, toggle comment
│   │   ├── navigation.ts           # Navigation: move by char/word/line/page, go to line, go to matching bracket
│   │   ├── selection-cmds.ts       # Selection: select word, select line, select all, expand/shrink selection
│   │   ├── clipboard.ts            # Clipboard: copy, cut, paste (uses perry/system clipboard API)
│   │   └── multicursor.ts          # Multi-cursor commands: add cursor above/below, select all occurrences, Ctrl+D
│   ├── search/
│   │   ├── search-engine.ts        # Literal and regex search across the buffer, match result collection
│   │   ├── replace.ts              # Replace and replace-all with capture group support
│   │   └── incremental.ts          # Incremental search: updates matches on buffer changes and query changes
│   ├── history/
│   │   ├── undo-manager.ts         # Undo/redo stack management with time-based coalescing
│   │   └── operation.ts            # Operation type: array of TextEdits + cursor state before/after
│   ├── folding/
│   │   ├── fold-provider.ts        # Fold range computation: indent-based and syntax-based (Lezer tree)
│   │   └── fold-state.ts           # FoldState: map of lineNumber -> collapsed/expanded, fold/unfold methods
│   ├── tokenizer/
│   │   ├── syntax-engine.ts        # Lezer parser integration: parse, incremental re-parse, tree query
│   │   ├── token-theme.ts          # Token-to-theme-color mapping: resolve Lezer tags to editor theme colors
│   │   ├── incremental.ts          # Incremental tokenization: per-line token cache, invalidation on edit
│   │   └── grammars/
│   │       ├── typescript.ts       # TypeScript/JavaScript grammar setup (re-exports @lezer/javascript)
│   │       ├── html.ts             # HTML grammar setup
│   │       ├── css.ts              # CSS grammar setup
│   │       ├── json.ts             # JSON grammar setup
│   │       ├── markdown.ts         # Markdown grammar setup
│   │       ├── python.ts           # Python grammar setup
│   │       ├── rust.ts             # Rust grammar setup
│   │       ├── go.ts               # Go grammar setup
│   │       ├── cpp.ts              # C/C++ grammar setup
│   │       └── yaml.ts             # YAML grammar setup
│   ├── diff/
│   │   ├── diff-model.ts           # DiffResult, DiffHunk types with accept/reject state for AI edits
│   │   ├── diff-compute.ts         # Myers diff algorithm implementation (O((N+M)D) time)
│   │   ├── hunk.ts                 # Hunk operations: merge adjacent hunks, split hunks, hunk navigation
│   │   └── inline-diff.ts          # Character-level inline diff within changed lines
│   ├── lsp-client/
│   │   ├── client.ts               # Lightweight LSP client: JSON-RPC over stdio, request/response/notification
│   │   ├── protocol.ts             # LSP protocol types: CompletionItem, Hover, Diagnostic, etc.
│   │   └── capabilities.ts         # Capability negotiation and feature detection
│   ├── dap-client/
│   │   ├── client.ts               # Debug Adapter Protocol client: launch, attach, breakpoints, stepping
│   │   └── protocol.ts             # DAP protocol types: StackFrame, Variable, Breakpoint, etc.
│   ├── viewport/
│   │   ├── viewport-manager.ts     # Virtual scrolling: compute visible line range, buffer zone above/below
│   │   ├── scroll.ts               # Smooth scrolling, momentum scrolling, scroll-to-reveal logic
│   │   └── line-height.ts          # Line height cache: uniform height for most lines, variable for wrapped/code-lens
│   └── index.ts                    # Core barrel export: re-exports all public APIs from core/
├── view-model/
│   ├── editor-view-model.ts        # Main ViewModel: bridges core state to rendering state, reactive via State()
│   ├── line-layout.ts              # Compute rendered lines: apply folding, wrapping, decorations to buffer lines
│   ├── cursor-state.ts             # Cursor rendering state: blink timer, cursor style, IME composition state
│   ├── gutter.ts                   # Gutter rendering: line numbers, fold indicators, breakpoint icons, diff markers
│   ├── minimap.ts                  # Minimap data: downscaled line color blocks, viewport indicator, click-to-scroll
│   ├── overlays.ts                 # Overlay state: autocomplete popup, hover tooltip, parameter hints, diagnostics popup
│   ├── scroll-state.ts             # Scroll position state: scrollTop, scrollLeft, max scroll bounds
│   ├── decorations.ts              # Decoration types: inline (bold, color), line (background), margin (icons)
│   ├── find-widget.ts              # Find/replace widget state: query, matches, current match index, replace text
│   ├── diff-view-model.ts          # Diff view: side-by-side or inline, hunk navigation, accept/reject UI state
│   ├── ghost-text.ts               # AI ghost text: inline completion preview, accept/reject/partial-accept
│   └── theme.ts                    # Theme system: color tokens, font settings, resolved colors for all UI elements
├── native/
│   ├── macos/
│   │   ├── Cargo.toml              # Rust crate manifest for macOS FFI
│   │   └── src/
│   │       ├── lib.rs              # FFI entry points (#[no_mangle] pub extern "C" fn)
│   │       ├── text_renderer.rs    # Core Text glyph shaping + rendering, sub-pixel anti-aliasing
│   │       ├── layer_manager.rs    # Core Animation layer compositing for smooth scrolling
│   │       └── metal_blitter.rs    # Metal GPU-accelerated text atlas blitting
│   ├── windows/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # FFI entry points
│   │       ├── text_renderer.rs    # DirectWrite text shaping + Direct2D rendering
│   │       └── compositor.rs       # DirectComposition for smooth scrolling
│   ├── linux/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # FFI entry points
│   │       ├── text_renderer.rs    # Pango text shaping + Cairo rendering
│   │       └── compositor.rs       # X11/Wayland surface management
│   ├── ios/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # FFI entry points
│   │       ├── text_renderer.rs    # Core Text + UIKit text rendering
│   │       └── touch_handler.rs    # Touch event translation for cursor/selection
│   ├── android/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # FFI entry points
│   │       ├── text_renderer.rs    # Android Canvas + Skia text rendering via JNI
│   │       └── input_handler.rs    # IME and soft keyboard integration
│   └── web/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              # FFI entry points (compiled to WASM)
│           ├── dom_renderer.rs     # DOM span-based rendering: each line is a <div>, each token is a <span>
│           └── selection_overlay.rs # CSS-based selection highlighting and cursor rendering
├── tests/
│   ├── buffer.test.ts              # Rope/piece-table unit tests (insert, delete, line mapping, 1M+ lines)
│   ├── cursor.test.ts              # Cursor movement, multi-cursor, selection merging
│   ├── search.test.ts              # Literal search, regex search, unicode search, incremental search
│   ├── undo.test.ts                # Undo/redo, coalescing, max depth, redo-stack clearing
│   ├── diff.test.ts                # Myers diff correctness, edge cases (empty, identical, all-changed)
│   ├── syntax.test.ts              # Parse -> tokens -> theme colors integration tests
│   ├── folding.test.ts             # Indent-based and syntax-based fold range detection
│   ├── viewport.test.ts            # Virtual scrolling, visible range computation
│   └── benchmarks/
│       ├── keystroke-latency.ts    # Benchmark: measure insert + re-render time
│       ├── large-file-open.ts      # Benchmark: open 100K-line file, time to first render
│       └── scroll-perf.ts          # Benchmark: scroll throughput (frames per second)
├── examples/
│   ├── minimal/
│   │   ├── main.ts                 # Minimal example: open a file, render editor, handle input
│   │   └── perry.config.ts         # Perry config for minimal example
│   ├── markdown-editor/
│   │   ├── main.ts                 # Markdown editor with live preview pane
│   │   └── perry.config.ts
│   └── diff-viewer/
│       ├── main.ts                 # Side-by-side diff viewer for two files
│       └── perry.config.ts
├── perry.config.ts                 # Root Perry configuration (compile targets, FFI crate paths)
├── package.json                    # NPM package: @honeide/editor
└── LICENSE                         # MIT license
```

---

## 4. Core Interfaces & Types

### TextBuffer

```typescript
/**
 * High-performance text buffer backed by a piece table with B-tree indexing.
 * All offset-based operations are O(log n). The buffer is the single source of
 * truth for document content — all edits flow through this interface.
 */
interface TextBuffer {
  /**
   * Insert text at the given character offset.
   * @param offset - Zero-based character offset in the buffer.
   * @param text - The string to insert.
   * @returns The actual number of characters inserted (may differ from text.length
   *          if line ending normalization occurs).
   */
  insert(offset: number, text: string): number;

  /**
   * Delete a range of characters from the buffer.
   * @param offset - Zero-based start offset (inclusive).
   * @param length - Number of characters to delete.
   * @returns The deleted text.
   */
  delete(offset: number, length: number): string;

  /**
   * Get the full text content of the buffer.
   * For large buffers, prefer getLine() or getText(start, end) to avoid
   * materializing the entire string.
   */
  getText(): string;

  /**
   * Get text within a character offset range.
   * @param start - Zero-based start offset (inclusive).
   * @param end - Zero-based end offset (exclusive).
   */
  getTextRange(start: number, end: number): string;

  /**
   * Get the content of a single line (without line ending).
   * @param lineNumber - Zero-based line number.
   */
  getLine(lineNumber: number): string;

  /** Total number of lines in the buffer. */
  getLineCount(): number;

  /**
   * Get the character offset of the start of a line.
   * @param lineNumber - Zero-based line number.
   * @returns Character offset of the first character on that line.
   */
  getLineOffset(lineNumber: number): number;

  /**
   * Get the line number for a given character offset.
   * @param offset - Zero-based character offset.
   * @returns Zero-based line number containing that offset.
   */
  getOffsetLine(offset: number): number;

  /** Total number of characters in the buffer. */
  getLength(): number;

  /**
   * Apply multiple edits atomically. Edits are applied in offset order
   * (sorted internally). Offsets refer to the buffer state before any
   * edits in this batch.
   * @param edits - Array of { offset, deleteCount, insertText } operations.
   */
  applyEdits(edits: TextEdit[]): void;

  /**
   * Create an immutable snapshot of the current buffer state.
   * Used for undo/redo and diffing. The snapshot is cheap (shares
   * structure with the live buffer via the piece table).
   */
  snapshot(): BufferSnapshot;

  /**
   * Restore the buffer to a previous snapshot state.
   * @param snapshot - A snapshot previously obtained from snapshot().
   */
  restoreSnapshot(snapshot: BufferSnapshot): void;
}

/** A single text edit operation. */
interface TextEdit {
  /** Zero-based character offset where the edit starts. */
  offset: number;
  /** Number of characters to delete starting at offset. 0 for pure insert. */
  deleteCount: number;
  /** Text to insert at offset (after deletion). Empty string for pure delete. */
  insertText: string;
}

/** Immutable snapshot of buffer state. Cheap to create (structural sharing). */
interface BufferSnapshot {
  /** Unique monotonically increasing snapshot ID. */
  readonly id: number;
  /** Total character count at snapshot time. */
  readonly length: number;
  /** Total line count at snapshot time. */
  readonly lineCount: number;
  /** Materialize the full text (expensive for large buffers). */
  getText(): string;
  /** Get a single line from the snapshot. */
  getLine(lineNumber: number): string;
}
```

### EditorDocument

```typescript
/**
 * Represents an open document in the editor. Wraps a TextBuffer with metadata
 * (URI, language, version, encoding) and provides transactional editing.
 */
interface EditorDocument {
  /** Unique resource identifier (e.g., file:///path/to/file.ts). */
  readonly uri: string;

  /** The underlying text buffer. */
  readonly buffer: TextBuffer;

  /** Language identifier (e.g., "typescript", "python", "markdown"). */
  languageId: string;

  /**
   * Document version, incremented on each edit. Used for LSP
   * textDocument/didChange versioning.
   */
  readonly version: number;

  /** Whether the document has unsaved changes. */
  readonly isDirty: boolean;

  /** File encoding (detected on open, changeable by user). */
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';

  /** Line ending style. */
  lineEnding: '\n' | '\r\n' | '\r';

  /**
   * Apply an edit transaction. All edits within the callback are grouped
   * as a single undo step.
   * @param callback - Function that receives an EditBuilder and applies edits.
   */
  edit(callback: (builder: EditBuilder) => void): void;

  /**
   * Save the document to its URI. Resets isDirty to false.
   * @returns Promise that resolves when the file is written.
   */
  save(): Promise<void>;

  /**
   * Revert the document to the last saved state. Discards all unsaved changes.
   */
  revert(): Promise<void>;
}

/** Builder for constructing atomic edit transactions. */
interface EditBuilder {
  /** Insert text at a position. */
  insert(offset: number, text: string): void;
  /** Delete text in a range. */
  delete(offset: number, length: number): void;
  /** Replace text in a range. */
  replace(offset: number, length: number, newText: string): void;
}
```

### CursorManager

```typescript
/**
 * Manages multiple cursors and selections. The primary cursor (index 0) drives
 * scroll-to-reveal behavior. All cursor operations maintain sorted order and
 * merge overlapping cursors/selections.
 */
interface CursorManager {
  /** The primary cursor (always at index 0). */
  readonly primary: CursorState;

  /** All cursors, sorted by position. Primary is at index 0. */
  readonly cursors: readonly CursorState[];

  /**
   * Move all cursors in a direction.
   * @param direction - The movement direction.
   * @param extend - If true, extends selection instead of moving cursor.
   */
  move(direction: CursorDirection, extend: boolean): void;

  /**
   * Move the primary cursor to an exact position.
   * @param line - Zero-based line number.
   * @param column - Zero-based column number.
   * @param extend - If true, extends selection from current position.
   */
  moveToPosition(line: number, column: number, extend: boolean): void;

  /**
   * Move all cursors by one word in a direction.
   * @param direction - 'left' or 'right'.
   * @param extend - If true, extends selection.
   */
  moveByWord(direction: 'left' | 'right', extend: boolean): void;

  /**
   * Add a new cursor at a specific position. If a cursor already exists
   * at that position, this is a no-op.
   * @param line - Zero-based line number.
   * @param column - Zero-based column number.
   */
  addCursorAt(line: number, column: number): void;

  /** Add a cursor one line above each existing cursor. */
  addCursorAbove(): void;

  /** Add a cursor one line below each existing cursor. */
  addCursorBelow(): void;

  /**
   * Select all occurrences of the current selection (or word under cursor)
   * and place a cursor at each.
   */
  selectAllOccurrences(): void;

  /**
   * Add the next occurrence of the current selection as a new cursor (Ctrl+D).
   */
  addNextOccurrence(): void;

  /** Reset to a single cursor at the given position. */
  reset(line: number, column: number): void;
}

/** State of a single cursor. */
interface CursorState {
  /** Zero-based line number of the cursor position. */
  line: number;
  /** Zero-based column number of the cursor position. */
  column: number;
  /** If there is a selection, the anchor position. Null if no selection. */
  selectionAnchor: Position | null;
  /**
   * Desired column for vertical movement. Preserved across up/down moves
   * so the cursor returns to its original column after passing short lines.
   */
  desiredColumn: number;
}

interface Position {
  line: number;
  column: number;
}

type CursorDirection =
  | 'left' | 'right' | 'up' | 'down'
  | 'lineStart' | 'lineEnd'
  | 'documentStart' | 'documentEnd'
  | 'pageUp' | 'pageDown';
```

### ViewportManager

```typescript
/**
 * Manages the visible region of the editor. Implements virtual scrolling:
 * only lines within the viewport (plus a buffer zone) are rendered.
 */
interface ViewportManager {
  /**
   * Update the viewport dimensions (call on resize).
   * @param widthPx - Viewport width in pixels.
   * @param heightPx - Viewport height in pixels.
   */
  update(widthPx: number, heightPx: number): void;

  /**
   * Get the range of lines currently visible (including buffer zone).
   * @returns { startLine, endLine } — zero-based, inclusive start, exclusive end.
   */
  getVisibleRange(): { startLine: number; endLine: number };

  /**
   * Get the rendered line data for all visible lines.
   * @returns Array of RenderedLine objects for the visible range.
   */
  getVisibleLines(): RenderedLine[];

  /**
   * Scroll to an absolute vertical offset.
   * @param offsetY - Pixel offset from the top of the document.
   */
  scrollTo(offsetY: number): void;

  /**
   * Scroll by a relative amount.
   * @param deltaY - Pixels to scroll (positive = down, negative = up).
   */
  scrollBy(deltaY: number): void;

  /**
   * Scroll the viewport so that a specific line is visible.
   * @param lineNumber - Zero-based line number to reveal.
   * @param position - Where in the viewport to place the line.
   */
  revealLine(lineNumber: number, position: 'top' | 'center' | 'bottom'): void;
}
```

### RenderedLine

```typescript
/**
 * A single line as prepared for rendering. Contains everything the native
 * renderer needs to draw one line of the editor.
 */
interface RenderedLine {
  /** Zero-based line number in the document. */
  lineNumber: number;

  /** The text content of the line (without line ending). */
  content: string;

  /**
   * Syntax tokens for this line, sorted by startColumn.
   * Each token has a start column, end column, and theme color.
   */
  tokens: LineToken[];

  /**
   * Decorations applied to this line (e.g., error underlines, search
   * highlights, git blame annotations, AI edit markers).
   */
  decorations: LineDecoration[];

  /**
   * Fold state: 'expanded', 'collapsed', or 'none' (line is not a fold point).
   * If 'collapsed', lines below this fold are hidden.
   */
  foldState: 'expanded' | 'collapsed' | 'none';

  /**
   * Items to render in the gutter for this line (line number, fold icon,
   * breakpoint, diff marker, etc.).
   */
  gutterItems: GutterItem[];
}

interface LineToken {
  /** Zero-based start column (inclusive). */
  startColumn: number;
  /** Zero-based end column (exclusive). */
  endColumn: number;
  /** Resolved theme color as a hex string (e.g., "#d4d4d4"). */
  color: string;
  /** Font style flags. */
  fontStyle: 'normal' | 'italic' | 'bold' | 'bold-italic';
}

interface LineDecoration {
  /** Zero-based start column. */
  startColumn: number;
  /** Zero-based end column. */
  endColumn: number;
  /** Decoration type determines rendering. */
  type: 'highlight' | 'underline-error' | 'underline-warning' | 'underline-info'
      | 'strikethrough' | 'background' | 'border';
  /** CSS-like color string. */
  color: string;
  /** Optional hover text for this decoration. */
  hoverMessage?: string;
}

interface GutterItem {
  type: 'line-number' | 'fold-indicator' | 'breakpoint' | 'diff-added'
      | 'diff-modified' | 'diff-deleted' | 'diagnostic-error' | 'diagnostic-warning';
  /** Display text (for line numbers). */
  text?: string;
  /** Icon identifier (for breakpoints, fold indicators). */
  icon?: string;
  /** Color override. */
  color?: string;
}
```

### DiffEngine

```typescript
/**
 * Computes line-level and character-level diffs between two text buffers.
 * Used for file diff views and AI edit approval workflows.
 */
interface DiffEngine {
  /**
   * Compute a line-level diff between two buffers.
   * Uses the Myers diff algorithm: O((N+M)D) time, O(N+M) space.
   * @param original - The original (base) text buffer.
   * @param modified - The modified text buffer.
   * @returns DiffResult containing an array of hunks.
   */
  computeDiff(original: TextBuffer, modified: TextBuffer): DiffResult;

  /**
   * Compute character-level (inline) diff for a pair of changed lines.
   * Used to highlight exactly which characters changed within a modified line.
   * @param originalLine - The original line text.
   * @param modifiedLine - The modified line text.
   * @returns Array of inline diff segments.
   */
  computeInlineDiff(originalLine: string, modifiedLine: string): InlineDiffSegment[];
}

interface DiffResult {
  /** Array of diff hunks in document order. */
  hunks: DiffHunk[];
  /** Total number of lines added across all hunks. */
  totalAdded: number;
  /** Total number of lines deleted across all hunks. */
  totalDeleted: number;
}

interface DiffHunk {
  /** Change type: lines were added, deleted, or modified (both added and deleted). */
  type: 'add' | 'delete' | 'modify';

  /** Line range in the original buffer (zero-based, inclusive start, exclusive end). */
  originalRange: { startLine: number; endLine: number };

  /** Line range in the modified buffer. */
  modifiedRange: { startLine: number; endLine: number };

  /**
   * Acceptance state for AI edit workflows.
   * - 'pending': user has not yet decided
   * - 'accepted': user approved this hunk
   * - 'rejected': user rejected this hunk
   */
  state: 'pending' | 'accepted' | 'rejected';
}

interface InlineDiffSegment {
  /** The text content of this segment. */
  text: string;
  /** Whether this segment is unchanged, added, or deleted. */
  type: 'unchanged' | 'added' | 'deleted';
}
```

### EditorViewModel

```typescript
/**
 * The central view model that bridges core editor state to the rendering layer.
 * All properties are reactive via Perry's State() bindings — changes automatically
 * trigger re-renders of the native view.
 */
interface EditorViewModel {
  // === Content ===
  /** Lines currently visible in the viewport, fully resolved with tokens and decorations. */
  visibleLines: State<RenderedLine[]>;

  // === Cursors & Selections ===
  /** All cursor positions (for rendering cursor carets). */
  cursors: State<CursorState[]>;
  /** All selection ranges (for rendering selection highlights). */
  selections: State<SelectionRange[]>;

  // === Scroll ===
  /** Current scroll state. */
  scrollState: State<ScrollState>;

  // === Gutter ===
  /** Computed gutter width in pixels (depends on line count digits + icon columns). */
  gutterWidth: State<number>;

  // === Overlays ===
  /** Overlay state for popups and widgets that float above the editor. */
  overlays: State<OverlayState>;

  // === AI Features ===
  /** Ghost text for inline AI completion preview. */
  ghostText: State<GhostTextState | null>;
  /** AI annotations for code review (inline comments, suggestions). */
  aiAnnotations: State<AIAnnotation[]>;
  /** Preview state for agent-initiated edits awaiting user approval. */
  agentEditPreview: State<AgentEditPreview | null>;

  // === Minimap ===
  /** Downscaled line color data for minimap rendering. */
  minimapLines: State<MinimapLine[]>;

  // === Theme ===
  /** Resolved theme colors and font settings. */
  theme: State<EditorTheme>;

  // === Event Handlers ===
  /** Handle a key down event. Returns true if the event was consumed. */
  onKeyDown(event: KeyEvent): boolean;
  /** Handle a key up event. */
  onKeyUp(event: KeyEvent): void;
  /** Handle mouse down (click, selection start). */
  onMouseDown(event: MouseEvent): void;
  /** Handle mouse move (selection dragging, hover). */
  onMouseMove(event: MouseEvent): void;
  /** Handle mouse up (selection end). */
  onMouseUp(event: MouseEvent): void;
  /** Handle scroll events (wheel, trackpad, scrollbar). */
  onScroll(event: ScrollEvent): void;
  /** Handle viewport resize. */
  onResize(width: number, height: number): void;
  /** Handle text input (IME composition result, character input). */
  onTextInput(text: string): void;
  /** Handle IME composition events. */
  onCompositionStart(): void;
  onCompositionUpdate(text: string): void;
  onCompositionEnd(text: string): void;
  /** Handle focus/blur. */
  onFocus(): void;
  onBlur(): void;
}

interface SelectionRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface ScrollState {
  /** Vertical scroll offset in pixels. */
  scrollTop: number;
  /** Horizontal scroll offset in pixels. */
  scrollLeft: number;
  /** Total document height in pixels. */
  scrollHeight: number;
  /** Total document width in pixels (longest line). */
  scrollWidth: number;
  /** Viewport height in pixels. */
  viewportHeight: number;
  /** Viewport width in pixels. */
  viewportWidth: number;
}

interface OverlayState {
  /** Autocomplete popup. Null if not visible. */
  autocomplete: {
    items: CompletionItem[];
    selectedIndex: number;
    anchorPosition: { x: number; y: number };
  } | null;
  /** Hover tooltip. Null if not visible. */
  hover: {
    content: string;
    anchorPosition: { x: number; y: number };
  } | null;
  /** Parameter hints popup. Null if not visible. */
  parameterHints: {
    signatures: SignatureInfo[];
    activeSignature: number;
    activeParameter: number;
    anchorPosition: { x: number; y: number };
  } | null;
  /** Diagnostics popup (error/warning details). Null if not visible. */
  diagnosticsPopup: {
    diagnostics: Diagnostic[];
    anchorPosition: { x: number; y: number };
  } | null;
  /** Find/replace widget. Null if not visible. */
  findWidget: FindWidgetState | null;
}

interface GhostTextState {
  /** Line where ghost text starts. */
  line: number;
  /** Column where ghost text starts. */
  column: number;
  /** The ghost text content (may be multi-line). */
  text: string;
  /** Whether the ghost text is stale (buffer has changed since it was generated). */
  isStale: boolean;
}

interface AIAnnotation {
  /** Line range this annotation applies to. */
  startLine: number;
  endLine: number;
  /** Annotation content (markdown). */
  content: string;
  /** Severity/type of annotation. */
  type: 'suggestion' | 'comment' | 'issue';
}

interface AgentEditPreview {
  /** The diff between current buffer and proposed edit. */
  diff: DiffResult;
  /** Description of what the AI agent changed. */
  description: string;
  /** Accept all changes. */
  acceptAll(): void;
  /** Reject all changes. */
  rejectAll(): void;
}

interface MinimapLine {
  /** Array of color blocks for this line (each block is ~4 characters wide). */
  blocks: { color: string; width: number }[];
}

interface FindWidgetState {
  /** Current search query. */
  query: string;
  /** Whether regex mode is enabled. */
  isRegex: boolean;
  /** Whether case-sensitive mode is enabled. */
  caseSensitive: boolean;
  /** Whether whole-word mode is enabled. */
  wholeWord: boolean;
  /** Total number of matches. */
  matchCount: number;
  /** Index of the currently focused match (1-based for display). */
  currentMatch: number;
  /** Replace text (empty if find-only mode). */
  replaceText: string;
  /** Whether the replace input is visible. */
  replaceVisible: boolean;
}
```

### SyntaxEngine

```typescript
/**
 * Integrates Lezer parsers to provide syntax highlighting and structural
 * analysis of documents. Supports incremental parsing — on edits, only
 * the affected region is re-parsed.
 */
interface SyntaxEngine {
  /**
   * Set the language for a document. Loads the appropriate Lezer grammar.
   * @param languageId - Language identifier (e.g., "typescript", "python").
   */
  setLanguage(languageId: string): void;

  /**
   * Parse (or incrementally re-parse) the document.
   * @param buffer - The text buffer to parse.
   * @param previousTree - The previous parse tree (for incremental parsing). Null for first parse.
   * @param changedRanges - Ranges that changed since the previous parse.
   * @returns The updated parse tree.
   */
  parse(
    buffer: TextBuffer,
    previousTree: Tree | null,
    changedRanges: { fromOffset: number; toOffset: number }[]
  ): Tree;

  /**
   * Get syntax tokens for a specific line. Walks the parse tree and resolves
   * Lezer highlight tags to theme colors.
   * @param tree - The parse tree.
   * @param lineNumber - Zero-based line number.
   * @param theme - The current editor theme (for color resolution).
   * @returns Array of LineToken for the line.
   */
  getLineTokens(tree: Tree, lineNumber: number, theme: EditorTheme): LineToken[];

  /**
   * Get fold ranges from the syntax tree (matching brackets/blocks).
   * @param tree - The parse tree.
   * @returns Array of fold ranges.
   */
  getFoldRanges(tree: Tree): FoldRange[];

  /**
   * Find the matching bracket for a given position.
   * @param tree - The parse tree.
   * @param offset - Character offset of the bracket.
   * @returns Offset of the matching bracket, or null if none found.
   */
  findMatchingBracket(tree: Tree, offset: number): number | null;

  /** List of supported language IDs. */
  getSupportedLanguages(): string[];
}

interface FoldRange {
  /** Zero-based start line (the line with the opening bracket/keyword). */
  startLine: number;
  /** Zero-based end line (the line with the closing bracket/keyword). */
  endLine: number;
}
```

---

## 5. Implementation Guide

### Rope Buffer (`core/buffer/`)

**piece-table.ts** — The foundation of the text buffer.

The piece table maintains two immutable string buffers:
1. **Original buffer**: The file content as loaded from disk. Never modified.
2. **Add buffer**: Append-only buffer for all inserted text. New text is appended here.

A **piece descriptor** references a span in one of these buffers: `{ bufferType: 'original' | 'add', start: number, length: number }`.

The document content is the concatenation of all piece descriptors in order.

**rope.ts** — B-tree indexing over pieces.

Pieces are stored in a balanced B-tree (order 32-64, tuned for cache line performance). Each internal node stores:
- `charCount`: total characters in the subtree
- `lineBreakCount`: total line breaks in the subtree
- `children`: child nodes

This enables O(log n) for:
- Offset-to-piece lookup (binary search on charCount)
- Line-to-offset lookup (binary search on lineBreakCount)
- Insert (split piece at offset, insert new piece, rebalance)
- Delete (split pieces at range boundaries, remove middle pieces, rebalance)

**line-index.ts** — Maintains a mapping from line numbers to character offsets.

On each edit, incrementally updates the line index:
1. For deletions: count line breaks in deleted range, remove those entries, shift subsequent offsets.
2. For insertions: count line breaks in inserted text, insert new entries, shift subsequent offsets.

The line index is stored as a simple array for lines under 100K, switching to a Fenwick tree (binary indexed tree) for larger documents to maintain O(log n) prefix-sum queries.

**text-buffer.ts** — The public `TextBuffer` implementation.

Wraps the rope and line index, providing the clean interface defined in Section 4. Key implementation details:
- `applyEdits()` sorts edits by offset in reverse order, then applies each edit. Reverse order ensures earlier offsets remain valid as later edits shift positions.
- `snapshot()` copies the piece descriptor tree (cheap, O(number of pieces)) but shares the underlying string buffers. The original and add buffers are immutable, so sharing is safe.
- `restoreSnapshot()` replaces the piece descriptor tree and line index. The add buffer may have grown since the snapshot, but the snapshot's pieces only reference the portion that existed at snapshot time.

### Document Model (`core/document/`)

**document.ts** — `EditorDocument` implementation.

```
class EditorDocumentImpl implements EditorDocument {
  private _buffer: TextBuffer;
  private _version: number = 0;
  private _savedSnapshot: BufferSnapshot;
  // ... other fields
}
```

On construction:
1. Read file bytes from disk (via Perry filesystem API).
2. Detect encoding using BOM detection + heuristic analysis (encoding.ts).
3. Decode bytes to string.
4. Detect line ending (scan first 1000 lines, use majority).
5. Initialize TextBuffer with the decoded string.
6. Store initial snapshot as `_savedSnapshot`.

`isDirty` is computed by comparing `buffer.snapshot().id !== _savedSnapshot.id`.

**edit-builder.ts** — Transaction builder.

Collects edits during a callback, then applies them atomically via `buffer.applyEdits()`. Before applying, the undo manager is notified to capture the pre-edit state.

**encoding.ts** — Encoding detection.

1. Check for BOM (byte order mark): UTF-8 BOM (EF BB BF), UTF-16 LE BOM (FF FE), UTF-16 BE BOM (FE FF).
2. If no BOM, use heuristic: scan first 8KB for null bytes (suggests UTF-16), high bytes (suggests ISO-8859-1 vs UTF-8), and UTF-8 multi-byte sequence validation.
3. Default to UTF-8.

### Cursor/Selection (`core/cursor/`)

**cursor-manager.ts** — Multi-cursor implementation.

Key behaviors:
- Cursors are stored in an array sorted by position (line, then column).
- After any cursor operation, overlapping/adjacent cursors are merged.
- `addCursorAbove()`/`addCursorBelow()`: For each existing cursor, clone it with `line += 1` (or `-1`). Clamp to document bounds. Then merge.
- `desiredColumn` preservation: When moving up/down, if the target line is shorter than `desiredColumn`, the cursor moves to end-of-line but retains `desiredColumn`. When moving to a line that is long enough, the cursor returns to `desiredColumn`.

**selection.ts** — Selection range normalization.

A selection is defined by an anchor and the cursor position. The "start" of the selection is `min(anchor, cursor)` and the "end" is `max(anchor, cursor)`. Direction is preserved for shift+arrow extension.

Selection merging: after multi-cursor operations, any two selections that overlap or are adjacent are merged into one selection spanning the union of both ranges.

**word-boundary.ts** — Unicode word boundary detection.

Simplified UAX #29 implementation:
1. Classify each character into categories: letter, digit, whitespace, punctuation, other.
2. Word boundary = transition between different categories.
3. Special cases: camelCase boundaries (transition from lowercase to uppercase), underscore-separated identifiers (underscore is treated as a boundary).

### Commands (`core/commands/`)

**registry.ts** — Command registry.

```typescript
type CommandHandler = (editor: EditorViewModel, args?: any) => void;

class CommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();

  register(id: string, handler: CommandHandler): void;
  execute(id: string, editor: EditorViewModel, args?: any): void;
  has(id: string): boolean;
  getAll(): string[];
}
```

Command IDs follow a namespaced convention: `editor.action.insertLineAfter`, `editor.action.selectAllOccurrences`, etc.

**editing.ts** — Core editing commands.

- `type` (default key handler): Insert text at all cursor positions. Uses `document.edit()` for atomicity.
- `deleteLeft` (Backspace): Delete one character before each cursor. If cursor has a selection, delete the selection instead.
- `deleteRight` (Delete): Delete one character after each cursor.
- `insertLineAfter` (Enter): Insert newline + auto-indent at all cursors. Auto-indent: copy leading whitespace from current line.
- `indent` (Tab): If selection, indent all selected lines. Otherwise, insert tab/spaces at cursor.
- `outdent` (Shift+Tab): Remove one level of indentation from all cursors/selected lines.
- `toggleComment` (Cmd+/ or Ctrl+/): Toggle line comment for all cursors/selected lines. Language-aware (uses `//` for JS/TS, `#` for Python, etc.).

**navigation.ts** — Navigation commands.

- `moveCursorLeft/Right/Up/Down`: Delegate to CursorManager.move().
- `moveCursorWordLeft/Right`: Delegate to CursorManager.moveByWord().
- `moveCursorToLineStart/End`: Move to first non-whitespace character (first press) or column 0 (second press).
- `goToLine`: Accept a line number, move primary cursor there, revealLine().
- `goToMatchingBracket`: Use SyntaxEngine.findMatchingBracket(), move cursor there.

**selection-cmds.ts** — Selection commands.

- `selectAll` (Cmd+A): Select entire document.
- `selectWord`: Expand cursor to word boundaries (using word-boundary.ts).
- `selectLine`: Select the entire current line including line ending.
- `expandSelection`: Smart expand — select word, then containing brackets/block, then outer block.
- `shrinkSelection`: Reverse of expandSelection (maintains a stack of previous selections).

**clipboard.ts** — Clipboard integration.

Uses `perry/system` clipboard API:
- `copy` (Cmd+C): If selection exists, copy selected text. If no selection, copy entire current line.
- `cut` (Cmd+X): Copy, then delete. If no selection, cut entire line.
- `paste` (Cmd+V): Read clipboard text, insert at all cursor positions. If clipboard contains N lines and there are N cursors, distribute one line per cursor.

**multicursor.ts** — Multi-cursor commands.

- `addCursorAbove` (Cmd+Alt+Up): CursorManager.addCursorAbove().
- `addCursorBelow` (Cmd+Alt+Down): CursorManager.addCursorBelow().
- `addNextOccurrence` (Cmd+D): Find the next occurrence of the current selection (or word under cursor), add a cursor+selection there.
- `selectAllOccurrences` (Cmd+Shift+L): Find all occurrences, add cursor+selection at each.
- `addCursorAtClick` (Alt+Click): CursorManager.addCursorAt(clickLine, clickColumn).

### Search (`core/search/`)

**search-engine.ts** — Core search implementation.

Two modes:
1. **Literal search**: Uses a simple string scan. For case-insensitive mode, compare lowercased strings. Returns all match offsets.
2. **Regex search**: Compiles the user's regex pattern, scans the buffer line-by-line. Returns matches with capture groups.

For large files, search is performed in chunks (64KB at a time) to avoid materializing the entire buffer into one string. Chunk boundaries handle matches that span chunk boundaries by overlapping chunks by the max possible match length (for literal search, the query length; for regex, not bounded, so we re-check at boundaries).

**replace.ts** — Replace operations.

- `replaceNext()`: Replace the current match and advance to the next.
- `replaceAll()`: Collect all matches, apply as a single edit transaction (for single undo step). Replacement text supports `$1`, `$2` capture group references in regex mode.

**incremental.ts** — Incremental search.

Maintains a `SearchState` that caches all match positions. On buffer edit:
1. Invalidate matches in the edited region.
2. Re-search only the affected lines (with some context for multi-line patterns).
3. Adjust match offsets after the edit point by the edit delta.

On query change: full re-search (but still chunked for large files).

### Undo/Redo (`core/history/`)

**operation.ts** — Operation representation.

```typescript
interface Operation {
  /** Edits to apply for this operation. */
  edits: TextEdit[];
  /** Cursor state before the operation (for restoring on undo). */
  cursorsBefore: CursorState[];
  /** Cursor state after the operation (for restoring on redo). */
  cursorsAfter: CursorState[];
  /** Timestamp when this operation was created. */
  timestamp: number;
}
```

**undo-manager.ts** — Undo stack management.

State:
- `undoStack: Operation[]` — operations that can be undone.
- `redoStack: Operation[]` — operations that can be redone.
- `maxDepth: number = 10000` — maximum undo stack depth.

Push behavior:
1. When a new edit occurs, create an Operation from the edit(s).
2. **Coalescing**: If the previous operation on the undo stack was created within 500ms AND the new operation is a simple character insert/delete (not a paste or multi-cursor operation), merge the new edit into the previous operation.
3. Clear the redo stack (any new edit invalidates the redo history).
4. If stack exceeds maxDepth, drop the oldest operation.

Undo:
1. Pop the top Operation from undoStack.
2. Compute the inverse edits (for each insert, create a delete; for each delete, create an insert with the deleted text).
3. Apply inverse edits to the buffer.
4. Restore `cursorsBefore`.
5. Push a "redo operation" (original edits + cursors) onto redoStack.

Redo:
1. Pop from redoStack, apply edits, restore `cursorsAfter`, push onto undoStack.

### Folding (`core/folding/`)

**fold-provider.ts** — Fold range computation.

Two strategies, used in combination:

1. **Indent-based folding** (fallback for unknown languages):
   - A fold range starts at line L if line L+1 has greater indentation than L.
   - The fold range ends at the last consecutive line with greater indentation.
   - Skip blank lines when computing the fold boundary.

2. **Syntax-based folding** (when a Lezer parse tree is available):
   - Walk the tree looking for block nodes (function bodies, class bodies, object literals, array literals, if/else blocks).
   - The fold range starts at the line of the opening bracket/keyword and ends at the line of the closing bracket/keyword.

**fold-state.ts** — Fold state management.

```typescript
class FoldState {
  private foldedRanges: Map<number, FoldRange>; // key = start line number

  /** Fold (collapse) the range starting at the given line. */
  fold(lineNumber: number): void;

  /** Unfold (expand) the range starting at the given line. */
  unfold(lineNumber: number): void;

  /** Toggle fold state at the given line. */
  toggle(lineNumber: number): void;

  /** Check if a line is hidden because it is inside a folded range. */
  isLineHidden(lineNumber: number): boolean;

  /** Get the fold state for a specific line. */
  getFoldState(lineNumber: number): 'expanded' | 'collapsed' | 'none';

  /** Adjust fold ranges after a buffer edit (lines inserted/deleted). */
  onBufferEdit(editLine: number, linesDelta: number): void;
}
```

When a fold is collapsed, the viewport skips hidden lines. The ViewModel maps logical line numbers to screen rows accounting for folds.

### Syntax Highlighting (`core/tokenizer/`)

**syntax-engine.ts** — Lezer parser integration.

```typescript
class SyntaxEngineImpl implements SyntaxEngine {
  private parsers: Map<string, Parser>; // languageId -> Lezer Parser
  private currentTree: Tree | null;

  constructor() {
    // Register all built-in grammars
    this.parsers = new Map();
    this.registerGrammar('typescript', typescriptParser);
    this.registerGrammar('javascript', javascriptParser);
    // ... etc for all 10 languages
  }
}
```

Parsing strategy:
1. On document open: full parse. For files under 500KB, parse synchronously. For larger files, parse in chunks using Lezer's incremental parsing with periodic yields (via `setTimeout(0)` equivalent in Perry) to keep the UI responsive.
2. On edit: use Lezer's built-in incremental parsing. Pass the previous Tree and the changed ranges. Lezer efficiently reuses unchanged subtrees.
3. Parse runs on the main thread but is designed to complete within one frame (< 16ms) for typical edits. For large structural changes (e.g., pasting 10K lines), the parse may take multiple frames — in this case, tokenization of visible lines is prioritized.

**token-theme.ts** — Maps Lezer highlight tags to theme colors.

Lezer provides a tag system (e.g., `tags.keyword`, `tags.string`, `tags.comment`, `tags.variableName`). The token-theme module maintains a mapping from these tags to hex color strings based on the current editor theme:

```typescript
interface TokenThemeMapping {
  keyword: string;         // e.g., "#569cd6"
  string: string;          // e.g., "#ce9178"
  comment: string;         // e.g., "#6a9955"
  variableName: string;    // e.g., "#9cdcfe"
  typeName: string;        // e.g., "#4ec9b0"
  functionName: string;    // e.g., "#dcdcaa"
  number: string;          // e.g., "#b5cea8"
  operator: string;        // e.g., "#d4d4d4"
  punctuation: string;     // e.g., "#d4d4d4"
  // ... full set of ~30 token types
}
```

**incremental.ts** — Per-line token cache.

Maintains a `LineToken[][]` array indexed by line number. On buffer edit:
1. Invalidate the cache for edited lines and all lines below (syntax changes can cascade).
2. On next render, re-tokenize only the visible lines by walking the parse tree.
3. Lines below the visible range are lazily re-tokenized when they scroll into view.

Optimization: after a small edit, only the directly affected lines usually change tokens. The cache tracks a "dirty region" and expands it conservatively. Once re-tokenized lines match the previous cache for 5 consecutive lines, stop invalidating further lines (the change has converged).

**grammars/** — Individual grammar setup files.

Each file (e.g., `typescript.ts`) re-exports the appropriate Lezer parser with any needed configuration:

```typescript
// grammars/typescript.ts
import { parser as jsParser } from '@lezer/javascript';

export const typescriptParser = jsParser.configure({
  dialect: 'ts jsx',
});
```

### Diff Engine (`core/diff/`)

**diff-compute.ts** — Myers diff algorithm.

Implementation of Eugene Myers' "An O(ND) Difference Algorithm and Its Variations":

1. **Input**: Two arrays of lines (from original and modified buffers).
2. **Algorithm**: Shortest Edit Script (SES) search on the edit graph. Uses the linear-space refinement (Hirschberg-style divide-and-conquer) for O(N+M) space.
3. **Output**: Array of edit operations (insert line, delete line) which is then grouped into DiffHunks.

Key implementation details:
- Lines are compared by content equality (string comparison).
- For performance, lines are first hashed (FNV-1a) and compared by hash; only hash-equal lines are string-compared (reduces comparison cost for large files).
- Maximum diff computation time: 1 second. If exceeded (pathologically different files), fall back to a simple "delete all original, insert all modified" result.

**diff-model.ts** — DiffResult and DiffHunk types (as defined in Section 4).

**hunk.ts** — Hunk operations.

- `mergeAdjacentHunks(hunks, contextLines)`: Merge hunks that are within `contextLines` of each other (default 3).
- `splitHunk(hunk, line)`: Split a hunk at a line boundary (for partial accept/reject of AI edits).
- `navigateHunks(hunks, currentLine, direction)`: Find the next/previous hunk from the current line.

**inline-diff.ts** — Character-level diff within lines.

Uses the same Myers algorithm but at the character level (input = arrays of characters). For very long lines (> 1000 chars), fall back to word-level diff (split on whitespace, diff words, then mark individual character differences within changed words).

### LSP Client (`core/lsp-client/`)

**client.ts** — Lightweight LSP client.

This is a minimal LSP client for editor-level features. The full LSP lifecycle management (starting/stopping servers, managing multiple servers) is handled by `hone-core`. This client handles the protocol details of communicating with a running server.

```typescript
class LSPClient {
  private requestId: number = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }>;

  /** Connect to an LSP server via stdio streams. */
  connect(stdin: WritableStream, stdout: ReadableStream): void;

  /** Send a request and wait for a response. */
  request<T>(method: string, params: any): Promise<T>;

  /** Send a notification (no response expected). */
  notify(method: string, params: any): void;

  /** Register a handler for server-initiated notifications. */
  onNotification(method: string, handler: (params: any) => void): void;
}
```

Supported features (thin wrappers around the raw protocol):
- `textDocument/completion` — Trigger autocomplete
- `textDocument/hover` — Get hover information
- `textDocument/definition` — Go to definition
- `textDocument/references` — Find all references
- `textDocument/publishDiagnostics` — Receive diagnostics (server-initiated)
- `textDocument/signatureHelp` — Parameter hints
- `textDocument/codeAction` — Code actions (quick fix, refactor)

**protocol.ts** — LSP type definitions matching the LSP specification.

**capabilities.ts** — Capability negotiation.

After `initialize`, inspect the server's capabilities to determine which features are available. This prevents sending unsupported requests.

### DAP Client (`core/dap-client/`)

**client.ts** — Debug Adapter Protocol client.

Similar structure to the LSP client but for the Debug Adapter Protocol:
- `launch(config)` / `attach(config)` — Start/attach to a debug session
- `setBreakpoints(source, breakpoints)` — Set breakpoints in a file
- `continue()` / `next()` / `stepIn()` / `stepOut()` — Execution control
- `stackTrace(threadId)` — Get the call stack
- `scopes(frameId)` — Get variable scopes
- `variables(variablesReference)` — Get variables

**protocol.ts** — DAP type definitions.

### Viewport (`core/viewport/`)

**viewport-manager.ts** — Virtual scrolling.

The viewport manager determines which lines to render based on scroll position and viewport size:

```
visibleStartLine = floor(scrollTop / lineHeight)
visibleEndLine = ceil((scrollTop + viewportHeight) / lineHeight)
bufferZone = 10 lines above and below (for smooth scrolling)
renderStartLine = max(0, visibleStartLine - bufferZone)
renderEndLine = min(lineCount, visibleEndLine + bufferZone)
```

Complications:
- **Folded regions**: Folded lines are skipped. The mapping from screen row to document line accounts for folds.
- **Word wrap**: Wrapped lines occupy multiple screen rows. Each wrapped segment is tracked in the line height cache.
- **Code lenses**: Code lenses insert extra height between lines.

The viewport manager maintains a `screenRowToLine[]` mapping that is recomputed when folds change or word wrap recalculates.

**scroll.ts** — Scroll behavior.

- `scrollTo(offsetY)`: Set absolute scroll position, clamp to [0, maxScroll].
- `scrollBy(deltaY)`: Relative scroll.
- `revealLine(line, position)`: Compute the pixel offset for the target line, then scroll so that:
  - `'top'`: Line is at the top of the viewport.
  - `'center'`: Line is vertically centered.
  - `'bottom'`: Line is at the bottom of the viewport.
- Smooth scrolling: Uses animation frames to interpolate from current position to target (ease-out curve, 150ms duration).

**line-height.ts** — Line height cache.

Most lines have a uniform height (base line height, typically 20px for 14px font). The cache stores exceptions:
- Wrapped lines: `height = baseLineHeight * wrapCount`
- Code lens lines: `height = baseLineHeight + codeLensHeight`

```typescript
class LineHeightCache {
  private baseLineHeight: number;
  private overrides: Map<number, number>; // lineNumber -> pixelHeight

  getLineHeight(lineNumber: number): number;
  getLineTop(lineNumber: number): number; // cumulative height above this line
  getTotalHeight(): number;
  setWrapped(lineNumber: number, wrapCount: number): void;
  setCodeLens(lineNumber: number, lensHeight: number): void;
}
```

### ViewModel (`view-model/`)

**editor-view-model.ts** — The central orchestrator.

The EditorViewModel connects all core subsystems and exposes reactive state for the rendering layer:

```typescript
class EditorViewModelImpl implements EditorViewModel {
  // Core subsystems
  private document: EditorDocument;
  private cursorManager: CursorManager;
  private viewport: ViewportManager;
  private syntaxEngine: SyntaxEngine;
  private undoManager: UndoManager;
  private foldState: FoldState;
  private searchState: SearchState;
  private commandRegistry: CommandRegistry;

  // Reactive state (Perry State() bindings)
  visibleLines = State<RenderedLine[]>([]);
  cursors = State<CursorState[]>([]);
  // ... all other State() properties

  constructor(document: EditorDocument) {
    // Initialize all subsystems
    // Set up reactive subscriptions
    // Parse initial syntax tree
    // Compute initial visible lines
  }
}
```

The update cycle on each edit:
1. Edit applied to buffer (via command system).
2. Undo manager records the operation.
3. Syntax engine incrementally re-parses.
4. Token cache invalidated for affected lines.
5. Fold state adjusted for line changes.
6. Search matches updated incrementally.
7. Viewport recalculates visible range.
8. ViewModel recomputes `visibleLines` (only for visible range).
9. State() reactivity triggers native re-render.

Target: all of this completes within 16ms for a single keystroke edit in a 100K-line file.

**line-layout.ts** — Compute rendered lines.

For each visible line:
1. Get buffer line content.
2. Check fold state (skip hidden lines).
3. Get syntax tokens from token cache (or tokenize on demand).
4. Collect decorations (search highlights, diagnostic underlines, git diff markers, AI annotations).
5. Compute gutter items (line number, fold indicator, breakpoints).
6. Package as RenderedLine.

**cursor-state.ts** — Cursor rendering.

- Blink timer: 500ms on / 500ms off. Reset to "on" on any cursor movement or edit.
- Cursor styles: line (default), block, underline. Configurable in settings.
- IME composition: During IME composition (e.g., typing Chinese/Japanese), render the composition string with an underline decoration at the cursor position. The actual cursor is hidden during composition.

**gutter.ts** — Gutter width and rendering.

Gutter width = line number column width + fold indicator column + breakpoint column + diff marker column.

- Line number width: `max(2, floor(log10(lineCount)) + 1) * charWidth + padding`.
- Fold indicator: fixed 16px column.
- Breakpoint column: fixed 16px column (hidden if debugging is not active).
- Diff marker column: fixed 4px column (colored bar for git changes).

**minimap.ts** — Minimap data generation.

For each line in the document, generate a `MinimapLine`:
1. Divide the line into blocks of ~4 characters.
2. For each block, determine the dominant syntax color (most common token color in that block).
3. Store as `{ color, width }` pairs.

The minimap renders these blocks at ~1px per line height and ~1px per 4 characters. The viewport indicator is an overlay rectangle showing which portion of the document is visible.

For performance: minimap data is computed lazily. Only the portion visible in the minimap viewport is computed. Lines outside the minimap view use a cached "document color profile" (average color per section).

**overlays.ts** — Overlay management.

Overlays (autocomplete, hover, parameter hints, diagnostics popup) are positioned relative to the cursor or a specific buffer position:
1. Convert buffer position (line, column) to pixel coordinates using viewport scroll state, line heights, and character width measurements (via the native FFI `hone_editor_measure_text`).
2. Ensure the overlay stays within the editor bounds (flip above/below if not enough space below, flip left/right if near the edge).
3. Only one autocomplete popup and one hover tooltip at a time. Diagnostics popup can coexist with autocomplete.

**scroll-state.ts** — Reactive scroll state.

Simple container for scroll position that triggers UI updates via State():
```typescript
scrollState = State<ScrollState>({
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 0,
  scrollWidth: 0,
  viewportHeight: 0,
  viewportWidth: 0,
});
```

Updated by: viewport manager (on scroll), resize handler (on resize), content changes (scrollHeight/scrollWidth).

**decorations.ts** — Decoration types and management.

Decorations are collected from multiple providers:
- **Syntax decorations**: From the token theme (font style: italic, bold).
- **Diagnostic decorations**: Underlines from LSP diagnostics (error=red wavy, warning=yellow wavy, info=blue dots).
- **Search decorations**: Highlight background for search matches, brighter highlight for current match.
- **Selection decorations**: Background color for selected regions.
- **Git decorations**: Line background tint for added/modified lines (gutter markers handled separately).
- **AI decorations**: Ghost text styling, AI edit preview highlighting.
- **Bracket matching**: Background highlight on matching brackets when cursor is adjacent.

Decorations are stored per-line and regenerated when the line's state changes.

**find-widget.ts** — Find/replace widget state.

Manages the state for the find/replace UI:
- Open/close with Cmd+F (find) or Cmd+H (replace).
- On query change: trigger incremental search, update match count and current match index.
- Navigation: Enter/Shift+Enter to go to next/previous match. Wraps around at document boundaries.
- Replace: replace current match, replace all. Shows replacement preview.

**diff-view-model.ts** — Diff view rendering.

Two modes:
1. **Side-by-side**: Two editor viewports, scrolled in sync. Left = original, right = modified. Changed regions highlighted with background colors. Deleted lines in left (red), added lines in right (green), modified lines in both (yellow).
2. **Inline**: Single editor viewport with added/deleted lines interleaved. Deleted lines shown with red background and strikethrough. Added lines with green background.

For AI edit approval:
- Each hunk has accept/reject buttons in the gutter.
- Accepted hunks are applied to the buffer.
- Rejected hunks are discarded.
- "Accept all" / "Reject all" buttons at the top of the diff.

**ghost-text.ts** — AI inline completion preview.

Ghost text is rendered as semi-transparent text after the cursor:
1. AI completion response arrives with suggested text.
2. ViewModel sets `ghostText` state with the text and position.
3. The native renderer draws the ghost text in a lighter color (50% opacity of normal text color).
4. Tab accepts the ghost text (inserts it into the buffer).
5. Escape dismisses the ghost text.
6. Any other keystroke: if the typed character matches the start of the ghost text, advance the ghost text. Otherwise, dismiss it.
7. If the buffer changes (non-ghost-text edit), mark ghost text as stale and dismiss it.

Partial accept (Cmd+Right): accept the ghost text up to the next word boundary.

**theme.ts** — Theme system.

```typescript
interface EditorTheme {
  // Editor chrome
  background: string;
  foreground: string;
  selectionBackground: string;
  cursorColor: string;
  lineHighlight: string;
  gutterBackground: string;
  gutterForeground: string;

  // Syntax token colors
  tokens: TokenThemeMapping;

  // Diff colors
  diffAddedBackground: string;
  diffDeletedBackground: string;
  diffModifiedBackground: string;

  // Diagnostic colors
  errorForeground: string;
  warningForeground: string;
  infoForeground: string;

  // AI colors
  ghostTextForeground: string;
  aiAnnotationBackground: string;

  // Font settings
  fontFamily: string;      // e.g., "JetBrains Mono"
  fontSize: number;        // e.g., 14
  fontWeight: number;      // e.g., 400
  lineHeight: number;      // e.g., 1.5 (multiplier)
  letterSpacing: number;   // e.g., 0 (pixels)
}
```

Built-in themes: Dark (default, similar to One Dark Pro), Light (similar to GitHub Light).

### Native Rendering (`native/`)

Each platform directory contains a Rust FFI crate that implements platform-native text rendering. The crate is compiled as a companion library by Perry and linked into the final binary.

**FFI contract** — All platforms implement these functions:

```rust
/// Create a new editor view with the given dimensions.
/// Returns an opaque pointer to the editor view state.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView;

/// Destroy an editor view and free all resources.
#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView);

/// Set the editor font. Must be called before rendering.
/// `family` is a null-terminated UTF-8 string (e.g., "JetBrains Mono").
/// `size` is the font size in points.
#[no_mangle]
pub extern "C" fn hone_editor_set_font(
    view: *mut EditorView,
    family: *const c_char,
    size: f64,
);

/// Render a single line of text with syntax coloring.
/// `line_number` is for gutter display.
/// `text` is the line content (null-terminated UTF-8).
/// `tokens_json` is a JSON array of tokens: [{ "s": startCol, "e": endCol, "c": "#hexcolor", "st": "normal"|"italic"|"bold" }, ...]
/// `y_offset` is the vertical pixel position of this line.
#[no_mangle]
pub extern "C" fn hone_editor_render_line(
    view: *mut EditorView,
    line_number: i32,
    text: *const c_char,
    tokens_json: *const c_char,
    y_offset: f64,
);

/// Set the cursor position and style.
/// `style`: 0 = line, 1 = block, 2 = underline.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(
    view: *mut EditorView,
    x: f64,
    y: f64,
    style: i32,
);

/// Set selection highlight regions.
/// `regions_json` is a JSON array: [{ "x": f64, "y": f64, "w": f64, "h": f64 }, ...]
#[no_mangle]
pub extern "C" fn hone_editor_set_selection(
    view: *mut EditorView,
    regions_json: *const c_char,
);

/// Set the vertical scroll offset. The native view adjusts its rendering origin.
#[no_mangle]
pub extern "C" fn hone_editor_scroll(view: *mut EditorView, offset_y: f64);

/// Measure the width of a text string in the current font.
/// Returns the width in pixels. Used for cursor positioning and overlay placement.
#[no_mangle]
pub extern "C" fn hone_editor_measure_text(
    view: *mut EditorView,
    text: *const c_char,
) -> f64;

/// Invalidate the view, triggering a redraw on the next frame.
#[no_mangle]
pub extern "C" fn hone_editor_invalidate(view: *mut EditorView);
```

**macOS (`native/macos/`)** — Core Text + Metal.

`text_renderer.rs`:
- Uses `CTFontCreateWithName` to create a Core Text font from the font family and size.
- For each line, creates a `CTLine` from an attributed string where each token span has its own color attribute (`kCTForegroundColorAttributeName`).
- `CTLineDraw` renders the line into a Core Graphics context.
- Sub-pixel anti-aliasing is enabled via `CGContextSetShouldSmoothFonts`.

`layer_manager.rs`:
- Each visible line gets a `CALayer` for efficient compositing.
- On scroll, layers are repositioned (no re-rendering needed if content hasn't changed).
- Off-screen layers are recycled (layer pool) to avoid allocation churn.

`metal_blitter.rs`:
- For high-performance scenarios (fast scrolling, large files), pre-render lines into a Metal texture atlas.
- On scroll, blit the visible portion of the atlas to the screen.
- On edit, invalidate the affected line's texture and re-render just that line.

**Windows (`native/windows/`)** — DirectWrite + Direct2D.

`text_renderer.rs`:
- `IDWriteFactory::CreateTextFormat` for font configuration.
- `IDWriteFactory::CreateTextLayout` per line, with per-token `SetDrawingEffect` for colors.
- `ID2D1RenderTarget::DrawTextLayout` for rendering.
- ClearType anti-aliasing enabled by default.

`compositor.rs`:
- Uses `IDCompositionDevice` for smooth scrolling via composition surfaces.

**Linux (`native/linux/`)** — Pango + Cairo.

`text_renderer.rs`:
- `PangoFontDescription` for font configuration.
- `PangoLayout` per line with `PangoAttrList` for per-token colors.
- `pango_cairo_show_layout` to render into a Cairo surface.
- Cairo surfaces backed by X11 pixmaps or Wayland shared memory.

`compositor.rs`:
- X11: Use XRender for compositing. Double-buffer via pixmap.
- Wayland: Use wl_surface with damage tracking for minimal redraws.

**iOS (`native/ios/`)** — Core Text + UIKit.

Similar to macOS but using `UIView` instead of `NSView`. Touch handling (`touch_handler.rs`) converts touch events to cursor positions:
- Single tap: move cursor.
- Double tap: select word.
- Long press: enter selection mode with magnifying glass.
- Two-finger pan: scroll.

**Android (`native/android/`)** — Canvas + Skia via JNI.

`text_renderer.rs`:
- JNI calls to `android.graphics.Canvas` and `android.graphics.Paint`.
- Per-token color via `Paint.setColor()`.
- `Canvas.drawText()` for each token span.
- For performance, pre-render lines to `Bitmap` objects and blit.

`input_handler.rs`:
- JNI bridge to `InputMethodManager` for soft keyboard and IME.
- Implements `InputConnection` interface for text input events.

**Web (`native/web/`)** — DOM rendering.

`dom_renderer.rs` (compiled to WASM, interacts with DOM via `web-sys`):
- Each visible line is a `<div>` element with `position: absolute` and `top` set by y_offset.
- Each token within a line is a `<span>` with `color` set to the token color.
- Cursor is a `<div>` with CSS animation for blinking.
- Selection is rendered via `<div>` overlays with semi-transparent background.

`selection_overlay.rs`:
- CSS-based selection rendering using `::selection` pseudo-element where possible.
- For multi-cursor, manual `<div>` overlays.

---

## 6. Perry Integration

### Build Commands

```bash
# macOS build (default development target)
perry compile src/index.ts --target macos --bundle-ffi native/macos/

# Windows build
perry compile src/index.ts --target windows --bundle-ffi native/windows/

# Linux build
perry compile src/index.ts --target linux --bundle-ffi native/linux/

# iOS build
perry compile src/index.ts --target ios --bundle-ffi native/ios/

# Android build
perry compile src/index.ts --target android --bundle-ffi native/android/

# Web build (WASM)
perry compile src/index.ts --target web --bundle-ffi native/web/
```

### FFI Crate Integration

The `--bundle-ffi` flag tells Perry to:
1. Compile the Rust crate in the specified directory using `cargo build --release`.
2. Link the resulting static library (`.a` on macOS/iOS, `.lib` on Windows, `.a` on Linux, `.so` on Android, `.wasm` on Web) with the Perry-compiled binary.
3. Generate TypeScript FFI bindings from the `#[no_mangle]` functions, making them callable as regular TypeScript functions.

In TypeScript code, FFI functions are called like:

```typescript
// Perry auto-generates these imports from the FFI crate
import {
  hone_editor_create,
  hone_editor_destroy,
  hone_editor_set_font,
  hone_editor_render_line,
  hone_editor_set_cursor,
  hone_editor_set_selection,
  hone_editor_scroll,
  hone_editor_measure_text,
  hone_editor_invalidate,
} from 'perry/ffi';

// Usage
const view = hone_editor_create(800, 600);
hone_editor_set_font(view, "JetBrains Mono", 14);
hone_editor_render_line(view, 1, "const x = 42;", '[{"s":0,"e":5,"c":"#569cd6","st":"normal"}]', 0);
```

### State() Reactive Bindings

Perry's `State()` bindings connect the ViewModel's reactive properties to the native rendering layer:

```typescript
import { State, effect } from 'perry/state';

// When visibleLines changes, re-render affected lines
effect(() => {
  const lines = viewModel.visibleLines.value;
  for (const line of lines) {
    const tokensJson = JSON.stringify(line.tokens.map(t => ({
      s: t.startColumn,
      e: t.endColumn,
      c: t.color,
      st: t.fontStyle,
    })));
    hone_editor_render_line(view, line.lineNumber, line.content, tokensJson, line.yOffset);
  }
});

// When cursor changes, update cursor rendering
effect(() => {
  const cursor = viewModel.cursors.value[0]; // primary cursor
  const x = measureCursorX(cursor);
  const y = cursor.line * lineHeight - scrollTop;
  hone_editor_set_cursor(view, x, y, 0); // 0 = line cursor
});

// When scroll state changes, update native scroll offset
effect(() => {
  const scroll = viewModel.scrollState.value;
  hone_editor_scroll(view, scroll.scrollTop);
});
```

### Why Not Perry Canvas

Perry's Canvas widget provides basic drawing primitives:
- `move_to(x, y)`, `line_to(x, y)` — path construction
- `stroke(color, width)` — stroke paths
- `fill_gradient(colors, direction)` — gradient fills

It does **not** provide:
- Text rendering on canvas
- Glyph shaping (ligatures, complex scripts)
- Sub-pixel anti-aliasing
- Font metrics (ascent, descent, advance width)
- Text measurement

A code editor requires all of these. Therefore, the native FFI crates bypass Canvas entirely and manage their own platform-native views. Perry's UI layout system (VStack, HStack) is used only for the chrome around the editor (toolbar, sidebar, status bar), not for the editor surface itself.

---

## 7. Test Strategy

### Unit Tests

**Buffer tests (`tests/buffer.test.ts`):**
- Insert at beginning, middle, end of empty buffer.
- Delete from beginning, middle, end.
- Insert and delete on same offset.
- Line count after inserts with newlines.
- `getLine()` correctness after edits.
- `getLineOffset()` and `getOffsetLine()` round-trip.
- `applyEdits()` with multiple edits in various orders.
- Snapshot and restore: verify content matches.
- **Scale test**: Insert 1 million lines, verify O(log n) performance for random access.
- **Scale test**: 10,000 random insert/delete operations, verify content matches a naive string implementation.

**Cursor tests (`tests/cursor.test.ts`):**
- Move left/right at line boundaries (wraps to previous/next line).
- Move up/down with desired column preservation.
- Move by word (camelCase, underscore_case, mixed).
- Multi-cursor: add cursor above/below, verify positions.
- Multi-cursor: merge overlapping cursors.
- Selection: extend selection via shift+move.
- Selection: select word, select line.
- addNextOccurrence (Ctrl+D): verify correct match found.
- selectAllOccurrences: verify all matches found.

**Search tests (`tests/search.test.ts`):**
- Literal search: case-sensitive and case-insensitive.
- Literal search: no matches.
- Regex search: simple patterns, capture groups.
- Regex search: Unicode patterns (e.g., `\p{L}+`).
- Replace: literal replacement.
- Replace: regex replacement with capture groups (`$1`).
- Replace all: verify all occurrences replaced.
- Incremental search: buffer edit invalidates/updates matches correctly.

**Undo tests (`tests/undo.test.ts`):**
- Single edit, undo restores original.
- Multiple edits, multiple undos.
- Undo then redo restores the edit.
- Redo stack cleared on new edit after undo.
- Coalescing: rapid typing produces single undo step.
- Coalescing boundary: pause > 500ms produces separate undo steps.
- Max depth: exceed 10,000 operations, verify oldest dropped.
- Multi-cursor edit: undo restores all cursors.

**Diff tests (`tests/diff.test.ts`):**
- Identical files: no hunks.
- Empty original, non-empty modified: single add hunk.
- Non-empty original, empty modified: single delete hunk.
- Single line added in middle.
- Single line deleted from middle.
- Single line modified.
- Multiple non-adjacent changes.
- Inline diff: single character change.
- Inline diff: word added/removed.
- Hunk accept/reject state management.

**Folding tests (`tests/folding.test.ts`):**
- Indent-based: nested indentation produces nested fold ranges.
- Indent-based: blank lines within a fold range do not break it.
- Syntax-based: function body is a fold range.
- Syntax-based: nested blocks produce nested fold ranges.
- Fold/unfold: hidden lines correctly tracked.
- Buffer edit within folded range: fold adjusted correctly.

**Viewport tests (`tests/viewport.test.ts`):**
- Visible range calculation for various scroll positions.
- Visible range with folded regions.
- revealLine: top/center/bottom positioning.
- Resize: visible range updates.

### Integration Tests

**Syntax highlighting (`tests/syntax.test.ts`):**
- Parse a TypeScript file, verify token types (keyword, string, comment, etc.).
- Parse, edit (insert a character), re-parse, verify incremental behavior (tree reuse).
- Verify token-to-theme color mapping produces correct hex colors.
- Parse all 10 supported languages with sample files.

### Performance Benchmarks

**Keystroke latency (`tests/benchmarks/keystroke-latency.ts`):**
- Open a 10K-line TypeScript file.
- Measure time from `buffer.insert()` through syntax re-parse through ViewModel update through `hone_editor_render_line()` calls.
- **Target: < 16ms** (within a single 60fps frame).

**Large file open (`tests/benchmarks/large-file-open.ts`):**
- Generate a 100K-line file with realistic code content.
- Measure time from `new EditorDocument(content)` to first `visibleLines` computation.
- **Target: < 500ms** to first render.

**Scroll performance (`tests/benchmarks/scroll-perf.ts`):**
- Open a 100K-line file, fully parsed.
- Simulate rapid continuous scrolling (120fps input events).
- Measure frame drops and average frame time.
- **Target: 60fps minimum, 120fps on ProMotion displays.**

### Performance Targets Summary

| Metric | Target |
|--------|--------|
| Keystroke-to-pixel latency | < 16ms (60fps) |
| Scroll frame rate | 60fps min, 120fps on ProMotion |
| File open (100K lines) | < 500ms to first render |
| Syntax highlighting | Incremental, never blocks input |
| Memory usage | < 2x file size for buffer + syntax tree |
| Ghost text appearance | < 50ms after AI response arrives |

---

## 8. Phased Milestones

### Phase 0: Foundation (Weeks 1-4)

**Goal**: Open a file, see colored text, type, move cursor, undo on macOS.

Week 1-2:
- [ ] Implement piece table (`core/buffer/piece-table.ts`)
- [ ] Implement rope B-tree indexing (`core/buffer/rope.ts`)
- [ ] Implement line index (`core/buffer/line-index.ts`)
- [ ] Implement TextBuffer API (`core/buffer/text-buffer.ts`)
- [ ] Write buffer unit tests (insert, delete, line mapping, 1M-line scale test)
- [ ] Implement EditorDocument (`core/document/document.ts`)
- [ ] Implement EditBuilder (`core/document/edit-builder.ts`)
- [ ] Implement encoding detection (`core/document/encoding.ts`)

Week 2-3:
- [ ] Implement CursorManager (`core/cursor/cursor-manager.ts`)
- [ ] Implement Selection (`core/cursor/selection.ts`)
- [ ] Implement word boundary detection (`core/cursor/word-boundary.ts`)
- [ ] Implement UndoManager (`core/history/undo-manager.ts`)
- [ ] Implement Operation type (`core/history/operation.ts`)
- [ ] Write cursor and undo unit tests

Week 3-4:
- [ ] Implement ViewportManager (`core/viewport/viewport-manager.ts`)
- [ ] Implement scroll logic (`core/viewport/scroll.ts`)
- [ ] Implement line height cache (`core/viewport/line-height.ts`)
- [ ] Implement EditorViewModel skeleton (`view-model/editor-view-model.ts`)
- [ ] Implement line layout (`view-model/line-layout.ts`)
- [ ] Implement cursor state rendering (`view-model/cursor-state.ts`)
- [ ] Implement gutter (`view-model/gutter.ts`)
- [ ] Implement theme system (`view-model/theme.ts`)

Week 4:
- [ ] Implement macOS native FFI crate (`native/macos/`)
  - Core Text font loading and text rendering
  - Basic CALayer compositing
  - Input event handling (keyboard, mouse)
- [ ] Perry integration: compile and run on macOS
- [ ] Basic command registry with insert, delete, backspace, cursor movement
- [ ] Undo/redo wired up

**Phase 0 Milestone**: Open a source file, see it rendered with a monospace font (no syntax coloring yet, just basic text), type characters, move the cursor with arrow keys, undo/redo. Running natively on macOS.

### Phase 1: Full Editor (Weeks 5-10)

**Goal**: Full-featured editor on macOS/Windows/Linux. Publish `@honeide/editor` v0.1.0.

Week 5-6:
- [ ] Integrate Lezer parsers for all 10 languages (`core/tokenizer/`)
- [ ] Implement SyntaxEngine (`core/tokenizer/syntax-engine.ts`)
- [ ] Implement token-to-theme mapping (`core/tokenizer/token-theme.ts`)
- [ ] Implement incremental token cache (`core/tokenizer/incremental.ts`)
- [ ] Set up all grammar files (`core/tokenizer/grammars/`)
- [ ] Syntax highlighting fully working on macOS

Week 6-7:
- [ ] Implement code folding (`core/folding/`)
- [ ] Implement search engine (`core/search/search-engine.ts`)
- [ ] Implement replace (`core/search/replace.ts`)
- [ ] Implement incremental search (`core/search/incremental.ts`)
- [ ] Implement find widget state (`view-model/find-widget.ts`)
- [ ] Implement multi-cursor commands (`core/commands/multicursor.ts`)
- [ ] Implement all editing commands (`core/commands/editing.ts`)
- [ ] Implement all navigation commands (`core/commands/navigation.ts`)
- [ ] Implement selection commands (`core/commands/selection-cmds.ts`)
- [ ] Implement clipboard commands (`core/commands/clipboard.ts`)

Week 7-8:
- [ ] Implement autocomplete overlay (`view-model/overlays.ts`)
- [ ] Implement minimap (`view-model/minimap.ts`)
- [ ] Implement diff engine (`core/diff/`)
- [ ] Implement diff view model (`view-model/diff-view-model.ts`)
- [ ] Implement ghost text rendering (`view-model/ghost-text.ts`)
- [ ] Implement decorations system (`view-model/decorations.ts`)
- [ ] Implement scroll state (`view-model/scroll-state.ts`)

Week 8-9:
- [ ] Implement Windows native FFI crate (`native/windows/`)
  - DirectWrite text rendering
  - Direct2D rendering
  - DirectComposition smooth scrolling
  - Windows keyboard/mouse input handling
- [ ] Perry compile + test on Windows

Week 9-10:
- [ ] Implement Linux native FFI crate (`native/linux/`)
  - Pango text shaping
  - Cairo rendering
  - X11/Wayland surface management
  - Linux keyboard/mouse input handling
- [ ] Perry compile + test on Linux
- [ ] IME support on all three platforms (test with CJK input)
- [ ] Performance optimization pass (hit all benchmark targets)
- [ ] Write all remaining unit tests and integration tests
- [ ] Build examples (`examples/minimal/`, `examples/markdown-editor/`, `examples/diff-viewer/`)

**Phase 1 Milestone**: Full-featured code editor with syntax highlighting (10 languages), code folding, find/replace, multi-cursor, autocomplete overlay, minimap, diff view, ghost text, IME support, clipboard integration. Running natively on macOS, Windows, and Linux. Publish `@honeide/editor` v0.1.0 to npm.

### Phase 2: Language Intelligence (Weeks 11-14)

**Goal**: LSP and DAP integration for smart editor features.

Week 11-12:
- [ ] Implement LSP client (`core/lsp-client/`)
  - JSON-RPC transport
  - Capability negotiation
  - textDocument/completion integration with autocomplete overlay
  - textDocument/hover integration with hover tooltip
  - textDocument/definition for go-to-definition
  - textDocument/references for find-all-references
  - textDocument/publishDiagnostics for error/warning rendering
  - textDocument/signatureHelp for parameter hints

Week 12-13:
- [ ] Implement DAP client (`core/dap-client/`)
  - Debug session lifecycle
  - Breakpoint management (gutter click to toggle)
  - Call stack display
  - Variable inspection
  - Step controls
- [ ] Implement code action rendering (lightbulb icon in gutter, quick fix menu)

Week 13-14:
- [ ] Diagnostic rendering: wavy underlines, gutter icons, diagnostics popup
- [ ] Integration testing with TypeScript language server
- [ ] Integration testing with Python language server (pyright)
- [ ] Performance testing: verify LSP responses don't block editor rendering

**Phase 2 Milestone**: Editor with full LSP integration (autocomplete, hover, diagnostics, go-to-definition, find references, parameter hints, code actions) and DAP integration (breakpoints, stepping, variable inspection). Language intelligence working on macOS/Windows/Linux.

### Phase 3: All Platforms (Weeks 15-18)

**Goal**: iOS, Android, and Web support. All 6 platforms shipping.

Week 15-16:
- [ ] Implement iOS native FFI crate (`native/ios/`)
  - Core Text rendering (shared logic with macOS where possible)
  - UIKit integration
  - Touch handling (tap, double-tap, long press, pan)
  - iOS keyboard integration
- [ ] Perry compile + test on iOS simulator and device

Week 16-17:
- [ ] Implement Android native FFI crate (`native/android/`)
  - Canvas/Skia rendering via JNI
  - Android InputMethodManager integration
  - Touch handling
- [ ] Perry compile + test on Android emulator and device

Week 17-18:
- [ ] Implement Web native crate (`native/web/`)
  - DOM-based rendering (div/span)
  - CSS-based selection and cursor
  - Browser keyboard event handling
  - Browser clipboard API integration
- [ ] Perry compile to WASM + test in browsers (Chrome, Firefox, Safari)
- [ ] Cross-platform testing and polish
- [ ] Performance tuning for mobile (smaller viewport, touch scrolling)

**Phase 3 Milestone**: `@honeide/editor` running on all 6 platforms: macOS, Windows, Linux, iOS, Android, Web. Publish v0.2.0.

---

## 9. Open Questions / Risks

### Critical Risks

1. **Perry Canvas lacks text-on-canvas**: This is the fundamental constraint driving the FFI crate architecture. Each platform requires a separate Rust crate with platform-specific text rendering code. This is significant engineering effort (6 crates) but is the only viable path given Perry's limitations. Mitigation: share as much logic as possible in a common `hone-editor-core` Rust crate, with thin platform-specific wrappers.

2. **Perry FFI stability (v0.2.x)**: Perry is pre-1.0. The FFI interface (`--bundle-ffi`, auto-generated TypeScript bindings) may change between releases. Mitigation: pin Perry version in `perry.config.ts`, wrap all FFI calls behind a TypeScript abstraction layer so FFI changes are isolated.

3. **IME handling complexity**: Input Method Editor support (for CJK languages, emoji input, etc.) is notoriously complex and differs across platforms. macOS has `NSTextInputClient`, Windows has `ITextStoreACP`/`TSF`, Linux has `IBus`/`Fcitx`, iOS has `UITextInput`, Android has `InputConnection`. Each requires careful implementation to handle composition, candidate selection, and final commit. Mitigation: test CJK input from day one (Phase 0). Prioritize macOS/Windows IME in Phase 0/1, Linux/iOS/Android in Phase 3.

### Design Decisions Pending

4. **Line wrapping / word wrap**: Word wrap interacts with virtual scrolling in complex ways. A wrapped line occupies multiple screen rows but is a single document line. The viewport manager and line height cache must account for this. Decision needed: implement word wrap in Phase 0 (adds complexity but is expected) or Phase 1 (simpler Phase 0 but deferred risk)? **Recommendation**: Phase 1. Phase 0 uses horizontal scrolling only.

5. **Minimap rendering approach**: Two options:
   - **Pixel-level text preview**: Actually render text at ~1/8 scale. Provides accurate visual representation but expensive to render and update.
   - **Block colors**: For each line, compute the dominant syntax color per block of characters. Render colored rectangles. Cheaper and sufficient for navigation. **Recommendation**: Block colors for v0.1, pixel-level as optional enhancement later.

6. **Lezer grammar coverage**: Lezer has good grammar support for major languages but may lack grammars for niche languages (e.g., Zig, Elixir, Haskell). Mitigation: implement a fallback regex-based tokenizer for languages without Lezer grammars. The regex tokenizer provides basic keyword/string/comment highlighting without full parse tree support.

### Performance Risks

7. **Large file performance**: Files with 1M+ lines stress the rope data structure, syntax parser, and viewport. The rope handles this well (O(log n) operations), but syntax parsing may struggle. Lezer's incremental parsing is efficient, but the initial parse of a 1M-line file may take several seconds. Mitigation: for very large files (> 500K lines), skip syntax highlighting until the user scrolls to a region (lazy parsing). Show plain text initially, then progressively highlight.

8. **Memory pressure on mobile**: iOS and Android have tighter memory constraints than desktop. A 100MB file with syntax tree could exceed available memory. Mitigation: implement memory budgets and spill strategies (e.g., release syntax trees for off-screen regions, re-parse on demand).

### Ecosystem Risks

9. **Community grammar quality**: Lezer grammars are community-maintained and may have bugs or incomplete coverage. The TypeScript and JavaScript grammars (maintained by CodeMirror team) are high quality, but others may be less reliable. Mitigation: thorough testing of each grammar with real-world code samples. Contribute fixes upstream where possible.

10. **Cross-platform font consistency**: Different platforms render fonts differently (hinting, anti-aliasing, metrics). The same font at the same size may produce different glyph widths on macOS vs. Windows, causing layout differences. Mitigation: use `hone_editor_measure_text()` for all layout calculations (always platform-native measurement). Accept minor visual differences across platforms as long as functionality is consistent.
