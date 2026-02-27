/**
 * Virtual scrolling: compute visible line range, buffer zone above/below.
 *
 * Only lines within the viewport (plus a buffer zone) are rendered,
 * enabling smooth performance with very large files.
 */

import { LineHeightCache } from './line-height';
import { ScrollController } from './scroll';

const BUFFER_ZONE_LINES = 10;

export interface VisibleRange {
  /** First line to render (inclusive). */
  startLine: number;
  /** Last line to render (exclusive). */
  endLine: number;
}

export class ViewportManager {
  private _widthPx: number = 800;
  private _heightPx: number = 600;
  private totalLines: number = 1;
  readonly lineHeightCache: LineHeightCache;
  readonly scroll: ScrollController;

  /** Lines hidden due to folding. Map from line number -> true if hidden. */
  private hiddenLines: Set<number> = new Set();

  constructor() {
    this.lineHeightCache = new LineHeightCache();
    this.scroll = new ScrollController(this.lineHeightCache);
  }

  /** Update the viewport dimensions (call on resize). */
  update(widthPx: number, heightPx: number): void {
    this._widthPx = widthPx;
    this._heightPx = heightPx;
    this.scroll.setViewport(widthPx, heightPx);
  }

  /** Set the total number of lines in the document. */
  setTotalLines(count: number): void {
    this.totalLines = count;
    this.lineHeightCache.setTotalLines(count);
  }

  /** Mark lines as hidden (due to folding). */
  setHiddenLines(hidden: Set<number>): void {
    this.hiddenLines = hidden;
  }

  get widthPx(): number { return this._widthPx; }
  get heightPx(): number { return this._heightPx; }

  /**
   * Get the range of lines that should be rendered (including buffer zone).
   */
  getVisibleRange(): VisibleRange {
    const scrollTop = this.scroll.scrollTop;
    const baseHeight = this.lineHeightCache.baseLineHeight;

    // Approximate start line
    let startLine = this.lineHeightCache.getLineAtY(scrollTop);
    // Approximate end line
    let endLine = this.lineHeightCache.getLineAtY(scrollTop + this._heightPx) + 1;

    // Add buffer zones
    startLine = Math.max(0, startLine - BUFFER_ZONE_LINES);
    endLine = Math.min(this.totalLines, endLine + BUFFER_ZONE_LINES);

    return { startLine, endLine };
  }

  /**
   * Get visible lines, accounting for folded/hidden lines.
   * Returns document line numbers that should be rendered.
   */
  getVisibleLineNumbers(): number[] {
    const range = this.getVisibleRange();
    const lines: number[] = [];
    for (let i = range.startLine; i < range.endLine; i++) {
      if (!this.hiddenLines.has(i)) {
        lines.push(i);
      }
    }
    return lines;
  }

  /**
   * Scroll to reveal a specific line.
   */
  revealLine(lineNumber: number, position: 'top' | 'center' | 'bottom'): void {
    this.scroll.revealLine(lineNumber, position);
  }

  /**
   * Ensure a line is visible with minimal scrolling.
   */
  ensureLineVisible(lineNumber: number): void {
    this.scroll.ensureLineVisible(lineNumber);
  }

  /**
   * Get how many lines fit in the viewport (for page up/down).
   */
  getLinesPerPage(): number {
    return Math.max(1, Math.floor(this._heightPx / this.lineHeightCache.baseLineHeight) - 1);
  }
}
