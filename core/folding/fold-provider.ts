/**
 * Fold range computation: indent-based and syntax-based.
 *
 * Two strategies:
 * 1. Indent-based (fallback): fold range starts at line L if L+1 has greater indentation.
 * 2. Syntax-based: uses Lezer parse tree to find block nodes.
 */

import { TextBuffer } from '../buffer/text-buffer';
import type { ISyntaxEngine, FoldRange } from '../tokenizer/tokenizer-interface';

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
 * SHIP-V1-GAPS.md #87: region-marker folding.
 *
 * Scans the buffer for `#region` / `#endregion` markers and returns matched
 * fold ranges. Recognises the most common comment styles:
 *   //  #region | //  #endregion        (TS, JS, Rust, Go, C, C++, Java, Swift)
 *   #   #region | #   #endregion        (Python, Ruby, Shell, TOML, YAML — when
 *                                        the user opts into the convention)
 *   <!--#region--> | <!--#endregion-->   (HTML, XML, Markdown)
 *   /* #region * / | /* #endregion * /  (block-comment variants)
 *
 * We don't enforce a specific comment prefix — we look for `#region` /
 * `#endregion` anywhere on a line. Unmatched starts or ends are dropped.
 * Nested regions are supported (LIFO stack pairing).
 */
export function computeRegionFoldRanges(buffer: TextBuffer): FoldRange[] {
  const ranges: FoldRange[] = [];
  const stack: number[] = [];
  const lineCount = buffer.getLineCount();
  for (let i = 0; i < lineCount; i++) {
    const line = buffer.getLine(i);
    // Check the simpler `#endregion` first — it's a substring of `#region`
    // matching, but `#endregion` must take priority.
    if (line.indexOf('#endregion') >= 0) {
      const start = stack.pop();
      if (start !== undefined && i > start) {
        ranges.push({ startLine: start, endLine: i });
      }
    } else if (line.indexOf('#region') >= 0) {
      stack.push(i);
    }
  }
  return ranges;
}

/**
 * Compute fold ranges using syntax tree.
 * Falls back to indent-based if no syntax engine or unsupported language.
 * Region-marker ranges are always merged in.
 */
export function computeFoldRanges(
  buffer: TextBuffer,
  syntaxEngine?: ISyntaxEngine,
): FoldRange[] {
  const regions = computeRegionFoldRanges(buffer);
  if (syntaxEngine) {
    const syntaxRanges = syntaxEngine.getFoldRanges(buffer);
    if (syntaxRanges.length > 0) {
      return regions.length > 0 ? syntaxRanges.concat(regions) : syntaxRanges;
    }
  }
  const indentRanges = computeIndentFoldRanges(buffer);
  return regions.length > 0 ? indentRanges.concat(regions) : indentRanges;
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
