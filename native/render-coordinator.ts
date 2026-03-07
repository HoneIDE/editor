/**
 * NativeRenderCoordinator: bridges EditorViewModel to native FFI.
 *
 * Uses the TS-authoritative render protocol:
 * 1. cacheLine() for dirty lines (packed token format, no JSON)
 * 2. setViewport() to tell Rust which lines to display
 * 3. setCursor() for cursor position
 * 4. beginSelections() + addSelectionRect() for selections (scalar, no JSON)
 *
 * Only changed lines are re-sent via cacheLine() — clean lines stay in Rust's cache.
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
  // Per-line cache: unchanged lines skip re-packing + FFI calls.
  private _lineCacheContent: Map<number, string> = new Map();
  private _lineCacheTokens: Map<number, string> = new Map();

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
   * Perform a render cycle using the TS-authoritative protocol.
   */
  render(): void {
    if (!this._handle || !this._viewModel) return;
    const handle = this._handle;
    const vm = this._viewModel;
    const ffi = this._ffi;

    // Begin frame batch
    ffi.beginFrame(handle);

    const scroll = vm.scrollState;
    const visibleLines = vm.visibleLines;

    // 1. Cache dirty lines (only lines whose content/tokens changed)
    const cContent = this._lineCacheContent;
    const cTokens = this._lineCacheTokens;
    for (let li = 0; li < visibleLines.length; li++) {
      const line = visibleLines[li];
      const lineNum = line.lineNumber + 1; // 1-based for Rust
      let needsCache = true;
      if (cContent.has(line.lineNumber)) {
        const prev = cContent.get(line.lineNumber);
        if (prev === line.content && cTokens.has(line.lineNumber)) {
          needsCache = false;
        }
      }
      if (needsCache) {
        let packed = this.packTokens(line.tokens);
        // Prepend line background color if set (for code blocks, etc.)
        if (line.lineBg.length > 0) {
          let bgHex = line.lineBg;
          if (bgHex.length > 0 && bgHex.charCodeAt(0) === 35) { // strip '#'
            bgHex = bgHex.substring(1);
          }
          packed = 'BG:' + bgHex + '|' + packed;
        }
        ffi.cacheLine(handle, lineNum, line.content, packed);
        cContent.set(line.lineNumber, line.content);
        cTokens.set(line.lineNumber, packed);
      }
    }

    // 2. Set viewport (tells Rust which lines to display + computes y_offsets)
    if (visibleLines.length > 0) {
      const startLine = visibleLines[0].lineNumber + 1;
      const endLine = visibleLines[visibleLines.length - 1].lineNumber + 1;
      const totalLines = vm.document.buffer.getLineCount();
      const sz = this._config.fontSize;
      const lineHeight = sz + sz / 2; // 1.5x multiplier
      ffi.setViewport(handle, startLine, endLine, scroll.scrollTop, totalLines, lineHeight);
    }

    // 3. Update cursor(s)
    this.renderCursors(handle, vm);

    // 4. Update selections (scalar per-rect, no JSON)
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
    this._lineCacheContent.clear();
    this._lineCacheTokens.clear();
    if (this._handle) {
      this._ffi.invalidate(this._handle);
    }
    this.render();
  }

  /**
   * Explicitly set the computed line height in pixels.
   */
  setLineHeightPx(px: number): void {
    this._lineHeightPx = px;
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

    // Build selection rects
    const rects: { x: number; y: number; w: number; h: number }[] = [];

    for (let _si = 0; _si < selections.length; _si++) {
      const sel = selections[_si];
      if (sel.startLine === sel.endLine && sel.startColumn === sel.endColumn) continue;

      for (let line = sel.startLine; line <= sel.endLine; line++) {
        const lineContent = vm.document.buffer.getLine(line);
        const startCol = line === sel.startLine ? sel.startColumn : 0;
        const endCol = line === sel.endLine ? sel.endColumn : lineContent.length;

        const rx = this.measureTextWidth(handle, lineContent.substring(0, startCol)) + vm.gutterWidth;
        const rw = this.measureTextWidth(handle, lineContent.substring(startCol, endCol));
        const ry = this.computeYOffset(line, scroll.scrollTop);
        const sz2 = this._config.fontSize;
        const rh = sz2 + sz2 / 2;
        rects.push({ x: rx, y: ry, w: rw, h: rh });
      }
    }

    // Use per-rect FFI (no JSON)
    this._ffi.beginSelections(handle, rects.length);
    for (let i = 0; i < rects.length; i++) {
      this._ffi.addSelectionRect(handle, rects[i].x, rects[i].y, rects[i].w, rects[i].h);
    }
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
    // Perry-safe: read fontSize from config object (not _lineHeightPx class field,
    // which Perry's AOT codegen may read from the wrong memory offset).
    // Use integer arithmetic for 1.5x: sz + sz/2.
    const sz = this._config.fontSize;
    const lh = sz + sz / 2;
    return lineNumber * lh - scrollTop;
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

  /**
   * Pack tokens into the compact format: "start,end,hexColor,styleInt|..."
   * Replaces serializeTokens() which used JSON.stringify.
   */
  private packTokens(tokens: LineToken[]): string {
    let packed = '';
    for (let _ti = 0; _ti < tokens.length; _ti++) {
      const t = tokens[_ti];
      // Strip '#' from color — Rust adds it back
      let hex = t.color;
      if (hex.length > 0 && hex.charCodeAt(0) === 35) { // '#'
        hex = hex.substring(1);
      }
      let styleInt = 0;
      if (t.fontStyle === 'italic') styleInt = 1;
      if (t.fontStyle === 'bold') styleInt = 2;
      if (t.fontStyle === 'bold-italic') styleInt = 2;
      if (t.fontStyle === 'heading-lg') styleInt = 3;
      if (t.fontStyle === 'heading-md') styleInt = 4;
      packed += t.startColumn + ',' + t.endColumn + ',' + hex + ',' + styleInt + '|';
    }
    return packed;
  }
}
