/**
 * Decoration types: inline (bold, color), line (background), margin (icons).
 *
 * Decorations are collected from multiple providers and stored per-line.
 */

import type { LineDecoration } from './line-layout';
import type { SearchMatch } from '../core/search/search-engine';
import type { SelectionRange } from '../core/cursor/selection';
import type { Diagnostic } from './overlays';
import type { EditorTheme } from './theme';

/**
 * Generate search highlight decorations.
 */
export function searchDecorations(
  matches: readonly SearchMatch[],
  currentMatchIndex: number,
  lineNumber: number,
  theme: EditorTheme,
): LineDecoration[] {
  const decorations: LineDecoration[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.line !== lineNumber) continue;

    decorations.push({
      startColumn: match.column,
      endColumn: match.column + match.length,
      type: 'background',
      color: i === currentMatchIndex ? '#515c6a' : '#3a3d41',
    });
  }

  return decorations;
}

/**
 * Generate selection decorations.
 */
export function selectionDecorations(
  selections: SelectionRange[],
  lineNumber: number,
  lineLength: number,
  theme: EditorTheme,
): LineDecoration[] {
  const decorations: LineDecoration[] = [];

  for (const sel of selections) {
    if (lineNumber < sel.startLine || lineNumber > sel.endLine) continue;

    const startCol = lineNumber === sel.startLine ? sel.startColumn : 0;
    const endCol = lineNumber === sel.endLine ? sel.endColumn : lineLength;

    if (startCol < endCol) {
      decorations.push({
        startColumn: startCol,
        endColumn: endCol,
        type: 'background',
        color: theme.selectionBackground,
      });
    }
  }

  return decorations;
}

/**
 * Generate diagnostic decorations (underlines).
 */
export function diagnosticDecorations(
  diagnostics: Diagnostic[],
  lineNumber: number,
  theme: EditorTheme,
): LineDecoration[] {
  const decorations: LineDecoration[] = [];

  for (const diag of diagnostics) {
    if (lineNumber < diag.line || lineNumber > diag.endLine) continue;

    const startCol = lineNumber === diag.line ? diag.column : 0;
    const endCol = lineNumber === diag.endLine ? diag.endColumn : Infinity;

    const typeMap = {
      error: 'underline-error' as const,
      warning: 'underline-warning' as const,
      info: 'underline-info' as const,
      hint: 'underline-info' as const,
    };

    const colorMap = {
      error: theme.errorForeground,
      warning: theme.warningForeground,
      info: theme.infoForeground,
      hint: theme.infoForeground,
    };

    decorations.push({
      startColumn: startCol,
      endColumn: endCol,
      type: typeMap[diag.severity],
      color: colorMap[diag.severity],
      hoverMessage: diag.message,
    });
  }

  return decorations;
}

/**
 * Generate bracket matching decoration.
 */
export function bracketMatchDecoration(
  matchOffset: number,
  lineNumber: number,
  lineStartOffset: number,
): LineDecoration | null {
  const col = matchOffset - lineStartOffset;
  if (col < 0) return null;

  return {
    startColumn: col,
    endColumn: col + 1,
    type: 'background',
    color: '#3a3d41',
  };
}
