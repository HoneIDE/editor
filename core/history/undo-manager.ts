/**
 * Undo/redo stack management with time-based coalescing.
 *
 * Push behavior:
 * 1. New edit creates an Operation from the edit(s).
 * 2. Coalescing: if the previous operation was within 500ms AND the new
 *    operation is a simple character insert/delete, merge into previous.
 * 3. Clear redo stack on new edit.
 * 4. Drop oldest operation if stack exceeds maxDepth.
 */

import { TextBuffer, TextEdit } from '../buffer/text-buffer';
import { CursorState } from '../cursor/cursor-manager';
import { Operation, computeInverseEdits } from './operation';

const COALESCE_TIMEOUT_MS = 500;

export class UndoManager {
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private maxDepth: number = 10000;
  private buffer: TextBuffer;

  constructor(buffer: TextBuffer) {
    this.buffer = buffer;
  }

  /**
   * Record an edit operation for undo.
   *
   * @param edits - The edits that were applied.
   * @param deletedTexts - The text that was deleted by each edit.
   * @param cursorsBefore - Cursor state before the edit.
   * @param cursorsAfter - Cursor state after the edit.
   * @param forceNewGroup - If true, don't coalesce with previous operation.
   */
  push(
    edits: TextEdit[],
    deletedTexts: string[],
    cursorsBefore: CursorState[],
    cursorsAfter: CursorState[],
    forceNewGroup: boolean = false,
  ): void {
    const now = Date.now();
    const op: Operation = {
      edits: edits.map(e => ({ ...e })),
      deletedTexts: [...deletedTexts],
      cursorsBefore: cursorsBefore.map(c => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null })),
      cursorsAfter: cursorsAfter.map(c => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null })),
      timestamp: now,
    };

    // Clear redo stack
    this.redoStack = [];

    // Try coalescing
    if (!forceNewGroup && this.undoStack.length > 0) {
      const prev = this.undoStack[this.undoStack.length - 1];
      if (this.canCoalesce(prev, op)) {
        // Merge into previous
        prev.edits.push(...op.edits);
        prev.deletedTexts.push(...op.deletedTexts);
        prev.cursorsAfter = op.cursorsAfter;
        prev.timestamp = now;
        return;
      }
    }

    this.undoStack.push(op);

    // Enforce max depth
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo the last operation.
   * @returns The cursor state to restore, or null if nothing to undo.
   */
  undo(): CursorState[] | null {
    const op = this.undoStack.pop();
    if (!op) return null;

    // Compute and apply inverse edits
    const inverseEdits = computeInverseEdits(op);
    this.buffer.applyEdits(inverseEdits);

    // Push redo operation
    this.redoStack.push(op);

    return op.cursorsBefore;
  }

  /**
   * Redo the last undone operation.
   * @returns The cursor state to restore, or null if nothing to redo.
   */
  redo(): CursorState[] | null {
    const op = this.redoStack.pop();
    if (!op) return null;

    // Re-apply the original edits
    this.buffer.applyEdits(op.edits);

    // Push back onto undo stack
    this.undoStack.push(op);

    return op.cursorsAfter;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Clear all history. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Determine if two operations should be coalesced.
   * Coalesce if:
   * - Within COALESCE_TIMEOUT_MS
   * - Both are single-character inserts or single-character deletes
   * - Not a paste or multi-cursor operation
   */
  private canCoalesce(prev: Operation, next: Operation): boolean {
    // Time check
    if (next.timestamp - prev.timestamp > COALESCE_TIMEOUT_MS) return false;

    // Only coalesce single edits (not paste/multi-cursor)
    if (next.edits.length !== 1) return false;

    const edit = next.edits[0];

    // Only coalesce single-character inserts or deletes
    const isSingleInsert = edit.deleteCount === 0 && edit.insertText.length === 1;
    const isSingleDelete = edit.deleteCount === 1 && edit.insertText.length === 0;

    if (!isSingleInsert && !isSingleDelete) return false;

    // Don't coalesce if inserting a newline (should be a separate undo step)
    if (edit.insertText === '\n') return false;

    // Check that previous operation is also simple edits
    const prevLastEdit = prev.edits[prev.edits.length - 1];
    if (!prevLastEdit) return false;

    const prevIsSingleInsert = prevLastEdit.deleteCount === 0 && prevLastEdit.insertText.length === 1;
    const prevIsSingleDelete = prevLastEdit.deleteCount === 1 && prevLastEdit.insertText.length === 0;

    // Only coalesce same type of operations (inserts with inserts, deletes with deletes)
    if (isSingleInsert && !prevIsSingleInsert) return false;
    if (isSingleDelete && !prevIsSingleDelete) return false;

    return true;
  }
}
