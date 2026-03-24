/**
 * High-level TextBuffer API wrapping rope internals.
 *
 * This is the public interface for all text operations. It coordinates
 * the PieceTable, Rope, and LineIndex to provide a clean API for
 * editing, querying, and snapshotting document content.
 */

import { PieceTable } from './piece-table';
import { Rope, RopeSnapshot } from './rope';
import { LineIndex } from './line-index';

export interface TextEdit {
  /** Zero-based character offset where the edit starts. */
  offset: number;
  /** Number of characters to delete starting at offset. 0 for pure insert. */
  deleteCount: number;
  /** Text to insert at offset (after deletion). Empty string for pure delete. */
  insertText: string;
}

export interface BufferSnapshot {
  readonly id: number;
  readonly length: number;
  readonly lineCount: number;
  getText(): string;
  getLine(lineNumber: number): string;
}

let snapshotIdCounter = 0;

export class TextBuffer {
  private rope: Rope;
  private lineIndex: LineIndex;
  // Perry-safe shadow copy of full text.
  // Rope internals use splice/for-of patterns that may corrupt charCount in Perry
  // AOT native codegen (affecting getFullText() after edits). By maintaining a
  // plain string that's updated via substring + concatenation — operations Perry
  // handles correctly — we bypass rope traversal for all text-read operations.
  private _text: string;
  // Precomputed line start offsets for O(1) getLine/getLineOffset/getOffsetLine.
  // _lineStarts[i] = character offset of the first char of line i.
  // Length = lineCount. Rebuilt on any mutation.
  private _lineStarts: number[];
  private _lineCount: number;

  constructor(initialContent: string = '') {
    // Normalize line endings to \n (avoid regex — Perry may not support it;
    // use charCode scan instead)
    let normalized = '';
    for (let i = 0; i < initialContent.length; i++) {
      const code = initialContent.charCodeAt(i);
      if (code === 13) {
        // CR: emit \n; skip next char if it's \n (CRLF)
        normalized += '\n';
        if (i + 1 < initialContent.length && initialContent.charCodeAt(i + 1) === 10) {
          i++;
        }
      } else {
        normalized += initialContent.charAt(i);
      }
    }
    this._text = normalized;
    this._lineStarts = [];
    this._lineCount = 0;
    this._rebuildLineStarts();
    const pieceTable = new PieceTable(normalized);
    this.rope = new Rope(pieceTable);
    this.lineIndex = new LineIndex();
  }

  /** Rebuild the line start offset index from _text. */
  private _rebuildLineStarts(): void {
    const text = this._text;
    const starts: number[] = [0]; // line 0 always starts at offset 0
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        starts.push(i + 1);
      }
    }
    this._lineStarts = starts;
    this._lineCount = starts.length;
  }

  /**
   * Incrementally update _lineStarts after an insert.
   * Perry-safe: builds a NEW array (no splice/push on class field arrays).
   */
  private _updateLineStartsInsert(offset: number, text: string): void {
    const old = this._lineStarts;
    const insertLen = text.length;

    // Find the line containing offset via binary search
    let lo = 0, hi = old.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (old[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    const lineNum = lo;

    // Build new array: [before] + [new line starts] + [shifted after]
    const result: number[] = [];

    // Copy starts up to and including the line containing offset
    for (let i = 0; i <= lineNum; i++) {
      result.push(old[i]);
    }

    // Add new line starts from inserted text
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        result.push(offset + i + 1);
      }
    }

    // Copy and shift remaining starts
    for (let i = lineNum + 1; i < old.length; i++) {
      result.push(old[i] + insertLen);
    }

    this._lineStarts = result;
    this._lineCount = result.length;
  }

  /**
   * Incrementally update _lineStarts after a delete.
   * Perry-safe: builds a NEW array (no splice on class field arrays).
   */
  private _updateLineStartsDelete(offset: number, length: number): void {
    const old = this._lineStarts;
    const deleteEnd = offset + length;

    // Build new array: keep starts before/at offset, skip starts in deleted range, shift the rest
    const result: number[] = [];

    for (let i = 0; i < old.length; i++) {
      if (old[i] <= offset) {
        // Before or at the deletion point — keep as-is
        result.push(old[i]);
      } else if (old[i] > deleteEnd) {
        // After the deleted range — shift back
        result.push(old[i] - length);
      }
      // Starts within (offset, deleteEnd] are dropped
    }

    this._lineStarts = result;
    this._lineCount = result.length;
  }

  /**
   * Insert text at the given character offset.
   * @returns The actual number of characters inserted.
   */
  insert(offset: number, text: string): number {
    if (text.length === 0) return 0;
    // Update shadow text — fast-path for common end-of-buffer case avoids O(n²).
    const clampedOffset = offset < 0 ? 0 : (offset > this._text.length ? this._text.length : offset);
    if (clampedOffset === this._text.length) {
      this._text = this._text + text;
    } else if (clampedOffset === 0) {
      this._text = text + this._text;
    } else {
      this._text = this._text.substring(0, clampedOffset) + text + this._text.substring(clampedOffset);
    }
    this._updateLineStartsInsert(clampedOffset, text);
    return text.length;
  }

  /**
   * Delete a range of characters from the buffer.
   * @returns The deleted text.
   */
  delete(offset: number, length: number): string {
    if (length <= 0) return '';
    const deletedText = this._text.substring(offset, offset + length);
    this._text = this._text.substring(0, offset) + this._text.substring(offset + length);
    this._updateLineStartsDelete(offset, length);
    return deletedText;
  }

  /** Get the full text content of the buffer. */
  getText(): string {
    return this._text;
  }

  /** Get text within a character offset range [start, end). */
  getTextRange(start: number, end: number): string {
    return this._text.substring(start, end < 0 ? 0 : end);
  }

  /** Get the content of a single line (without line ending). O(1) via offset index. */
  getLine(lineNumber: number): string {
    if (lineNumber < 0 || lineNumber >= this._lineCount) return '';
    const start = this._lineStarts[lineNumber];
    if (lineNumber + 1 < this._lineCount) {
      // Next line start is after the \n, so line end = nextStart - 1
      return this._text.substring(start, this._lineStarts[lineNumber + 1] - 1);
    }
    // Last line — goes to end of text
    return this._text.substring(start);
  }

  /** Total number of lines in the buffer. O(1) via cached count. */
  getLineCount(): number {
    return this._lineCount;
  }

  /** Get the character offset of the start of a line. O(1) via offset index. */
  getLineOffset(lineNumber: number): number {
    if (lineNumber <= 0) return 0;
    if (lineNumber >= this._lineCount) return this._text.length;
    return this._lineStarts[lineNumber];
  }

  /** Get the line number for a given character offset. O(log N) binary search. */
  getOffsetLine(offset: number): number {
    const starts = this._lineStarts;
    const n = this._lineCount;
    if (n <= 1) return 0;
    if (offset >= this._text.length) return n - 1;
    // Binary search for the last line whose start <= offset
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /** Total number of characters in the buffer. */
  getLength(): number {
    return this._text.length;
  }

  /**
   * Apply multiple edits atomically. Edits are applied in offset order
   * (sorted internally). Offsets refer to the buffer state before any
   * edits in this batch.
   */
  applyEdits(edits: TextEdit[]): void {
    if (edits.length === 0) return;

    // Perry AOT: [...edits].sort() uses spread + closure comparator, both broken.
    // Sort in place using a Perry-safe insertion sort (edits are usually small).
    const n = edits.length;
    // Copy to local array first (index assignment is Perry-safe)
    const sorted: TextEdit[] = [];
    for (let _si = 0; _si < n; _si++) { sorted[_si] = edits[_si]; }
    // Insertion sort descending by offset (Perry-safe: no closure comparator)
    for (let _si = 1; _si < n; _si++) {
      const cur = sorted[_si];
      let _sj = _si - 1;
      while (_sj >= 0 && sorted[_sj].offset < cur.offset) {
        sorted[_sj + 1] = sorted[_sj];
        _sj--;
      }
      sorted[_sj + 1] = cur;
    }

    // Perry AOT: for...of on arrays is broken; use index loop
    for (let _ei = 0; _ei < sorted.length; _ei++) {
      const edit = sorted[_ei];
      if (edit.deleteCount > 0) {
        this.delete(edit.offset, edit.deleteCount);
      }
      if (edit.insertText.length > 0) {
        this.insert(edit.offset, edit.insertText);
      }
    }
  }

  /**
   * Create an immutable snapshot of the current buffer state.
   * Captures _text (plain string) — Perry-safe, no rope traversal needed.
   */
  snapshot(): BufferSnapshot {
    const id = ++snapshotIdCounter;
    const capturedText = this._text;
    const capturedLineCount = this.getLineCount();

    return {
      id,
      length: capturedText.length,
      lineCount: capturedLineCount,
      getText(): string {
        return capturedText;
      },
      getLine(lineNumber: number): string {
        let currentLine = 0;
        let lineStart = 0;
        for (let i = 0; i < capturedText.length; i++) {
          if (capturedText.charCodeAt(i) === 10) {
            if (currentLine === lineNumber) {
              return capturedText.substring(lineStart, i);
            }
            currentLine++;
            lineStart = i + 1;
          }
        }
        if (currentLine === lineNumber) {
          return capturedText.substring(lineStart, capturedText.length);
        }
        return '';
      },
    };
  }

  /**
   * Restore the buffer to a previous snapshot state.
   */
  restoreSnapshot(snapshot: BufferSnapshot): void {
    const text = snapshot.getText();
    this._text = text;
    this._rebuildLineStarts();
    const pieceTable = new PieceTable(text);
    this.rope = new Rope(pieceTable);
    this.lineIndex = new LineIndex();
  }

  /**
   * Get the line length (excluding newline character).
   */
  /** Line length excluding newline. O(1) via offset index. */
  getLineLength(lineNumber: number): number {
    if (lineNumber < 0 || lineNumber >= this._lineCount) return 0;
    const start = this._lineStarts[lineNumber];
    if (lineNumber + 1 < this._lineCount) {
      return this._lineStarts[lineNumber + 1] - 1 - start;
    }
    return this._text.length - start;
  }
}
