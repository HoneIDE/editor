/**
 * Multi-cursor management: primary cursor, secondary cursors, cursor merging.
 *
 * All cursor operations maintain sorted order and merge overlapping
 * cursors/selections. The primary cursor (index 0) drives scroll-to-reveal.
 */

import { TextBuffer } from '../buffer/text-buffer';
import {
  Position,
  SelectionRange,
  comparePositions,
  normalizeSelection,
  selectionsOverlap,
  mergeSelections,
} from './selection';
import { findWordStart, findWordEnd, getWordAtColumn } from './word-boundary';

export type CursorDirection =
  | 'left' | 'right' | 'up' | 'down'
  | 'lineStart' | 'lineEnd'
  | 'documentStart' | 'documentEnd'
  | 'pageUp' | 'pageDown';

export interface CursorState {
  line: number;
  column: number;
  selectionAnchor: Position | null;
  desiredColumn: number;
}

export class CursorManager {
  private _cursors: CursorState[];
  private buffer: TextBuffer;
  private pageSize: number = 30; // lines per page for pageUp/pageDown

  constructor(buffer: TextBuffer) {
    this.buffer = buffer;
    this._cursors = [{
      line: 0,
      column: 0,
      selectionAnchor: null,
      desiredColumn: 0,
    }];
  }

  get primary(): CursorState {
    return this._cursors[0];
  }

  get cursors(): readonly CursorState[] {
    return this._cursors;
  }

  setPageSize(lines: number): void {
    this.pageSize = lines;
  }

  /** Move all cursors in a direction. */
  move(direction: CursorDirection, extend: boolean): void {
    for (const cursor of this._cursors) {
      this.moveCursor(cursor, direction, extend);
    }
    this.mergeCursors();
  }

  /** Move the primary cursor to an exact position. */
  moveToPosition(line: number, column: number, extend: boolean): void {
    const cursor = this._cursors[0];
    if (extend && !cursor.selectionAnchor) {
      cursor.selectionAnchor = { line: cursor.line, column: cursor.column };
    }
    if (!extend) {
      cursor.selectionAnchor = null;
    }
    cursor.line = this.clampLine(line);
    cursor.column = this.clampColumn(cursor.line, column);
    cursor.desiredColumn = cursor.column;
    this.mergeCursors();
  }

  /** Move all cursors by one word in a direction. */
  moveByWord(direction: 'left' | 'right', extend: boolean): void {
    for (const cursor of this._cursors) {
      if (extend && !cursor.selectionAnchor) {
        cursor.selectionAnchor = { line: cursor.line, column: cursor.column };
      }
      if (!extend) cursor.selectionAnchor = null;

      const lineText = this.buffer.getLine(cursor.line);

      if (direction === 'left') {
        if (cursor.column === 0 && cursor.line > 0) {
          cursor.line--;
          cursor.column = this.buffer.getLineLength(cursor.line);
        } else {
          cursor.column = findWordStart(lineText, cursor.column);
        }
      } else {
        if (cursor.column >= lineText.length && cursor.line < this.buffer.getLineCount() - 1) {
          cursor.line++;
          cursor.column = 0;
        } else {
          cursor.column = findWordEnd(lineText, cursor.column);
        }
      }
      cursor.desiredColumn = cursor.column;
    }
    this.mergeCursors();
  }

  /** Add a new cursor at a specific position. */
  addCursorAt(line: number, column: number): void {
    line = this.clampLine(line);
    column = this.clampColumn(line, column);

    // Check if cursor already exists at this position
    for (const c of this._cursors) {
      if (c.line === line && c.column === column) return;
    }

    this._cursorsSorted = false;
    this._cursors.push({
      line,
      column,
      selectionAnchor: null,
      desiredColumn: column,
    });
    this.sortCursors();
    this.mergeCursors();
  }

  /** Add a cursor one line above each existing cursor. */
  addCursorAbove(): void {
    const newCursors: CursorState[] = [];
    for (const cursor of this._cursors) {
      if (cursor.line > 0) {
        const newLine = cursor.line - 1;
        const newCol = this.clampColumn(newLine, cursor.desiredColumn);
        newCursors.push({
          line: newLine,
          column: newCol,
          selectionAnchor: null,
          desiredColumn: cursor.desiredColumn,
        });
      }
    }
    this._cursorsSorted = false;
    this._cursors.push(...newCursors);
    this.sortCursors();
    this.mergeCursors();
  }

  /** Add a cursor one line below each existing cursor. */
  addCursorBelow(): void {
    const newCursors: CursorState[] = [];
    const maxLine = this.buffer.getLineCount() - 1;
    for (const cursor of this._cursors) {
      if (cursor.line < maxLine) {
        const newLine = cursor.line + 1;
        const newCol = this.clampColumn(newLine, cursor.desiredColumn);
        newCursors.push({
          line: newLine,
          column: newCol,
          selectionAnchor: null,
          desiredColumn: cursor.desiredColumn,
        });
      }
    }
    this._cursorsSorted = false;
    this._cursors.push(...newCursors);
    this.sortCursors();
    this.mergeCursors();
  }

  /**
   * SHIP-V1-GAPS.md #80 — column / box selection.
   *
   * Replaces the cursor set with one cursor per line in `[startLine..endLine]`,
   * each anchored at min(startCol,endCol) and head at max(startCol,endCol).
   * Lines shorter than startCol get a zero-length cursor at the line end so
   * `addNextOccurrence`-style follow-up actions stay aligned.
   *
   * Callers wire this to Alt+drag from the editor surface; the column-select
   * mouse-tracker lives in the Rust event handler — this is the document-side
   * primitive it calls into.
   */
  setColumnSelection(startLine: number, startCol: number, endLine: number, endCol: number): void {
    const fromLine = Math.min(startLine, endLine);
    const toLine = Math.max(startLine, endLine);
    const leftCol = Math.min(startCol, endCol);
    const rightCol = Math.max(startCol, endCol);
    this._cursors = [];
    for (let l = fromLine; l <= toLine; l++) {
      const lineLen = this.buffer.getLine(l).length;
      const a = Math.min(leftCol, lineLen);
      const b = Math.min(rightCol, lineLen);
      this._cursors.push({
        line: l,
        column: b,
        selectionAnchor: a === b ? null : { line: l, column: a },
        desiredColumn: b,
      });
    }
    this._cursorsSorted = false;
    this.sortCursors();
    this.mergeCursors();
  }

  /** Select all occurrences of the current selection (or word under cursor). */
  selectAllOccurrences(): void {
    const primary = this._cursors[0];
    let searchText: string;

    if (primary.selectionAnchor) {
      const sel = normalizeSelection(primary.selectionAnchor, { line: primary.line, column: primary.column });
      searchText = this.getSelectionText(sel);
    } else {
      const lineText = this.buffer.getLine(primary.line);
      const [start, end] = getWordAtColumn(lineText, primary.column);
      searchText = lineText.substring(start, end);
    }

    if (searchText.length === 0) return;

    const fullText = this.buffer.getText();

    // Collect all match offsets first
    const matchOffsets: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = fullText.indexOf(searchText, searchFrom);
      if (idx === -1) break;
      matchOffsets.push(idx);
      searchFrom = idx + searchText.length;
    }

    // Batch convert offsets to line/col in a single forward pass
    // (avoids O(n * log n) binary searches for sorted offsets)
    this._cursors = [];
    let curLine = 0;
    let curLineOffset = 0;
    const lineCount = this.buffer.getLineCount();
    const searchLen = searchText.length;

    for (let mi = 0; mi < matchOffsets.length; mi++) {
      const startOff = matchOffsets[mi];
      const endOff = startOff + searchLen;

      // Advance curLine to find the line containing startOff
      while (curLine + 1 < lineCount && this.buffer.getLineOffset(curLine + 1) <= startOff) {
        curLine++;
      }
      const startLine = curLine;
      const startCol = startOff - this.buffer.getLineOffset(startLine);

      // Advance curLine to find the line containing endOff
      while (curLine + 1 < lineCount && this.buffer.getLineOffset(curLine + 1) <= endOff) {
        curLine++;
      }
      const endLine = curLine;
      const endCol = endOff - this.buffer.getLineOffset(endLine);

      this._cursors.push({
        line: endLine,
        column: endCol,
        selectionAnchor: { line: startLine, column: startCol },
        desiredColumn: endCol,
      });
    }

    if (this._cursors.length === 0) {
      this._cursors = [{
        line: primary.line,
        column: primary.column,
        selectionAnchor: null,
        desiredColumn: primary.column,
      }];
    }
  }

  /** Add the next occurrence of the current selection as a new cursor. */
  addNextOccurrence(): void {
    const primary = this._cursors[this._cursors.length - 1]; // last cursor
    let searchText: string;

    if (primary.selectionAnchor) {
      const sel = normalizeSelection(primary.selectionAnchor, { line: primary.line, column: primary.column });
      searchText = this.getSelectionText(sel);
    } else {
      const lineText = this.buffer.getLine(primary.line);
      const [start, end] = getWordAtColumn(lineText, primary.column);
      searchText = lineText.substring(start, end);
      // Select the current word on the primary cursor first
      primary.selectionAnchor = { line: primary.line, column: start };
      primary.column = end;
      primary.desiredColumn = end;
    }

    if (searchText.length === 0) return;

    // Search from after the last cursor's position
    const lastOffset = this.buffer.getLineOffset(primary.line) + primary.column;
    const fullText = this.buffer.getText();
    let idx = fullText.indexOf(searchText, lastOffset);
    if (idx === -1) {
      // Wrap around
      idx = fullText.indexOf(searchText, 0);
    }
    if (idx === -1) return;

    // Check if this occurrence is already covered by an existing cursor
    const startLine = this.buffer.getOffsetLine(idx);
    const startCol = idx - this.buffer.getLineOffset(startLine);
    for (const c of this._cursors) {
      if (c.selectionAnchor &&
          c.selectionAnchor.line === startLine &&
          c.selectionAnchor.column === startCol) {
        return; // already have this one
      }
    }

    const endOffset = idx + searchText.length;
    const endLine = this.buffer.getOffsetLine(endOffset);
    const endCol = endOffset - this.buffer.getLineOffset(endLine);

    this._cursorsSorted = false;
    this._cursors.push({
      line: endLine,
      column: endCol,
      selectionAnchor: { line: startLine, column: startCol },
      desiredColumn: endCol,
    });
    this.sortCursors();
  }

  /** Reset to a single cursor at the given position. */
  reset(line: number, column: number): void {
    line = this.clampLine(line);
    column = this.clampColumn(line, column);
    this._cursors = [{
      line,
      column,
      selectionAnchor: null,
      desiredColumn: column,
    }];
  }

  /** Get all selections (for rendering). */
  getSelections(): SelectionRange[] {
    const selections: SelectionRange[] = [];
    for (const cursor of this._cursors) {
      if (cursor.selectionAnchor) {
        selections.push(normalizeSelection(
          cursor.selectionAnchor,
          { line: cursor.line, column: cursor.column },
        ));
      }
    }
    return selections;
  }

  /** Get text content of a selection. */
  private getSelectionText(sel: SelectionRange): string {
    const startOffset = this.buffer.getLineOffset(sel.startLine) + sel.startColumn;
    const endOffset = this.buffer.getLineOffset(sel.endLine) + sel.endColumn;
    return this.buffer.getTextRange(startOffset, endOffset);
  }

  private moveCursor(cursor: CursorState, direction: CursorDirection, extend: boolean): void {
    // Set up selection anchor
    if (extend && !cursor.selectionAnchor) {
      cursor.selectionAnchor = { line: cursor.line, column: cursor.column };
    }

    // If not extending and has selection, collapse to selection edge
    if (!extend && cursor.selectionAnchor) {
      const sel = normalizeSelection(cursor.selectionAnchor, { line: cursor.line, column: cursor.column });
      if (direction === 'left' || direction === 'up') {
        cursor.line = sel.startLine;
        cursor.column = sel.startColumn;
      } else if (direction === 'right' || direction === 'down') {
        cursor.line = sel.endLine;
        cursor.column = sel.endColumn;
      }
      cursor.selectionAnchor = null;
      cursor.desiredColumn = cursor.column;
      if (direction === 'left' || direction === 'right') return;
    }

    if (!extend) cursor.selectionAnchor = null;

    switch (direction) {
      case 'left':
        if (cursor.column > 0) {
          cursor.column--;
        } else if (cursor.line > 0) {
          cursor.line--;
          cursor.column = this.buffer.getLineLength(cursor.line);
        }
        cursor.desiredColumn = cursor.column;
        break;

      case 'right': {
        const lineLen = this.buffer.getLineLength(cursor.line);
        if (cursor.column < lineLen) {
          cursor.column++;
        } else if (cursor.line < this.buffer.getLineCount() - 1) {
          cursor.line++;
          cursor.column = 0;
        }
        cursor.desiredColumn = cursor.column;
        break;
      }

      case 'up':
        if (cursor.line > 0) {
          cursor.line--;
          cursor.column = this.clampColumn(cursor.line, cursor.desiredColumn);
        }
        break;

      case 'down':
        if (cursor.line < this.buffer.getLineCount() - 1) {
          cursor.line++;
          cursor.column = this.clampColumn(cursor.line, cursor.desiredColumn);
        }
        break;

      case 'lineStart': {
        // First press: go to first non-whitespace. Second press: go to column 0.
        const lineText = this.buffer.getLine(cursor.line);
        const firstNonWS = lineText.search(/\S/);
        const target = firstNonWS === -1 ? 0 : firstNonWS;
        cursor.column = cursor.column === target ? 0 : target;
        cursor.desiredColumn = cursor.column;
        break;
      }

      case 'lineEnd':
        cursor.column = this.buffer.getLineLength(cursor.line);
        cursor.desiredColumn = cursor.column;
        break;

      case 'documentStart':
        cursor.line = 0;
        cursor.column = 0;
        cursor.desiredColumn = 0;
        break;

      case 'documentEnd':
        cursor.line = this.buffer.getLineCount() - 1;
        cursor.column = this.buffer.getLineLength(cursor.line);
        cursor.desiredColumn = cursor.column;
        break;

      case 'pageUp':
        cursor.line = Math.max(0, cursor.line - this.pageSize);
        cursor.column = this.clampColumn(cursor.line, cursor.desiredColumn);
        break;

      case 'pageDown':
        cursor.line = Math.min(this.buffer.getLineCount() - 1, cursor.line + this.pageSize);
        cursor.column = this.clampColumn(cursor.line, cursor.desiredColumn);
        break;
    }
  }

  private clampLine(line: number): number {
    return Math.max(0, Math.min(line, this.buffer.getLineCount() - 1));
  }

  private clampColumn(line: number, column: number): number {
    const lineLen = this.buffer.getLineLength(line);
    return Math.max(0, Math.min(column, lineLen));
  }

  private _cursorsSorted: boolean = false;

  private sortCursors(): void {
    if (this._cursorsSorted) return;
    this._cursors.sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.column - b.column;
    });
    this._cursorsSorted = true;
  }

  /** Merge overlapping or coincident cursors. */
  private mergeCursors(): void {
    if (this._cursors.length <= 1) return;
    this.sortCursors();

    const merged: CursorState[] = [this._cursors[0]];
    for (let i = 1; i < this._cursors.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = this._cursors[i];

      // Check if cursors are at the same position
      if (prev.line === curr.line && prev.column === curr.column) {
        // Merge: keep the one with a selection if any
        if (curr.selectionAnchor && !prev.selectionAnchor) {
          merged[merged.length - 1] = curr;
        }
        continue;
      }

      // Check if selections overlap
      if (prev.selectionAnchor && curr.selectionAnchor) {
        const prevSel = normalizeSelection(prev.selectionAnchor, { line: prev.line, column: prev.column });
        const currSel = normalizeSelection(curr.selectionAnchor, { line: curr.line, column: curr.column });
        if (selectionsOverlap(prevSel, currSel)) {
          const mergedSel = mergeSelections(prevSel, currSel);
          // Keep the later cursor position, use merged selection as anchor
          prev.line = curr.line;
          prev.column = curr.column;
          prev.selectionAnchor = { line: mergedSel.startLine, column: mergedSel.startColumn };
          continue;
        }
      }

      merged.push(curr);
    }

    this._cursors = merged;
  }
}
