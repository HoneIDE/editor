/**
 * Minimap data: downscaled line color blocks, viewport indicator, click-to-scroll.
 */

import { TextBuffer } from '../core/buffer/text-buffer';
import type { LineToken } from './line-layout';
import type { EditorTheme } from './theme';

export interface MinimapLine {
  blocks: { color: string; width: number }[];
}

const BLOCK_SIZE = 4; // characters per block

/**
 * Generate minimap data for a range of lines.
 */
export function computeMinimapLines(
  buffer: TextBuffer,
  startLine: number,
  endLine: number,
  getTokens: (lineNumber: number) => LineToken[],
  theme: EditorTheme,
): MinimapLine[] {
  const lines: MinimapLine[] = [];

  for (let i = startLine; i < endLine && i < buffer.getLineCount(); i++) {
    const lineText = buffer.getLine(i);
    const tokens = getTokens(i);

    if (lineText.length === 0) {
      lines.push({ blocks: [] });
      continue;
    }

    const blocks: { color: string; width: number }[] = [];

    // Divide line into blocks and find dominant color per block
    for (let col = 0; col < lineText.length; col += BLOCK_SIZE) {
      const blockEnd = Math.min(col + BLOCK_SIZE, lineText.length);
      const blockWidth = blockEnd - col;

      // Find the token that covers the midpoint of this block
      const midpoint = col + Math.floor(blockWidth / 2);
      let color = theme.foreground;

      for (const token of tokens) {
        if (token.startColumn <= midpoint && token.endColumn > midpoint) {
          color = token.color;
          break;
        }
      }

      blocks.push({ color, width: blockWidth });
    }

    lines.push({ blocks });
  }

  return lines;
}

/**
 * Compute the viewport indicator rectangle for the minimap.
 */
export function computeViewportIndicator(
  scrollTop: number,
  viewportHeight: number,
  totalHeight: number,
  minimapHeight: number,
): { y: number; height: number } {
  if (totalHeight <= 0) return { y: 0, height: minimapHeight };

  const scale = minimapHeight / totalHeight;
  const y = scrollTop * scale;
  const height = Math.max(10, viewportHeight * scale); // minimum 10px

  return { y, height: Math.min(height, minimapHeight - y) };
}
