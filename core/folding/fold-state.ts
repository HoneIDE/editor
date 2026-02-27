/**
 * FoldState: map of lineNumber -> collapsed/expanded, fold/unfold methods.
 *
 * When a fold is collapsed, the viewport skips hidden lines.
 */

import type { FoldRange } from '../tokenizer/syntax-engine';

export class FoldState {
  /** Map from start line number to fold range. */
  private foldedRanges: Map<number, FoldRange> = new Map();
  /** All available fold ranges (from fold provider). */
  private availableRanges: FoldRange[] = [];

  /**
   * Update available fold ranges (called after parse or indent analysis).
   */
  setAvailableRanges(ranges: FoldRange[]): void {
    this.availableRanges = ranges;
    // Remove folded ranges that no longer exist
    for (const [startLine] of this.foldedRanges) {
      if (!ranges.some(r => r.startLine === startLine)) {
        this.foldedRanges.delete(startLine);
      }
    }
  }

  /** Fold (collapse) the range starting at the given line. */
  fold(lineNumber: number): void {
    const range = this.availableRanges.find(r => r.startLine === lineNumber);
    if (range) {
      this.foldedRanges.set(lineNumber, range);
    }
  }

  /** Unfold (expand) the range starting at the given line. */
  unfold(lineNumber: number): void {
    this.foldedRanges.delete(lineNumber);
  }

  /** Toggle fold state at the given line. */
  toggle(lineNumber: number): void {
    if (this.foldedRanges.has(lineNumber)) {
      this.unfold(lineNumber);
    } else {
      this.fold(lineNumber);
    }
  }

  /** Fold all available ranges. */
  foldAll(): void {
    for (const range of this.availableRanges) {
      this.foldedRanges.set(range.startLine, range);
    }
  }

  /** Unfold all ranges. */
  unfoldAll(): void {
    this.foldedRanges.clear();
  }

  /** Check if a line is hidden because it is inside a folded range. */
  isLineHidden(lineNumber: number): boolean {
    for (const range of this.foldedRanges.values()) {
      if (lineNumber > range.startLine && lineNumber <= range.endLine) {
        return true;
      }
    }
    return false;
  }

  /** Get the fold state for a specific line. */
  getFoldState(lineNumber: number): 'expanded' | 'collapsed' | 'none' {
    if (this.foldedRanges.has(lineNumber)) return 'collapsed';
    if (this.availableRanges.some(r => r.startLine === lineNumber)) return 'expanded';
    return 'none';
  }

  /** Get all hidden line numbers (for viewport). */
  getHiddenLines(): Set<number> {
    const hidden = new Set<number>();
    for (const range of this.foldedRanges.values()) {
      for (let i = range.startLine + 1; i <= range.endLine; i++) {
        hidden.add(i);
      }
    }
    return hidden;
  }

  /** Adjust fold ranges after a buffer edit (lines inserted/deleted). */
  onBufferEdit(editLine: number, linesDelta: number): void {
    if (linesDelta === 0) return;

    const newFolded = new Map<number, FoldRange>();

    for (const [startLine, range] of this.foldedRanges) {
      if (startLine > editLine) {
        // Range is after the edit — shift
        const newStart = startLine + linesDelta;
        const newEnd = range.endLine + linesDelta;
        if (newStart >= 0 && newEnd > newStart) {
          newFolded.set(newStart, { startLine: newStart, endLine: newEnd });
        }
      } else if (range.endLine >= editLine) {
        // Edit is within the range — adjust end line
        const newEnd = range.endLine + linesDelta;
        if (newEnd > startLine) {
          newFolded.set(startLine, { startLine, endLine: newEnd });
        }
        // If the range would collapse to nothing, just drop it
      } else {
        // Range is before the edit — keep as-is
        newFolded.set(startLine, range);
      }
    }

    this.foldedRanges = newFolded;
  }

  /** Get all folded ranges. */
  get foldedCount(): number {
    return this.foldedRanges.size;
  }

  /** Get available ranges. */
  get availableCount(): number {
    return this.availableRanges.length;
  }
}
