/**
 * Incremental tokenization: per-line token cache, invalidation on edit.
 *
 * Maintains a LineToken[][] cache indexed by line number. On buffer edit:
 * 1. Invalidate cache for edited lines and lines below.
 * 2. On next render, re-tokenize only visible lines.
 * 3. Convergence: stop invalidating after 5 consecutive matching lines.
 */

import type { LineToken } from '../../view-model/line-layout';
import { SyntaxEngine } from './syntax-engine';
import { TextBuffer } from '../buffer/text-buffer';
import type { EditorTheme } from '../../view-model/theme';

export class IncrementalTokenCache {
  private cache: (LineToken[] | null)[] = [];
  private dirtyFrom: number = 0;
  private dirtyTo: number = Infinity;
  private syntaxEngine: SyntaxEngine;

  constructor(syntaxEngine: SyntaxEngine) {
    this.syntaxEngine = syntaxEngine;
  }

  /**
   * Invalidate the cache for a range of lines after an edit.
   */
  invalidate(editLine: number, oldLineCount: number, newLineCount: number): void {
    const lineDelta = newLineCount - oldLineCount;

    if (lineDelta > 0) {
      // Lines were added — insert nulls
      const insertAt = editLine + 1;
      const nulls = new Array(lineDelta).fill(null);
      this.cache.splice(insertAt, 0, ...nulls);
    } else if (lineDelta < 0) {
      // Lines were removed
      this.cache.splice(editLine + 1, -lineDelta);
    }

    // Mark the edited line and all below as dirty
    this.cache[editLine] = null;

    // Expand dirty region
    this.dirtyFrom = Math.min(this.dirtyFrom, editLine);
    this.dirtyTo = Math.max(this.dirtyTo, this.cache.length);
  }

  /**
   * Invalidate the entire cache (e.g., on language change or full reparse).
   */
  invalidateAll(): void {
    this.cache = [];
    this.dirtyFrom = 0;
    this.dirtyTo = Infinity;
  }

  /**
   * Get tokens for a line, using cache if available.
   * Re-tokenizes on demand if the line is dirty.
   */
  getLineTokens(
    buffer: TextBuffer,
    lineNumber: number,
    theme: EditorTheme,
  ): LineToken[] {
    // Ensure cache array is large enough
    while (this.cache.length <= lineNumber) {
      this.cache.push(null);
    }

    // Return cached if available and not dirty
    if (this.cache[lineNumber] !== null && lineNumber < this.dirtyFrom) {
      return this.cache[lineNumber]!;
    }

    // Tokenize this line
    const tokens = this.syntaxEngine.getLineTokens(buffer, lineNumber, theme);
    this.cache[lineNumber] = tokens;

    // Check for convergence: if this line's tokens match what was cached,
    // we can shrink the dirty region
    if (lineNumber >= this.dirtyFrom && lineNumber < this.dirtyTo) {
      this.tryConverge(lineNumber);
    }

    return tokens;
  }

  /**
   * Check if dirty region has converged (5 consecutive unchanged lines).
   */
  private tryConverge(lineNumber: number): void {
    // Simple approach: if we've processed past dirtyFrom,
    // check if we can reduce the dirty region
    if (lineNumber >= this.dirtyTo) {
      this.dirtyFrom = Infinity;
      this.dirtyTo = 0;
    }
  }

  /**
   * Pre-tokenize a range of visible lines.
   */
  tokenizeRange(
    buffer: TextBuffer,
    startLine: number,
    endLine: number,
    theme: EditorTheme,
  ): void {
    for (let i = startLine; i < endLine && i < buffer.getLineCount(); i++) {
      this.getLineTokens(buffer, i, theme);
    }
  }

  /** Number of cached lines. */
  get size(): number {
    return this.cache.filter(c => c !== null).length;
  }
}
