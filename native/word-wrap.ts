/**
 * Word wrap computation for the editor.
 *
 * Computes visual line breaks for lines that exceed the viewport width.
 * Used by both the viewport manager (to compute correct line heights)
 * and the render coordinator (to render wrapped lines).
 */

import type { NativeEditorFFI, NativeViewHandle } from './ffi-bridge';
import type { TextBuffer } from '../core/buffer/text-buffer';

export interface WrapPoint {
  /** Column offset in the original line where this visual line starts. */
  column: number;
  /** Indent level (in pixels) for wrapped continuation lines. */
  indent: number;
}

export interface WrappedLine {
  /** Document line number (0-based). */
  lineNumber: number;
  /** Visual line segments (first segment starts at column 0). */
  segments: WrapPoint[];
}

export type WrapMode = 'none' | 'word' | 'bounded';

export interface WrapConfig {
  /** Wrap mode. */
  mode: WrapMode;
  /** Maximum column width for 'bounded' mode. 0 = use viewport width. */
  wrapColumn: number;
  /** Indent wrapped lines by this many characters (visual only). */
  wrappedLineIndent: number;
}

const DEFAULT_WRAP_CONFIG: WrapConfig = {
  mode: 'none',
  wrapColumn: 0,
  wrappedLineIndent: 0,
};

/**
 * Computes word wrap breaks for a single line.
 */
export function computeWrapPoints(
  text: string,
  maxWidth: number,
  measureFn: (text: string) => number,
  mode: WrapMode,
  wrappedIndent: number = 0,
): WrapPoint[] {
  if (mode === 'none' || text.length === 0) {
    return [{ column: 0, indent: 0 }];
  }

  const totalWidth = measureFn(text);
  if (totalWidth <= maxWidth) {
    return [{ column: 0, indent: 0 }];
  }

  const points: WrapPoint[] = [{ column: 0, indent: 0 }];
  let currentStart = 0;
  const indentPx = wrappedIndent > 0 ? measureFn(' '.repeat(wrappedIndent)) : 0;

  while (currentStart < text.length) {
    const effectiveMaxWidth = points.length === 1 ? maxWidth : maxWidth - indentPx;
    if (effectiveMaxWidth <= 0) break;

    const remaining = text.substring(currentStart);
    const remainingWidth = measureFn(remaining);

    if (remainingWidth <= effectiveMaxWidth) break;

    // Binary search for the break point
    let breakCol = findBreakColumn(remaining, effectiveMaxWidth, measureFn);

    if (mode === 'word' && breakCol > 0) {
      // Try to break at a word boundary
      const wordBreak = findWordBreak(remaining, breakCol);
      if (wordBreak > 0) {
        breakCol = wordBreak;
      }
    }

    if (breakCol <= 0) breakCol = 1; // At least one character per visual line

    currentStart += breakCol;
    if (currentStart < text.length) {
      points.push({ column: currentStart, indent: indentPx });
    }
  }

  return points;
}

/**
 * Find the column where text exceeds maxWidth using binary search.
 */
function findBreakColumn(
  text: string,
  maxWidth: number,
  measureFn: (text: string) => number,
): number {
  let lo = 1;
  let hi = text.length;
  let result = 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const width = measureFn(text.substring(0, mid));

    if (width <= maxWidth) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

/**
 * Find the best word break position before or at column.
 */
function findWordBreak(text: string, column: number): number {
  // Search backward for a break opportunity
  for (let i = column; i > 0; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '-' || ch === '/' || ch === '\\') {
      return i + 1; // break after the separator
    }
    // CJK characters are always breakable
    const code = text.charCodeAt(i);
    if (isCJK(code)) {
      return i;
    }
  }
  return 0; // no good break point found
}

/**
 * Check if a character code is a CJK ideograph (always breakable).
 */
function isCJK(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
    (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols and Punctuation
    (code >= 0xFF00 && code <= 0xFFEF) ||   // Fullwidth Forms
    (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
    (code >= 0x30A0 && code <= 0x30FF) ||   // Katakana
    (code >= 0xAC00 && code <= 0xD7AF)      // Hangul Syllables
  );
}

/**
 * WrapCache: caches wrap points for document lines.
 * Invalidated on edit or viewport width change.
 */
export class WrapCache {
  private _cache: Map<number, WrapPoint[]> = new Map();
  private _config: WrapConfig;
  private _maxWidth: number = 0;
  private _measureFn: ((text: string) => number) | null = null;

  constructor(config?: Partial<WrapConfig>) {
    this._config = { ...DEFAULT_WRAP_CONFIG, ...config };
  }

  get config(): WrapConfig {
    return this._config;
  }

  setConfig(config: Partial<WrapConfig>): void {
    this._config = { ...this._config, ...config };
    this._cache.clear();
  }

  setMaxWidth(width: number): void {
    if (width !== this._maxWidth) {
      this._maxWidth = width;
      this._cache.clear();
    }
  }

  setMeasureFn(fn: (text: string) => number): void {
    this._measureFn = fn;
    this._cache.clear();
  }

  /**
   * Get wrap points for a line (cached).
   */
  getWrapPoints(buffer: TextBuffer, lineNumber: number): WrapPoint[] {
    const cached = this._cache.get(lineNumber);
    if (cached) return cached;

    const text = buffer.getLine(lineNumber);
    const measureFn = this._measureFn ?? ((t: string) => t.length * 8);
    const maxWidth = this._config.wrapColumn > 0
      ? this._config.wrapColumn * measureFn('M')
      : this._maxWidth;

    const points = computeWrapPoints(
      text,
      maxWidth,
      measureFn,
      this._config.mode,
      this._config.wrappedLineIndent,
    );

    this._cache.set(lineNumber, points);
    return points;
  }

  /**
   * Get the number of visual lines for a document line.
   */
  getVisualLineCount(buffer: TextBuffer, lineNumber: number): number {
    return this.getWrapPoints(buffer, lineNumber).length;
  }

  /**
   * Invalidate cached wrap data for specific lines.
   */
  invalidateLines(startLine: number, endLine: number): void {
    for (let i = startLine; i <= endLine; i++) {
      this._cache.delete(i);
    }
  }

  /**
   * Invalidate all cached wrap data.
   */
  invalidateAll(): void {
    this._cache.clear();
  }
}
