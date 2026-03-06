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
import { EditorViewModel, KeyEvent, MouseEvent as EditorMouseEvent, ScrollEvent } from '../view-model/editor-view-model';
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
declare function hone_editor_set_gutter_width(handle: number, width: number): void;

// === Read-only + line background FFI ===
declare function hone_editor_set_read_only(handle: number, mode: number): void;
declare function hone_editor_set_line_background(handle: number, line: number, r: number, g: number, b: number, a: number): void;
declare function hone_editor_clear_line_backgrounds(handle: number): void;

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

// === Multi-instance editor slots (max 3: main + 2 diff editors) ===
// Perry closures can't be passed as C function pointers on ARM64 (non-executable heap memory).
// Use module-level slots + a top-level (non-closure) function instead.
let _editor0: Editor | null = null;
let _editor1: Editor | null = null;
let _editor2: Editor | null = null;
let _editorCount: number = 0;
let _pollStarted: number = 0;

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

/** Module-level poll function for setInterval. Polls all registered editors. */
function _pollAllEditors(): void {
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
  nativeHandle: number | null;

  constructor(width: number, height: number, opts?: EditorOptions) {
    this._disposed = false;
    this._readOnly = false;
    this._editorSlot = -1;
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

    let fontFamily = 'JetBrains Mono';
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
    this._vm = vm;

    const config: RenderCoordinatorConfig = {
      fontFamily,
      fontSize,
      lineHeight: 1.5,
    };

    const coordinator = new NativeRenderCoordinator(ffi, config);
    this._coordinator = coordinator;

    const handle = coordinator.create(width, height);
    this.nativeHandle = handle;

    coordinator.attach(vm);

    // Sync gutter width to Rust for pixel-perfect cursor/text alignment.
    hone_editor_set_gutter_width(handle, vm.gutterWidth);

    vm.onResize(width, height);

    // Enable ts_mode: Rust only queues events, TypeScript handles all state.
    hone_editor_set_ts_mode(handle, 1);

    // Apply read-only mode
    if (readOnly) {
      this._readOnly = true;
      hone_editor_set_read_only(handle, 1);
    }

    // Register in a multi-instance slot.
    this._editorSlot = _registerEditor(this);

    // Start the shared poll timer only once (first Editor instance).
    if (_pollStarted < 1) {
      _pollStarted = 1;
      setInterval(() => { _pollAllEditors(); }, 16);
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
    // Rebuild block comment depth cache for new content
    const engine = vm.syntaxEngine;
    engine.parse(buf);
    vm.touch(); // notify onChange listeners (buffer was modified externally)
    const coordinator = this._coordinator;
    coordinator.invalidate();
  }

  /** Switch the syntax highlighting language. */
  setLanguage(languageId: string): void {
    const doc = this._doc;
    doc.languageId = languageId;
    const vm = this._vm;
    const engine = vm.syntaxEngine;
    engine.setLanguage(languageId);
    engine.parse(doc.buffer);
    // Re-create the token provider closure so Perry captures the UPDATED
    // engine state (keywords, lineComment). The constructor-time closure
    // holds stale state because Perry closures capture by value.
    vm.refreshTokenProvider();
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
    const hadEvents = this._pollEvents();
    // Perry: onChange closure (() => { this.render(); }) in coordinator.attach()
    // silently fails — Perry closures capture `this` by value. Explicitly
    // re-render here after processing events to bypass the broken closure.
    if (hadEvents) {
      // Sync gutter width (may change as line count grows/shrinks).
      const handle = this.nativeHandle;
      if (handle !== null) {
        const vm = this._vm;
        hone_editor_set_gutter_width(handle as number, vm.gutterWidth);
      }
      const coordinator = this._coordinator;
      coordinator.render();
    }
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
   */
  private _pollEvents(): boolean {
    if (this._disposed) return false;
    const handle = this.nativeHandle;
    if (handle === null) {
      return false;
    }

    const count = hone_editor_pending_event_count(handle as number);
    if (count <= 0) return false;

    const vm = this._vm;
    const isReadOnly = this._readOnly;

    for (let i = 0; i < count; i++) {
      const evType = hone_editor_get_event_type(handle as number, i);

      if (evType === EVENT_TEXT) {
        // Skip text input in read-only mode
        if (isReadOnly) continue;
        const code = hone_editor_get_event_char(handle as number, i);
        if (code > 0) {
          const ch = String.fromCharCode(code);
          vm.onTextInput(ch);
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
      } else if (evType === EVENT_SCROLL) {
        const dx = hone_editor_get_event_x(handle as number, i);
        const dy = hone_editor_get_event_y(handle as number, i);
        // macOS scrollingDeltaY: positive = scroll up (natural) → scrollTop decreases
        const scrollEvent: ScrollEvent = { deltaX: -dx, deltaY: -dy };
        vm.onScroll(scrollEvent);
      } else if (evType === EVENT_MOUSE_DOWN) {
        const x = hone_editor_get_event_x(handle as number, i);
        const y = hone_editor_get_event_y(handle as number, i);
        // Perry: explicit key: value (no ES6 shorthand)
        const mouseEvent: EditorMouseEvent = {
          x: x,
          y: y,
          button: 0,
          clickCount: 1,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        };
        vm.onMouseDown(mouseEvent);
      }
    }

    hone_editor_clear_events(handle as number);
    return true;
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
    else if (aid === ACTION_CUT) { vm.executeCommand('editor.action.cut'); return; }
    else if (aid === ACTION_COPY) { vm.executeCommand('editor.action.copy'); return; }
    else if (aid === ACTION_PASTE) { vm.executeCommand('editor.action.paste'); return; }
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
