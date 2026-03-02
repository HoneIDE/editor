/**
 * NativeRenderCoordinator: bridges EditorViewModel to native FFI.
 *
 * Converts RenderedLines, cursor state, scroll position, and selections
 * into FFI calls. Manages the native view lifecycle (create/destroy),
 * frame batching, and dirty tracking to minimize FFI calls.
 */

import type { NativeEditorFFI, NativeViewHandle, RenderToken, SelectionRegion, DecorationOverlay } from './ffi-bridge';
import { CursorStyle } from './ffi-bridge';
import type { EditorViewModel, ScrollState } from '../view-model/editor-view-model';
import type { RenderedLine, LineToken, LineDecoration } from '../view-model/line-layout';
import type { CursorState } from '../core/cursor/cursor-manager';
import type { SelectionRange } from '../core/cursor/selection';

export interface RenderCoordinatorConfig {
  /** Font family (e.g., "JetBrains Mono"). */
  fontFamily: string;
  /** Font size in points. */
  fontSize: number;
  /** Line height multiplier. */
  lineHeight: number;
}

/**
 * Coordinates rendering between the EditorViewModel and native FFI layer.
 */
export class NativeRenderCoordinator {
  private _ffi: NativeEditorFFI;
  private _handle: NativeViewHandle | null = null;
  private _config: RenderCoordinatorConfig;
  private _lineHeightPx: number;
  private _charWidth: number = 8;
  private _viewModel: EditorViewModel | null = null;
  private _unsubscribe: (() => void) | null = null;

  private _lastScrollTop: number = -1;
  private _lastCursorKey: string = '';
  private _lastSelectionKey: string = '';

  constructor(ffi: NativeEditorFFI, config: RenderCoordinatorConfig) {
    this._ffi = ffi;
    this._config = config;
    this._lineHeightPx = config.fontSize * config.lineHeight;
  }

  get handle(): NativeViewHandle | null {
    return this._handle;
  }

  get charWidth(): number {
    return this._charWidth;
  }

  /**
   * Create the native editor view.
   */
  create(width: number, height: number): NativeViewHandle {
    if (this._handle !== null) {
      this.destroy();
    }

    this._handle = this._ffi.create(width, height);
    this._ffi.setFont(this._handle, this._config.fontFamily, this._config.fontSize);

    // Measure a reference character to get char width
    this._charWidth = this._ffi.measureText(this._handle, 'M');

    return this._handle;
  }

  /**
   * Destroy the native editor view.
   */
  destroy(): void {
    if (this._handle !== null) {
      this.detach();
      this._ffi.destroy(this._handle);
      this._handle = null;
      this._lastScrollTop = -1;
      this._lastCursorKey = '';
      this._lastSelectionKey = '';
    }
  }

  /**
   * Attach to an EditorViewModel and auto-render on changes.
   */
  attach(viewModel: EditorViewModel): void {
    this.detach();
    this._viewModel = viewModel;

    // Feed char width back to view model
    viewModel.setCharWidth(this._charWidth);

    // Listen for state changes
    this._unsubscribe = viewModel.onChange(() => {
      this.render();
    });

    // Initial render
    this.render();
  }

  /**
   * Detach from the current ViewModel.
   */
  detach(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._viewModel = null;
  }

  /**
   * Perform a full render cycle.
   */
  render(): void {
    if (!this._handle || !this._viewModel) return;
    const handle = this._handle;
    const vm = this._viewModel;
    const ffi = this._ffi;

    // Begin frame batch
    ffi.beginFrame(handle);

    // 1. Update scroll
    const scroll = vm.scrollState;
    if (scroll.scrollTop !== this._lastScrollTop) {
      ffi.scroll(handle, scroll.scrollTop);
      this._lastScrollTop = scroll.scrollTop;
    }

    // 2. Render visible lines
    const visibleLines = vm.visibleLines;
    for (let li = 0; li < visibleLines.length; li++) {
      const line = visibleLines[li];
      const tokensJson = this.serializeTokens(line.tokens);
      const yOffset = this.computeYOffset(line.lineNumber, scroll.scrollTop);

      ffi.renderLine(
        handle,
        line.lineNumber + 1, // 1-based display
        line.content,
        tokensJson,
        yOffset,
      );
    }

    // 3. Update cursor(s)
    this.renderCursors(handle, vm);

    // 4. Update selections
    this.renderSelections(handle, vm);

    // 5. Render ghost text if supported and active
    this.renderGhostText(handle, vm);

    // End frame batch
    ffi.endFrame(handle);
  }

  /**
   * Force a full re-render (clears dirty cache).
   */
  invalidate(): void {
    this._lastCursorKey = '';
    this._lastSelectionKey = '';
    if (this._handle) {
      this._ffi.invalidate(this._handle);
    }
    this.render();
  }

  /**
   * Update font configuration.
   */
  setFont(family: string, size: number): void {
    this._config.fontFamily = family;
    this._config.fontSize = size;
    this._lineHeightPx = size * this._config.lineHeight;

    if (this._handle) {
      this._ffi.setFont(this._handle, family, size);
      this._charWidth = this._ffi.measureText(this._handle, 'M');

      if (this._viewModel) {
        this._viewModel.setCharWidth(this._charWidth);
      }
      this.invalidate();
    }
  }

  /**
   * Measure text width using native renderer.
   */
  measureText(text: string): number {
    if (!this._handle) return text.length * this._charWidth;
    return this._ffi.measureText(this._handle, text);
  }

  // === Private ===

  private renderCursors(handle: NativeViewHandle, vm: EditorViewModel): void {
    const cursors = vm.cursors;
    const renderState = vm.cursorRenderState;
    const scroll = vm.scrollState;

    if (!renderState.visible || cursors.length === 0) return;

    const cursorStyle = renderState.style === 'block' ? CursorStyle.Block
      : renderState.style === 'underline' ? CursorStyle.Underline
      : CursorStyle.Line;

    // Perry AOT: cursors.map(c => ...) broken — build key with index loop.
    let cursorKey = '';
    for (let _ci = 0; _ci < cursors.length; _ci++) {
      const c = cursors[_ci];
      if (_ci > 0) cursorKey += '|';
      cursorKey += c.line + ':' + c.column + ':' + cursorStyle + ':' + renderState.visible;
    }
    cursorKey += ':' + scroll.scrollTop;

    if (cursorKey === this._lastCursorKey) return;
    this._lastCursorKey = cursorKey;

    if (cursors.length === 1) {
      // Single cursor (common case)
      const primary = cursors[0];
      const x = this.computeCursorX(handle, primary, vm);
      const y = this.computeYOffset(primary.line, scroll.scrollTop);
      this._ffi.setCursor(handle, x, y, cursorStyle);
    } else if (this._ffi.setCursors) {
      // Perry AOT: cursors.map(c => ({...})) broken — use index loop.
      const cursorsData: any[] = [];
      for (let _ci = 0; _ci < cursors.length; _ci++) {
        const c = cursors[_ci];
        const cx = this.computeCursorX(handle, c, vm);
        const cy = this.computeYOffset(c.line, scroll.scrollTop);
        cursorsData.push({ x: cx, y: cy, style: cursorStyle });
      }
      this._ffi.setCursors(handle, JSON.stringify(cursorsData));
    }
  }

  private renderSelections(handle: NativeViewHandle, vm: EditorViewModel): void {
    const selections = vm.selections;
    const scroll = vm.scrollState;

    // Perry AOT: selections.map(s => ...).join() broken — build key with index loop.
    let selectionKey = '';
    for (let _si = 0; _si < selections.length; _si++) {
      const s = selections[_si];
      if (_si > 0) selectionKey += '|';
      selectionKey += s.startLine + ':' + s.startColumn + '-' + s.endLine + ':' + s.endColumn;
    }
    selectionKey += ':' + scroll.scrollTop;

    if (selectionKey === this._lastSelectionKey) return;
    this._lastSelectionKey = selectionKey;

    const regions: SelectionRegion[] = [];

    // Perry AOT: for (const sel of selections) broken — use index loop.
    for (let _si = 0; _si < selections.length; _si++) {
      const sel = selections[_si];
      // Skip empty selections
      if (sel.startLine === sel.endLine && sel.startColumn === sel.endColumn) continue;

      // Generate rectangles for each line in the selection
      for (let line = sel.startLine; line <= sel.endLine; line++) {
        const lineContent = vm.document.buffer.getLine(line);
        const startCol = line === sel.startLine ? sel.startColumn : 0;
        const endCol = line === sel.endLine ? sel.endColumn : lineContent.length;

        const rx = this.measureTextWidth(handle, lineContent.substring(0, startCol)) + vm.gutterWidth;
        const rw = this.measureTextWidth(handle, lineContent.substring(startCol, endCol));
        const ry = this.computeYOffset(line, scroll.scrollTop);
        const rh = this._lineHeightPx;

        // Perry AOT: {x, y, w, h} shorthand → use explicit key:value.
        regions.push({ x: rx, y: ry, w: rw, h: rh });
      }
    }

    this._ffi.setSelection(handle, JSON.stringify(regions));
  }

  private renderGhostText(handle: NativeViewHandle, vm: EditorViewModel): void {
    if (!this._ffi.renderGhostText) return;

    const ghost = vm.ghostText.state;
    if (!ghost) return;

    const primary = vm.cursors[0];
    const scroll = vm.scrollState;
    const lineContent = vm.document.buffer.getLine(primary.line);

    const x = this.measureTextWidth(handle, lineContent.substring(0, primary.column)) + vm.gutterWidth;
    const y = this.computeYOffset(primary.line, scroll.scrollTop);

    this._ffi.renderGhostText(handle, ghost.text, x, y, '#808080');
  }

  private computeYOffset(lineNumber: number, scrollTop: number): number {
    return lineNumber * this._lineHeightPx - scrollTop;
  }

  private computeCursorX(handle: NativeViewHandle, cursor: CursorState, vm: EditorViewModel): number {
    const lineContent = vm.document.buffer.getLine(cursor.line);
    const textBeforeCursor = lineContent.substring(0, cursor.column);
    return this.measureTextWidth(handle, textBeforeCursor) + vm.gutterWidth;
  }

  private measureTextWidth(handle: NativeViewHandle, text: string): number {
    if (text.length === 0) return 0;
    return this._ffi.measureText(handle, text);
  }

  private serializeTokens(tokens: LineToken[]): string {
    // Perry AOT: tokens.map(t => ({...})) broken — use index loop.
    const ffiTokens: RenderToken[] = [];
    for (let _ti = 0; _ti < tokens.length; _ti++) {
      const t = tokens[_ti];
      const st = t.fontStyle === 'bold-italic' ? 'bold' : t.fontStyle;
      ffiTokens.push({ s: t.startColumn, e: t.endColumn, c: t.color, st: st });
    }
    return JSON.stringify(ffiTokens);
  }

  private serializeDecorations(
    decorations: LineDecoration[],
    lineNumber: number,
    scrollTop: number,
  ): string {
    // Perry AOT: decorations.map(d => ({...})) broken — use index loop.
    const y = this.computeYOffset(lineNumber, scrollTop);
    const overlays: DecorationOverlay[] = [];
    for (let _di = 0; _di < decorations.length; _di++) {
      const d = decorations[_di];
      let dType: 'background' | 'underline' | 'underline-wavy';
      if (d.type === 'underline-error') {
        dType = 'underline-wavy';
      } else if (d.type === 'underline' || d.type === 'underline-warning' || d.type === 'underline-info') {
        dType = 'underline';
      } else {
        dType = 'background';
      }
      const dx = d.startColumn * this._charWidth;
      const dw = (d.endColumn - d.startColumn) * this._charWidth;
      const dh = this._lineHeightPx;
      overlays.push({ x: dx, y: y, w: dw, h: dh, color: d.color, type: dType });
    }
    return JSON.stringify(overlays);
  }

  private hashLine(line: RenderedLine): string {
    // Perry AOT: line.tokens.map(t => ...).join(',') broken — use index loop.
    let tokenHash = '';
    for (let _hi = 0; _hi < line.tokens.length; _hi++) {
      const t = line.tokens[_hi];
      if (_hi > 0) tokenHash += ',';
      tokenHash += t.startColumn + ':' + t.endColumn + ':' + t.color;
    }
    return line.content + '|' + line.tokens.length + '|' + line.decorations.length + '|' + line.foldState + '|' + tokenHash;
  }
}
