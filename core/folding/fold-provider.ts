/**
 * Fold range computation: indent-based and syntax-based.
 *
 * Two strategies:
 * 1. Indent-based (fallback): fold range starts at line L if L+1 has greater indentation.
 * 2. Syntax-based: uses Lezer parse tree to find block nodes.
 */

import { TextBuffer } from '../buffer/text-buffer';
import type { SyntaxEngine, FoldRange } from '../tokenizer/syntax-engine';

/**
 * Compute fold ranges using indent-based folding.
 * Used as fallback for languages without Lezer grammars.
 */
export function computeIndentFoldRanges(buffer: TextBuffer): FoldRange[] {
  const ranges: FoldRange[] = [];
  const lineCount = buffer.getLineCount();

  for (let i = 0; i < lineCount - 1; i++) {
    const currentLine = buffer.getLine(i);
    const currentIndent = getIndentLevel(currentLine);

    // Skip blank lines
    if (currentLine.trim().length === 0) continue;

    // Look ahead for lines with greater indentation
    let endLine = -1;
    for (let j = i + 1; j < lineCount; j++) {
      const line = buffer.getLine(j);
      if (line.trim().length === 0) continue; // skip blank lines

      const indent = getIndentLevel(line);
      if (indent > currentIndent) {
        endLine = j;
      } else {
        break;
      }
    }

    if (endLine > i) {
      ranges.push({ startLine: i, endLine });
    }
  }

  return ranges;
}

/**
 * Compute fold ranges using syntax tree.
 * Falls back to indent-based if no syntax engine or unsupported language.
 */
export function computeFoldRanges(
  buffer: TextBuffer,
  syntaxEngine?: SyntaxEngine,
): FoldRange[] {
  if (syntaxEngine) {
    const syntaxRanges = syntaxEngine.getFoldRanges(buffer);
    if (syntaxRanges.length > 0) {
      return syntaxRanges;
    }
  }
  return computeIndentFoldRanges(buffer);
}

/**
 * Get indentation level (number of leading spaces, tabs count as 4).
 */
function getIndentLevel(line: string): number {
  let indent = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') indent++;
    else if (line[i] === '\t') indent += 4;
    else break;
  }
  return indent;
}
