/**
 * Gutter rendering: line numbers, fold indicators, breakpoint icons, diff markers.
 */

export interface GutterItem {
  type: 'line-number' | 'fold-indicator' | 'breakpoint' | 'diff-added'
    | 'diff-modified' | 'diff-deleted' | 'diagnostic-error' | 'diagnostic-warning';
  text?: string;
  icon?: string;
  color?: string;
}

export interface GutterConfig {
  showLineNumbers: boolean;
  showFoldIndicators: boolean;
  showBreakpoints: boolean;
  showDiffMarkers: boolean;
}

const DEFAULT_CONFIG: GutterConfig = {
  showLineNumbers: true,
  showFoldIndicators: true,
  showBreakpoints: false,
  showDiffMarkers: true,
};

export class GutterRenderer {
  private config: GutterConfig;
  private charWidth: number = 8; // approximate monospace char width

  constructor(config?: Partial<GutterConfig>) {
    // Perry AOT: { ...DEFAULT_CONFIG, ...config } object spread is broken.
    // Perry AOT: default parameter (= {}) may not be processed — use optional param.
    // Initialize with DEFAULT_CONFIG values explicitly, then override if provided.
    this.config = {
      showLineNumbers: true,
      showFoldIndicators: true,
      showBreakpoints: false,
      showDiffMarkers: true,
    };
    if (config !== undefined && config !== null) {
      if (config.showLineNumbers !== undefined) this.config.showLineNumbers = config.showLineNumbers;
      if (config.showFoldIndicators !== undefined) this.config.showFoldIndicators = config.showFoldIndicators;
      if (config.showBreakpoints !== undefined) this.config.showBreakpoints = config.showBreakpoints;
      if (config.showDiffMarkers !== undefined) this.config.showDiffMarkers = config.showDiffMarkers;
    }
  }

  setCharWidth(width: number): void {
    this.charWidth = width;
  }

  /**
   * Compute gutter width in pixels.
   */
  computeGutterWidth(totalLineCount: number): number {
    let width = 0;

    if (this.config.showLineNumbers) {
      const digits = Math.max(2, Math.floor(Math.log10(totalLineCount)) + 1);
      width += digits * this.charWidth + 16; // padding
    }

    if (this.config.showFoldIndicators) {
      width += 16;
    }

    if (this.config.showBreakpoints) {
      width += 16;
    }

    if (this.config.showDiffMarkers) {
      width += 4;
    }

    return width;
  }

  /**
   * Generate gutter items for a line.
   */
  getGutterItems(
    lineNumber: number,
    foldState: 'expanded' | 'collapsed' | 'none',
    hasBreakpoint: boolean,
    diffState: 'added' | 'modified' | 'deleted' | null,
    diagnosticSeverity: 'error' | 'warning' | null,
  ): GutterItem[] {
    const items: GutterItem[] = [];

    if (this.config.showLineNumbers) {
      // Perry AOT: String(n) may not work — use string concatenation.
      items.push({
        type: 'line-number',
        text: '' + (lineNumber + 1), // 1-based display
      });
    }

    if (this.config.showFoldIndicators && foldState !== 'none') {
      items.push({
        type: 'fold-indicator',
        icon: foldState === 'expanded' ? 'chevron-down' : 'chevron-right',
      });
    }

    if (this.config.showBreakpoints && hasBreakpoint) {
      items.push({
        type: 'breakpoint',
        icon: 'circle-filled',
        color: '#e51400',
      });
    }

    if (this.config.showDiffMarkers && diffState) {
      // Perry AOT: colorMap[diffState] dynamic Record access is broken.
      // Perry AOT: template literal `diff-${diffState}` may have issues with union cast.
      // Use explicit if-else chains for both color and type.
      let diffColor = '#0078d4';
      let diffType: GutterItem['type'] = 'diff-modified';
      if (diffState === 'added') { diffColor = '#2ea043'; diffType = 'diff-added'; }
      else if (diffState === 'modified') { diffColor = '#0078d4'; diffType = 'diff-modified'; }
      else if (diffState === 'deleted') { diffColor = '#f85149'; diffType = 'diff-deleted'; }
      items.push({ type: diffType, color: diffColor });
    }

    if (diagnosticSeverity === 'error') {
      items.push({ type: 'diagnostic-error', icon: 'error', color: '#f44747' });
    } else if (diagnosticSeverity === 'warning') {
      items.push({ type: 'diagnostic-warning', icon: 'warning', color: '#cca700' });
    }

    return items;
  }
}
