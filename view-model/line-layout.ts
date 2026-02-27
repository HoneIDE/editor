/**
 * Compute rendered lines: apply folding, wrapping, decorations to buffer lines.
 */

import { TextBuffer } from '../core/buffer/text-buffer';
import { GutterItem, GutterRenderer } from './gutter';

export interface LineToken {
  startColumn: number;
  endColumn: number;
  color: string;
  fontStyle: 'normal' | 'italic' | 'bold' | 'bold-italic';
}

export interface LineDecoration {
  startColumn: number;
  endColumn: number;
  type: 'highlight' | 'underline-error' | 'underline-warning' | 'underline-info'
    | 'strikethrough' | 'background' | 'border';
  color: string;
  hoverMessage?: string;
}

export interface RenderedLine {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
  decorations: LineDecoration[];
  foldState: 'expanded' | 'collapsed' | 'none';
  gutterItems: GutterItem[];
}

/**
 * Compute rendered lines for a set of visible line numbers.
 */
export function computeRenderedLines(
  buffer: TextBuffer,
  lineNumbers: number[],
  gutterRenderer: GutterRenderer,
  getTokens?: (lineNumber: number) => LineToken[],
  getDecorations?: (lineNumber: number) => LineDecoration[],
  getFoldState?: (lineNumber: number) => 'expanded' | 'collapsed' | 'none',
): RenderedLine[] {
  return lineNumbers.map(lineNumber => {
    const content = buffer.getLine(lineNumber);
    const tokens = getTokens ? getTokens(lineNumber) : defaultTokens(content);
    const decorations = getDecorations ? getDecorations(lineNumber) : [];
    const foldState = getFoldState ? getFoldState(lineNumber) : 'none';

    const gutterItems = gutterRenderer.getGutterItems(
      lineNumber,
      foldState,
      false, // hasBreakpoint
      null,  // diffState
      null,  // diagnosticSeverity
    );

    return {
      lineNumber,
      content,
      tokens,
      decorations,
      foldState,
      gutterItems,
    };
  });
}

/**
 * Default tokens: entire line as a single token in foreground color.
 */
function defaultTokens(content: string): LineToken[] {
  if (content.length === 0) return [];
  return [{
    startColumn: 0,
    endColumn: content.length,
    color: '#d4d4d4',
    fontStyle: 'normal',
  }];
}
