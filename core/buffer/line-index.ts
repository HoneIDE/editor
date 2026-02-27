/**
 * Line-start-offset index, maintained incrementally on edits.
 *
 * Maps line numbers to character offsets. Stored as an array for documents
 * under 100K lines. The index is rebuilt from the rope on demand or updated
 * incrementally by the TextBuffer after edits.
 */

import { Rope } from './rope';

export class LineIndex {
  /**
   * Line start offsets. lineStarts[i] = character offset of the start of line i.
   * lineStarts[0] is always 0.
   */
  private lineStarts: number[];

  constructor() {
    this.lineStarts = [0];
  }

  /** Total number of lines. */
  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Get the character offset of the start of a line. */
  getLineStart(lineNumber: number): number {
    if (lineNumber < 0) return 0;
    if (lineNumber >= this.lineStarts.length) {
      return this.lineStarts[this.lineStarts.length - 1];
    }
    return this.lineStarts[lineNumber];
  }

  /** Get the line number for a given character offset. */
  getLineForOffset(offset: number): number {
    if (offset <= 0) return 0;

    // Binary search for the line containing this offset
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /**
   * Rebuild the entire line index from scratch by scanning the rope.
   */
  rebuild(rope: Rope): void {
    this.lineStarts = [0];
    const text = rope.getFullText();
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /**
   * Update the line index after an edit.
   *
   * @param editOffset - Character offset where the edit occurred.
   * @param deletedLength - Number of characters deleted.
   * @param deletedText - The text that was deleted (to count line breaks).
   * @param insertedLength - Number of characters inserted.
   * @param insertedText - The text that was inserted (to count line breaks).
   */
  update(
    editOffset: number,
    deletedText: string,
    insertedText: string,
  ): void {
    const deletedLength = deletedText.length;
    const insertedLength = insertedText.length;
    const delta = insertedLength - deletedLength;

    // Find the line where the edit starts
    const editLine = this.getLineForOffset(editOffset);

    // Count line breaks in deleted and inserted text
    let deletedBreaks = 0;
    for (let i = 0; i < deletedText.length; i++) {
      if (deletedText.charCodeAt(i) === 10) deletedBreaks++;
    }

    let insertedBreaks = 0;
    const insertedBreakPositions: number[] = [];
    for (let i = 0; i < insertedText.length; i++) {
      if (insertedText.charCodeAt(i) === 10) {
        insertedBreaks++;
        insertedBreakPositions.push(editOffset + i + 1); // offset of char after newline
      }
    }

    if (deletedBreaks === 0 && insertedBreaks === 0) {
      // No line structure change, just shift offsets after the edit
      if (delta !== 0) {
        for (let i = editLine + 1; i < this.lineStarts.length; i++) {
          this.lineStarts[i] += delta;
        }
      }
      return;
    }

    // Remove the line entries for deleted line breaks
    if (deletedBreaks > 0) {
      this.lineStarts.splice(editLine + 1, deletedBreaks);
    }

    // Insert new line entries for inserted line breaks
    if (insertedBreaks > 0) {
      this.lineStarts.splice(editLine + 1, 0, ...insertedBreakPositions);
    }

    // Shift all subsequent line starts by the delta
    const shiftStart = editLine + 1 + insertedBreaks;
    if (delta !== 0) {
      for (let i = shiftStart; i < this.lineStarts.length; i++) {
        this.lineStarts[i] += delta;
      }
    }
  }

  /** Clone the line index. */
  clone(): LineIndex {
    const li = new LineIndex();
    li.lineStarts = [...this.lineStarts];
    return li;
  }

  /** Get all line starts (for debugging/testing). */
  getLineStarts(): readonly number[] {
    return this.lineStarts;
  }
}
