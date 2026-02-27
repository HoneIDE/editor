/**
 * Replace and replace-all with capture group support.
 */

import { TextBuffer, TextEdit } from '../buffer/text-buffer';
import { SearchMatch, searchAll, searchNext, SearchOptions } from './search-engine';

/**
 * Build a replacement string, expanding capture group references ($1, $2, etc.).
 */
export function expandReplacement(replacement: string, match: SearchMatch): string {
  if (!match.captures || match.captures.length === 0) {
    return replacement;
  }

  return replacement.replace(/\$(\d+)/g, (_, num) => {
    const idx = parseInt(num, 10) - 1;
    if (idx >= 0 && idx < match.captures!.length) {
      return match.captures![idx] ?? '';
    }
    return '';
  });
}

/**
 * Replace the current match and return the next match.
 */
export function replaceNext(
  buffer: TextBuffer,
  query: string,
  replacement: string,
  currentMatch: SearchMatch,
  options: Partial<SearchOptions> = {},
): { edit: TextEdit; deletedText: string; nextMatch: SearchMatch | null } {
  const expandedReplacement = expandReplacement(replacement, currentMatch);

  const edit: TextEdit = {
    offset: currentMatch.offset,
    deleteCount: currentMatch.length,
    insertText: expandedReplacement,
  };

  const deletedText = currentMatch.text;

  // Apply the edit
  buffer.applyEdits([edit]);

  // Find next match (after the replacement)
  const nextOffset = currentMatch.offset + expandedReplacement.length;
  const nextMatch = searchNext(buffer, query, nextOffset, options);

  return { edit, deletedText, nextMatch };
}

/**
 * Replace all matches at once as a single edit transaction.
 * Returns all edits for undo support.
 */
export function replaceAll(
  buffer: TextBuffer,
  query: string,
  replacement: string,
  options: Partial<SearchOptions> = {},
): { edits: TextEdit[]; deletedTexts: string[]; count: number } {
  const matches = searchAll(buffer, query, options);
  if (matches.length === 0) {
    return { edits: [], deletedTexts: [], count: 0 };
  }

  const edits: TextEdit[] = [];
  const deletedTexts: string[] = [];

  for (const match of matches) {
    const expandedReplacement = expandReplacement(replacement, match);
    edits.push({
      offset: match.offset,
      deleteCount: match.length,
      insertText: expandedReplacement,
    });
    deletedTexts.push(match.text);
  }

  // Apply all edits atomically
  buffer.applyEdits(edits);

  return { edits, deletedTexts, count: matches.length };
}
