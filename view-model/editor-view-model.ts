/**
 * Main ViewModel: bridges core state to rendering state.
 *
 * The EditorViewModel connects all core subsystems and exposes
 * state for the rendering layer. In Perry, these would be State() bindings
 * that trigger native re-renders. For now, we use plain properties
 * with a change notification pattern.
 */

import { TextBuffer, TextEdit } from '../core/buffer/text-buffer';
import { EditorDocument } from '../core/document/document';
import { CursorManager, CursorState } from '../core/cursor/cursor-manager';
import { SelectionRange } from '../core/cursor/selection';
import { UndoManager } from '../core/history/undo-manager';
import { ViewportManager } from '../core/viewport/viewport-manager';
import { CommandRegistry, CommandContext } from '../core/commands/registry';
import { registerEditingCommands } from '../core/commands/editing';
import { registerNavigationCommands } from '../core/commands/navigation';
import { registerSelectionCommands } from '../core/commands/selection-cmds';
import { registerClipboardCommands } from '../core/commands/clipboard';
import { registerMulticursorCommands } from '../core/commands/multicursor';
import { CursorBlinkController, CursorRenderState } from './cursor-state';
import { GutterRenderer } from './gutter';
import { RenderedLine, computeRenderedLines, LineToken, LineDecoration } from './line-layout';
import { EditorTheme, DARK_THEME } from './theme';

export interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface KeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface MouseEvent {
  x: number;
  y: number;
  button: number;
  clickCount: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ScrollEvent {
  deltaX: number;
  deltaY: number;
}

type ChangeListener = () => void;

export class EditorViewModel {
  // Core subsystems
  readonly document: EditorDocument;
  readonly cursorManager: CursorManager;
  readonly viewport: ViewportManager;
  readonly undoManager: UndoManager;
  readonly commandRegistry: CommandRegistry;

  // Rendering state
  private _cursorBlink: CursorBlinkController;
  private _gutter: GutterRenderer;
  private _theme: EditorTheme;
  private _charWidth: number = 8; // default, updated by native renderer
  private _listeners: ChangeListener[] = [];

  // Token/decoration providers (set by syntax engine)
  private _tokenProvider: ((lineNumber: number) => LineToken[]) | null = null;
  private _decorationProvider: ((lineNumber: number) => LineDecoration[]) | null = null;
  private _foldStateProvider: ((lineNumber: number) => 'expanded' | 'collapsed' | 'none') | null = null;

  constructor(doc: EditorDocument, theme?: EditorTheme) {
    this.document = doc;
    this._theme = theme ?? DARK_THEME;

    this.cursorManager = new CursorManager(doc.buffer);
    this.viewport = new ViewportManager();
    this.undoManager = new UndoManager(doc.buffer);
    this.commandRegistry = new CommandRegistry();

    this._cursorBlink = new CursorBlinkController();
    this._gutter = new GutterRenderer();

    // Register all command groups
    registerEditingCommands(this.commandRegistry);
    registerNavigationCommands(this.commandRegistry);
    registerSelectionCommands(this.commandRegistry);
    registerClipboardCommands(this.commandRegistry);
    registerMulticursorCommands(this.commandRegistry);

    // Sync viewport with buffer
    this.viewport.setTotalLines(doc.buffer.getLineCount());

    // Set viewport line height from theme
    const lineHeightPx = this._theme.fontSize * this._theme.lineHeight;
    this.viewport.lineHeightCache.setBaseLineHeight(lineHeightPx);

    // Set page size for cursor
    this.cursorManager.setPageSize(this.viewport.getLinesPerPage());
  }

  get theme(): EditorTheme {
    return this._theme;
  }

  setTheme(theme: EditorTheme): void {
    this._theme = theme;
    const lineHeightPx = theme.fontSize * theme.lineHeight;
    this.viewport.lineHeightCache.setBaseLineHeight(lineHeightPx);
    this.notifyChange();
  }

  setCharWidth(width: number): void {
    this._charWidth = width;
    this._gutter.setCharWidth(width);
  }

  setTokenProvider(provider: (lineNumber: number) => LineToken[]): void {
    this._tokenProvider = provider;
  }

  setDecorationProvider(provider: (lineNumber: number) => LineDecoration[]): void {
    this._decorationProvider = provider;
  }

  setFoldStateProvider(provider: (lineNumber: number) => 'expanded' | 'collapsed' | 'none'): void {
    this._foldStateProvider = provider;
  }

  /** Subscribe to state changes. */
  onChange(listener: ChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  private notifyChange(): void {
    for (const listener of this._listeners) listener();
  }

  // === Computed State ===

  get visibleLines(): RenderedLine[] {
    const lineNumbers = this.viewport.getVisibleLineNumbers();
    return computeRenderedLines(
      this.document.buffer,
      lineNumbers,
      this._gutter,
      this._tokenProvider ?? undefined,
      this._decorationProvider ?? undefined,
      this._foldStateProvider ?? undefined,
    );
  }

  get cursors(): readonly CursorState[] {
    return this.cursorManager.cursors;
  }

  get selections(): SelectionRange[] {
    return this.cursorManager.getSelections();
  }

  get scrollState(): ScrollState {
    return {
      scrollTop: this.viewport.scroll.scrollTop,
      scrollLeft: this.viewport.scroll.scrollLeft,
      scrollHeight: this.viewport.lineHeightCache.getTotalHeight(),
      scrollWidth: 0, // TODO: compute from longest line
      viewportHeight: this.viewport.heightPx,
      viewportWidth: this.viewport.widthPx,
    };
  }

  get gutterWidth(): number {
    return this._gutter.computeGutterWidth(this.document.buffer.getLineCount());
  }

  get cursorRenderState(): CursorRenderState {
    return this._cursorBlink.renderState;
  }

  // === Event Handlers ===

  /** Execute a command by ID. */
  executeCommand(commandId: string, args?: any): boolean {
    const ctx: CommandContext = { editor: this };
    const result = this.commandRegistry.execute(commandId, ctx, args);
    if (result) {
      this.afterEdit();
    }
    return result;
  }

  /** Handle keyboard input. */
  onKeyDown(event: KeyEvent): boolean {
    const cmd = this.resolveKeybinding(event);
    if (cmd) {
      this.executeCommand(cmd);
      return true;
    }

    // Regular text input
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      this.executeCommand('editor.action.type', { text: event.key });
      return true;
    }

    return false;
  }

  /** Handle text input (IME result). */
  onTextInput(text: string): void {
    this.executeCommand('editor.action.type', { text });
  }

  /** Handle mouse click. */
  onMouseDown(event: MouseEvent): void {
    const { line, column } = this.pixelToPosition(event.x, event.y);

    if (event.altKey) {
      // Alt+click: add cursor
      this.cursorManager.addCursorAt(line, column);
    } else if (event.shiftKey) {
      // Shift+click: extend selection
      this.cursorManager.moveToPosition(line, column, true);
    } else {
      // Regular click: move cursor
      if (event.clickCount === 2) {
        // Double click: select word
        this.cursorManager.reset(line, column);
        this.executeCommand('editor.action.selectWord');
      } else if (event.clickCount === 3) {
        // Triple click: select line
        this.cursorManager.reset(line, 0);
        this.executeCommand('editor.action.selectLine');
      } else {
        this.cursorManager.reset(line, column);
      }
    }

    this._cursorBlink.resetBlink();
    this.notifyChange();
  }

  /** Handle mouse drag (selection). */
  onMouseMove(event: MouseEvent): void {
    if (event.button === 0) {
      const { line, column } = this.pixelToPosition(event.x, event.y);
      this.cursorManager.moveToPosition(line, column, true);
      this.notifyChange();
    }
  }

  onMouseUp(_event: MouseEvent): void {
    // Selection end — nothing special needed
  }

  /** Handle scroll events. */
  onScroll(event: ScrollEvent): void {
    this.viewport.scroll.scrollBy(event.deltaX, event.deltaY);
    this.notifyChange();
  }

  /** Handle resize. */
  onResize(width: number, height: number): void {
    this.viewport.update(width, height);
    this.cursorManager.setPageSize(this.viewport.getLinesPerPage());
    this.notifyChange();
  }

  /** Handle focus. */
  onFocus(): void {
    this._cursorBlink.setFocused(true);
    this.notifyChange();
  }

  /** Handle blur. */
  onBlur(): void {
    this._cursorBlink.setFocused(false);
    this.notifyChange();
  }

  // IME
  onCompositionStart(): void {
    this._cursorBlink.startComposition();
  }

  onCompositionUpdate(text: string): void {
    this._cursorBlink.updateComposition(text);
    this.notifyChange();
  }

  onCompositionEnd(text: string): void {
    this._cursorBlink.endComposition();
    this.onTextInput(text);
  }

  // === Private ===

  /** Called after any edit or cursor change. */
  private afterEdit(): void {
    this.viewport.setTotalLines(this.document.buffer.getLineCount());
    // Ensure cursor is visible
    const primary = this.cursorManager.primary;
    this.viewport.ensureLineVisible(primary.line);
    this._cursorBlink.resetBlink();
    this.notifyChange();
  }

  /** Convert pixel coordinates to buffer position. */
  private pixelToPosition(x: number, y: number): { line: number; column: number } {
    const scrollTop = this.viewport.scroll.scrollTop;
    const scrollLeft = this.viewport.scroll.scrollLeft;

    const lineHeight = this.viewport.lineHeightCache.baseLineHeight;
    const line = Math.max(0, Math.min(
      Math.floor((y + scrollTop) / lineHeight),
      this.document.buffer.getLineCount() - 1,
    ));

    const gutterW = this.gutterWidth;
    const column = Math.max(0, Math.round((x + scrollLeft - gutterW) / this._charWidth));
    const lineLen = this.document.buffer.getLineLength(line);

    return { line, column: Math.min(column, lineLen) };
  }

  /** Map key events to command IDs. */
  private resolveKeybinding(event: KeyEvent): string | null {
    const meta = event.metaKey || event.ctrlKey; // Cmd on macOS, Ctrl on others
    const shift = event.shiftKey;
    const alt = event.altKey;

    // Undo/Redo
    if (meta && !shift && event.key === 'z') return 'editor.action.undo';
    if (meta && shift && event.key === 'z') return 'editor.action.redo';
    if (meta && event.key === 'y') return 'editor.action.redo';

    // Navigation
    if (event.key === 'ArrowLeft') {
      if (meta && shift) return 'editor.action.selectToLineStart';
      if (meta) return 'editor.action.moveCursorToLineStart';
      if (alt && shift) return 'editor.action.selectWordLeft';
      if (alt) return 'editor.action.moveCursorWordLeft';
      if (shift) return 'editor.action.selectLeft';
      return 'editor.action.moveCursorLeft';
    }
    if (event.key === 'ArrowRight') {
      if (meta && shift) return 'editor.action.selectToLineEnd';
      if (meta) return 'editor.action.moveCursorToLineEnd';
      if (alt && shift) return 'editor.action.selectWordRight';
      if (alt) return 'editor.action.moveCursorWordRight';
      if (shift) return 'editor.action.selectRight';
      return 'editor.action.moveCursorRight';
    }
    if (event.key === 'ArrowUp') {
      if (meta && alt) return 'editor.action.addCursorAbove';
      if (meta && shift) return 'editor.action.selectToDocumentStart';
      if (meta) return 'editor.action.moveCursorToDocumentStart';
      if (shift) return 'editor.action.selectUp';
      return 'editor.action.moveCursorUp';
    }
    if (event.key === 'ArrowDown') {
      if (meta && alt) return 'editor.action.addCursorBelow';
      if (meta && shift) return 'editor.action.selectToDocumentEnd';
      if (meta) return 'editor.action.moveCursorToDocumentEnd';
      if (shift) return 'editor.action.selectDown';
      return 'editor.action.moveCursorDown';
    }

    if (event.key === 'Home') {
      if (shift) return 'editor.action.selectToLineStart';
      return 'editor.action.moveCursorToLineStart';
    }
    if (event.key === 'End') {
      if (shift) return 'editor.action.selectToLineEnd';
      return 'editor.action.moveCursorToLineEnd';
    }
    if (event.key === 'PageUp') {
      if (shift) return 'editor.action.selectPageUp';
      return 'editor.action.pageUp';
    }
    if (event.key === 'PageDown') {
      if (shift) return 'editor.action.selectPageDown';
      return 'editor.action.pageDown';
    }

    // Editing
    if (event.key === 'Backspace') return 'editor.action.deleteLeft';
    if (event.key === 'Delete') return 'editor.action.deleteRight';
    if (event.key === 'Enter') return 'editor.action.insertLineAfter';
    if (event.key === 'Tab') {
      if (shift) return 'editor.action.outdent';
      return 'editor.action.indent';
    }

    // Selection
    if (meta && event.key === 'a') return 'editor.action.selectAll';
    if (meta && event.key === 'd') return 'editor.action.addNextOccurrence';
    if (meta && shift && event.key === 'l') return 'editor.action.selectAllOccurrences';

    // Clipboard
    if (meta && event.key === 'c') return 'editor.action.copy';
    if (meta && event.key === 'x') return 'editor.action.cut';
    if (meta && event.key === 'v') return 'editor.action.paste';

    return null;
  }

  destroy(): void {
    this._cursorBlink.destroy();
  }
}
