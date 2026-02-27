/**
 * Line height cache: uniform height for most lines, variable for wrapped/code-lens.
 */

export class LineHeightCache {
  private _baseLineHeight: number;
  private overrides: Map<number, number> = new Map(); // lineNumber -> pixelHeight
  private totalLines: number = 0;

  constructor(baseLineHeight: number = 20) {
    this._baseLineHeight = baseLineHeight;
  }

  get baseLineHeight(): number {
    return this._baseLineHeight;
  }

  setBaseLineHeight(height: number): void {
    this._baseLineHeight = height;
  }

  setTotalLines(count: number): void {
    this.totalLines = count;
  }

  getLineHeight(lineNumber: number): number {
    return this.overrides.get(lineNumber) ?? this._baseLineHeight;
  }

  /**
   * Get the pixel Y position of the top of a line.
   */
  getLineTop(lineNumber: number): number {
    if (this.overrides.size === 0) {
      return lineNumber * this._baseLineHeight;
    }
    let top = 0;
    for (let i = 0; i < lineNumber; i++) {
      top += this.overrides.get(i) ?? this._baseLineHeight;
    }
    return top;
  }

  /**
   * Get the total height of all lines.
   */
  getTotalHeight(): number {
    if (this.overrides.size === 0) {
      return this.totalLines * this._baseLineHeight;
    }
    let total = 0;
    for (let i = 0; i < this.totalLines; i++) {
      total += this.overrides.get(i) ?? this._baseLineHeight;
    }
    return total;
  }

  /**
   * Find the line number at a given pixel Y position.
   */
  getLineAtY(y: number): number {
    if (y <= 0) return 0;

    if (this.overrides.size === 0) {
      return Math.min(
        Math.floor(y / this._baseLineHeight),
        Math.max(0, this.totalLines - 1),
      );
    }

    let top = 0;
    for (let i = 0; i < this.totalLines; i++) {
      const h = this.overrides.get(i) ?? this._baseLineHeight;
      if (top + h > y) return i;
      top += h;
    }
    return Math.max(0, this.totalLines - 1);
  }

  setWrapped(lineNumber: number, wrapCount: number): void {
    if (wrapCount <= 1) {
      this.overrides.delete(lineNumber);
    } else {
      this.overrides.set(lineNumber, this._baseLineHeight * wrapCount);
    }
  }

  setCodeLens(lineNumber: number, lensHeight: number): void {
    this.overrides.set(lineNumber, this._baseLineHeight + lensHeight);
  }

  clearOverride(lineNumber: number): void {
    this.overrides.delete(lineNumber);
  }

  clearAllOverrides(): void {
    this.overrides.clear();
  }
}
