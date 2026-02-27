/**
 * Find/replace widget state: query, matches, current match index, replace text.
 */

import { TextBuffer } from '../core/buffer/text-buffer';
import { IncrementalSearch } from '../core/search/incremental';
import { replaceNext, replaceAll } from '../core/search/replace';
import type { SearchOptions, SearchMatch } from '../core/search/search-engine';

export interface FindWidgetState {
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  matchCount: number;
  currentMatch: number; // 1-based for display
  replaceText: string;
  replaceVisible: boolean;
  isOpen: boolean;
}

export class FindWidgetController {
  private search: IncrementalSearch;
  private _replaceText: string = '';
  private _replaceVisible: boolean = false;
  private _isOpen: boolean = false;

  constructor() {
    this.search = new IncrementalSearch();
  }

  get state(): FindWidgetState {
    return {
      query: this.search.matchCount > 0 ? this.search.matches[0]?.text.length.toString() : '',
      isRegex: false,
      caseSensitive: true,
      wholeWord: false,
      matchCount: this.search.matchCount,
      currentMatch: this.search.currentIndex + 1,
      replaceText: this._replaceText,
      replaceVisible: this._replaceVisible,
      isOpen: this._isOpen,
    };
  }

  get matchCount(): number {
    return this.search.matchCount;
  }

  get currentMatch(): SearchMatch | null {
    return this.search.currentMatch;
  }

  get matches(): readonly SearchMatch[] {
    return this.search.matches;
  }

  /** Open the find widget. */
  open(buffer: TextBuffer): void {
    this._isOpen = true;
  }

  /** Close the find widget. */
  close(): void {
    this._isOpen = false;
    this.search.clear();
  }

  /** Set the search query. */
  setQuery(buffer: TextBuffer, query: string, options?: Partial<SearchOptions>): void {
    this.search.setQuery(buffer, query, options);
  }

  /** Navigate to next match. */
  nextMatch(): SearchMatch | null {
    return this.search.next();
  }

  /** Navigate to previous match. */
  prevMatch(): SearchMatch | null {
    return this.search.prev();
  }

  /** Go to match nearest to offset. */
  goToNearest(offset: number): SearchMatch | null {
    return this.search.goToNearest(offset);
  }

  /** Set the replace text. */
  setReplaceText(text: string): void {
    this._replaceText = text;
  }

  /** Toggle replace input visibility. */
  toggleReplace(): void {
    this._replaceVisible = !this._replaceVisible;
  }

  /** Replace current match and advance. */
  replaceCurrent(buffer: TextBuffer, query: string, options?: Partial<SearchOptions>): SearchMatch | null {
    const match = this.search.currentMatch;
    if (!match) return null;

    const { nextMatch } = replaceNext(buffer, query, this._replaceText, match, options);
    // Re-search to update matches
    this.search.setQuery(buffer, query, options);
    return nextMatch;
  }

  /** Replace all matches. Returns count. */
  doReplaceAll(buffer: TextBuffer, query: string, options?: Partial<SearchOptions>): number {
    const { count } = replaceAll(buffer, query, this._replaceText, options);
    this.search.setQuery(buffer, query, options);
    return count;
  }

  /** Notify of buffer edit. */
  onBufferEdit(buffer: TextBuffer, editOffset: number, deletedLength: number, insertedLength: number): void {
    this.search.onBufferEdit(buffer, editOffset, deletedLength, insertedLength);
  }
}
