/**
 * Tree-sitter-backed syntax engine (SHIP-V1-GAPS.md #16, #18).
 *
 * Replaces the single-color KeywordSyntaxEngine for the languages tree-sitter
 * supports. Calls into the native bridge (`hone_editor_ts_*`) which holds the
 * last-parse results in thread-local Rust state. We re-parse on every `parse()`
 * call for now; incremental reparse is a Phase 1 follow-up.
 *
 * The engine emits TextMate-style scope strings (e.g. `keyword.control`,
 * `entity.name.function`, `string.quoted`). The render path resolves these
 * through the active theme's `TokenTheme` map — so a theme switch only needs
 * to repaint, not retokenize.
 */

import type { TextBuffer } from '../buffer/text-buffer';
import type { LineToken } from '../../view-model/line-layout';
import type { EditorTheme } from '../../view-model/theme';
import type { ISyntaxEngine, FoldRange } from './tokenizer-interface';
import { resolveTokenScope } from './token-theme';

// FFI — resolved by Perry's codegen from package.json perry.nativeLibrary.functions.
declare function hone_editor_ts_parse(source: string, langId: number): number;
declare function hone_editor_ts_clear(): void;
declare function hone_editor_ts_token_count(): number;
declare function hone_editor_ts_token_start(idx: number): number;
declare function hone_editor_ts_token_end(idx: number): number;
declare function hone_editor_ts_token_scope(idx: number): string;

// langId values — must match the Rust side's `LangId` enum + lang_id_from_f64
// dispatch in `tree_sitter_bridge.rs`.
const LANG_TYPESCRIPT = 0;
const LANG_PYTHON = 1;
const LANG_RUST = 2;
const LANG_JAVASCRIPT = 4;
const LANG_JSON = 5;
const LANG_CSS = 7;
const LANG_TSX = 9;

function langIdForLanguage(languageId: string): number {
  // Cross-module string equality is unreliable in Perry, so we route off
  // (length, first-two-chars). The set is small and disjoint.
  const n = languageId.length;
  if (n < 1) return -1;
  const c0 = languageId.charCodeAt(0);
  const c1 = n >= 2 ? languageId.charCodeAt(1) : 0;

  // tsx / tsx-react
  if (c0 === 116 && c1 === 115) return LANG_TSX;             // 't','s'
  // typescript
  if (c0 === 116 && c1 === 121) return LANG_TYPESCRIPT;      // 't','y'
  // javascript / jsx
  if (c0 === 106) return LANG_JAVASCRIPT;                    // 'j'
  // python
  if (c0 === 112 && c1 === 121) return LANG_PYTHON;          // 'p','y'
  // rust
  if (c0 === 114 && c1 === 117) return LANG_RUST;            // 'r','u'
  // json / json5
  if (c0 === 106 && c1 === 115) return LANG_JSON;            // 'j','s' — also matches javascript; checked above first
  if (c0 === 110) return LANG_JSON;                          // 'n' for ndjson? — defensive
  if (n >= 4 && c0 === 106 && c1 === 115 && languageId.charCodeAt(2) === 111 && languageId.charCodeAt(3) === 110) return LANG_JSON;
  // css / scss / less — treat as CSS
  if (c0 === 99 && c1 === 115) return LANG_CSS;              // 'c','s'
  if (c0 === 115 && c1 === 99) return LANG_CSS;              // 's','c' (scss)
  if (c0 === 108 && c1 === 101) return LANG_CSS;             // 'l','e' (less)
  return -1;
}

/** Cached parse for one buffer — invalidated when buffer.version changes. */
interface CachedParse {
  version: number;
  langId: number;
  // Snapshot of the token array as of the last call to `parse()`. Cheaper than
  // re-querying the FFI for every line. Each entry is a flat row of [startByte, endByte].
  starts: number[];
  ends: number[];
  scopes: string[];
}

export class TreeSitterEngine implements ISyntaxEngine {
  private currentLangId: number = -1;
  private cache: CachedParse | null = null;
  private bufferRef: TextBuffer | null = null;

  setLanguage(languageId: string): void {
    this.currentLangId = langIdForLanguage(languageId);
    // Invalidate — a language switch invalidates the previous parse.
    this.cache = null;
  }

  /**
   * Parse (or re-parse) the buffer. Stores the token array in TS-side cache
   * so per-line slicing doesn't pay the FFI roundtrip per token.
   */
  parse(buffer: TextBuffer, _changedRanges?: { fromOffset: number; toOffset: number }[]): unknown {
    if (this.currentLangId < 0) return null;
    const version = (buffer as any).version as number;
    if (this.cache !== null
        && this.cache.langId === this.currentLangId
        && this.cache.version === version
        && this.bufferRef === buffer) {
      return null;
    }
    const text = buffer.getText();
    const n = hone_editor_ts_parse(text, this.currentLangId);

    const starts: number[] = [];
    const ends: number[] = [];
    const scopes: string[] = [];
    for (let i = 0; i < n; i++) {
      starts.push(hone_editor_ts_token_start(i));
      ends.push(hone_editor_ts_token_end(i));
      scopes.push(hone_editor_ts_token_scope(i));
    }
    this.cache = { version: version, langId: this.currentLangId, starts: starts, ends: ends, scopes: scopes };
    this.bufferRef = buffer;
    return null;
  }

  /**
   * Tokens for a single line. Filters the cached full-document parse by byte
   * range, converts byte offsets to line-relative columns, and resolves each
   * scope through the active theme's TokenTheme.
   */
  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[] {
    if (this.cache === null || this.bufferRef !== buffer) {
      this.parse(buffer);
    }
    if (this.cache === null) return [];

    const lineStart = buffer.getLineOffset(lineNumber);
    const lineText = buffer.getLine(lineNumber);
    const lineEnd = lineStart + lineText.length;

    const out: LineToken[] = [];
    const starts = this.cache.starts;
    const ends = this.cache.ends;
    const scopes = this.cache.scopes;
    const n = starts.length;
    for (let i = 0; i < n; i++) {
      const ts = starts[i];
      const te = ends[i];
      if (te <= lineStart) continue;
      if (ts >= lineEnd) break;
      // Clip to line bounds.
      const clipStart = ts < lineStart ? lineStart : ts;
      const clipEnd = te > lineEnd ? lineEnd : te;
      const startCol = clipStart - lineStart;
      const endCol = clipEnd - lineStart;
      const scope = scopes[i];
      const color = resolveTokenScope(theme, scope);
      // Carry the scope string through alongside the resolved color: on web the
      // color resolves to undefined inside WASM (PerryTS/perry#1071), so the DOM
      // renderer re-resolves from `scope` JS-side. Native renderers use `color`.
      out.push({
        startColumn: startCol,
        endColumn: endCol,
        color: color,
        fontStyle: '',
        scope: scope,
      } as unknown as LineToken);
    }
    return out;
  }

  /**
   * Foldable ranges. Phase 1 follow-up: derive from tree-sitter node spans
   * (functions, classes, control blocks). For now defer to the existing
   * indent-based folder used by the editor's fold-provider.
   */
  getFoldRanges(_buffer: TextBuffer): FoldRange[] {
    return [];
  }

  /**
   * Matching bracket lookup. Phase 1 follow-up: tree-sitter exposes paired
   * delimiter information via node parents — for now defer to the editor's
   * bracket-matching service.
   */
  findMatchingBracket(_buffer: TextBuffer, _offset: number): number | null {
    return null;
  }

  getSupportedLanguages(): string[] {
    return ['typescript', 'javascript', 'tsx', 'jsx', 'python', 'rust', 'json', 'css', 'scss', 'less'];
  }

  hasLanguage(languageId: string): boolean {
    return langIdForLanguage(languageId) >= 0;
  }

  /** Release Rust-side parse state. Call when the editor closes. */
  dispose(): void {
    hone_editor_ts_clear();
    this.cache = null;
    this.bufferRef = null;
  }
}
