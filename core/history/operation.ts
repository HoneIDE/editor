/**
 * Operation type: array of TextEdits + cursor state before/after.
 */

import { TextEdit } from '../buffer/text-buffer';
import { CursorState } from '../cursor/cursor-manager';

export interface Operation {
  /** Edits applied in this operation. */
  edits: TextEdit[];
  /** The text that was deleted by each edit (needed to compute inverse). */
  deletedTexts: string[];
  /** Cursor state before the operation (for restoring on undo). */
  cursorsBefore: CursorState[];
  /** Cursor state after the operation (for restoring on redo). */
  cursorsAfter: CursorState[];
  /** Timestamp when this operation was created. */
  timestamp: number;
}

/**
 * Compute the inverse edits for an operation (for undo).
 * Each insert becomes a delete, each delete becomes an insert.
 */
export function computeInverseEdits(op: Operation): TextEdit[] {
  const inverseEdits: TextEdit[] = [];

  // We need to compute what the edits look like when applied in reverse order
  // to undo the operation.
  //
  // The original edits were applied in reverse offset order (highest offset first).
  // To undo, we apply the inverse edits in forward offset order (lowest offset first).
  //
  // But we need to account for offset shifts caused by previous edits.

  // First, pair each edit with its deleted text and sort by offset ascending
  const editPairs = op.edits.map((edit, i) => ({
    edit,
    deletedText: op.deletedTexts[i] ?? '',
  }));
  editPairs.sort((a, b) => a.edit.offset - b.edit.offset);

  let offsetDelta = 0;
  for (const { edit, deletedText } of editPairs) {
    const adjustedOffset = edit.offset + offsetDelta;

    inverseEdits.push({
      offset: adjustedOffset,
      deleteCount: edit.insertText.length,
      insertText: deletedText,
    });

    // Track how the offset shifts
    offsetDelta += edit.insertText.length - edit.deleteCount;
  }

  return inverseEdits;
}
