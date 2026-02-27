/**
 * Selection range representation, normalization, merging overlapping selections.
 *
 * A selection is defined by an anchor and a cursor position.
 * The "start" is min(anchor, cursor), "end" is max(anchor, cursor).
 */

export interface Position {
  line: number;
  column: number;
}

export interface SelectionRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * Compare two positions. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

/**
 * Normalize a selection so start <= end.
 */
export function normalizeSelection(
  anchor: Position,
  cursor: Position,
): SelectionRange {
  const cmp = comparePositions(anchor, cursor);
  if (cmp <= 0) {
    return {
      startLine: anchor.line,
      startColumn: anchor.column,
      endLine: cursor.line,
      endColumn: cursor.column,
    };
  }
  return {
    startLine: cursor.line,
    startColumn: cursor.column,
    endLine: anchor.line,
    endColumn: anchor.column,
  };
}

/**
 * Check if two selections overlap or are adjacent.
 */
export function selectionsOverlap(a: SelectionRange, b: SelectionRange): boolean {
  // a ends before b starts
  if (a.endLine < b.startLine) return false;
  if (a.endLine === b.startLine && a.endColumn < b.startColumn) return false;
  // b ends before a starts
  if (b.endLine < a.startLine) return false;
  if (b.endLine === a.startLine && b.endColumn < a.startColumn) return false;
  return true;
}

/**
 * Merge two overlapping/adjacent selections into one.
 */
export function mergeSelections(a: SelectionRange, b: SelectionRange): SelectionRange {
  const startCmp = comparePositions(
    { line: a.startLine, column: a.startColumn },
    { line: b.startLine, column: b.startColumn },
  );
  const endCmp = comparePositions(
    { line: a.endLine, column: a.endColumn },
    { line: b.endLine, column: b.endColumn },
  );

  return {
    startLine: startCmp <= 0 ? a.startLine : b.startLine,
    startColumn: startCmp <= 0 ? a.startColumn : b.startColumn,
    endLine: endCmp >= 0 ? a.endLine : b.endLine,
    endColumn: endCmp >= 0 ? a.endColumn : b.endColumn,
  };
}

/**
 * Check if a selection is empty (zero-width).
 */
export function isSelectionEmpty(sel: SelectionRange): boolean {
  return sel.startLine === sel.endLine && sel.startColumn === sel.endColumn;
}
