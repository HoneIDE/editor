/**
 * Scroll logic: smooth scrolling, scroll-to-reveal.
 */

import { LineHeightCache } from './line-height';

export interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

export class ScrollController {
  private _scrollTop: number = 0;
  private _scrollLeft: number = 0;
  private lineHeightCache: LineHeightCache;
  private viewportHeight: number = 0;
  private viewportWidth: number = 0;
  private maxScrollWidth: number = 0;

  constructor(lineHeightCache: LineHeightCache) {
    this.lineHeightCache = lineHeightCache;
  }

  get scrollTop(): number { return this._scrollTop; }
  get scrollLeft(): number { return this._scrollLeft; }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.clamp();
  }

  setMaxScrollWidth(width: number): void {
    this.maxScrollWidth = width;
  }

  /** Scroll to an absolute vertical offset. */
  scrollTo(offsetY: number): void {
    this._scrollTop = offsetY;
    this.clamp();
  }

  /** Scroll by a relative amount. */
  scrollBy(deltaX: number, deltaY: number): void {
    this._scrollTop += deltaY;
    this._scrollLeft += deltaX;
    this.clamp();
  }

  /**
   * Scroll the viewport so that a specific line is visible.
   */
  revealLine(lineNumber: number, position: 'top' | 'center' | 'bottom'): void {
    const lineTop = this.lineHeightCache.getLineTop(lineNumber);
    const lineHeight = this.lineHeightCache.getLineHeight(lineNumber);

    switch (position) {
      case 'top':
        this._scrollTop = lineTop;
        break;
      case 'center':
        this._scrollTop = lineTop - (this.viewportHeight - lineHeight) / 2;
        break;
      case 'bottom':
        this._scrollTop = lineTop - this.viewportHeight + lineHeight;
        break;
    }
    this.clamp();
  }

  /**
   * Ensure a line is visible, scrolling minimally if needed.
   */
  ensureLineVisible(lineNumber: number): void {
    const lineTop = this.lineHeightCache.getLineTop(lineNumber);
    const lineBottom = lineTop + this.lineHeightCache.getLineHeight(lineNumber);

    if (lineTop < this._scrollTop) {
      this._scrollTop = lineTop;
    } else if (lineBottom > this._scrollTop + this.viewportHeight) {
      this._scrollTop = lineBottom - this.viewportHeight;
    }
    this.clamp();
  }

  /** Ensure a column is visible horizontally. */
  ensureColumnVisible(pixelX: number, charWidth: number): void {
    const margin = charWidth * 2;
    if (pixelX < this._scrollLeft + margin) {
      this._scrollLeft = Math.max(0, pixelX - margin);
    } else if (pixelX > this._scrollLeft + this.viewportWidth - margin) {
      this._scrollLeft = pixelX - this.viewportWidth + margin;
    }
  }

  get position(): ScrollPosition {
    return { scrollTop: this._scrollTop, scrollLeft: this._scrollLeft };
  }

  private clamp(): void {
    const maxScrollTop = Math.max(0, this.lineHeightCache.getTotalHeight() - this.viewportHeight);
    this._scrollTop = Math.max(0, Math.min(this._scrollTop, maxScrollTop));

    const maxScrollLeft = Math.max(0, this.maxScrollWidth - this.viewportWidth);
    this._scrollLeft = Math.max(0, Math.min(this._scrollLeft, maxScrollLeft));
  }
}
