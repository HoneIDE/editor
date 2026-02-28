/**
 * Perry Editor Component: embeddable code editor for Perry apps.
 *
 * Wraps EditorDocument + EditorViewModel + NativeRenderCoordinator
 * behind a simple API. FFI functions are declared as extern and resolved
 * by Perry's codegen from the perry.nativeLibrary manifest in package.json.
 */

import { EditorDocument } from '../core/document/document';
import { EditorViewModel, KeyEvent } from '../view-model/editor-view-model';
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

// EditorOptions removed — Perry constructor uses simple params to avoid
// object spread / nullish coalescing patterns that don't compile natively.

/**
 * Perry-embeddable code editor component.
 *
 * NOTE: Constructor avoids object spread, nullish coalescing, and ternary on
 * strings — these patterns don't compile correctly in Perry's native codegen.
 */
export class Editor {
  private _doc: EditorDocument;
  private _vm: EditorViewModel;
  private _coordinator: NativeRenderCoordinator;
  private _ffi: NativeEditorFFI;
  private _width: number;
  private _height: number;
  private _disposed: boolean;
  nativeHandle: number | null;

  constructor(width: number, height: number) {
    this._disposed = false;
    this._width = width;
    this._height = height;
    this.nativeHandle = null;

    const ffi = new PerryEditorFFI();
    this._ffi = ffi;

    const doc = new EditorDocument('untitled', '', 'typescript');
    this._doc = doc;

    const syntaxEngine = new KeywordSyntaxEngine();
    const vm = new EditorViewModel(doc, DARK_THEME, syntaxEngine);
    this._vm = vm;

    const config: RenderCoordinatorConfig = {
      fontFamily: 'Menlo',
      fontSize: 13,
      lineHeight: 1.5,
    };

    const coordinator = new NativeRenderCoordinator(ffi, config);
    this._coordinator = coordinator;

    const handle = coordinator.create(width, height);
    this.nativeHandle = handle;
    coordinator.attach(vm);

    vm.onResize(width, height);
  }

  /** Get the current text content. */
  get content(): string {
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
      ctrlKey: modifiers?.ctrl ?? false,
      shiftKey: modifiers?.shift ?? false,
      altKey: modifiers?.alt ?? false,
      metaKey: modifiers?.meta ?? false,
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

  /** Set the font. */
  setFont(family: string, size: number): void {
    const coordinator = this._coordinator;
    coordinator.setFont(family, size);
  }

  /** Free all resources. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const coordinator = this._coordinator;
    coordinator.detach();
    coordinator.destroy();
  }
}
