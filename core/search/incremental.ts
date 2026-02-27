/**
 * Incremental search: updates matches on buffer changes and query changes.
 *
 * Maintains cached match positions. On buffer edit:
 * 1. Invalidate matches in the edited region.
 * 2. Re-search only the affected lines.
 * 3. Adjust match offsets after the edit point by the edit delta.
 */

import { TextBuffer } from '../buffer/text-buffer';
import { SearchMatch, searchAll, SearchOptions } from './search-engine';

export class IncrementalSearch {
  private _matches: SearchMatch[] = [];
  private _query: string = '';
  private _options: SearchOptions = {
    isRegex: false,
    caseSensitive: true,
    wholeWord: false,
  };
  private _currentIndex: number = -1;

  get matches(): readonly SearchMatch[] {
    return this._matches;
  }

  get matchCount(): number {
    return this._matches.length;
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get currentMatch(): SearchMatch | null {
    if (this._currentIndex < 0 || this._currentIndex >= this._matches.length) {
      return null;
    }
    return this._matches[this._currentIndex];
  }

  /**
   * Set the search query and perform a full search.
   */
  setQuery(buffer: TextBuffer, query: string, options?: Partial<SearchOptions>): void {
    this._query = query;
    if (options) {
      this._options = { ...this._options, ...options };
    }
    this.fullSearch(buffer);
  }

  /**
   * Update search options.
   */
  setOptions(buffer: TextBuffer, options: Partial<SearchOptions>): void {
    this._options = { ...this._options, ...options };
    this.fullSearch(buffer);
  }

  /**
   * Navigate to the next match.
   */
  next(): SearchMatch | null {
    if (this._matches.length === 0) return null;
    this._currentIndex = (this._currentIndex + 1) % this._matches.length;
    return this.currentMatch;
  }

  /**
   * Navigate to the previous match.
   */
  prev(): SearchMatch | null {
    if (this._matches.length === 0) return null;
    this._currentIndex = (this._currentIndex - 1 + this._matches.length) % this._matches.length;
    return this.currentMatch;
  }

  /**
   * Navigate to the match nearest to a given offset.
   */
  goToNearest(offset: number): SearchMatch | null {
    if (this._matches.length === 0) return null;

    // Find the first match at or after the offset
    for (let i = 0; i < this._matches.length; i++) {
      if (this._matches[i].offset >= offset) {
        this._currentIndex = i;
        return this.currentMatch;
      }
    }

    // Wrap around to first match
    this._currentIndex = 0;
    return this.currentMatch;
  }

  /**
   * Called after a buffer edit to update matches incrementally.
   */
  onBufferEdit(buffer: TextBuffer, editOffset: number, deletedLength: number, insertedLength: number): void {
    if (this._query.length === 0) return;

    // For simplicity and correctness, do a full re-search.
    // An optimized version would only re-search the affected region
    // and adjust offsets for matches after the edit.
    this.fullSearch(buffer);
  }

  /**
   * Clear the search.
   */
  clear(): void {
    this._query = '';
    this._matches = [];
    this._currentIndex = -1;
  }

  private fullSearch(buffer: TextBuffer): void {
    if (this._query.length === 0) {
      this._matches = [];
      this._currentIndex = -1;
      return;
    }

    this._matches = searchAll(buffer, this._query, this._options);

    // Preserve current position if possible
    if (this._matches.length === 0) {
      this._currentIndex = -1;
    } else if (this._currentIndex >= this._matches.length) {
      this._currentIndex = 0;
    } else if (this._currentIndex < 0) {
      this._currentIndex = 0;
    }
  }
}
