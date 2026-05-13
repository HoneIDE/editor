/**
 * Perry Editor Component: embeddable code editor for Perry apps.
 *
 * Wraps EditorDocument + EditorViewModel + NativeRenderCoordinator
 * behind a simple API. FFI functions are declared as extern and resolved
 * by Perry's codegen from the perry.nativeLibrary manifest in package.json.
 *
 * Supports up to 3 concurrent Editor instances (main + 2 diff editors).
 */

import { embedNSView } from 'perry/ui';
import { EditorDocument } from '../core/document/document';
import { EditorViewModel, KeyEvent, MouseEvent as EditorMouseEvent, ScrollEvent, setPerryMarkdownState, setPerryLanguageState, setPerryTokenTheme, getPerryCursorState, setPerryCursorPos, getPerryClipboard } from '../view-model/editor-view-model';
import { NativeRenderCoordinator, RenderCoordinatorConfig } from '../native/render-coordinator';
import { DARK_THEME, LIGHT_THEME, EditorTheme } from '../view-model/theme';
import type { NativeEditorFFI, NativeViewHandle } from '../native/ffi-bridge';
import { KeywordSyntaxEngine } from '../core/tokenizer/keyword-syntax-engine';
import { CompositeEngine } from '../core/tokenizer/composite-engine';

// ============================================================
// FFI function declarations — resolved by Perry's codegen from
// the perry.nativeLibrary manifest in package.json.
// These compile to extern "C" function references.
// ============================================================

declare function hone_editor_create(width: number, height: number): number;
declare function hone_editor_destroy(handle: number): void;
declare function hone_editor_set_font(handle: number, family: string, size: number): void;
declare function hone_editor_render_line(handle: number, lineNumber: number, text: string, tokensJson: string, yOffset: number): void;
declare function hone_editor_set_cursor(handle: number, x: number, y: number, style: number): void;
declare function hone_editor_set_selection(handle: number, regionsJson: string): void;
declare function hone_editor_scroll(handle: number, offsetY: number): void;
declare function hone_editor_measure_text(handle: number, text: string): number;
declare function hone_editor_invalidate(handle: number): void;
declare function hone_editor_begin_frame(handle: number): void;
declare function hone_editor_end_frame(handle: number): void;
declare function hone_editor_render_ghost_text(handle: number, text: number, x: number, y: number, color: number): void;
declare function hone_editor_render_decorations(handle: number, decorationsJson: number): void;
// Tree-sitter bridge (SHIP-V1-GAPS.md #16). Parses the full source once via
// `hone_editor_ts_parse`; per-line tokenization slices the cached scopes by
// byte range. langId: 0 = TypeScript, 1 = Python (Phase 1 expands the set).
declare function hone_editor_ts_parse(source: string, langId: number): number;
declare function hone_editor_ts_clear(): void;
declare function hone_editor_ts_token_count(): number;
declare function hone_editor_ts_token_start(idx: number): number;
declare function hone_editor_ts_token_end(idx: number): number;
declare function hone_editor_ts_token_scope(idx: number): string;
// SHIP-V1-GAPS.md #17: per-language live tokenizer + theme-aware palette.
// Set on language switch (tab change) and on theme switch respectively.
declare function hone_editor_set_tokenizer_language(langId: number): void;
declare function hone_editor_set_token_colors(
  keyword: number, str: number, comment: number, variable: number,
  typename: number, fn: number, num: number, def: number,
): void;
declare function hone_editor_set_find_highlights(handle: number, json: number): void;
declare function hone_editor_clear_find_highlights(handle: number): void;
declare function hone_editor_set_cursors(handle: number, cursorsJson: number): void;
declare function hone_editor_attach_to_view(handle: number, parentView: number): void;
declare function hone_editor_nsview(handle: number): number;

// === Event callback + polling API ===
declare function hone_editor_set_event_callback(handle: number, cb: () => void): void;
declare function hone_editor_pending_event_count(handle: number): number;
declare function hone_editor_get_event_type(handle: number, index: number): number;
declare function hone_editor_get_event_char(handle: number, index: number): number;
declare function hone_editor_get_event_action(handle: number, index: number): number;
declare function hone_editor_get_event_x(handle: number, index: number): number;
declare function hone_editor_get_event_y(handle: number, index: number): number;
declare function hone_editor_clear_events(handle: number): void;
declare function hone_editor_set_ts_mode(handle: number, mode: number): void;
declare function hone_editor_is_ios(): number;
declare function hone_editor_poll_touch(handle: number): number;
declare function hone_editor_set_gutter_width(handle: number, width: number): void;

// === Read-only + line background FFI ===
declare function hone_editor_set_read_only(handle: number, mode: number): void;
declare function hone_editor_set_line_background(handle: number, line: number, r: number, g: number, b: number, a: number): void;
declare function hone_editor_clear_line_backgrounds(handle: number): void;
declare function hone_editor_set_line_diagnostics(handle: number, packedData: number): void;
declare function hone_editor_clear_diagnostics(handle: number): void;
declare function hone_editor_set_breakpoints(handle: number, packedLines: number): void;
declare function hone_editor_set_fold_ranges(handle: number, packedData: number): void;

// === Clipboard FFI ===
declare function hone_editor_copy_to_clipboard(handle: number, text: number): void;
declare function hone_editor_paste_from_clipboard(handle: number): void;

// === Scroll delta + line cache FFI ===
declare function hone_editor_get_scroll_delta(handle: number): number;
declare function hone_editor_clear_scroll_delta(handle: number): void;
declare function hone_editor_get_scroll_delta_x(handle: number): number;
declare function hone_editor_clear_scroll_delta_x(handle: number): void;
declare function hone_editor_needs_lines(handle: number): number;
declare function hone_editor_clear_line_cache(handle: number): void;

// === View size query FFI ===
declare function hone_editor_get_view_width(handle: number): number;
declare function hone_editor_get_view_height(handle: number): number;

// === Theme colors FFI ===
declare function hone_editor_set_bg_color(handle: number, r: number, g: number, b: number): void;
declare function hone_editor_set_fg_color(handle: number, r: number, g: number, b: number): void;
declare function hone_editor_set_gutter_fg_color(handle: number, r: number, g: number, b: number): void;
declare function hone_editor_set_selection_color(handle: number, r: number, g: number, b: number, a: number): void;
declare function hone_editor_set_cursor_color(handle: number, r: number, g: number, b: number): void;

// === New TS-authoritative render protocol FFI ===
declare function hone_editor_cache_line(handle: number, lineNumber: number, text: number, packedTokens: number): void;
declare function hone_editor_invalidate_line(handle: number, lineNumber: number): void;
declare function hone_editor_set_viewport(handle: number, startLine: number, endLine: number, scrollTop: number, totalLines: number, lineHeight: number): void;
declare function hone_editor_begin_selections(handle: number, count: number): void;
declare function hone_editor_add_selection_rect(handle: number, x: number, y: number, w: number, h: number): void;

// === Action IDs (must match Rust action_id constants) ===
const ACTION_MOVE_LEFT = 1;
const ACTION_MOVE_RIGHT = 2;
const ACTION_MOVE_UP = 3;
const ACTION_MOVE_DOWN = 4;
const ACTION_MOVE_BOL = 5;
const ACTION_MOVE_EOL = 6;
const ACTION_MOVE_BOD = 7;
const ACTION_MOVE_EOD = 8;
const ACTION_INSERT_NEWLINE = 9;
const ACTION_DELETE_BACKWARD = 10;
const ACTION_DELETE_FORWARD = 11;
const ACTION_INSERT_TAB = 12;
const ACTION_MOVE_WORD_LEFT = 13;
const ACTION_MOVE_WORD_RIGHT = 14;
const ACTION_MOVE_LEFT_SEL = 15;
const ACTION_MOVE_RIGHT_SEL = 16;
const ACTION_MOVE_UP_SEL = 17;
const ACTION_MOVE_DOWN_SEL = 18;
const ACTION_MOVE_BOL_SEL = 19;
const ACTION_MOVE_EOL_SEL = 20;
const ACTION_SELECT_ALL = 21;
const ACTION_CUT = 22;
const ACTION_COPY = 23;
const ACTION_PASTE = 24;
const ACTION_UNDO = 25;
const ACTION_REDO = 26;
const ACTION_DELETE_WORD_BACKWARD = 27;
const ACTION_PAGE_UP = 28;
const ACTION_PAGE_DOWN = 29;

// === Event type constants (must match Rust event_type) ===
const EVENT_TEXT = 1;
const EVENT_ACTION = 2;
const EVENT_SCROLL = 3;
const EVENT_MOUSE_DOWN = 4;
const EVENT_MOUSE_DRAG = 5;

// === Multi-instance editor slots (max 3: main + 2 diff editors) ===
// Perry closures can't be passed as C function pointers on ARM64 (non-executable heap memory).
// Use module-level slots + a top-level (non-closure) function instead.
let _editor0: Editor | null = null;
let _editor1: Editor | null = null;
let _editor2: Editor | null = null;
let _editorCount: number = 0;
let _pollStarted: number = 0;
let _currentBufferText: string = '';
let _isMobilePlatform: number = 0;
let _debugHandle: number = 0;

// Persistent decoration JSON — pushed after every coordinator.render() so decorations
// survive the begin_frame clear. Set via setPersistentDecorations() from IDE code.
let _persistentDecorations = '';
let _measuredCharWidth: number = 8.5;

/** Set persistent decorations JSON that gets re-pushed after every begin_frame clear.
 * Use for find highlights, bracket matching, etc. that must survive frame clears.
 * Pass empty string to clear. */
export function setPersistentDecorations(json: string): void {
  _persistentDecorations = json;
}

export function createEditorPerryWidget(): unknown {
  if (_debugHandle === 0) { return 0; }
  const viewPtr = hone_editor_nsview(_debugHandle);
  return embedNSView(viewPtr);
}

function _registerEditor(ed: Editor): number {
  if (_editor0 === null) { _editor0 = ed; _editorCount = _editorCount + 1; return 0; }
  if (_editor1 === null) { _editor1 = ed; _editorCount = _editorCount + 1; return 1; }
  if (_editor2 === null) { _editor2 = ed; _editorCount = _editorCount + 1; return 2; }
  return -1; // all slots full
}

function _unregisterEditor(slot: number): void {
  if (slot === 0) { _editor0 = null; }
  else if (slot === 1) { _editor1 = null; }
  else if (slot === 2) { _editor2 = null; }
  _editorCount = _editorCount - 1;
  if (_editorCount < 0) _editorCount = 0;
}

/** Module-level poll function for setInterval. */
function _pollAllEditors(): void {
  _editor0?.flushEvents();
  _editor1?.flushEvents();
  _editor2?.flushEvents();
}

/**
 * FFI implementation that delegates to Perry's extern FFI functions.
 * String parameters use i64 pointers (Perry handles string allocation).
 */
class PerryEditorFFI implements NativeEditorFFI {
  create(width: number, height: number): NativeViewHandle {
    return hone_editor_create(width, height);
  }

  destroy(handle: NativeViewHandle): void {
    hone_editor_destroy(handle);
  }

  setFont(handle: NativeViewHandle, family: string, size: number): void {
    hone_editor_set_font(handle, family as any, size);
  }

  renderLine(handle: NativeViewHandle, lineNumber: number, text: string, tokensJson: string, yOffset: number): void {
    hone_editor_render_line(handle, lineNumber, text as any, tokensJson as any, yOffset);
  }

  setCursor(handle: NativeViewHandle, x: number, y: number, style: number): void {
    hone_editor_set_cursor(handle, x, y, style);
  }

  setSelection(handle: NativeViewHandle, regionsJson: string): void {
    hone_editor_set_selection(handle, regionsJson as any);
  }

  scroll(handle: NativeViewHandle, offsetY: number): void {
    hone_editor_scroll(handle, offsetY);
  }

  measureText(handle: NativeViewHandle, text: string): number {
    return hone_editor_measure_text(handle, text as any);
  }

  invalidate(handle: NativeViewHandle): void {
    hone_editor_invalidate(handle);
  }

  beginFrame(handle: NativeViewHandle): void {
    hone_editor_begin_frame(handle);
  }

  endFrame(handle: NativeViewHandle): void {
    hone_editor_end_frame(handle);
  }

  renderGhostText(handle: NativeViewHandle, text: string, x: number, y: number, color: string): void {
    hone_editor_render_ghost_text(handle, text as any, x, y, color as any);
  }

  renderDecorations(handle: NativeViewHandle, decorationsJson: string): void {
    hone_editor_render_decorations(handle, decorationsJson as any);
  }

  setCursors(handle: NativeViewHandle, cursorsJson: string): void {
    hone_editor_set_cursors(handle, cursorsJson as any);
  }

  cacheLine(handle: NativeViewHandle, lineNumber: number, text: string, packedTokens: string): void {
    hone_editor_cache_line(handle, lineNumber, text as any, packedTokens as any);
  }

  setViewport(handle: NativeViewHandle, startLine: number, endLine: number, scrollTop: number, totalLines: number, lineHeight: number): void {
    hone_editor_set_viewport(handle, startLine, endLine, scrollTop, totalLines, lineHeight);
  }

  beginSelections(handle: NativeViewHandle, count: number): void {
    hone_editor_begin_selections(handle, count);
  }

  addSelectionRect(handle: NativeViewHandle, x: number, y: number, w: number, h: number): void {
    hone_editor_add_selection_rect(handle, x, y, w, h);
  }
}

/**
 * Options for configuring the Editor component.
 */
export interface EditorOptions {
  /** Custom FFI implementation. Omit to use Perry's native FFI. Useful for testing. */
  ffi?: NativeEditorFFI;
  /** Initial text content. Defaults to empty string. */
  content?: string;
  /** Language ID for syntax highlighting (e.g. 'typescript', 'python'). Defaults to 'typescript'. */
  language?: string;
  /** Color theme. Defaults to 'dark'. */
  theme?: 'dark' | 'light';
  /** Font size in points. Defaults to 14. */
  fontSize?: number;
  /** Font family name. Defaults to 'JetBrains Mono'. */
  fontFamily?: string;
  /** Read-only mode. When true, text input and edit actions are blocked. */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for the Rust-side per-language tokenizer (SHIP-V1-GAPS.md #17).
// ---------------------------------------------------------------------------

/** Parse "#RRGGBB" (and "#RRGGBBAA") into a 24-bit integer for FFI. */
function hexToInt(hex: string): number {
  if (hex.length < 7 || hex.charCodeAt(0) !== 35) return 0;
  let n = 0;
  for (let i = 1; i < 7; i++) {
    const c = hex.charCodeAt(i);
    let d = 0;
    if (c >= 48 && c <= 57) d = c - 48;
    else if (c >= 97 && c <= 102) d = c - 87;
    else if (c >= 65 && c <= 70) d = c - 55;
    n = n * 16 + d;
  }
  return n;
}

/**
 * Map a language id string to the Rust LangId enum.
 * Order must match `lang_from_i32` in `tokenizer.rs`.
 *   0=TS 1=JS 2=Python 3=Rust 4=Go 5=Swift 6=Java 7=C/C++.
 * Unknown languages fall back to TypeScript (most permissive grammar in the set).
 */
function tokenizerLangId(languageId: string): number {
  if (languageId.length === 0) return 0;
  const c0 = languageId.charCodeAt(0);
  const c1 = languageId.length >= 2 ? languageId.charCodeAt(1) : 0;
  if (c0 === 116 && c1 === 121) return 0; // 't','y' typescript
  if (c0 === 116 && c1 === 115) return 0; // 't','s' tsx → TS
  if (c0 === 106) return 1;               // 'j' javascript / jsx
  if (c0 === 112 && c1 === 121) return 2; // 'p','y' python
  if (c0 === 114 && c1 === 117) return 3; // 'r','u' rust
  if (c0 === 103 && c1 === 111) return 4; // 'g','o'
  if (c0 === 115 && c1 === 119) return 5; // 's','w' swift
  if (c0 === 106 && c1 === 97) return 6;  // 'j','a' java
  if (c0 === 99) return 7;                // 'c' c, cpp
  return 0;
}

/**
 * Perry-embeddable code editor component.
 */
export class Editor {
  private _doc: EditorDocument;
  private _vm: EditorViewModel;
  private _coordinator: NativeRenderCoordinator;
  private _ffi: NativeEditorFFI;
  private _width: number;
  private _height: number;
  private _disposed: boolean;
  private _readOnly: boolean;
  private _editorSlot: number;
  private _isMd: number;
  private _isIOS: number;
  private _needsInitialRender: number;
  nativeHandle: number | null;

  constructor(width: number, height: number, opts?: EditorOptions) {
    this._disposed = false;
    this._readOnly = false;
    this._editorSlot = -1;
    this._isMd = 0;
    this._isIOS = 0;
    this._needsInitialRender = 1;
    this._width = width;
    this._height = height;
    this.nativeHandle = null;

    const ffi: NativeEditorFFI = opts?.ffi ?? new PerryEditorFFI();
    this._ffi = ffi;

    const initialContent = opts?.content ?? '';
    const language = opts?.language ?? 'typescript';
    const fontSize = opts?.fontSize ?? 14;
    const fontFamily = opts?.fontFamily ?? 'Menlo';
    const theme: EditorTheme = opts?.theme === 'light' ? LIGHT_THEME : DARK_THEME;
    const readOnly = opts?.readOnly === true;

    const doc = new EditorDocument('untitled', initialContent, language);
    this._doc = doc;

    // CompositeEngine routes per-language: tree-sitter for TS/JS/TSX/JSX/Python
    // (SHIP-V1-GAPS.md #16); KeywordSyntaxEngine fallback for everything else.
    const syntaxEngine = new CompositeEngine();
    const vm = new EditorViewModel(doc, theme, syntaxEngine);
    vm.setPerryMode(true);
    vm.setDirectTokens(1);
    setPerryLanguageState(language);
    this._vm = vm;

    const config: RenderCoordinatorConfig = {
      fontFamily,
      fontSize,
      lineHeight: 1.5,
    };

    const coordinator = new NativeRenderCoordinator(ffi, config);
    this._coordinator = coordinator;

    // Call hone_editor_create directly and inject the handle into the coordinator.
    const handle = hone_editor_create(width, height);
    coordinator.setHandle(handle);
    this.nativeHandle = handle;
    _debugHandle = handle as number;

    coordinator.attach(vm);

    // Measure real char width from native renderer.
    const measuredWidth = hone_editor_measure_text(handle, 'M' as any);
    if (measuredWidth > 0) {
      vm.setCharWidth(measuredWidth);
      _measuredCharWidth = measuredWidth;
    }

    // Sync gutter width to Rust for pixel-perfect cursor/text alignment.
    hone_editor_set_gutter_width(handle, vm.gutterWidth);

    vm.onResize(width, height);

    // Detect platform
    const iosCheck = hone_editor_is_ios();
    if (iosCheck > 0) { _isMobilePlatform = 1; }
    this._isIOS = _isMobilePlatform;

    // Enable ts_mode: Rust only queues events, TypeScript handles all state.
    hone_editor_set_ts_mode(handle, 1);

    // Apply read-only mode
    if (readOnly) {
      this._readOnly = true;
      hone_editor_set_read_only(handle, 1);
    }

    // Direct render to populate frame_lines in the Rust view.
    _currentBufferText = initialContent;
    this._directRenderText(initialContent);

    // Clear TS-side cache so next render() re-sends lines with proper tokens.
    coordinator.clearLineCache();

    // Register in a multi-instance slot.
    this._editorSlot = _registerEditor(this);

    // Start the shared poll timer only once (first Editor instance).
    if (_pollStarted < 1) {
      _pollStarted = 1;
      setInterval(() => { _pollAllEditors(); }, 8);
    }
  }

  /** Get the current text content. */
  get content(): string {
    return this._doc.buffer.getText();
  }

  /** Get the current text content (method form for Perry compatibility). */
  getContent(): string {
    return this._doc.buffer.getText();
  }

  /** Replace all content. */
  set content(text: string) {
    this.setContent(text);
  }

  /** Replace all content (regular method — Perry may not support property setters). */
  setContent(text: string): void {
    const doc = this._doc;
    const buf = doc.buffer;
    // Delete existing content first
    const len = buf.getLength();
    if (len > 0) {
      buf.delete(0, len);
    }
    buf.insert(0, text);
    let lineCount = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) lineCount++;
    }
    const vm = this._vm;
    vm.viewport.setTotalLines(lineCount);
    // Reset scroll and cursor to top of new content
    vm.viewport.scroll.scrollTo(0, 0);
    vm.cursorManager.reset(0, 0);
    const engine = vm.syntaxEngine;
    engine.parse(buf);
    if (this._isMd === 1) {
      // Build fence cache: 'N' = not in fence, 'F' = in fence
      let fenceStr = '';
      let inFence = false;
      for (let fi = 0; fi < lineCount; fi++) {
        if (inFence) {
          fenceStr += 'F';
        } else {
          fenceStr += 'N';
        }
        const fline = buf.getLine(fi);
        const ftrimmed = fline.trimStart();
        if (ftrimmed.length >= 3 && ftrimmed.charAt(0) === '`' && ftrimmed.charAt(1) === '`' && ftrimmed.charAt(2) === '`') {
          inFence = !inFence;
        }
      }
      setPerryMarkdownState(1, fenceStr);
    }
    // Clear Rust line cache — old lines are stale after content change.
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_clear_line_cache(handle as number);
    }
    vm.touch();
    _currentBufferText = text;
    this._directRenderText(text);
    this._coordinator.clearLineCache();
  }

  /** Switch the syntax highlighting language. */
  setLanguage(languageId: string): void {
    const doc = this._doc;
    doc.languageId = languageId;
    const vm = this._vm;
    const engine = vm.syntaxEngine;
    engine.setLanguage(languageId);
    engine.parse(doc.buffer);
    setPerryLanguageState(languageId);
    if (languageId === 'markdown') {
      this._isMd = 1;
      setPerryMarkdownState(1, '');
    } else {
      this._isMd = 0;
      setPerryMarkdownState(0, '');
    }
    // SHIP-V1-GAPS.md #17: push the language id to the Rust live tokenizer
    // so on-keystroke retokenization uses the right keyword table.
    hone_editor_set_tokenizer_language(tokenizerLangId(languageId));
    const coordinator = this._coordinator;
    coordinator.invalidate();
  }

  /** Get the underlying EditorDocument. */
  get document(): EditorDocument {
    return this._doc;
  }

  /** Get the underlying EditorViewModel. */
  get viewModel(): EditorViewModel {
    return this._vm;
  }

  /**
   * Embed the editor's native NSView into Perry's layout system and return
   * an opaque Perry widget handle for use in VStack / HStack children.
   *
   * All FFI knowledge lives here — callers need no awareness of
   * hone_editor_nsview or embedNSView.
   *
   * NOTE: Perry codegen inverts !== null checks on union-typed fields.
   * Skip the null guard and cast directly — the constructor always sets
   * nativeHandle to a valid value before this method is called.
   */

  /**
   * Push decoration overlays to the Rust renderer.
   * JSON array of { x, y, w, h, color, type } objects.
   * Must be called each frame — decorations are appended (cleared on next draw cycle).
   */
  pushDecorations(decorationsJson: string): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_render_decorations(handle as number, decorationsJson as any);
    }
  }

  /**
   * Set persistent find highlights. NOT cleared by begin_frame — persists until
   * explicitly changed or cleared. Use for find/replace match highlighting.
   */
  setFindHighlights(json: string): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_find_highlights(handle as number, json as any);
    }
  }

  /** Clear find highlights. */
  clearFindHighlights(): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_clear_find_highlights(handle as number);
    }
  }

  /**
   * Set line diagnostics for Error Lens rendering.
   * packedData format: "line:severity:color:message\n..." (1-based lines)
   * severity: 1=error, 2=warning, 3=info, 4=hint
   */
  setLineDiagnostics(packedData: string): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_line_diagnostics(handle as number, packedData as any);
    }
  }

  /** Set breakpoint lines (1-based, newline-separated). */
  setBreakpoints(packedLines: string): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_breakpoints(handle as number, packedLines as any);
    }
  }

  /** Set fold range indicators (packed "line:collapsed\n..." format). */
  setFoldRanges(packedData: string): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_fold_ranges(handle as number, packedData as any);
    }
  }

  /** Clear all line diagnostics. */
  clearDiagnostics(): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_clear_diagnostics(handle as number);
    }
  }

  /**
   * Get the character width in pixels (for column→pixel conversion).
   */
  getCharWidth(): number {
    return this._vm.getCharWidth();
  }

  /**
   * Get the viewport start/end line numbers (0-based).
   */
  getViewportRange(): { startLine: number; endLine: number } {
    return this._vm.viewport.getVisibleRange();
  }

  /**
   * Get the cursor line number (0-based).
   */
  getCursorLine(): number {
    const state = getPerryCursorState();
    return state.line;
  }

  /**
   * Get the cursor column (0-based).
   */
  getCursorColumn(): number {
    const state = getPerryCursorState();
    return state.col;
  }

  /**
   * Set the cursor position (0-based line + column).
   * SHIP-V1-GAPS.md #43: used by the IDE to restore cursor on session reload.
   */
  setCursorPosition(line: number, col: number): void {
    setPerryCursorPos(line, col);
  }

  /** Read the editor's vertical scroll offset in pixels. */
  getScrollTop(): number {
    return this._vm.viewport.scroll.scrollTop;
  }

  /** Scroll the editor to the given pixel offset (top-left origin). */
  setScrollTop(scrollTop: number): void {
    this._vm.viewport.scroll.scrollTo(scrollTop);
  }

  createPerryWidget(): unknown {
    return embedNSView(hone_editor_nsview(_debugHandle));
  }

  /** Attach the editor's native view to a parent view (Perry NSView/UIView/HWND). */
  attachToView(parentView: number): void {
    const handle = this._coordinator.handle;
    if (handle !== null) {
      hone_editor_attach_to_view(handle, parentView);
    }
  }

  /** Handle a key down event. Returns true if the event was consumed. */
  onKeyDown(key: string, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): boolean {
    const event: KeyEvent = {
      key,
      code: key,
      ctrlKey: modifiers?.ctrl === true,
      shiftKey: modifiers?.shift === true,
      altKey: modifiers?.alt === true,
      metaKey: modifiers?.meta === true,
    };
    return this._vm.onKeyDown(event);
  }

  /** Handle text input (e.g., from IME). */
  onTextInput(text: string): void {
    const vm = this._vm;
    vm.onTextInput(text);
  }

  /** Execute a named command (e.g., 'editor.action.undo'). */
  executeCommand(commandId: string, args?: any): boolean {
    const vm = this._vm;
    return vm.executeCommand(commandId, args);
  }

  /** Handle resize. */
  onResize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    const vm = this._vm;
    vm.onResize(width, height);
  }

  /** Trigger a render cycle. */
  render(): void {
    const coordinator = this._coordinator;
    coordinator.render();
  }

  /** Set read-only mode at runtime. */
  setReadOnly(mode: boolean): void {
    this._readOnly = mode;
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_read_only(handle as number, mode ? 1 : 0);
    }
  }

  /** Set a background color for a specific line (1-based). Used for diff highlighting. */
  setLineBackground(line: number, r: number, g: number, b: number, a: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_line_background(handle as number, line, r, g, b, a);
    }
  }

  /** Clear all per-line background colors. */
  clearLineBackgrounds(): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_clear_line_backgrounds(handle as number);
    }
  }

  /**
   * Drain the Rust event queue and re-render. Called by the synchronous Rust
   * event_callback (_globalEventHandler) when Rust queues a new input event.
   * Public so the module-level top-level function can reach it without a closure.
   */
  flushEvents(): void {
    const h = this.nativeHandle as number;
    if (h === null || h < 1) return; // Guard against uninitialized/freed handle

    // Sync view dimensions
    let sizeChanged = 0;
    const actualW = hone_editor_get_view_width(h);
    const actualH = hone_editor_get_view_height(h);
    if (actualW > 1 && actualH > 1) {
      if (Math.abs(actualW - this._width) > 1 || Math.abs(actualH - this._height) > 1) {
        this._width = actualW;
        this._height = actualH;
        this._vm.onResize(actualW, actualH);
        sizeChanged = 1;
      }
    }

    // Sync scroll delta (vertical) — go through `vm.applyScrollDelta`
    // instead of `vm.viewport.scroll.scrollBy` so the call dispatches to
    // a directly-imported class. The deeper chain silently no-ops.
    const scrollDelta = hone_editor_get_scroll_delta(h);
    let scrollChanged = 0;
    if (scrollDelta !== 0) {
      this._vm.applyScrollDelta(0, -scrollDelta);
      hone_editor_clear_scroll_delta(h);
      scrollChanged = 1;
    }

    // Sync horizontal scroll delta (same reason as vertical above).
    const scrollDeltaX = hone_editor_get_scroll_delta_x(h);
    if (scrollDeltaX !== 0) {
      this._vm.applyScrollDelta(scrollDeltaX, 0);
      hone_editor_clear_scroll_delta_x(h);
      scrollChanged = 1;
    }

    // Initial render flag
    let needsRender = 0;
    if (this._needsInitialRender > 0) {
      this._needsInitialRender = 0;
      needsRender = 1;
    }

    // Process input events
    const hadEvents = this._pollEvents();

    if (_isMobilePlatform > 0) {
      // Mobile path (iOS/Android): direct render + invalidate
      hone_editor_poll_touch(h);
      hone_editor_set_gutter_width(h, 52);
      this._directRenderText(_currentBufferText);
    } else {
      // Desktop path — render only when needed
      const rustNeedsLines = hone_editor_needs_lines(h);
      if (hadEvents > 0 || scrollChanged > 0 || sizeChanged > 0 || needsRender > 0 || rustNeedsLines > 0) {
        hone_editor_set_gutter_width(h, this._vm.gutterWidth);
        // Use direct FFI render (coordinator.render() uses interface dispatch
        // which doesn't work in Perry's AOT mode on Windows/Linux).
        this._directRenderText(_currentBufferText);
      }
    }
    // Re-push persistent decorations after render (begin_frame clears them)
    if (_persistentDecorations.length > 2 && _debugHandle > 0) {
      hone_editor_render_decorations(_debugHandle, _persistentDecorations as any);
    }
    // Always sync cursor/selection and invalidate on all platforms.
    this._syncCursor(h, this._vm);
    hone_editor_invalidate(h);
  }

  /** Set the font. */
  setFont(family: string, size: number): void {
    const coordinator = this._coordinator;
    coordinator.setFont(family, size);
    coordinator.render();
  }

  /** Subscribe to editor state changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    return this._vm.onChange(listener);
  }

  /**
   * Drain the Rust event queue and process all pending input events.
   * Called periodically by the setInterval timer.
   * Returns: 0 = no events, 1 = scroll-only, 2 = content-changing events
   */
  private _pollEvents(): number {
    if (this._disposed) return 0;
    const handle = this.nativeHandle as number;

    const count = hone_editor_pending_event_count(handle);
    if (count <= 0) return 0;

    const vm = this._vm;
    const isReadOnly = this._readOnly;
    let hadContentChange = 0;

    for (let i = 0; i < count; i++) {
      const evType = hone_editor_get_event_type(handle as number, i);

      if (evType === EVENT_TEXT) {
        // Skip text input in read-only mode
        if (isReadOnly) continue;
        const code = hone_editor_get_event_char(handle as number, i);
        if (code > 0) {
          const ch = String.fromCharCode(code);
          vm.onTextInput(ch);
          hadContentChange = 1;
        }
      } else if (evType === EVENT_ACTION) {
        const aid = hone_editor_get_event_action(handle as number, i);
        // Skip edit actions in read-only mode
        if (isReadOnly) {
          if (aid === ACTION_INSERT_NEWLINE) continue;
          if (aid === ACTION_DELETE_BACKWARD) continue;
          if (aid === ACTION_DELETE_FORWARD) continue;
          if (aid === ACTION_INSERT_TAB) continue;
          if (aid === ACTION_CUT) continue;
          if (aid === ACTION_PASTE) continue;
          if (aid === ACTION_UNDO) continue;
          if (aid === ACTION_REDO) continue;
          if (aid === ACTION_DELETE_WORD_BACKWARD) continue;
        }
        this._dispatchAction(vm, aid);
        hadContentChange = 1;
      } else if (evType === EVENT_SCROLL) {
        const dx = hone_editor_get_event_x(handle as number, i);
        const dy = hone_editor_get_event_y(handle as number, i);
        // macOS scrollingDeltaY: positive = scroll up (natural) → scrollTop decreases
        const scrollEvent: ScrollEvent = { deltaX: -dx, deltaY: -dy };
        vm.onScroll(scrollEvent);
      } else if (evType === EVENT_MOUSE_DOWN) {
        const x = hone_editor_get_event_x(handle as number, i);
        const y = hone_editor_get_event_y(handle as number, i);
        if (_isMobilePlatform > 0) {
          const scrollTop = vm.viewport.scroll.scrollTop;
          const lh = 14 + 14 / 2;
          const line = Math.max(0, Math.min(
            Math.floor((y + scrollTop) / lh),
            this._doc.buffer.getLineCount() - 1,
          ));
          const col = Math.max(0, Math.round((x - 52) / _measuredCharWidth));
          const lineLen = this._doc.buffer.getLineLength(line);
          const clampedCol = col < lineLen ? col : lineLen;
          vm.cursorManager.reset(line, clampedCol);
          setPerryCursorPos(line, clampedCol);
          vm.notifyChange();
        } else {
          // Desktop: use pixelToPosition via onMouseDown
          const clickCount = hone_editor_get_event_action(handle as number, i);
          const cc = clickCount > 0 ? clickCount : 1;
          const mouseEvent: EditorMouseEvent = {
            x: x,
            y: y,
            button: 0,
            clickCount: cc,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
          };
          vm.onMouseDown(mouseEvent);
        }
      } else if (evType === EVENT_MOUSE_DRAG) {
        const x = hone_editor_get_event_x(handle as number, i);
        const y = hone_editor_get_event_y(handle as number, i);
        const dragEvent: EditorMouseEvent = {
          x: x,
          y: y,
          button: 0,
          clickCount: 1,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        };
        vm.onMouseMove(dragEvent);
      }
    }

    hone_editor_clear_events(handle as number);
    if (hadContentChange > 0) {
      _currentBufferText = vm.document.buffer.getText();
    }
    return hadContentChange > 0 ? 2 : 1;
  }

  /**
   * Map a Rust action ID to an editor action (key event or command).
   */
  private _dispatchAction(vm: EditorViewModel, aid: number): void {
    // Commands that map to key events
    let key = '';
    let shiftKey = false;
    let ctrlKey = false;
    let altKey = false;

    if (aid === ACTION_MOVE_LEFT) { key = 'ArrowLeft'; }
    else if (aid === ACTION_MOVE_RIGHT) { key = 'ArrowRight'; }
    else if (aid === ACTION_MOVE_UP) { key = 'ArrowUp'; }
    else if (aid === ACTION_MOVE_DOWN) { key = 'ArrowDown'; }
    else if (aid === ACTION_MOVE_BOL) { key = 'Home'; }
    else if (aid === ACTION_MOVE_EOL) { key = 'End'; }
    else if (aid === ACTION_MOVE_BOD) { key = 'Home'; ctrlKey = true; }
    else if (aid === ACTION_MOVE_EOD) { key = 'End'; ctrlKey = true; }
    else if (aid === ACTION_INSERT_NEWLINE) { key = 'Enter'; }
    else if (aid === ACTION_DELETE_BACKWARD) { key = 'Backspace'; }
    else if (aid === ACTION_DELETE_FORWARD) { key = 'Delete'; }
    else if (aid === ACTION_INSERT_TAB) { key = 'Tab'; }
    else if (aid === ACTION_MOVE_WORD_LEFT) { key = 'ArrowLeft'; altKey = true; }
    else if (aid === ACTION_MOVE_WORD_RIGHT) { key = 'ArrowRight'; altKey = true; }
    else if (aid === ACTION_MOVE_LEFT_SEL) { key = 'ArrowLeft'; shiftKey = true; }
    else if (aid === ACTION_MOVE_RIGHT_SEL) { key = 'ArrowRight'; shiftKey = true; }
    else if (aid === ACTION_MOVE_UP_SEL) { key = 'ArrowUp'; shiftKey = true; }
    else if (aid === ACTION_MOVE_DOWN_SEL) { key = 'ArrowDown'; shiftKey = true; }
    else if (aid === ACTION_MOVE_BOL_SEL) { key = 'Home'; shiftKey = true; }
    else if (aid === ACTION_MOVE_EOL_SEL) { key = 'End'; shiftKey = true; }
    else if (aid === ACTION_DELETE_WORD_BACKWARD) { key = 'Backspace'; altKey = true; }
    else if (aid === ACTION_PAGE_UP) { key = 'PageUp'; }
    else if (aid === ACTION_PAGE_DOWN) { key = 'PageDown'; }
    else if (aid === ACTION_SELECT_ALL) { vm.executeCommand('editor.action.selectAll'); return; }
    else if (aid === ACTION_CUT) {
      vm.executeCommand('editor.action.cut');
      const cutText = getPerryClipboard();
      if (cutText.length > 0) {
        hone_editor_copy_to_clipboard(this.nativeHandle as number, cutText as any);
      }
      return;
    }
    else if (aid === ACTION_COPY) {
      vm.executeCommand('editor.action.copy');
      const copiedText = getPerryClipboard();
      if (copiedText.length > 0) {
        hone_editor_copy_to_clipboard(this.nativeHandle as number, copiedText as any);
      }
      return;
    }
    else if (aid === ACTION_PASTE) {
      // Read system clipboard into internal clipboard via Rust FFI.
      // hone_editor_paste_from_clipboard pushes each char as TEXT events,
      // but we need bulk insert. Instead, use the internal clipboard directly.
      // If internal clipboard is empty, the paste is a no-op (expected for now).
      vm.executeCommand('editor.action.paste');
      return;
    }
    else if (aid === ACTION_UNDO) { vm.executeCommand('editor.action.undo'); return; }
    else if (aid === ACTION_REDO) { vm.executeCommand('editor.action.redo'); return; }

    if (key.length > 0) {
      const event: KeyEvent = {
        key, code: key, ctrlKey, shiftKey, altKey, metaKey: false,
      };
      vm.onKeyDown(event);
    }
  }

  /** Push cursor position directly via FFI. */
  private _syncCursor(h: number, vm: EditorViewModel): void {
    const cs = getPerryCursorState();
    const cw = vm.getCharWidth();
    const gw = vm.gutterWidth;
    const sz = 14;
    const lh = sz + sz / 2;
    const scrollTop = vm.viewport.scroll.scrollTop;
    const x = cs.col * cw + gw;
    const y = cs.line * lh - scrollTop;
    hone_editor_set_cursor(h, x, y, 0);
  }

  /** Push selection rects directly via FFI. */
  private _syncSelections(h: number, vm: EditorViewModel): void {
    const cs = getPerryCursorState();
    if (cs.anchorLine < 0) {
      hone_editor_begin_selections(h, 0);
      return;
    }

    // Normalize: ensure start <= end
    let startLine = cs.anchorLine;
    let startCol = cs.anchorCol;
    let endLine = cs.line;
    let endCol = cs.col;
    if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
      const tl = startLine;
      const tc = startCol;
      startLine = endLine;
      startCol = endCol;
      endLine = tl;
      endCol = tc;
    }

    // Skip empty selection
    if (startLine === endLine && startCol === endCol) {
      hone_editor_begin_selections(h, 0);
      return;
    }

    // Count rects (one per line in range)
    const rectCount = endLine - startLine + 1;
    hone_editor_begin_selections(h, rectCount);

    const cw = vm.getCharWidth();
    const gw = vm.gutterWidth;
    const sz = 14;
    const lh = sz + sz / 2;
    const scrollTop = vm.viewport.scroll.scrollTop;

    for (let line = startLine; line <= endLine; line++) {
      const sc = line === startLine ? startCol : 0;
      const lineContent = vm.document.buffer.getLine(line);
      const ec = line === endLine ? endCol : lineContent.length;
      const rx = sc * cw + gw;
      const rw = (ec - sc) * cw;
      const ry = line * lh - scrollTop;
      hone_editor_add_selection_rect(h, rx, ry, rw, lh);
    }
  }

  private _directRenderText(text: string): void {
    const handle = this.nativeHandle;
    // fontSize 14, lineHeight 1.5 → lineHeightPx = 21 (same as coordinator default)
    const sz = 14;
    const lh = sz + sz / 2;
    const vm = this._vm;
    // EditorViewModel mirrors scrollTop on itself for direct access — see
    // `_scrollTopMirror` on the EditorViewModel class for why.
    const scrollTop = vm.getScrollTop();
    const doc = this._doc;
    const theme = vm.theme;
    const engine = vm.syntaxEngine as KeywordSyntaxEngine;

    hone_editor_begin_frame(handle as number);

    // Scan text and emit one render_line per line (Perry-safe manual split)
    let lineNum = 0;
    let lineStart = 0;
    for (let i = 0; i <= text.length; i++) {
      // Treat EOF as implicit newline to flush last line
      const ch = i < text.length ? text.charCodeAt(i) : 10;
      if (ch === 10) {
        const lineContent = text.substring(lineStart, i);
        const yOffset = lineNum * lh - scrollTop;

        // Generate syntax tokens via TS-side KeywordSyntaxEngine
        // Format as JSON array matching Rust RenderToken: {s, e, c, st}
        let tokensJson = '[]';
        if (lineNum < doc.buffer.getLineCount()) {
          const tokens = engine.getLineTokens(doc.buffer, lineNum, theme);
          if (tokens.length > 0) {
            let parts = '[';
            for (let _ti = 0; _ti < tokens.length; _ti++) {
              if (_ti > 0) parts += ',';
              const t = tokens[_ti];
              parts += '{"s":' + t.startColumn + ',"e":' + t.endColumn + ',"c":"' + t.color + '","st":"' + t.fontStyle + '"}';
            }
            parts += ']';
            tokensJson = parts;
          }
        }

        hone_editor_render_line(handle as number, lineNum + 1, lineContent, tokensJson, yOffset);
        lineNum++;
        lineStart = i + 1;
      }
    }

    hone_editor_end_frame(handle as number);
  }

  /**
   * Switch syntax highlighting token colors between dark (0) and light (1) mode.
   * Call before setContent or after theme switch.
   * Also invalidates the line cache so tokens re-render with new colors.
   *
   * SHIP-V1-GAPS.md #19: also pushes the new EditorTheme into the ViewModel,
   * which invalidates the token cache. For tree-sitter-routed languages the
   * scope strings stay valid and only the color resolution re-runs.
   */
  setThemeMode(mode: number): void {
    setPerryTokenTheme(mode);
    const newTheme = mode === 1 ? LIGHT_THEME : DARK_THEME;
    this._vm.setTheme(newTheme);
    // SHIP-V1-GAPS.md #17: push the active token palette to the Rust live
    // tokenizer so on-keystroke retokenization uses the right colors. Colors
    // are encoded as 24-bit RGB integers (the FFI takes f64s to avoid string
    // allocation through Perry's native bridge).
    const t = newTheme.tokens;
    hone_editor_set_token_colors(
      hexToInt(t.keyword),
      hexToInt(t.string),
      hexToInt(t.comment),
      hexToInt(t.variableName),
      hexToInt(t.typeName),
      hexToInt(t.functionName),
      hexToInt(t.number),
      hexToInt(newTheme.foreground),
    );
    // Clear Rust line cache so tokens are re-pushed with new colors
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_clear_line_cache(handle as number);
    }
    const coordinator = this._coordinator;
    coordinator.invalidate();
  }

  /** Set editor background color (also sets gutter bg to match). Components 0.0–1.0. */
  setBgColor(r: number, g: number, b: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_bg_color(handle as number, r, g, b);
    }
  }

  /** Set default text foreground color. Components 0.0–1.0. */
  setFgColor(r: number, g: number, b: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_fg_color(handle as number, r, g, b);
    }
  }

  /** Set gutter (line number) foreground color. Components 0.0–1.0. */
  setGutterFgColor(r: number, g: number, b: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_gutter_fg_color(handle as number, r, g, b);
    }
  }

  /** Set selection highlight color. Components 0.0–1.0 (a = alpha). */
  setSelectionColor(r: number, g: number, b: number, a: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_selection_color(handle as number, r, g, b, a);
    }
  }

  /** Set cursor color. Components 0.0–1.0. */
  setCursorColor(r: number, g: number, b: number): void {
    const handle = this.nativeHandle;
    if (handle !== null) {
      hone_editor_set_cursor_color(handle as number, r, g, b);
    }
  }

  /** Free all resources and unregister from multi-instance slots. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    _unregisterEditor(this._editorSlot);
    const coordinator = this._coordinator;
    coordinator.detach();
    coordinator.destroy();
  }
}

// ============================================================
// Module-level FFI wrappers for theme colors.
// Perry can reliably call module-level exported functions cross-module.
// These bypass class method dispatch issues.
// ============================================================

export function editorSetBgColor(handle: number, r: number, g: number, b: number): void {
  hone_editor_set_bg_color(handle, r, g, b);
}

export function editorSetFgColor(handle: number, r: number, g: number, b: number): void {
  hone_editor_set_fg_color(handle, r, g, b);
}

export function editorSetGutterFgColor(handle: number, r: number, g: number, b: number): void {
  hone_editor_set_gutter_fg_color(handle, r, g, b);
}

export function editorSetSelectionColor(handle: number, r: number, g: number, b: number, a: number): void {
  hone_editor_set_selection_color(handle, r, g, b, a);
}

export function editorSetCursorColor(handle: number, r: number, g: number, b: number): void {
  hone_editor_set_cursor_color(handle, r, g, b);
}
