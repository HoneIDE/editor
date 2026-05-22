/**
 * Compute rendered lines: apply folding, wrapping, decorations to buffer lines.
 */

import { TextBuffer } from '../core/buffer/text-buffer';
import { GutterItem, GutterRenderer } from './gutter';

export interface LineToken {
  startColumn: number;
  endColumn: number;
  color: string;
  fontStyle: 'normal' | 'italic' | 'bold' | 'bold-italic' | 'heading-lg' | 'heading-md';
  /**
   * TextMate-style scope string (e.g. `keyword.control`) when this token came
   * from the scope-based tree-sitter engine. Carried through to the renderer so
   * the web target can resolve the color JS-side: `theme.tokens.*` reads return
   * undefined inside Perry's WASM (PerryTS/perry#1071), so `color` above is
   * unreliable on web — the renderer falls back to resolving `scope` itself.
   */
  scope?: string;
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
  /** Optional line background color hex (e.g., code blocks). */
  lineBg: string;
}

/**
 * Compute rendered lines for a set of visible line numbers.
 * Uses a for loop instead of .map() for Perry compatibility.
 */
export function computeRenderedLines(
  buffer: TextBuffer,
  lineNumbers: number[],
  gutterRenderer: GutterRenderer,
  tokenProvider: ((lineNumber: number) => LineToken[]) | null,
): RenderedLine[] {
  const result: RenderedLine[] = [];
  for (let i = 0; i < lineNumbers.length; i++) {
    const lineNumber = lineNumbers[i];
    const content = buffer.getLine(lineNumber);
    let tokens: LineToken[];
    if (tokenProvider !== null) {
      tokens = tokenProvider(lineNumber);
      if (tokens.length === 0) {
        tokens = defaultTokens(content);
      }
    } else {
      tokens = defaultTokens(content);
    }
    // Extract lineBg from special sentinel token (startColumn === -1)
    let lineBg = '';
    const realTokens: LineToken[] = [];
    for (let ti = 0; ti < tokens.length; ti++) {
      if (tokens[ti].startColumn === -1) {
        lineBg = tokens[ti].color;
      } else {
        realTokens.push(tokens[ti]);
      }
    }
    const decorations: LineDecoration[] = [];
    const gutterItems = gutterRenderer.getGutterItems(
      lineNumber,
      'none',
      false,
      null,
      null,
    );
    const line: RenderedLine = {
      lineNumber: lineNumber,
      content: content,
      tokens: realTokens,
      decorations: decorations,
      foldState: 'none',
      gutterItems: gutterItems,
      lineBg: lineBg,
    };
    result.push(line);
  }
  return result;
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
