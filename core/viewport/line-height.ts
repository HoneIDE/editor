/**
 * Line height cache: uniform height for most lines, variable for wrapped/code-lens.
 * Maintains cached cumulative sums for O(1) getLineTop and O(log n) getLineAtY.
 */

export class LineHeightCache {
  private _baseLineHeight: number;
  private overrides: Map<number, number> = new Map();
  private totalLines: number = 0;
  // Cumulative sum cache: _cumSums[i] = pixel Y of the top of line i
  // _cumSums[totalLines] = total height
  private _cumSums: number[] = [];
  private _cumDirty: boolean = true;

  constructor(baseLineHeight: number = 20) {
    this._baseLineHeight = baseLineHeight;
  }

  get baseLineHeight(): number {
    return this._baseLineHeight;
  }

  setBaseLineHeight(height: number): void {
    this._baseLineHeight = height;
    this._cumDirty = true;
  }

  setTotalLines(count: number): void {
    this.totalLines = count;
    this._cumDirty = true;
  }

  getLineHeight(lineNumber: number): number {
    const ov = this.overrides.get(lineNumber);
    if (ov === undefined) return this._baseLineHeight;
    return ov;
  }

  /** Rebuild cumulative sums if dirty. */
  private _ensureCumSums(): void {
    if (!this._cumDirty) return;
    const n = this.totalLines;
    const sums = this._cumSums;
    // Resize if needed
    if (sums.length !== n + 1) {
      this._cumSums = new Array(n + 1);
    }
    const s = this._cumSums;
    s[0] = 0;
    if (this.overrides.size === 0) {
      // Fast path: all lines have base height
      for (let i = 0; i < n; i++) {
        s[i + 1] = (i + 1) * this._baseLineHeight;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const ov = this.overrides.get(i);
        if (ov === undefined) {
          s[i + 1] = s[i] + this._baseLineHeight;
        } else {
          s[i + 1] = s[i] + ov;
        }
      }
    }
    this._cumDirty = false;
  }

  /**
   * Get the pixel Y position of the top of a line. O(1) with cache.
   */
  getLineTop(lineNumber: number): number {
    if (this.overrides.size === 0) {
      return lineNumber * this._baseLineHeight;
    }
    this._ensureCumSums();
    if (lineNumber <= 0) return 0;
    if (lineNumber >= this.totalLines) return this._cumSums[this.totalLines];
    return this._cumSums[lineNumber];
  }

  /**
   * Get the total height of all lines. O(1) with cache.
   */
  getTotalHeight(): number {
    if (this.overrides.size === 0) {
      return this.totalLines * this._baseLineHeight;
    }
    this._ensureCumSums();
    return this._cumSums[this.totalLines];
  }

  /**
   * Find the line number at a given pixel Y position. O(log n) with cache.
   */
  getLineAtY(y: number): number {
    if (y <= 0) return 0;

    if (this.overrides.size === 0) {
      return Math.min(
        Math.floor(y / this._baseLineHeight),
        Math.max(0, this.totalLines - 1),
      );
    }

    this._ensureCumSums();
    const sums = this._cumSums;
    const n = this.totalLines;

    // Binary search: find last line whose top <= y
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sums[mid] <= y) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  setWrapped(lineNumber: number, wrapCount: number): void {
    if (wrapCount <= 1) {
      this.overrides.delete(lineNumber);
    } else {
      this.overrides.set(lineNumber, this._baseLineHeight * wrapCount);
    }
    this._cumDirty = true;
  }

  setCodeLens(lineNumber: number, lensHeight: number): void {
    this.overrides.set(lineNumber, this._baseLineHeight + lensHeight);
    this._cumDirty = true;
  }

  clearOverride(lineNumber: number): void {
    this.overrides.delete(lineNumber);
    this._cumDirty = true;
  }

  clearAllOverrides(): void {
    this.overrides.clear();
    this._cumDirty = true;
  }
}
