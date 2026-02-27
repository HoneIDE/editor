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

  constructor(config: Partial<GutterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
      items.push({
        type: 'line-number',
        text: String(lineNumber + 1), // 1-based display
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
      const colorMap = {
        added: '#2ea043',
        modified: '#0078d4',
        deleted: '#f85149',
      };
      items.push({
        type: `diff-${diffState}` as GutterItem['type'],
        color: colorMap[diffState],
      });
    }

    if (diagnosticSeverity === 'error') {
      items.push({ type: 'diagnostic-error', icon: 'error', color: '#f44747' });
    } else if (diagnosticSeverity === 'warning') {
      items.push({ type: 'diagnostic-warning', icon: 'warning', color: '#cca700' });
    }

    return items;
  }
}
