/**
 * Syntax engine interface — decouples tokenization from any specific parser.
 *
 * Implementations:
 * - SyntaxEngine: Lezer-based, full AST parsing (for bun/test/V8 consumers)
 * - KeywordSyntaxEngine: Pure TS keyword scanner (for Perry native compilation)
 */

import type { TextBuffer } from '../buffer/text-buffer';
import type { LineToken } from '../../view-model/line-layout';
import type { EditorTheme } from '../../view-model/theme';

export interface FoldRange {
  startLine: number;
  endLine: number;
}

export interface ISyntaxEngine {
  /** Set the active language for parsing. */
  setLanguage(languageId: string): void;

  /** Parse (or incrementally re-parse) the buffer. Returns opaque tree or null. */
  parse(buffer: TextBuffer, changedRanges?: { fromOffset: number; toOffset: number }[]): any;

  /** Get syntax tokens for a specific line. */
  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[];

  /** Get foldable ranges from the document. */
  getFoldRanges(buffer: TextBuffer): FoldRange[];

  /** Find the matching bracket at the given offset. */
  findMatchingBracket(buffer: TextBuffer, offset: number): number | null;

  /** List supported language IDs. */
  getSupportedLanguages(): string[];

  /** Check if a language is supported. */
  hasLanguage(languageId: string): boolean;
}
