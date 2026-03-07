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
import type { ISyntaxEngine } from '../core/tokenizer/tokenizer-interface';

// Perry-safe: module-level variables for direct tokenization state.
// Class field mutations aren't visible in getters (Perry captures initial values).
// Module-level variables ARE read fresh on each function/getter call.
let _perryLangIsMarkdown: number = 0;
let _perryFenceCache: string = '';
let _perryUseDirectTokens: number = 0;

export function setPerryMarkdownState(isMarkdown: number, fenceCache: string): void {
  _perryLangIsMarkdown = isMarkdown;
  _perryFenceCache = fenceCache;
}

export function setPerryDirectTokens(enabled: number): void {
  _perryUseDirectTokens = enabled;
}

/**
 * Module-level markdown tokenizer. Must be in the SAME file as the getter
 * that calls it — Perry AOT silently drops cross-module function calls from getters.
 * Uses hardcoded VS Code dark theme colors (no theme parameter needed).
 */
function _tokenizeMdLine(line: string, inFence: number): LineToken[] {
  const tokens: LineToken[] = [];
  const len = line.length;
  if (len === 0) return tokens;

  const codeBg = '#282830';
  const headingColor = '#4fc1ff';
  const stringColor = '#ce9178';
  const metaColor = '#569cd6';
  const boldColor = '#d7ba7d';
  const fgColor = '#d4d4d4';

  // Trim leading whitespace for detection
  let trimStart = 0;
  while (trimStart < len && (line.charCodeAt(trimStart) === 32 || line.charCodeAt(trimStart) === 9)) {
    trimStart++;
  }

  // Code fence (```)
  if (len - trimStart >= 3 && line.charAt(trimStart) === '`' && line.charAt(trimStart + 1) === '`' && line.charAt(trimStart + 2) === '`') {
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    tokens.push({ startColumn: 0, endColumn: len, color: metaColor, fontStyle: 'normal' });
    return tokens;
  }

  // Inside a fenced code block
  if (inFence === 1) {
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    tokens.push({ startColumn: 0, endColumn: len, color: stringColor, fontStyle: 'normal' });
    return tokens;
  }

  // Heading: starts with # followed by space
  if (line.charAt(trimStart) === '#') {
    let level = 0;
    let hi = trimStart;
    while (hi < len && line.charAt(hi) === '#' && level < 6) {
      level++;
      hi++;
    }
    if (hi < len && line.charCodeAt(hi) === 32) {
      const headingStyle = level <= 2 ? 'heading-lg' : 'heading-md';
      tokens.push({ startColumn: 0, endColumn: len, color: headingColor, fontStyle: headingStyle });
      return tokens;
    }
  }

  // Horizontal rule: --- or *** or ___
  if (len - trimStart >= 3) {
    const hrC = line.charCodeAt(trimStart);
    if (hrC === 45 || hrC === 42 || hrC === 95) { // - * _
      let allMatch = true;
      for (let i = trimStart; i < len; i++) {
        const c = line.charCodeAt(i);
        if (c !== hrC && c !== 32) { allMatch = false; break; }
      }
      if (allMatch) {
        tokens.push({ startColumn: 0, endColumn: len, color: metaColor, fontStyle: 'normal' });
        return tokens;
      }
    }
  }

  // Blockquote: > prefix
  if (line.charAt(trimStart) === '>') {
    tokens.push({ startColumn: 0, endColumn: len, color: stringColor, fontStyle: 'italic' });
    return tokens;
  }

  // List item: - or * or + or 1.
  if (trimStart < len) {
    const lc = line.charCodeAt(trimStart);
    if (lc === 45 || lc === 42 || lc === 43) { // - * +
      if (trimStart + 1 < len && line.charCodeAt(trimStart + 1) === 32) {
        // Bullet point — just color the bullet, rest is normal
        tokens.push({ startColumn: 0, endColumn: trimStart + 2, color: metaColor, fontStyle: 'normal' });
        if (trimStart + 2 < len) {
          tokens.push({ startColumn: trimStart + 2, endColumn: len, color: fgColor, fontStyle: 'normal' });
        }
        return tokens;
      }
    }
  }

  // Inline formatting: scan for **, *, `, []()
  let pos = 0;
  let lastEnd = 0;
  while (pos < len) {
    const ch = line.charCodeAt(pos);

    // Inline code: `...`
    if (ch === 96) { // backtick
      let end = pos + 1;
      while (end < len && line.charCodeAt(end) !== 96) end++;
      if (end < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 1, color: stringColor, fontStyle: 'normal' });
        lastEnd = end + 1;
        pos = end + 1;
        continue;
      }
    }

    // Bold: **...**
    if (ch === 42 && pos + 1 < len && line.charCodeAt(pos + 1) === 42) {
      let end = pos + 2;
      while (end + 1 < len) {
        if (line.charCodeAt(end) === 42 && line.charCodeAt(end + 1) === 42) break;
        end++;
      }
      if (end + 1 < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 2, color: boldColor, fontStyle: 'bold' });
        lastEnd = end + 2;
        pos = end + 2;
        continue;
      }
    }

    // Italic: *...*  (single asterisk, not followed by another)
    if (ch === 42 && (pos + 1 >= len || line.charCodeAt(pos + 1) !== 42)) {
      let end = pos + 1;
      while (end < len && line.charCodeAt(end) !== 42) end++;
      if (end < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 1, color: fgColor, fontStyle: 'italic' });
        lastEnd = end + 1;
        pos = end + 1;
        continue;
      }
    }

    pos++;
  }

  // Remaining text
  if (lastEnd < len) {
    tokens.push({ startColumn: lastEnd, endColumn: len, color: fgColor, fontStyle: 'normal' });
  }

  return tokens;
}

import { IncrementalTokenCache } from '../core/tokenizer/incremental';
import { FoldState } from '../core/folding/fold-state';
import { CursorBlinkController, CursorRenderState } from './cursor-state';
import { GutterRenderer } from './gutter';
import { FindWidgetController } from './find-widget';
import { GhostTextController } from './ghost-text';
import { OverlayManager } from './overlays';
import { DiffViewModel } from './diff-view-model';
import { RenderedLine, computeRenderedLines, LineToken, LineDecoration } from './line-layout';
import { searchDecorations } from './decorations';
import { EditorTheme, DARK_THEME } from './theme';

/** No-op syntax engine for backward compatibility when none is provided. */
const NO_OP_SYNTAX_ENGINE: ISyntaxEngine = {
  setLanguage() {},
  parse() { return null; },
  getLineTokens() { return []; },
  getFoldRanges() { return []; },
  findMatchingBracket() { return null; },
  getSupportedLanguages() { return []; },
  hasLanguage() { return false; },
};

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

  // Phase 1 subsystems
  readonly syntaxEngine: ISyntaxEngine;
  readonly tokenCache: IncrementalTokenCache;
  readonly foldState: FoldState;
  readonly findWidget: FindWidgetController;
  readonly ghostText: GhostTextController;
  readonly overlays: OverlayManager;
  readonly diffView: DiffViewModel;

  // Rendering state
  private _cursorBlink: CursorBlinkController;
  private _gutter: GutterRenderer;
  private _theme: EditorTheme;
  private _charWidth: number = 8; // default, updated by native renderer
  private _perryMode: boolean = false; // set true to use Perry-safe command handlers
  // Single listener — Perry-safe (no array push/splice/for...of needed).
  private _listener: ChangeListener | null = null;

  // Token/decoration providers (set by syntax engine)
  private _tokenProvider: ((lineNumber: number) => LineToken[]) | null = null;
  private _decorationProvider: ((lineNumber: number) => LineDecoration[]) | null = null;
  private _foldStateProvider: ((lineNumber: number) => 'expanded' | 'collapsed' | 'none') | null = null;

  // Perry-safe direct tokenization: bypass _tokenProvider closure entirely.
  // When set to 1, visibleLines calls this.syntaxEngine.getLineTokens() directly.
  private _useDirectTokens: number = 0;

  // Perry-safe language tracking: engine property access fails after first frame.
  // Track markdown flag and fence cache string directly on the ViewModel.
  _langIsMarkdown: number = 0;
  _fenceCache: string = '';

  constructor(doc: EditorDocument, theme?: EditorTheme, syntaxEngine?: ISyntaxEngine) {
    this.document = doc;
    this._theme = theme !== undefined ? theme : DARK_THEME;

    this.cursorManager = new CursorManager(doc.buffer);
    this.viewport = new ViewportManager();
    this.undoManager = new UndoManager(doc.buffer);
    this.commandRegistry = new CommandRegistry();

    // Phase 1 subsystems — use provided engine or a no-op stub
    this.syntaxEngine = syntaxEngine !== undefined ? syntaxEngine : NO_OP_SYNTAX_ENGINE;
    this.tokenCache = new IncrementalTokenCache(this.syntaxEngine);
    this.foldState = new FoldState();
    this.findWidget = new FindWidgetController();
    this.ghostText = new GhostTextController();
    this.overlays = new OverlayManager();
    this.diffView = new DiffViewModel();

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

    // Wire syntax engine to document language
    if (doc.languageId && this.syntaxEngine.hasLanguage(doc.languageId)) {
      this.syntaxEngine.setLanguage(doc.languageId);
      this.syntaxEngine.parse(doc.buffer);
      this.updateFoldRanges();
    }

    // Wire token provider from syntax engine.
    // NOTE: bypasses IncrementalTokenCache — Perry's class-field Array.push
    // dispatch is broken (same issue as LineIndex), causing an infinite loop
    // in the cache-growth while loop. Call the syntax engine directly instead.
    this._tokenProvider = (lineNumber: number) => {
      return this.syntaxEngine.getLineTokens(doc.buffer, lineNumber, this._theme);
    };

    // Wire fold state provider
    this._foldStateProvider = (lineNumber: number) => {
      return this.foldState.getFoldState(lineNumber);
    };

    // Wire hidden lines from fold state into viewport
    this.viewport.setHiddenLines(this.foldState.getHiddenLines());
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

  /** Enable Perry-safe command handlers (avoids destructuring, .map(), spread). */
  setPerryMode(enabled: boolean): void {
    this._perryMode = enabled;
  }

  /** Enable direct tokenization (bypass _tokenProvider closure for Perry). */
  setDirectTokens(enabled: number): void {
    this._useDirectTokens = enabled;
    // Also set module-level flag — this is called from within the same module's
    // class method, which CAN update module-level state (unlike cross-module calls).
    _perryUseDirectTokens = enabled;
  }

  /** Perry-safe: set markdown flag directly (avoids engine property access). */
  setMarkdownMode(isMarkdown: number): void {
    this._langIsMarkdown = isMarkdown;
  }

  /** Perry-safe: set fence cache string directly (avoids engine property access). */
  setFenceCache(cache: string): void {
    this._fenceCache = cache;
  }

  /** Direct tokenization for a single line (Perry-safe: bypasses ISyntaxEngine vtable). */
  tokenizeLine(lineNum: number): LineToken[] {
    return getLineTokensDirect(
      this.syntaxEngine as any, this.document.buffer, lineNum, this._theme,
    );
  }

  setTokenProvider(provider: (lineNumber: number) => LineToken[]): void {
    this._tokenProvider = provider;
  }

  /**
   * Re-create the _tokenProvider closure so Perry captures the CURRENT
   * syntax engine state (language, keywords, lineComment). Must be called
   * after engine.setLanguage() because Perry closures capture by value —
   * the constructor-time closure holds stale engine state.
   */
  refreshTokenProvider(): void {
    const engine = this.syntaxEngine;
    const buf = this.document.buffer;
    const theme = this._theme;
    this._tokenProvider = (lineNumber: number) => {
      return engine.getLineTokens(buf, lineNumber, theme);
    };
  }

  setDecorationProvider(provider: (lineNumber: number) => LineDecoration[]): void {
    this._decorationProvider = provider;
  }

  setFoldStateProvider(provider: (lineNumber: number) => 'expanded' | 'collapsed' | 'none'): void {
    this._foldStateProvider = provider;
  }

  /** Subscribe to state changes. */
  onChange(listener: ChangeListener): () => void {
    // Perry-safe: single nullable field — no array, no push, no for...of.
    this._listener = listener;
    return () => { this._listener = null; };
  }

  private notifyChange(): void {
    // Perry-safe: plain null check on a single field.
    if (this._listener !== null && this._listener !== undefined) {
      this._listener();
    }
  }

  /**
   * Notify all change listeners without modifying any state.
   * Call this after external buffer modifications (e.g. setContent) to ensure
   * onChange subscribers and the render coordinator are updated.
   */
  touch(): void {
    this.notifyChange();
  }

  // === Computed State ===

  get visibleLines(): RenderedLine[] {
    // Only send visible viewport lines to Rust (not the entire file).
    // Rust clears frame_lines on begin_frame and only needs lines that
    // will actually be drawn. Sending ALL lines was O(N) per frame which
    // made scrolling laggy on files with hundreds of lines.
    const visRange = this.viewport.getVisibleRange();

    const lineNumbers: number[] = [];
    let i = visRange.startLine;
    while (i < visRange.endLine) {
      lineNumbers.push(i);
      i = i + 1;
    }

    // Perry-safe: inline tokenization for markdown. Uses module-level
    // _tokenizeMdLine (same file — cross-module function calls from getters
    // are silently dropped by Perry AOT). Fence state is computed on-the-fly.
    if (_perryUseDirectTokens === 1) {
      const result: RenderedLine[] = [];
      // Pre-compute fence state up to the first visible line (scan from line 0)
      let fenceState = 0;
      const firstLine = lineNumbers.length > 0 ? lineNumbers[0] : 0;
      for (let fl = 0; fl < firstLine; fl++) {
        const ftext = this.document.buffer.getLine(fl);
        let fts = 0;
        while (fts < ftext.length && (ftext.charCodeAt(fts) === 32 || ftext.charCodeAt(fts) === 9)) fts++;
        if (ftext.length - fts >= 3 && ftext.charAt(fts) === '`' && ftext.charAt(fts + 1) === '`' && ftext.charAt(fts + 2) === '`') {
          fenceState = fenceState === 0 ? 1 : 0;
        }
      }
      for (let li = 0; li < lineNumbers.length; li++) {
        const lineNum = lineNumbers[li];
        const content = this.document.buffer.getLine(lineNum);
        let tokens: LineToken[] = [];
        let lineBg = '';
        if (content.length > 0) {
          const mdTokens = _tokenizeMdLine(content, fenceState);
          if (mdTokens.length > 0) {
            for (let ti = 0; ti < mdTokens.length; ti++) {
              if (mdTokens[ti].startColumn === -1) {
                lineBg = mdTokens[ti].color;
              } else {
                tokens.push(mdTokens[ti]);
              }
            }
          }
        }
        // Update fence state for next line
        if (content.length > 0) {
          let fts2 = 0;
          while (fts2 < content.length && (content.charCodeAt(fts2) === 32 || content.charCodeAt(fts2) === 9)) fts2++;
          if (content.length - fts2 >= 3 && content.charAt(fts2) === '`' && content.charAt(fts2 + 1) === '`' && content.charAt(fts2 + 2) === '`') {
            fenceState = fenceState === 0 ? 1 : 0;
          }
        }
        if (tokens.length === 0 && content.length > 0) {
          tokens = [{
            startColumn: 0, endColumn: content.length,
            color: this._theme.foreground, fontStyle: 'normal',
          }];
        }
        const gutterItems = this._gutter.getGutterItems(
          lineNum, 'none', false, null, null,
        );
        const line: RenderedLine = {
          lineNumber: lineNum,
          content: content,
          tokens: tokens,
          decorations: [],
          foldState: 'none',
          gutterItems: gutterItems,
          lineBg: lineBg,
        };
        result.push(line);
      }
      return result;
    }

    return computeRenderedLines(
      this.document.buffer,
      lineNumbers,
      this._gutter,
      this._tokenProvider,
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
    // Handle Phase 1 commands directly
    switch (commandId) {
      case 'editor.action.find':
        this.findWidget.open(this.document.buffer);
        this.notifyChange();
        return true;
      case 'editor.action.replace':
        this.findWidget.open(this.document.buffer);
        this.findWidget.toggleReplace();
        this.notifyChange();
        return true;
      case 'editor.action.findNext':
        this.findWidget.nextMatch();
        this.notifyChange();
        return true;
      case 'editor.action.findPrev':
        this.findWidget.prevMatch();
        this.notifyChange();
        return true;
      case 'editor.action.escape':
        if (this.findWidget.state.isOpen) {
          this.findWidget.close();
        }
        this.overlays.hideAll();
        this.ghostText.dismiss();
        this.notifyChange();
        return true;
      case 'editor.action.fold': {
        const primary = this.cursorManager.primary;
        this.foldState.fold(primary.line);
        this.viewport.setHiddenLines(this.foldState.getHiddenLines());
        this.notifyChange();
        return true;
      }
      case 'editor.action.unfold': {
        const primary = this.cursorManager.primary;
        this.foldState.unfold(primary.line);
        this.viewport.setHiddenLines(this.foldState.getHiddenLines());
        this.notifyChange();
        return true;
      }
      case 'editor.action.acceptGhostText': {
        const text = this.ghostText.accept();
        if (text) {
          this.executeCommand('editor.action.type', { text });
        }
        return true;
      }
    }

    // Perry-safe command handlers: run BEFORE the command registry because
    // registered handlers use destructuring, .map(), spread, for...of — all
    // broken in Perry AOT. These use only Perry-safe patterns.
    // Only active when setPerryMode(true) has been called.
    if (this._perryMode) {

    const cursors0 = this.cursorManager.cursors;
    if (cursors0.length === 0) return false;
    const cursor0 = cursors0[0];

    if (commandId === 'editor.action.type') {
      const text = args !== null && args !== undefined ? args.text : '';
      if (text === null || text === undefined || text.length === 0) return false;

      const lineContent = this.document.buffer.getLine(cursor0.line);
      const lineOffset = this.document.buffer.getLineOffset(cursor0.line);
      const ch = text.charAt(0);

      // Auto-bracket: single character handling
      if (text.length === 1) {
        // Over-type check: if typing a closing bracket/quote and next char matches, skip insert
        const nextChar = cursor0.column < lineContent.length ? lineContent.charAt(cursor0.column) : '';
        if (ch === ')' || ch === '}' || ch === ']' || ch === '"' || ch === "'" || ch === '`') {
          if (nextChar === ch) {
            cursor0.column = cursor0.column + 1;
            cursor0.desiredColumn = cursor0.column;
            cursor0.selectionAnchor = null;
            this.notifyChange();
            return true;
          }
        }

        // Auto-close: opening bracket → insert pair, cursor between
        let closeChar = '';
        if (ch === '(') closeChar = ')';
        else if (ch === '{') closeChar = '}';
        else if (ch === '[') closeChar = ']';
        else if (ch === '"') closeChar = '"';
        else if (ch === "'") closeChar = "'";
        else if (ch === '`') closeChar = '`';

        if (closeChar.length > 0) {
          // For quotes, don't auto-close if adjacent to word char
          let shouldClose = true;
          if (ch === '"' || ch === "'" || ch === '`') {
            if (cursor0.column < lineContent.length) {
              const nc = lineContent.charCodeAt(cursor0.column);
              if ((nc >= 97 && nc <= 122) || (nc >= 65 && nc <= 90) || (nc >= 48 && nc <= 57) || nc === 95) {
                shouldClose = false;
              }
            }
            if (cursor0.column > 0) {
              const pc = lineContent.charCodeAt(cursor0.column - 1);
              if ((pc >= 97 && pc <= 122) || (pc >= 65 && pc <= 90) || (pc >= 48 && pc <= 57) || pc === 95) {
                shouldClose = false;
              }
            }
          }
          if (shouldClose) {
            let pair = '';
            pair += ch;
            pair += closeChar;
            this.document.buffer.insert(lineOffset + cursor0.column, pair);
            cursor0.column = cursor0.column + 1;
            cursor0.desiredColumn = cursor0.column;
            cursor0.selectionAnchor = null;
            this.afterEdit();
            return true;
          }
        }
      }

      // Plain insert (no auto-bracket)
      this.document.buffer.insert(lineOffset + cursor0.column, text);
      cursor0.column = cursor0.column + text.length;
      cursor0.desiredColumn = cursor0.column;
      cursor0.selectionAnchor = null;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.insertLineAfter') {
      const currentLine = this.document.buffer.getLine(cursor0.line);
      // Get leading whitespace (Perry-safe: no regex)
      let indentEnd = 0;
      for (let wi = 0; wi < currentLine.length; wi++) {
        const wc = currentLine.charAt(wi);
        if (wc === ' ' || wc === '\t') {
          indentEnd = wi + 1;
        } else {
          break;
        }
      }
      const indent = currentLine.substring(0, indentEnd);

      // Check char before and after cursor for smart indent
      const charBefore = cursor0.column > 0 ? currentLine.charAt(cursor0.column - 1) : '';
      const charAfter = cursor0.column < currentLine.length ? currentLine.charAt(cursor0.column) : '';

      // Check if last non-ws char before cursor is '{'
      let endsWithBrace = false;
      for (let bi = cursor0.column - 1; bi >= 0; bi--) {
        const bc = currentLine.charAt(bi);
        if (bc === ' ' || bc === '\t') continue;
        if (bc === '{') endsWithBrace = true;
        break;
      }

      let insertText = '\n';
      let newLine = cursor0.line + 1;
      let newCol = 0;

      if (charBefore === '{' && charAfter === '}') {
        // Smart Enter between braces: {|} → {\n  indent\n indent}
        insertText += indent;
        insertText += '  ';
        insertText += '\n';
        insertText += indent;
        newCol = indentEnd + 2;
      } else if (endsWithBrace) {
        // After opening brace: increase indent
        insertText += indent;
        insertText += '  ';
        newCol = indentEnd + 2;
      } else {
        // Normal Enter: preserve indent
        insertText += indent;
        newCol = indentEnd;
      }

      const offset = this.document.buffer.getLineOffset(cursor0.line) + cursor0.column;
      this.document.buffer.insert(offset, insertText);
      cursor0.line = newLine;
      cursor0.column = newCol;
      cursor0.desiredColumn = newCol;
      cursor0.selectionAnchor = null;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.deleteLeft') {
      if (cursor0.selectionAnchor !== null && cursor0.selectionAnchor !== undefined) {
        // Delete selection
        const anchorLine = cursor0.selectionAnchor.line;
        const anchorCol = cursor0.selectionAnchor.column;
        let startLine = cursor0.line;
        let startCol = cursor0.column;
        let endLine = anchorLine;
        let endCol = anchorCol;
        if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
          startLine = anchorLine;
          startCol = anchorCol;
          endLine = cursor0.line;
          endCol = cursor0.column;
        }
        const startOff = this.document.buffer.getLineOffset(startLine) + startCol;
        const endOff = this.document.buffer.getLineOffset(endLine) + endCol;
        if (endOff > startOff) {
          this.document.buffer.delete(startOff, endOff - startOff);
        }
        cursor0.line = startLine;
        cursor0.column = startCol;
        cursor0.desiredColumn = startCol;
        cursor0.selectionAnchor = null;
        this.afterEdit();
        return true;
      }
      // Auto-delete pair: if between matching brackets, delete both
      if (cursor0.column > 0) {
        const delLine = this.document.buffer.getLine(cursor0.line);
        const prevCh = delLine.charAt(cursor0.column - 1);
        const nextCh = cursor0.column < delLine.length ? delLine.charAt(cursor0.column) : '';
        let isPair = false;
        if (prevCh === '(' && nextCh === ')') isPair = true;
        else if (prevCh === '{' && nextCh === '}') isPair = true;
        else if (prevCh === '[' && nextCh === ']') isPair = true;
        else if (prevCh === '"' && nextCh === '"') isPair = true;
        else if (prevCh === "'" && nextCh === "'") isPair = true;
        else if (prevCh === '`' && nextCh === '`') isPair = true;
        if (isPair) {
          const lineOff = this.document.buffer.getLineOffset(cursor0.line);
          this.document.buffer.delete(lineOff + cursor0.column - 1, 2);
          cursor0.column = cursor0.column - 1;
          cursor0.desiredColumn = cursor0.column;
          this.afterEdit();
          return true;
        }
      }
      if (cursor0.column > 0) {
        const lineOff = this.document.buffer.getLineOffset(cursor0.line);
        this.document.buffer.delete(lineOff + cursor0.column - 1, 1);
        cursor0.column = cursor0.column - 1;
        cursor0.desiredColumn = cursor0.column;
        this.afterEdit();
        return true;
      } else if (cursor0.line > 0) {
        const prevLineLen = this.document.buffer.getLineLength(cursor0.line - 1);
        const joinOffset = this.document.buffer.getLineOffset(cursor0.line) - 1;
        this.document.buffer.delete(joinOffset, 1);
        cursor0.line = cursor0.line - 1;
        cursor0.column = prevLineLen;
        cursor0.desiredColumn = cursor0.column;
        this.afterEdit();
        return true;
      }
      return false;
    }

    } // end if (this._perryMode)

    // For commands without Perry-safe fallbacks, try the command registry
    const ctx: CommandContext = { editor: this };
    const result = this.commandRegistry.execute(commandId, ctx, args);
    if (result) {
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.moveCursorLeft') {
      if (cursor0.column > 0) {
        cursor0.column = cursor0.column - 1;
      } else if (cursor0.line > 0) {
        cursor0.line = cursor0.line - 1;
        cursor0.column = this.document.buffer.getLineLength(cursor0.line);
      }
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorRight') {
      const lineLen0 = this.document.buffer.getLineLength(cursor0.line);
      if (cursor0.column < lineLen0) {
        cursor0.column = cursor0.column + 1;
      } else if (cursor0.line < this.document.buffer.getLineCount() - 1) {
        cursor0.line = cursor0.line + 1;
        cursor0.column = 0;
      }
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorUp') {
      if (cursor0.line > 0) {
        cursor0.line = cursor0.line - 1;
        const lineLen1 = this.document.buffer.getLineLength(cursor0.line);
        if (cursor0.column > lineLen1) {
          cursor0.column = lineLen1;
        }
      }
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorDown') {
      const totalLines = this.document.buffer.getLineCount();
      if (cursor0.line < totalLines - 1) {
        cursor0.line = cursor0.line + 1;
        const lineLen2 = this.document.buffer.getLineLength(cursor0.line);
        if (cursor0.column > lineLen2) {
          cursor0.column = lineLen2;
        }
      }
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorToLineStart') {
      cursor0.column = 0;
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = 0;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorToLineEnd') {
      cursor0.column = this.document.buffer.getLineLength(cursor0.line);
      cursor0.selectionAnchor = null;
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    return false;
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
    // Use explicit form (not shorthand) — Perry AOT shorthand captures stale values.
    this.executeCommand('editor.action.type', { text: text });
  }

  /** Handle mouse click. */
  onMouseDown(event: MouseEvent): void {
    // Avoid destructuring — Perry AOT may not support it correctly.
    const _clickPos = this.pixelToPosition(event.x, event.y);
    const line = _clickPos.line;
    const column = _clickPos.column;

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
      const _movePos = this.pixelToPosition(event.x, event.y);
      this.cursorManager.moveToPosition(_movePos.line, _movePos.column, true);
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

    // Re-parse for syntax highlighting
    const langId = this.document.languageId;
    if (langId !== null && langId !== undefined && this.syntaxEngine.hasLanguage(langId)) {
      this.syntaxEngine.parse(this.document.buffer);
      this.updateFoldRanges();
    }

    // Dismiss ghost text on edit
    this.ghostText.markStale();

    // Ensure cursor is visible — use cursors[0] directly (Perry-safe, avoids getter dispatch).
    const _afterEditCursors = this.cursorManager.cursors;
    if (_afterEditCursors.length > 0) {
      this.viewport.ensureLineVisible(_afterEditCursors[0].line);
    }
    this._cursorBlink.resetBlink();
    this.notifyChange();
  }

  /** Update fold ranges from syntax engine. */
  private updateFoldRanges(): void {
    const ranges = this.syntaxEngine.getFoldRanges(this.document.buffer);
    this.foldState.setAvailableRanges(ranges);
    this.viewport.setHiddenLines(this.foldState.getHiddenLines());
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

    return { line: line, column: Math.min(column, lineLen) };
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

    // Find/Replace
    if (meta && event.key === 'f') return 'editor.action.find';
    if (meta && event.key === 'h') return 'editor.action.replace';
    if (event.key === 'Escape') return 'editor.action.escape';
    if (meta && event.key === 'g') {
      if (shift) return 'editor.action.findPrev';
      return 'editor.action.findNext';
    }

    // Folding
    if (meta && shift && event.key === '[') return 'editor.action.fold';
    if (meta && shift && event.key === ']') return 'editor.action.unfold';

    // Ghost text
    if (event.key === 'Tab' && !shift && this.ghostText.state) return 'editor.action.acceptGhostText';

    return null;
  }

  destroy(): void {
    this._cursorBlink.destroy();
  }
}
