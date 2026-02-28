/**
 * Pure TypeScript keyword-based syntax engine.
 *
 * No @lezer imports — safe for Perry native compilation.
 * Handles: comments, strings, numbers, keywords, function names, type names,
 * operators, punctuation. Produces LineToken[] with theme colors.
 */

import type { ISyntaxEngine, FoldRange } from './tokenizer-interface';
import type { TextBuffer } from '../buffer/text-buffer';
import type { LineToken } from '../../view-model/line-layout';
import type { EditorTheme } from '../../view-model/theme';

// ---------------------------------------------------------------------------
// Language keyword tables
// ---------------------------------------------------------------------------

const TYPESCRIPT_KEYWORDS = [
  'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'new', 'this', 'class', 'extends', 'implements', 'interface', 'type',
  'enum', 'namespace', 'module', 'declare', 'abstract', 'readonly',
  'public', 'private', 'protected', 'static', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'in', 'of', 'as', 'is', 'keyof', 'void', 'null', 'undefined',
  'true', 'false', 'default', 'yield', 'super', 'delete',
];

const PYTHON_KEYWORDS = [
  'import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else',
  'for', 'while', 'break', 'continue', 'pass', 'raise', 'try', 'except',
  'finally', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal',
  'assert', 'del', 'in', 'not', 'and', 'or', 'is', 'True', 'False', 'None',
  'async', 'await', 'print', 'self',
];

const RUST_KEYWORDS = [
  'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
  'pub', 'use', 'mod', 'crate', 'super', 'self', 'Self', 'where',
  'if', 'else', 'match', 'loop', 'while', 'for', 'in', 'break', 'continue',
  'return', 'as', 'ref', 'move', 'type', 'unsafe', 'extern', 'async', 'await',
  'dyn', 'true', 'false',
];

const HTML_KEYWORDS = ['doctype', 'html', 'head', 'body', 'div', 'span', 'script', 'style', 'link', 'meta'];
const CSS_KEYWORDS = ['import', 'media', 'keyframes', 'font-face', 'supports', 'charset'];
const JSON_KEYWORDS = ['true', 'false', 'null'];
const MARKDOWN_KEYWORDS: string[] = [];

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  typescript: TYPESCRIPT_KEYWORDS,
  javascript: TYPESCRIPT_KEYWORDS,
  python: PYTHON_KEYWORDS,
  rust: RUST_KEYWORDS,
  html: HTML_KEYWORDS,
  css: CSS_KEYWORDS,
  json: JSON_KEYWORDS,
  markdown: MARKDOWN_KEYWORDS,
  c: RUST_KEYWORDS,
  cpp: RUST_KEYWORDS,
};

const LANGUAGE_LINE_COMMENTS: Record<string, string> = {
  typescript: '//',
  javascript: '//',
  python: '#',
  rust: '//',
  c: '//',
  cpp: '//',
  html: '',
  css: '',
  json: '',
  markdown: '',
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_KEYWORDS);

// ---------------------------------------------------------------------------
// Token classification helpers
// ---------------------------------------------------------------------------

function isWordChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
}

function isUpperCase(c: string): boolean {
  return c >= 'A' && c <= 'Z';
}

const OPERATORS = '=+-*/<>!&|?:%~^';

// ---------------------------------------------------------------------------
// KeywordSyntaxEngine
// ---------------------------------------------------------------------------

export class KeywordSyntaxEngine implements ISyntaxEngine {
  private languageId: string = '';
  private keywords: string[] = [];
  private lineComment: string = '//';
  private parsed: boolean = false;

  setLanguage(languageId: string): void {
    this.languageId = languageId;
    this.keywords = LANGUAGE_KEYWORDS[languageId] ?? [];
    this.lineComment = LANGUAGE_LINE_COMMENTS[languageId] ?? '//';
    this.parsed = false;
  }

  parse(_buffer: TextBuffer, _changedRanges?: { fromOffset: number; toOffset: number }[]): any {
    this.parsed = true;
    return true;
  }

  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[] {
    if (lineNumber < 0 || lineNumber >= buffer.getLineCount()) return [];

    const lineText = buffer.getLine(lineNumber);
    if (lineText.length === 0) return [];

    const tokens: LineToken[] = [];
    let i = 0;

    // Check if we're inside a block comment by scanning prior lines
    let inBlockComment = false;
    if (this.languageId !== 'python') {
      inBlockComment = this.isInsideBlockComment(buffer, lineNumber);
    }

    if (inBlockComment) {
      const endIdx = lineText.indexOf('*/');
      if (endIdx >= 0) {
        tokens.push({
          startColumn: 0,
          endColumn: endIdx + 2,
          color: theme.tokens.comment,
          fontStyle: 'italic',
        });
        i = endIdx + 2;
      } else {
        return [{
          startColumn: 0,
          endColumn: lineText.length,
          color: theme.tokens.comment,
          fontStyle: 'italic',
        }];
      }
    }

    while (i < lineText.length) {
      const c = lineText.charAt(i);

      // Line comment
      if (this.lineComment.length > 0 && lineText.startsWith(this.lineComment, i)) {
        tokens.push({
          startColumn: i,
          endColumn: lineText.length,
          color: theme.tokens.comment,
          fontStyle: 'italic',
        });
        return tokens;
      }

      // Block comment (C-style languages)
      if (c === '/' && i + 1 < lineText.length && lineText.charAt(i + 1) === '*') {
        const endIdx = lineText.indexOf('*/', i + 2);
        if (endIdx >= 0) {
          tokens.push({
            startColumn: i,
            endColumn: endIdx + 2,
            color: theme.tokens.comment,
            fontStyle: 'italic',
          });
          i = endIdx + 2;
          continue;
        } else {
          tokens.push({
            startColumn: i,
            endColumn: lineText.length,
            color: theme.tokens.comment,
            fontStyle: 'italic',
          });
          return tokens;
        }
      }

      // Python # comment
      if (this.languageId === 'python' && c === '#') {
        tokens.push({
          startColumn: i,
          endColumn: lineText.length,
          color: theme.tokens.comment,
          fontStyle: 'italic',
        });
        return tokens;
      }

      // Strings (single, double, backtick)
      if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        let j = i + 1;
        while (j < lineText.length) {
          if (lineText.charAt(j) === '\\') { j += 2; continue; }
          if (lineText.charAt(j) === quote) { j++; break; }
          j++;
        }
        tokens.push({
          startColumn: i,
          endColumn: j,
          color: theme.tokens.string,
          fontStyle: 'normal',
        });
        i = j;
        continue;
      }

      // Numbers (decimal, hex, binary, octal, floats)
      if ((c >= '0' && c <= '9') || (c === '.' && i + 1 < lineText.length && lineText.charAt(i + 1) >= '0' && lineText.charAt(i + 1) <= '9')) {
        let j = i;
        if (c === '0' && j + 1 < lineText.length) {
          const next = lineText.charAt(j + 1);
          if (next === 'x' || next === 'X') {
            j += 2;
            while (j < lineText.length && /[0-9a-fA-F_]/.test(lineText.charAt(j))) j++;
          } else if (next === 'b' || next === 'B') {
            j += 2;
            while (j < lineText.length && (lineText.charAt(j) === '0' || lineText.charAt(j) === '1' || lineText.charAt(j) === '_')) j++;
          } else if (next === 'o' || next === 'O') {
            j += 2;
            while (j < lineText.length && lineText.charAt(j) >= '0' && lineText.charAt(j) <= '7') j++;
          } else {
            while (j < lineText.length && ((lineText.charAt(j) >= '0' && lineText.charAt(j) <= '9') || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
          }
        } else {
          while (j < lineText.length && ((lineText.charAt(j) >= '0' && lineText.charAt(j) <= '9') || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
        }
        // Numeric suffix (Rust: u32, i64, f64, etc.)
        if (this.languageId === 'rust' && j < lineText.length && (lineText.charAt(j) === 'u' || lineText.charAt(j) === 'i' || lineText.charAt(j) === 'f')) {
          j++;
          while (j < lineText.length && lineText.charAt(j) >= '0' && lineText.charAt(j) <= '9') j++;
        }
        tokens.push({
          startColumn: i,
          endColumn: j,
          color: theme.tokens.number,
          fontStyle: 'normal',
        });
        i = j;
        continue;
      }

      // Words (keywords, types, function names, identifiers)
      if (isWordChar(c)) {
        let j = i;
        while (j < lineText.length && isWordChar(lineText.charAt(j))) j++;
        const word = lineText.slice(i, j);

        // Determine token color
        let color = theme.foreground;
        let fontStyle: 'normal' | 'italic' | 'bold' | 'bold-italic' = 'normal';

        // Look ahead for function call: word followed by `(`
        let afterWord = j;
        while (afterWord < lineText.length && lineText.charAt(afterWord) === ' ') afterWord++;
        const isFunction = afterWord < lineText.length && lineText.charAt(afterWord) === '(';

        if (this.keywords.indexOf(word) >= 0) {
          color = theme.tokens.keyword;
          // Boolean/null literals
          if (word === 'true' || word === 'false' || word === 'True' || word === 'False') {
            color = theme.tokens.bool;
          } else if (word === 'null' || word === 'undefined' || word === 'None') {
            color = theme.tokens.keyword;
          } else if (word === 'self' || word === 'Self' || word === 'this' || word === 'super') {
            color = theme.tokens.keyword;
            fontStyle = 'italic';
          }
        } else if (isFunction) {
          color = theme.tokens.functionName;
        } else if (isUpperCase(word.charAt(0)) && word.length > 1) {
          // Capitalized identifiers are likely type names
          color = theme.tokens.typeName;
        } else {
          // Check if it follows `:` or `<` — likely a type annotation
          let before = i - 1;
          while (before >= 0 && lineText.charAt(before) === ' ') before--;
          if (before >= 0 && (lineText.charAt(before) === ':' || lineText.charAt(before) === '<')) {
            color = theme.tokens.typeName;
          } else {
            color = theme.tokens.variableName;
          }
        }

        tokens.push({
          startColumn: i,
          endColumn: j,
          color,
          fontStyle,
        });
        i = j;
        continue;
      }

      // Operators
      if (OPERATORS.indexOf(c) >= 0) {
        let j = i;
        while (j < lineText.length && OPERATORS.indexOf(lineText.charAt(j)) >= 0) j++;
        tokens.push({
          startColumn: i,
          endColumn: j,
          color: theme.tokens.operator,
          fontStyle: 'normal',
        });
        i = j;
        continue;
      }

      // Punctuation
      if ('{}[]().,;@#'.indexOf(c) >= 0) {
        tokens.push({
          startColumn: i,
          endColumn: i + 1,
          color: theme.tokens.punctuation,
          fontStyle: 'normal',
        });
        i++;
        continue;
      }

      // Whitespace and other characters — foreground
      let j = i;
      while (j < lineText.length &&
             !isWordChar(lineText.charAt(j)) &&
             OPERATORS.indexOf(lineText.charAt(j)) < 0 &&
             '{}[]().,;@#'.indexOf(lineText.charAt(j)) < 0 &&
             lineText.charAt(j) !== '/' &&
             lineText.charAt(j) !== "'" &&
             lineText.charAt(j) !== '"' &&
             lineText.charAt(j) !== '`') {
        j++;
      }
      if (j === i) j = i + 1;
      tokens.push({
        startColumn: i,
        endColumn: j,
        color: theme.foreground,
        fontStyle: 'normal',
      });
      i = j;
    }

    return tokens;
  }

  getFoldRanges(buffer: TextBuffer): FoldRange[] {
    const ranges: FoldRange[] = [];
    const lineCount = buffer.getLineCount();

    // Indent-based fold detection
    for (let i = 0; i < lineCount; i++) {
      const line = buffer.getLine(i);
      const trimmed = line.trimStart();
      if (trimmed.length === 0) continue;

      // Lines ending with `{`, `:`, or `(` start a foldable region
      const lastChar = trimmed.charAt(trimmed.length - 1);
      if (lastChar === '{' || lastChar === ':' || lastChar === '(') {
        const currentIndent = line.length - trimmed.length;
        // Find end of fold: next line at same or lower indent
        let endLine = i;
        for (let j = i + 1; j < lineCount; j++) {
          const nextLine = buffer.getLine(j);
          const nextTrimmed = nextLine.trimStart();
          if (nextTrimmed.length === 0) continue;
          const nextIndent = nextLine.length - nextTrimmed.length;
          if (nextIndent <= currentIndent) {
            endLine = j - 1;
            break;
          }
          endLine = j;
        }
        if (endLine > i) {
          ranges.push({ startLine: i, endLine });
        }
      }
    }

    return ranges;
  }

  findMatchingBracket(buffer: TextBuffer, offset: number): number | null {
    const text = buffer.getText();
    if (offset < 0 || offset >= text.length) return null;

    const ch = text.charAt(offset);
    const pairs: Record<string, string> = {
      '(': ')', ')': '(',
      '[': ']', ']': '[',
      '{': '}', '}': '{',
    };

    const match = pairs[ch];
    if (!match) return null;

    const isOpen = ch === '(' || ch === '[' || ch === '{';

    if (isOpen) {
      // Scan forward
      let depth = 1;
      for (let i = offset + 1; i < text.length; i++) {
        if (text.charAt(i) === ch) depth++;
        else if (text.charAt(i) === match) {
          depth--;
          if (depth === 0) return i;
        }
      }
    } else {
      // Scan backward
      let depth = 1;
      for (let i = offset - 1; i >= 0; i--) {
        if (text.charAt(i) === ch) depth++;
        else if (text.charAt(i) === match) {
          depth--;
          if (depth === 0) return i;
        }
      }
    }

    return null;
  }

  getSupportedLanguages(): string[] {
    return SUPPORTED_LANGUAGES;
  }

  hasLanguage(languageId: string): boolean {
    return LANGUAGE_KEYWORDS[languageId] !== undefined;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isInsideBlockComment(buffer: TextBuffer, lineNumber: number): boolean {
    // Count unclosed `/*` in all lines before this one
    let depth = 0;
    for (let i = 0; i < lineNumber; i++) {
      const line = buffer.getLine(i);
      let j = 0;
      while (j < line.length) {
        if (line.charAt(j) === '/' && j + 1 < line.length && line.charAt(j + 1) === '*') {
          depth++;
          j += 2;
        } else if (line.charAt(j) === '*' && j + 1 < line.length && line.charAt(j + 1) === '/') {
          depth = Math.max(0, depth - 1);
          j += 2;
        } else {
          j++;
        }
      }
    }
    return depth > 0;
  }
}
