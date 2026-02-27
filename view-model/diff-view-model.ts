/**
 * Diff view: side-by-side or inline, hunk navigation, accept/reject UI state.
 */

import { DiffResult, DiffHunk } from '../core/diff/diff-model';
import { computeDiff } from '../core/diff/diff-compute';
import { navigateHunks } from '../core/diff/hunk';

export type DiffViewMode = 'side-by-side' | 'inline';

export class DiffViewModel {
  private _diff: DiffResult | null = null;
  private _mode: DiffViewMode = 'inline';
  private _currentHunkIndex: number = -1;

  get diff(): DiffResult | null {
    return this._diff;
  }

  get mode(): DiffViewMode {
    return this._mode;
  }

  get currentHunkIndex(): number {
    return this._currentHunkIndex;
  }

  get currentHunk(): DiffHunk | null {
    if (!this._diff || this._currentHunkIndex < 0) return null;
    return this._diff.hunks[this._currentHunkIndex] ?? null;
  }

  setMode(mode: DiffViewMode): void {
    this._mode = mode;
  }

  /** Compute diff between original and modified text. */
  computeDiff(originalText: string, modifiedText: string): void {
    this._diff = computeDiff(originalText, modifiedText);
    this._currentHunkIndex = this._diff.hunks.length > 0 ? 0 : -1;
  }

  /** Navigate to the next hunk. */
  nextHunk(): DiffHunk | null {
    if (!this._diff || this._diff.hunks.length === 0) return null;
    this._currentHunkIndex = (this._currentHunkIndex + 1) % this._diff.hunks.length;
    return this.currentHunk;
  }

  /** Navigate to the previous hunk. */
  prevHunk(): DiffHunk | null {
    if (!this._diff || this._diff.hunks.length === 0) return null;
    this._currentHunkIndex = (this._currentHunkIndex - 1 + this._diff.hunks.length) % this._diff.hunks.length;
    return this.currentHunk;
  }

  /** Accept a specific hunk. */
  acceptHunk(index: number): void {
    if (this._diff && index >= 0 && index < this._diff.hunks.length) {
      this._diff.hunks[index].state = 'accepted';
    }
  }

  /** Reject a specific hunk. */
  rejectHunk(index: number): void {
    if (this._diff && index >= 0 && index < this._diff.hunks.length) {
      this._diff.hunks[index].state = 'rejected';
    }
  }

  /** Accept all hunks. */
  acceptAll(): void {
    if (this._diff) {
      for (const hunk of this._diff.hunks) {
        hunk.state = 'accepted';
      }
    }
  }

  /** Reject all hunks. */
  rejectAll(): void {
    if (this._diff) {
      for (const hunk of this._diff.hunks) {
        hunk.state = 'rejected';
      }
    }
  }

  /** Get pending hunks. */
  getPendingHunks(): DiffHunk[] {
    if (!this._diff) return [];
    return this._diff.hunks.filter(h => h.state === 'pending');
  }

  /** Clear the diff. */
  clear(): void {
    this._diff = null;
    this._currentHunkIndex = -1;
  }
}
