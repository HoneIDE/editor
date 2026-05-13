/**
 * Composite syntax engine — routes per-language between TreeSitterEngine
 * and KeywordSyntaxEngine.
 *
 * SHIP-V1-GAPS.md #16 follow-up: tree-sitter handles the languages it has
 * grammars for (TS, JS, TSX, JSX, Python — Phase 1 adds more). Anything else
 * falls back to the keyword scanner so the editor never loses highlighting
 * during the grammar-set rollout.
 *
 * Both engines share the same `ISyntaxEngine` contract, so the consumer
 * (`EditorViewModel`, `IncrementalTokenCache`, etc.) is unaware of the routing.
 */

import type { TextBuffer } from '../buffer/text-buffer';
import type { LineToken } from '../../view-model/line-layout';
import type { EditorTheme } from '../../view-model/theme';
import type { ISyntaxEngine, FoldRange } from './tokenizer-interface';
import { KeywordSyntaxEngine } from './keyword-syntax-engine';
import { TreeSitterEngine } from './tree-sitter-engine';

export class CompositeEngine implements ISyntaxEngine {
  private treeSitter: TreeSitterEngine;
  private keyword: KeywordSyntaxEngine;
  private activeLanguage: string = '';
  // 1 = tree-sitter, 0 = keyword fallback. Decided on every setLanguage call.
  private route: number = 0;

  constructor() {
    this.treeSitter = new TreeSitterEngine();
    this.keyword = new KeywordSyntaxEngine();
  }

  setLanguage(languageId: string): void {
    this.activeLanguage = languageId;
    if (this.treeSitter.hasLanguage(languageId)) {
      this.route = 1;
      this.treeSitter.setLanguage(languageId);
    } else {
      this.route = 0;
      this.keyword.setLanguage(languageId);
    }
  }

  parse(buffer: TextBuffer, changedRanges?: { fromOffset: number; toOffset: number }[]): unknown {
    if (this.route === 1) return this.treeSitter.parse(buffer, changedRanges);
    return this.keyword.parse(buffer, changedRanges);
  }

  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[] {
    if (this.route === 1) return this.treeSitter.getLineTokens(buffer, lineNumber, theme);
    return this.keyword.getLineTokens(buffer, lineNumber, theme);
  }

  getFoldRanges(buffer: TextBuffer): FoldRange[] {
    if (this.route === 1) return this.treeSitter.getFoldRanges(buffer);
    return this.keyword.getFoldRanges(buffer);
  }

  findMatchingBracket(buffer: TextBuffer, offset: number): number | null {
    if (this.route === 1) return this.treeSitter.findMatchingBracket(buffer, offset);
    return this.keyword.findMatchingBracket(buffer, offset);
  }

  getSupportedLanguages(): string[] {
    // Merge — tree-sitter set is small for v1; keyword scanner covers the long tail.
    const tsLangs = this.treeSitter.getSupportedLanguages();
    const kwLangs = this.keyword.getSupportedLanguages();
    const seen: Record<string, number> = {};
    const out: string[] = [];
    for (let i = 0; i < tsLangs.length; i++) {
      if (seen[tsLangs[i]] !== 1) { seen[tsLangs[i]] = 1; out.push(tsLangs[i]); }
    }
    for (let j = 0; j < kwLangs.length; j++) {
      if (seen[kwLangs[j]] !== 1) { seen[kwLangs[j]] = 1; out.push(kwLangs[j]); }
    }
    return out;
  }

  hasLanguage(languageId: string): boolean {
    return this.treeSitter.hasLanguage(languageId) || this.keyword.hasLanguage(languageId);
  }

  /** Release tree-sitter Rust-side state. Call on editor disposal. */
  dispose(): void {
    this.treeSitter.dispose();
  }
}
