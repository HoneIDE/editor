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

  constructor(initialContent: string = '') {
    // Normalize line endings to \n
    const normalized = initialContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
    // Normalize line endings
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    this.rope.insert(offset, normalized);
    this.lineIndex.update(offset, '', normalized);
    return normalized.length;
  }

  /**
   * Delete a range of characters from the buffer.
   * @returns The deleted text.
   */
  delete(offset: number, length: number): string {
    if (length <= 0) return '';
    const deletedText = this.rope.getText(offset, offset + length);
    this.rope.delete(offset, length);
    this.lineIndex.update(offset, deletedText, '');
    return deletedText;
  }

  /** Get the full text content of the buffer. */
  getText(): string {
    return this.rope.getFullText();
  }

  /** Get text within a character offset range [start, end). */
  getTextRange(start: number, end: number): string {
    return this.rope.getText(start, end);
  }

  /** Get the content of a single line (without line ending). */
  getLine(lineNumber: number): string {
    if (lineNumber < 0 || lineNumber >= this.getLineCount()) return '';

    const lineStart = this.lineIndex.getLineStart(lineNumber);
    const lineEnd = lineNumber + 1 < this.getLineCount()
      ? this.lineIndex.getLineStart(lineNumber + 1) - 1 // exclude \n
      : this.getLength(); // last line goes to end

    return this.rope.getText(lineStart, lineEnd);
  }

  /** Total number of lines in the buffer. */
  getLineCount(): number {
    return this.lineIndex.lineCount;
  }

  /** Get the character offset of the start of a line. */
  getLineOffset(lineNumber: number): number {
    return this.lineIndex.getLineStart(lineNumber);
  }

  /** Get the line number for a given character offset. */
  getOffsetLine(offset: number): number {
    return this.lineIndex.getLineForOffset(offset);
  }

  /** Total number of characters in the buffer. */
  getLength(): number {
    return this.rope.totalChars;
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
   */
  snapshot(): BufferSnapshot {
    const id = ++snapshotIdCounter;
    const ropeSnap = this.rope.snapshot();
    const lineIndexSnap = this.lineIndex.clone();
    const rope = this.rope;

    return {
      id,
      length: ropeSnap.charCount,
      lineCount: lineIndexSnap.lineCount,
      getText(): string {
        // Reconstruct from snapshot pieces
        const pt = rope.pieceTable;
        const parts: string[] = [];
        for (const piece of ropeSnap.pieces) {
          const buffer = piece.bufferType === 'original' ? pt.originalBuffer : pt.addBuffer;
          parts.push(buffer.substring(piece.start, piece.start + piece.length));
        }
        return parts.join('');
      },
      getLine(lineNumber: number): string {
        const text = this.getText();
        const lines = text.split('\n');
        if (lineNumber < 0 || lineNumber >= lines.length) return '';
        return lines[lineNumber];
      },
    };
  }

  /**
   * Restore the buffer to a previous snapshot state.
   */
  restoreSnapshot(snapshot: BufferSnapshot): void {
    // Get the text from the snapshot and rebuild
    const text = snapshot.getText();
    const pieceTable = new PieceTable(text);
    this.rope = new Rope(pieceTable);
    this.lineIndex = new LineIndex();
    this.lineIndex.rebuild(this.rope);
  }

  /**
   * Get the line length (excluding newline character).
   */
  getLineLength(lineNumber: number): number {
    if (lineNumber < 0 || lineNumber >= this.getLineCount()) return 0;
    const lineStart = this.lineIndex.getLineStart(lineNumber);
    const lineEnd = lineNumber + 1 < this.getLineCount()
      ? this.lineIndex.getLineStart(lineNumber + 1) - 1
      : this.getLength();
    return lineEnd - lineStart;
  }
}
