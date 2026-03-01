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
    const pieceTable = new PieceTable(normalized);
    this.rope = new Rope(pieceTable);
    this.lineIndex = new LineIndex();
    this.lineIndex.rebuild(this.rope);
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
    // NOTE: lineIndex.update() intentionally skipped. lineIndex uses splice() on
    // class-field arrays which Perry AOT does not dispatch correctly. All offset
    // queries (getLineOffset, getOffsetLine, getLineLength) now scan _text directly.
    // NOTE: rope.insert() is intentionally skipped. _text is the source of truth
    // for all reads. Snapshots capture _text directly (see snapshot()).
    return text.length;
  }

  /**
   * Delete a range of characters from the buffer.
   * @returns The deleted text.
   */
  delete(offset: number, length: number): string {
    if (length <= 0) return '';
    const deletedText = this._text.substring(offset, offset + length);
    // Update shadow text
    this._text = this._text.substring(0, offset) + this._text.substring(offset + length);
    // NOTE: lineIndex.update() and rope.delete() intentionally skipped. See insert().
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

  /** Get the content of a single line (without line ending). */
  getLine(lineNumber: number): string {
    // Scan _text (Perry-safe plain string) for line boundaries.
    const fullText = this._text;
    let currentLine = 0;
    let lineStart = 0;
    for (let i = 0; i < fullText.length; i++) {
      if (fullText.charCodeAt(i) === 10) {
        if (currentLine === lineNumber) {
          return fullText.substring(lineStart, i);
        }
        currentLine++;
        lineStart = i + 1;
      }
    }
    // Last line (no trailing newline) or the requested line
    if (currentLine === lineNumber) {
      return fullText.substring(lineStart, fullText.length);
    }
    return '';
  }

  /** Total number of lines in the buffer. */
  getLineCount(): number {
    // Scan _text (Perry-safe plain string).
    const fullText = this._text;
    let count = 1;
    for (let i = 0; i < fullText.length; i++) {
      if (fullText.charCodeAt(i) === 10) {
        count++;
      }
    }
    return count;
  }

  /** Get the character offset of the start of a line. */
  getLineOffset(lineNumber: number): number {
    // Scan _text directly — lineIndex.splice() is broken in Perry AOT.
    if (lineNumber <= 0) return 0;
    const fullText = this._text;
    let currentLine = 0;
    for (let i = 0; i < fullText.length; i++) {
      if (fullText.charCodeAt(i) === 10) {
        currentLine++;
        if (currentLine === lineNumber) {
          return i + 1;
        }
      }
    }
    return fullText.length;
  }

  /** Get the line number for a given character offset. */
  getOffsetLine(offset: number): number {
    // Scan _text directly — lineIndex.splice() is broken in Perry AOT.
    const fullText = this._text;
    let count = 0;
    const limit = offset < fullText.length ? offset : fullText.length;
    for (let i = 0; i < limit; i++) {
      if (fullText.charCodeAt(i) === 10) {
        count++;
      }
    }
    return count;
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

    // Sort by offset in REVERSE order so earlier offsets remain valid
    const sorted = [...edits].sort((a, b) => b.offset - a.offset);

    for (const edit of sorted) {
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
    // Get the text from the snapshot and rebuild
    const text = snapshot.getText();
    this._text = text;
    const pieceTable = new PieceTable(text);
    this.rope = new Rope(pieceTable);
    this.lineIndex = new LineIndex();
    this.lineIndex.rebuild(this.rope);
  }

  /**
   * Get the line length (excluding newline character).
   */
  getLineLength(lineNumber: number): number {
    // Use getLine() which already scans _text directly (Perry-safe).
    return this.getLine(lineNumber).length;
  }
}
