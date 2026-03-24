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
   * Keeps matches before the edit, re-searches only the affected region,
   * and shifts matches after the edit by the delta.
   */
  onBufferEdit(buffer: TextBuffer, editOffset: number, deletedLength: number, insertedLength: number): void {
    if (this._query.length === 0) return;

    // For regex searches, fall back to full re-search (regex state is complex)
    if (this._options.isRegex) {
      this.fullSearch(buffer);
      return;
    }

    const delta = insertedLength - deletedLength;
    const deleteEnd = editOffset + deletedLength;
    const queryLen = this._query.length;

    // 1. Keep matches fully before the edit
    const before: SearchMatch[] = [];
    for (let i = 0; i < this._matches.length; i++) {
      const m = this._matches[i];
      if (m.offset + m.length <= editOffset) {
        before.push(m);
      } else {
        break; // sorted by offset
      }
    }

    // 2. Shift matches fully after the deleted range
    const after: SearchMatch[] = [];
    for (let i = this._matches.length - 1; i >= 0; i--) {
      const m = this._matches[i];
      if (m.offset >= deleteEnd) {
        const newOffset = m.offset + delta;
        const newLine = buffer.getOffsetLine(newOffset);
        const newCol = newOffset - buffer.getLineOffset(newLine);
        after.push({
          offset: newOffset,
          length: m.length,
          line: newLine,
          column: newCol,
          text: m.text,
          captures: m.captures,
        });
      } else {
        break;
      }
    }
    // Reverse since we collected in reverse order
    after.reverse();

    // 3. Re-search the affected region
    const regionStart = Math.max(0, editOffset - queryLen + 1);
    const regionEnd = Math.min(buffer.getLength(), editOffset + insertedLength + queryLen - 1);
    const regionText = buffer.getTextRange(regionStart, regionEnd);
    const opts = this._options;
    const sText = opts.caseSensitive ? regionText : regionText.toLowerCase();
    const sQuery = opts.caseSensitive ? this._query : this._query.toLowerCase();

    const regionMatches: SearchMatch[] = [];
    let pos = 0;
    while (pos < sText.length) {
      const idx = sText.indexOf(sQuery, pos);
      if (idx === -1) break;
      const globalOffset = regionStart + idx;
      // Whole word check on the full buffer text
      if (opts.wholeWord) {
        const fullText = buffer.getText();
        if (!isWholeWordAt(fullText, globalOffset, queryLen)) {
          pos = idx + 1;
          continue;
        }
      }
      const matchText = buffer.getTextRange(globalOffset, globalOffset + queryLen);
      const line = buffer.getOffsetLine(globalOffset);
      const col = globalOffset - buffer.getLineOffset(line);
      regionMatches.push({
        offset: globalOffset,
        length: queryLen,
        line: line,
        column: col,
        text: matchText,
      });
      pos = idx + queryLen;
    }

    // 4. Merge: before + regionMatches + after
    this._matches = [];
    for (let i = 0; i < before.length; i++) {
      this._matches.push(before[i]);
    }
    for (let i = 0; i < regionMatches.length; i++) {
      this._matches.push(regionMatches[i]);
    }
    for (let i = 0; i < after.length; i++) {
      this._matches.push(after[i]);
    }

    // Clamp current index
    if (this._matches.length === 0) {
      this._currentIndex = -1;
    } else if (this._currentIndex >= this._matches.length) {
      this._currentIndex = this._matches.length - 1;
    } else if (this._currentIndex < 0) {
      this._currentIndex = 0;
    }
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

function isWordChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) ||
         (ch >= 48 && ch <= 57) || ch === 95;
}

function isWholeWordAt(text: string, offset: number, length: number): boolean {
  if (offset > 0 && isWordChar(text.charCodeAt(offset - 1))) return false;
  const end = offset + length;
  if (end < text.length && isWordChar(text.charCodeAt(end))) return false;
  return true;
}
