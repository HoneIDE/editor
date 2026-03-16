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
import { EditorViewModel, KeyEvent, MouseEvent as EditorMouseEvent, ScrollEvent, setPerryMarkdownState, setPerryLanguageState, setPerryTokenTheme, getPerryCursorState } from '../view-model/editor-view-model';
import { NativeRenderCoordinator, RenderCoordinatorConfig } from '../native/render-coordinator';
import { DARK_THEME, LIGHT_THEME, EditorTheme } from '../view-model/theme';
import type { NativeEditorFFI, NativeViewHandle } from '../native/ffi-bridge';
import { KeywordSyntaxEngine } from '../core/tokenizer/keyword-syntax-engine';

// ============================================================
// FFI function declarations — resolved by Perry's codegen from
// the perry.nativeLibrary manifest in package.json.
// These compile to extern "C" function references.
// ============================================================

declare function hone_editor_create(width: number, height: number): number;
declare function hone_editor_destroy(handle: number): void;
declare function hone_editor_set_font(handle: number, family: number, size: number): void;
declare function hone_editor_render_line(handle: number, lineNumber: number, text: number, tokensJson: number, yOffset: number): void;
declare function hone_editor_set_cursor(handle: number, x: number, y: number, style: number): void;
declare function hone_editor_set_selection(handle: number, regionsJson: number): void;
declare function hone_editor_scroll(handle: number, offsetY: number): void;
declare function hone_editor_measure_text(handle: number, text: number): number;
declare function hone_editor_invalidate(handle: number): void;
declare function hone_editor_begin_frame(handle: number): void;
declare function hone_editor_end_frame(handle: number): void;
declare function hone_editor_render_ghost_text(handle: number, text: number, x: number, y: number, color: number): void;
declare function hone_editor_render_decorations(handle: number, decorationsJson: number): void;
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
let _debugCounter: number = 0;
let _debugHandle: number = 0;

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
  // DEBUG: bypass class method dispatch — call FFI directly with module-level handle
  if (_debugHandle > 0) {
    _debugCounter = _debugCounter + 1;
    hone_editor_set_cursor(_debugHandle, 52 + (_debugCounter % 20) * 8, 42, 0);
    hone_editor_invalidate(_debugHandle);
  }
  if (_editor0 !== null && _editor0 !== undefined) _editor0.flushEvents();
  if (_editor1 !== null && _editor1 !== undefined) _editor1.flushEvents();
  if (_editor2 !== null && _editor2 !== undefined) _editor2.flushEvents();
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
 *
 * NOTE: The constructor reads each field with explicit if-checks instead of
 * object spread or nullish coalescing — those patterns don't compile in Perry's
 * native codegen. Test code (Bun) can freely spread into this interface.
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

/**
 * Perry-embeddable code editor component.
 *
 * NOTE: Constructor body avoids object spread, nullish coalescing (??) and
 * optional-chaining (?.) — those patterns don't compile correctly in Perry's
 * native codegen. Explicit if-else is used throughout.
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

    // Resolve FFI — use injected impl (for testing) or Perry's native impl.
    let ffi: NativeEditorFFI;
    if (opts && opts.ffi) {
      ffi = opts.ffi;
    } else {
      ffi = new PerryEditorFFI();
    }
    this._ffi = ffi;

    // Resolve options with explicit if-checks (no ?. or ?? — Perry constraint).
    let initialContent = '';
    if (opts && opts.content) {
      initialContent = opts.content;
    }

    let language = 'typescript';
    if (opts && opts.language) {
      language = opts.language;
    }

    let useLight = false;
    if (opts && opts.theme) {
      useLight = opts.theme === 'light';
    }
    const theme: EditorTheme = useLight ? LIGHT_THEME : DARK_THEME;

    let fontSize = 14;
    if (opts && opts.fontSize) {
      fontSize = opts.fontSize;
    }

    let fontFamily = 'Menlo';
    if (opts && opts.fontFamily) {
      fontFamily = opts.fontFamily;
    }

    let readOnly = false;
    if (opts && opts.readOnly) {
      readOnly = true;
    }

    const doc = new EditorDocument('untitled', initialContent, language);
    this._doc = doc;

    const syntaxEngine = new KeywordSyntaxEngine();
    const vm = new EditorViewModel(doc, theme, syntaxEngine);
    vm.setPerryMode(true);
    // Perry-safe: bypass _tokenProvider closure, call engine directly
    // in visibleLines getter via this.syntaxEngine (no closure method dispatch).
    vm.setDirectTokens(1);
    // Set module-level language state so the inline tokenizer knows which keywords to use.
    setPerryLanguageState(language);
    this._vm = vm;

    const config: RenderCoordinatorConfig = {
      fontFamily,
      fontSize,
      lineHeight: 1.5,
    };

    const coordinator = new NativeRenderCoordinator(ffi, config);
    this._coordinator = coordinator;

    // Perry AOT: coordinator.create() dispatches through the NativeEditorFFI
    // interface at runtime. Perry's AOT codegen emits js_native_call_method for
    // interface methods, which requires a JS callback that is null in AOT mode.
    // Instead, call hone_editor_create directly (a declared extern "C" function
    // that Perry resolves statically) and inject the handle into the coordinator.
    const handle = hone_editor_create(width, height);
    coordinator.setHandle(handle);
    this.nativeHandle = handle;
    _debugHandle = handle as number;

    coordinator.attach(vm);

    // Measure real char width from native renderer (setHandle bypasses create()
    // which normally does this). Must be AFTER attach() and set directly on vm —
    // Perry class field reads return initial values, so coordinator._charWidth
    // from setCharWidthDirect() would still read as 8 inside attach().
    const measuredWidth = hone_editor_measure_text(handle, 'M' as any);
    if (measuredWidth > 0) {
      vm.setCharWidth(measuredWidth);
    }

    // Sync gutter width to Rust for pixel-perfect cursor/text alignment.
    hone_editor_set_gutter_width(handle, vm.gutterWidth);

    vm.onResize(width, height);

    // Detect platform
    // Set module-level platform flag (class field reads return stale values in Perry)
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

    // Perry AOT: coordinator.attach() and vm.onResize() trigger onChange → render()
    // which calls _ffi.* methods via interface dispatch — fails on GTK4/Linux
    // (Perry's js_native_call_method callback is null in AOT mode).
    // Call direct render with initialContent to populate frame_lines in the Rust view.
    _currentBufferText = initialContent;
    this._directRenderText(initialContent);

    // _directRenderText sends empty '[]' tokens via render_line, which overwrites
    // the Rust line_cache. But the coordinator's TS-side cache still thinks those
    // lines are clean (from the render() in attach/onResize). Clear it so the next
    // coordinator.render() (in flushEvents) re-sends lines with proper tokens.
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
    // Rebuild block comment depth cache for new content
    const engine = vm.syntaxEngine;
    engine.parse(buf);
    // Perry-safe: build fence cache for markdown content.
    // NOTE: doc.languageId === 'markdown' string comparison fails in Perry AOT.
    // Use this._isMd which was set by setLanguage() (called before setContent).
    if (this._isMd === 1) {
      // Build fence cache: char 'N' = not in fence, 'F' = in fence
      // Using printable chars (not \0/\1) because Perry strings may be null-terminated
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
    // Perry AOT: coordinator.invalidate() calls _ffi.* via interface dispatch → fails on GTK4/Linux.
    // Use direct render with the text parameter (already in scope) to push to Rust.
    _currentBufferText = text;
    this._directRenderText(text);
    // Clear coordinator's TS-side cache so the next render() re-sends tokens.
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
    // Perry-safe: set module-level markdown state directly from the language string.
    // Engine method calls and property access fail after first frame in Perry AOT.
    // Module-level vars are the ONLY reliable mutable state in Perry getters.
    setPerryLanguageState(languageId);
    if (languageId === 'markdown') {
      this._isMd = 1;
      setPerryMarkdownState(1, '');
    } else {
      this._isMd = 0;
      setPerryMarkdownState(0, '');
    }
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

  createPerryWidget(): unknown {
    return embedNSView(hone_editor_nsview(this.nativeHandle as number));
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
      ctrlKey: modifiers !== undefined && modifiers.ctrl === true,
      shiftKey: modifiers !== undefined && modifiers.shift === true,
      altKey: modifiers !== undefined && modifiers.alt === true,
      metaKey: modifiers !== undefined && modifiers.meta === true,
    };
    const vm = this._vm;
    return vm.onKeyDown(event);
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
    // Perry AOT inverts === null checks on union-typed fields.
    // Skip null guard — constructor always sets nativeHandle before this runs.
    const h = this.nativeHandle as number;

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

    // Sync scroll delta
    const scrollDelta = hone_editor_get_scroll_delta(h);
    let scrollChanged = 0;
    if (scrollDelta !== 0) {
      this._vm.viewport.scroll.scrollBy(0, -scrollDelta);
      hone_editor_clear_scroll_delta(h);
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
      // macOS path — coordinator.render() handles everything
      const rustNeedsLines = hone_editor_needs_lines(h);
      if (hadEvents > 0 || scrollChanged > 0 || sizeChanged > 0 || needsRender > 0 || rustNeedsLines > 0) {
        hone_editor_set_gutter_width(h, this._vm.gutterWidth);
        this._coordinator.render();
      }
    }
    // Always sync cursor/selection and invalidate on all platforms
    const cs = getPerryCursorState();
    hone_editor_set_cursor(h, cs.col * 8.5 + 52, cs.line * 21, 0);
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
    // Perry AOT inverts === null checks on union-typed fields. Skip guard.
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
        // click count is stored in action_id field for MOUSE_DOWN events
        const clickCount = hone_editor_get_event_action(handle as number, i);
        const cc = clickCount > 0 ? clickCount : 1;
        // Perry: explicit key: value (no ES6 shorthand)
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
    // Update module-level text for iOS _directRenderText (Perry class field chains stale)
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
      const cutText = vm.getClipboardText();
      if (cutText.length > 0) {
        hone_editor_copy_to_clipboard(this.nativeHandle as number, cutText as any);
      }
      return;
    }
    else if (aid === ACTION_COPY) {
      vm.executeCommand('editor.action.copy');
      const copiedText = vm.getClipboardText();
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
      // Perry: explicit key: value (no ES6 shorthand — it captures initial values)
      const event: KeyEvent = {
        key: key,
        code: key,
        ctrlKey: ctrlKey,
        shiftKey: shiftKey,
        altKey: altKey,
        metaKey: false,
      };
      vm.onKeyDown(event);
    }
  }

  /**
   * Perry AOT direct render: bypasses NativeRenderCoordinator interface dispatch,
   * which fails on GTK4/Linux (js_native_call_method callback is null in AOT mode).
   * Calls hone_editor_* FFI functions directly — Perry resolves these statically.
   *
   * Takes text as a parameter to avoid Perry getter dispatch issues:
   * Perry's AOT codegen does not call TypeScript `get` property getters — it reads
   * the property as a plain field (returning undefined). vm.visibleLines as a getter
   * returns undefined, making visibleLines.length === 0 and the render loop a no-op.
   * Passing text directly sidesteps all getter/view-model access.
   *
   * Perry AOT constraints apply:
   * - `for (let i...)` loop (not for-of or .map)
   * - No object shorthand, no ?. or ??
   * - Cast strings to `any` for FFI pointer params
   * - charCodeAt compared to numeric literal (not variable) — Perry-safe
   */
  /**
   * Push cursor position directly via FFI, bypassing coordinator.
   * The coordinator's renderCursors relies on vm.cursorRenderState getter
   * which Perry AOT may not dispatch correctly.
   */
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

  /**
   * Push selection rects directly via FFI, bypassing coordinator.
   * Reads cursor0.selectionAnchor and cursor position from the cursor manager.
   */
  private _syncSelections(h: number, vm: EditorViewModel): void {
    // Use module-level cursor state (Perry-safe: vm.cursors getter fails in AOT).
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
    const scrollTop = this._vm.viewport.scroll.scrollTop;

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
        // Empty tokens "[]": Rust tokenizer retokenizes on each edit in AOT mode.
        hone_editor_render_line(handle as number, lineNum + 1, lineContent as any, '[]' as any, yOffset);
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
   */
  setThemeMode(mode: number): void {
    setPerryTokenTheme(mode);
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
