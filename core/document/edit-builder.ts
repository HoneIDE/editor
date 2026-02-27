/**
 * Transaction builder for atomic multi-edit operations.
 *
 * Collects edits during a callback, then applies them atomically
 * via buffer.applyEdits(). Before applying, the undo manager is
 * notified to capture the pre-edit state.
 */

import { TextEdit } from '../buffer/text-buffer';

export class EditBuilder {
  private _edits: TextEdit[] = [];
  private _committed = false;

  /** Insert text at a position. */
  insert(offset: number, text: string): void {
    if (this._committed) throw new Error('EditBuilder already committed');
    this._edits.push({ offset, deleteCount: 0, insertText: text });
  }

  /** Delete text in a range. */
  delete(offset: number, length: number): void {
    if (this._committed) throw new Error('EditBuilder already committed');
    this._edits.push({ offset, deleteCount: length, insertText: '' });
  }

  /** Replace text in a range. */
  replace(offset: number, length: number, newText: string): void {
    if (this._committed) throw new Error('EditBuilder already committed');
    this._edits.push({ offset, deleteCount: length, insertText: newText });
  }

  /** Get the collected edits. Marks the builder as committed. */
  commit(): TextEdit[] {
    this._committed = true;
    return this._edits;
  }

  /** Whether this builder has any edits. */
  get hasEdits(): boolean {
    return this._edits.length > 0;
  }
}
