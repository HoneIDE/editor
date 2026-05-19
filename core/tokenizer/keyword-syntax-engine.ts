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

const GO_KEYWORDS = [
  'package', 'import', 'func', 'return', 'var', 'const', 'type', 'struct', 'interface',
  'map', 'chan', 'go', 'defer', 'select', 'case', 'default', 'if', 'else', 'for',
  'range', 'switch', 'break', 'continue', 'fallthrough', 'goto', 'true', 'false', 'nil',
  'make', 'new', 'len', 'cap', 'append', 'delete', 'copy', 'panic', 'recover',
];

const JAVA_KEYWORDS = [
  'import', 'package', 'class', 'interface', 'extends', 'implements', 'public', 'private',
  'protected', 'static', 'final', 'abstract', 'void', 'int', 'long', 'double', 'float',
  'boolean', 'char', 'byte', 'short', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'super', 'try', 'catch',
  'finally', 'throw', 'throws', 'instanceof', 'enum', 'assert', 'synchronized', 'volatile',
  'transient', 'native', 'null', 'true', 'false',
];

const SWIFT_KEYWORDS = [
  'import', 'class', 'struct', 'enum', 'protocol', 'extension', 'func', 'var', 'let',
  'return', 'if', 'else', 'guard', 'switch', 'case', 'default', 'for', 'in', 'while',
  'repeat', 'break', 'continue', 'fallthrough', 'do', 'try', 'catch', 'throw', 'throws',
  'rethrows', 'public', 'private', 'internal', 'fileprivate', 'open', 'static', 'override',
  'final', 'mutating', 'nonmutating', 'lazy', 'weak', 'unowned', 'self', 'Self', 'super',
  'nil', 'true', 'false', 'as', 'is', 'init', 'deinit', 'typealias', 'associatedtype',
  'where', 'async', 'await',
];

const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'in',
  'function', 'return', 'local', 'export', 'readonly', 'declare', 'typeset', 'unset', 'shift',
  'exit', 'echo', 'printf', 'read', 'test', 'set', 'source', 'eval', 'exec', 'true', 'false',
  'cd', 'pwd', 'pushd', 'popd',
];

const RUBY_KEYWORDS = [
  'def', 'class', 'module', 'end', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for',
  'do', 'begin', 'rescue', 'ensure', 'raise', 'return', 'yield', 'require', 'require_relative',
  'include', 'extend', 'attr_reader', 'attr_writer', 'attr_accessor', 'self', 'super', 'nil',
  'true', 'false', 'and', 'or', 'not', 'puts', 'print', 'p', 'lambda', 'proc', 'new',
];

const PHP_KEYWORDS = [
  'function', 'class', 'interface', 'trait', 'extends', 'implements', 'public', 'private',
  'protected', 'static', 'abstract', 'final', 'return', 'if', 'else', 'elseif', 'for',
  'foreach', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'match', 'new',
  'echo', 'print', 'var', 'const', 'use', 'namespace', 'try', 'catch', 'finally', 'throw',
  'null', 'true', 'false', 'array', 'list', 'isset', 'unset', 'empty',
];

const YAML_KEYWORDS = ['true', 'false', 'null', 'yes', 'no', 'on', 'off'];

const TOML_KEYWORDS = ['true', 'false'];

const SQL_KEYWORDS = [
  'select', 'SELECT', 'from', 'FROM', 'where', 'WHERE', 'insert', 'INSERT', 'into', 'INTO',
  'values', 'VALUES', 'update', 'UPDATE', 'set', 'SET', 'delete', 'DELETE', 'create', 'CREATE',
  'table', 'TABLE', 'drop', 'DROP', 'alter', 'ALTER', 'index', 'INDEX', 'view', 'VIEW',
  'join', 'JOIN', 'left', 'LEFT', 'right', 'RIGHT', 'inner', 'INNER', 'outer', 'OUTER',
  'on', 'ON', 'as', 'AS', 'and', 'AND', 'or', 'OR', 'not', 'NOT', 'null', 'NULL',
  'is', 'IS', 'in', 'IN', 'between', 'BETWEEN', 'like', 'LIKE', 'order', 'ORDER',
  'by', 'BY', 'group', 'GROUP', 'having', 'HAVING', 'limit', 'LIMIT', 'offset', 'OFFSET',
  'union', 'UNION', 'all', 'ALL', 'distinct', 'DISTINCT', 'count', 'COUNT', 'sum', 'SUM',
  'avg', 'AVG', 'min', 'MIN', 'max', 'MAX', 'exists', 'EXISTS', 'case', 'CASE',
  'when', 'WHEN', 'then', 'THEN', 'else', 'ELSE', 'end', 'END', 'begin', 'BEGIN',
  'commit', 'COMMIT', 'rollback', 'ROLLBACK', 'transaction', 'TRANSACTION',
  'primary', 'PRIMARY', 'key', 'KEY', 'foreign', 'FOREIGN', 'references', 'REFERENCES',
  'constraint', 'CONSTRAINT', 'default', 'DEFAULT', 'true', 'TRUE', 'false', 'FALSE',
];

const XML_KEYWORDS = ['xml', 'xmlns', 'version', 'encoding', 'standalone'];

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
  go: GO_KEYWORDS,
  java: JAVA_KEYWORDS,
  swift: SWIFT_KEYWORDS,
  shell: SHELL_KEYWORDS,
  ruby: RUBY_KEYWORDS,
  php: PHP_KEYWORDS,
  yaml: YAML_KEYWORDS,
  toml: TOML_KEYWORDS,
  sql: SQL_KEYWORDS,
  xml: XML_KEYWORDS,
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
  go: '//',
  java: '//',
  swift: '//',
  shell: '#',
  ruby: '#',
  php: '//',
  yaml: '#',
  toml: '#',
  sql: '--',
  xml: '',
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_KEYWORDS);

// ---------------------------------------------------------------------------
// Token classification helpers
// ---------------------------------------------------------------------------

function isWordChar(c: string): boolean {
  const ch = c.charCodeAt(0);
  return (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90) ||
         (ch >= 48 && ch <= 57) || ch === 95 || ch === 36;
}

function isUpperCase(c: string): boolean {
  const ch = c.charCodeAt(0);
  return ch >= 65 && ch <= 90;
}

function isDecimalChar(c: string): boolean {
  const ch = c.charCodeAt(0);
  return ch >= 48 && ch <= 57;
}

function isHexChar(c: string): boolean {
  const ch = c.charCodeAt(0);
  return (ch >= 48 && ch <= 57) || (ch >= 97 && ch <= 102) || (ch >= 65 && ch <= 70);
}

function isOctalChar(c: string): boolean {
  const ch = c.charCodeAt(0);
  return ch >= 48 && ch <= 55;
}

const OPERATORS = '=+-*/<>!&|?:%~^';

// VS Code-style bracket-pair colorization palette. Hard-coded because the
// theme system's nested-field passing doesn't survive the Perry web codegen
// boundary today (PerryTS/perry#1071); once it lands these can be sourced
// from `theme.tokens.regexp / tagName / atom` to match the macOS path.
const BRACKET_COLORS: string[] = ['#ffd700', '#da70d6', '#179fff'];

// Build a string where charCodeAt(i) === bracket nesting depth at the start of
// line i. Mirrors `buildBlockDepthString` shape so cache invalidation logic
// matches. Skips brackets inside strings and line comments.
function buildBracketDepthString(buffer: TextBuffer): string {
  let result = '';
  let depth = 0;
  const lineCount = buffer.getLineCount();
  for (let i = 0; i < lineCount; i++) {
    result += String.fromCharCode(depth);
    const line = buffer.getLine(i);
    let j = 0;
    while (j < line.length) {
      const ch = line.charAt(j);
      // Skip strings — Perry doesn't support regex, so scan char-by-char.
      if (ch === "'" || ch === '"' || ch === '`') {
        const q = ch;
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '\\') { j = j + 2; continue; }
          if (line.charAt(j) === q) { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      // Skip line comments (// only — // is fine for TS/JS/Rust/C/etc.).
      if (ch === '/' && j + 1 < line.length && line.charAt(j + 1) === '/') {
        break;
      }
      if (ch === '{' || ch === '[' || ch === '(') depth = depth + 1;
      else if (ch === '}' || ch === ']' || ch === ')') {
        if (depth > 0) depth = depth - 1;
      }
      j = j + 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// KeywordSyntaxEngine
// ---------------------------------------------------------------------------

// Build a string where charCodeAt(i) = block comment depth at start of line i.
function buildBlockDepthString(buffer: TextBuffer): string {
  let result = '';
  let depth = 0;
  const lineCount = buffer.getLineCount();
  for (let i = 0; i < lineCount; i++) {
    result += String.fromCharCode(depth);
    const line = buffer.getLine(i);
    let j = 0;
    while (j < line.length) {
      if (line.charAt(j) === "'") {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '\\') { j = j + 2; continue; }
          if (line.charAt(j) === "'") { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (line.charAt(j) === '"') {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '\\') { j = j + 2; continue; }
          if (line.charAt(j) === '"') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (line.charAt(j) === '`') {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '`') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (line.charAt(j) === '/' && j + 1 < line.length && line.charAt(j + 1) === '/') {
        break;
      }
      if (line.charAt(j) === '/' && j + 1 < line.length && line.charAt(j + 1) === '*') {
        depth = depth + 1;
        j = j + 2;
      } else if (line.charAt(j) === '*' && j + 1 < line.length && line.charAt(j + 1) === '/') {
        if (depth > 0) depth = depth - 1;
        j = j + 2;
      } else {
        j = j + 1;
      }
    }
  }
  return result;
}

// Fallback: compute block comment depth without cache (used if cache is stale).
function computeBlockCommentDepthAtLine(buffer: TextBuffer, targetLine: number): number {
  let depth = 0;
  for (let i = 0; i < targetLine; i++) {
    const line = buffer.getLine(i);
    let j = 0;
    while (j < line.length) {
      // Skip string literals so that /* or */ inside strings don't confuse depth.
      // Perry AOT can't compare charAt(j) to a variable — handle each quote
      // type separately with literal comparisons.
      if (line.charAt(j) === "'") {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '\\') { j = j + 2; continue; }
          if (line.charAt(j) === "'") { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (line.charAt(j) === '"') {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '\\') { j = j + 2; continue; }
          if (line.charAt(j) === '"') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (line.charAt(j) === '`') {
        j = j + 1;
        while (j < line.length) {
          if (line.charAt(j) === '`') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      // Also skip line comments — they can contain /* or */ as text
      if (line.charAt(j) === '/' && j + 1 < line.length && line.charAt(j + 1) === '/') {
        break; // rest of line is a comment, skip
      }
      if (line.charAt(j) === '/' && j + 1 < line.length && line.charAt(j + 1) === '*') {
        depth = depth + 1;
        j = j + 2;
      } else if (line.charAt(j) === '*' && j + 1 < line.length && line.charAt(j + 1) === '/') {
        if (depth > 0) depth = depth - 1;
        j = j + 2;
      } else {
        j = j + 1;
      }
    }
  }
  return depth;
}

export class KeywordSyntaxEngine implements ISyntaxEngine {
  private languageId: string = '';
  private keywords: string[] = [];
  private lineComment: string = '//';
  private parsed: boolean = false;
  _isMarkdown: number = 0;
  // Block comment depth cache: each char's code = depth at start of that line.
  private _blockDepthCache: string = '';
  private _blockDepthLineCount: number = 0;
  // Bracket depth at the start of each line (charCodeAt(i) === depth at line i).
  // Used to pick a cycling color for bracket-pair colorization that's stable
  // across lines (`{` on line 5 keeps the same color as its matching `}` on
  // line 10). Built by parse().
  private _bracketDepthCache: string = '';

  setLanguage(languageId: string): void {
    this.languageId = languageId;
    this._isMarkdown = languageId === 'markdown' ? 1 : 0;
    this.keywords = LANGUAGE_KEYWORDS[languageId] ?? [];
    this.lineComment = LANGUAGE_LINE_COMMENTS[languageId] ?? '//';
    this.parsed = false;
  }

  parse(_buffer: TextBuffer, _changedRanges?: { fromOffset: number; toOffset: number }[]): any {
    this.parsed = true;
    // Build block comment depth cache.
    if (this.languageId !== 'python') {
      this._blockDepthCache = buildBlockDepthString(_buffer);
      this._blockDepthLineCount = _buffer.getLineCount();
    }
    // Build bracket-pair depth cache (independent of comments — strings and
    // comments are skipped here so brackets inside them don't affect depth).
    this._bracketDepthCache = buildBracketDepthString(_buffer);
    // Rebuild markdown fence cache on re-parse
    if (this._isMarkdown === 1) {
      this._mdFenceLineCount = 0;
      this._mdFenceCache = '';
      this.buildMarkdownFenceCache(_buffer);
    }
    return true;
  }

  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[] {
    if (lineNumber < 0 || lineNumber >= buffer.getLineCount()) return [];

    const lineText = buffer.getLine(lineNumber);
    if (lineText.length === 0) return [];

    // Markdown gets its own tokenizer — headers, bold, italic, links, code, etc.
    if (this._isMarkdown === 1) {
      const inFence = this.isInsideMarkdownFence(buffer, lineNumber);
      return tokenizeMarkdownLine(lineText, theme, inFence);
    }

    const tokens: LineToken[] = [];
    let i = 0;

    // Bracket-pair colorization: depth at the START of this line is looked up
    // from the cache built by parse(). Depth is then mutated locally as we
    // emit bracket tokens. Don't write back — getLineTokens is per-line.
    let bracketDepth = 0;
    const bdCache = this._bracketDepthCache;
    if (bdCache.length > 0 && lineNumber < bdCache.length) {
      bracketDepth = bdCache.charCodeAt(lineNumber);
    }

    // Check if we're inside a block comment (computed on demand per line)
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

      // Strings (single, double, backtick).
      // Perry codegen can't compare charAt result to a variable (only literals),
      // so each quote type is handled separately with literal comparisons.
      if (c === "'") {
        let j = i + 1;
        while (j < lineText.length) {
          if (lineText.charAt(j) === '\\') { j += 2; continue; }
          if (lineText.charAt(j) === "'") { j++; break; }
          j++;
        }
        tokens.push({ startColumn: i, endColumn: j, color: theme.tokens.string, fontStyle: 'normal' });
        i = j;
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < lineText.length) {
          if (lineText.charAt(j) === '\\') { j += 2; continue; }
          if (lineText.charAt(j) === '"') { j++; break; }
          j++;
        }
        tokens.push({ startColumn: i, endColumn: j, color: theme.tokens.string, fontStyle: 'normal' });
        i = j;
        continue;
      }
      if (c === '`') {
        let j = i + 1;
        while (j < lineText.length) {
          if (lineText.charAt(j) === '`') { j++; break; }
          j++;
        }
        tokens.push({ startColumn: i, endColumn: j, color: theme.tokens.string, fontStyle: 'normal' });
        i = j;
        continue;
      }

      // Numbers (decimal, hex, binary, octal, floats).
      if (isDecimalChar(c) || (c === '.' && i + 1 < lineText.length && isDecimalChar(lineText.charAt(i + 1)))) {
        let j = i;
        if (c === '0' && j + 1 < lineText.length) {
          const next = lineText.charAt(j + 1);
          if (next === 'x' || next === 'X') {
            j += 2;
            while (j < lineText.length && (isHexChar(lineText.charAt(j)) || lineText.charAt(j) === '_')) j++;
          } else if (next === 'b' || next === 'B') {
            j += 2;
            while (j < lineText.length && (lineText.charAt(j) === '0' || lineText.charAt(j) === '1' || lineText.charAt(j) === '_')) j++;
          } else if (next === 'o' || next === 'O') {
            j += 2;
            while (j < lineText.length && (isOctalChar(lineText.charAt(j)) || lineText.charAt(j) === '_')) j++;
          } else {
            while (j < lineText.length && (isDecimalChar(lineText.charAt(j)) || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
          }
        } else {
          while (j < lineText.length && (isDecimalChar(lineText.charAt(j)) || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
        }
        // Numeric suffix (Rust: u32, i64, f64, etc.)
        if (this.languageId === 'rust' && j < lineText.length && (lineText.charAt(j) === 'u' || lineText.charAt(j) === 'i' || lineText.charAt(j) === 'f')) {
          j++;
          while (j < lineText.length && isDecimalChar(lineText.charAt(j))) j++;
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

        // Explicit loop instead of this.keywords.indexOf — Perry doesn't dispatch
        // Array methods correctly on class-field arrays in AOT native codegen.
        let isKeyword = false;
        const kws = this.keywords;
        for (let ki = 0; ki < kws.length; ki++) {
          if (kws[ki] === word) { isKeyword = true; break; }
        }
        // For plain-text-like languages, skip code-style word classification
        const langId = this.languageId;
        const isPlainText = langId === 'markdown' || langId === 'yaml' || langId === 'toml' || langId === 'xml';

        if (isKeyword) {
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
        } else if (isPlainText) {
          color = theme.foreground;
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

        // Use explicit key:value — Perry doesn't support ES6 shorthand {color, fontStyle}
        // which captures the initial variable value instead of the reassigned one.
        tokens.push({
          startColumn: i,
          endColumn: j,
          color: color,
          fontStyle: fontStyle,
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

      // Punctuation — brackets cycle through three colors based on nesting depth
      // (bracket-pair colorization). Non-bracket punctuation uses theme color.
      if ('{}[]().,;@#'.indexOf(c) >= 0) {
        const isOpen = c === '{' || c === '[' || c === '(';
        const isClose = c === '}' || c === ']' || c === ')';
        let color: string = theme.tokens.punctuation;
        if (isOpen || isClose) {
          if (isClose) bracketDepth = Math.max(0, bracketDepth - 1);
          color = BRACKET_COLORS[bracketDepth % BRACKET_COLORS.length];
          if (isOpen) bracketDepth++;
        }
        tokens.push({
          startColumn: i,
          endColumn: i + 1,
          color: color,
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
          // Perry AOT: { startLine: i, endLine } shorthand captures initial value.
          ranges.push({ startLine: i, endLine: endLine });
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
    // Perry AOT: LANGUAGE_KEYWORDS[languageId] dynamic key access is broken.
    // Use the explicit list instead.
    for (let i = 0; i < SUPPORTED_LANGUAGES.length; i++) {
      if (SUPPORTED_LANGUAGES[i] === languageId) return true;
    }
    return false;
  }

  // Track whether we're inside a fenced code block for markdown
  _mdFenceLineCount = 0;
  _mdFenceCache = '';

  /** Build a string where charCode at lineN = 1 if inside code fence, 0 if not. */
  buildMarkdownFenceCache(buffer: TextBuffer): void {
    const lineCount = buffer.getLineCount();
    if (lineCount === this._mdFenceLineCount && this._mdFenceCache.length > 0) return;
    let result = '';
    let inFence = false;
    for (let i = 0; i < lineCount; i++) {
      if (inFence) {
        result += String.fromCharCode(1);
      } else {
        result += String.fromCharCode(0);
      }
      const line = buffer.getLine(i);
      const trimmed = line.trimStart();
      if (trimmed.length >= 3 && trimmed.charAt(0) === '`' && trimmed.charAt(1) === '`' && trimmed.charAt(2) === '`') {
        inFence = !inFence;
      }
    }
    this._mdFenceCache = result;
    this._mdFenceLineCount = lineCount;
  }

  isInsideMarkdownFence(buffer: TextBuffer, lineNumber: number): boolean {
    this.buildMarkdownFenceCache(buffer);
    if (lineNumber < this._mdFenceCache.length) {
      return this._mdFenceCache.charCodeAt(lineNumber) > 0;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isInsideBlockComment(buffer: TextBuffer, lineNumber: number): boolean {
    // Use string cache (O(1) lookup) if available and line count matches
    const cache = this._blockDepthCache;
    if (cache.length > 0 && this._blockDepthLineCount === buffer.getLineCount() && lineNumber < cache.length) {
      return cache.charCodeAt(lineNumber) > 0;
    }
    // Fallback: recompute inline (O(N) scan)
    return computeBlockCommentDepthAtLine(buffer, lineNumber) > 0;
  }
}

// ---------------------------------------------------------------------------
// Markdown tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a single markdown line. Perry-safe: no regex, no optional chaining,
 * no shorthand objects, no for...of, no dynamic key access.
 */
function tokenizeMarkdownLine(line: string, theme: EditorTheme, inFence: boolean): LineToken[] {
  const tokens: LineToken[] = [];
  const len = line.length;

  // Code block background color — noticeably lighter than editor background (#1e1e1e)
  const codeBg = '#282830';

  // Inside a fenced code block — color entire line as string (code) + background
  if (inFence) {
    // Sentinel token for line background (startColumn=-1 signals background color)
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    // Check if this line is the closing fence
    const trimmed = line.trimStart();
    if (trimmed.length >= 3 && trimmed.charAt(0) === '`' && trimmed.charAt(1) === '`' && trimmed.charAt(2) === '`') {
      tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.meta, fontStyle: 'normal' });
    } else {
      tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.string, fontStyle: 'normal' });
    }
    return tokens;
  }

  // Code fence opening (``` or ```lang)
  const trimmed = line.trimStart();
  if (trimmed.length >= 3 && trimmed.charAt(0) === '`' && trimmed.charAt(1) === '`' && trimmed.charAt(2) === '`') {
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.meta, fontStyle: 'normal' });
    return tokens;
  }

  // Heading: lines starting with # (up to 6)
  if (len > 0 && trimmed.charAt(0) === '#') {
    let level = 0;
    let hi = 0;
    while (hi < trimmed.length && trimmed.charAt(hi) === '#' && level < 6) {
      level++;
      hi++;
    }
    if (hi < trimmed.length && trimmed.charAt(hi) === ' ') {
      // h1/h2 → large heading, h3+ → medium heading
      const headingStyle = level <= 2 ? 'heading-lg' : 'heading-md';
      tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.heading, fontStyle: headingStyle });
      return tokens;
    }
  }

  // Horizontal rule: --- or *** or ___ (3+ of same char, optionally with spaces)
  if (len >= 3) {
    let hrChar = '';
    if (trimmed.charAt(0) === '-') hrChar = '-';
    if (trimmed.charAt(0) === '*') hrChar = '*';
    if (trimmed.charAt(0) === '_') hrChar = '_';
    if (hrChar.length > 0) {
      let allMatch = true;
      for (let hi = 0; hi < trimmed.length; hi++) {
        const hc = trimmed.charAt(hi);
        if (hc !== hrChar && hc !== ' ') { allMatch = false; break; }
      }
      let charCount = 0;
      for (let hi = 0; hi < trimmed.length; hi++) {
        if (trimmed.charAt(hi) === hrChar) charCount++;
      }
      if (allMatch && charCount >= 3) {
        tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.punctuation, fontStyle: 'normal' });
        return tokens;
      }
    }
  }

  // Blockquote: lines starting with >
  if (trimmed.length > 0 && trimmed.charAt(0) === '>') {
    tokens.push({ startColumn: 0, endColumn: len, color: theme.tokens.comment, fontStyle: 'italic' });
    return tokens;
  }

  // Inline tokenization for remaining lines (including list items)
  let i = 0;

  // List bullet prefix: "- ", "* ", "+ ", or "1. " etc.
  if (trimmed.length >= 2) {
    const fc = trimmed.charAt(0);
    if ((fc === '-' || fc === '*' || fc === '+') && trimmed.charAt(1) === ' ') {
      const indent = len - trimmed.length;
      tokens.push({ startColumn: indent, endColumn: indent + 1, color: theme.tokens.punctuation, fontStyle: 'normal' });
      i = indent + 2;
    } else if (isDecimalChar(fc)) {
      // Numbered list: digits followed by . and space
      let ni = 0;
      while (ni < trimmed.length && isDecimalChar(trimmed.charAt(ni))) ni++;
      if (ni < trimmed.length && trimmed.charAt(ni) === '.' && ni + 1 < trimmed.length && trimmed.charAt(ni + 1) === ' ') {
        const indent = len - trimmed.length;
        tokens.push({ startColumn: indent, endColumn: indent + ni + 1, color: theme.tokens.punctuation, fontStyle: 'normal' });
        i = indent + ni + 2;
      }
    }
  }

  // Scan inline elements
  while (i < len) {
    const c = line.charAt(i);

    // Inline code: `...`
    if (c === '`') {
      let j = i + 1;
      while (j < len && line.charAt(j) !== '`') j++;
      if (j < len) {
        j++; // include closing backtick
        tokens.push({ startColumn: i, endColumn: j, color: theme.tokens.string, fontStyle: 'normal' });
        i = j;
        continue;
      }
    }

    // Bold: **...** or __...__
    if (c === '*' && i + 1 < len && line.charAt(i + 1) === '*') {
      let j = i + 2;
      let found = false;
      while (j + 1 < len) {
        if (line.charAt(j) === '*' && line.charAt(j + 1) === '*') {
          found = true;
          break;
        }
        j++;
      }
      if (found) {
        tokens.push({ startColumn: i, endColumn: j + 2, color: theme.foreground, fontStyle: 'bold' });
        i = j + 2;
        continue;
      }
    }
    if (c === '_' && i + 1 < len && line.charAt(i + 1) === '_') {
      let j = i + 2;
      let found = false;
      while (j + 1 < len) {
        if (line.charAt(j) === '_' && line.charAt(j + 1) === '_') {
          found = true;
          break;
        }
        j++;
      }
      if (found) {
        tokens.push({ startColumn: i, endColumn: j + 2, color: theme.foreground, fontStyle: 'bold' });
        i = j + 2;
        continue;
      }
    }

    // Italic: *...* or _..._  (single, not double)
    if (c === '*' && (i + 1 >= len || line.charAt(i + 1) !== '*')) {
      let j = i + 1;
      while (j < len && line.charAt(j) !== '*') j++;
      if (j < len) {
        tokens.push({ startColumn: i, endColumn: j + 1, color: theme.foreground, fontStyle: 'italic' });
        i = j + 1;
        continue;
      }
    }
    if (c === '_' && (i + 1 >= len || line.charAt(i + 1) !== '_')) {
      // Only treat as italic if not in the middle of a word
      const prevIsWord = i > 0 && isWordChar(line.charAt(i - 1));
      if (!prevIsWord) {
        let j = i + 1;
        while (j < len && line.charAt(j) !== '_') j++;
        if (j < len) {
          tokens.push({ startColumn: i, endColumn: j + 1, color: theme.foreground, fontStyle: 'italic' });
          i = j + 1;
          continue;
        }
      }
    }

    // Link: [text](url)
    if (c === '[') {
      let j = i + 1;
      while (j < len && line.charAt(j) !== ']') j++;
      if (j < len && j + 1 < len && line.charAt(j + 1) === '(') {
        let k = j + 2;
        while (k < len && line.charAt(k) !== ')') k++;
        if (k < len) {
          // [text] in link color
          tokens.push({ startColumn: i, endColumn: j + 1, color: theme.tokens.link, fontStyle: 'normal' });
          // (url) in comment/dim color
          tokens.push({ startColumn: j + 1, endColumn: k + 1, color: theme.tokens.comment, fontStyle: 'normal' });
          i = k + 1;
          continue;
        }
      }
    }

    // Image: ![alt](url)
    if (c === '!' && i + 1 < len && line.charAt(i + 1) === '[') {
      let j = i + 2;
      while (j < len && line.charAt(j) !== ']') j++;
      if (j < len && j + 1 < len && line.charAt(j + 1) === '(') {
        let k = j + 2;
        while (k < len && line.charAt(k) !== ')') k++;
        if (k < len) {
          tokens.push({ startColumn: i, endColumn: j + 1, color: theme.tokens.link, fontStyle: 'normal' });
          tokens.push({ startColumn: j + 1, endColumn: k + 1, color: theme.tokens.comment, fontStyle: 'normal' });
          i = k + 1;
          continue;
        }
      }
    }

    i++;
  }

  return tokens;
}

/**
 * Perry-safe standalone tokenization function.
 * Bypasses ISyntaxEngine vtable dispatch which fails after first call in Perry AOT.
 * Accepts the engine as a plain parameter — Perry handles free function calls correctly.
 */
/**
 * Perry-safe standalone tokenization.
 * Reads engine state directly (no vtable dispatch).
 * For markdown: calls tokenizeMarkdownLine (free function).
 * For other languages: calls engine.getLineTokens (method — only works on first frame in Perry).
 */
export function getLineTokensDirect(
  engine: KeywordSyntaxEngine,
  buffer: TextBuffer,
  lineNumber: number,
  theme: EditorTheme,
): LineToken[] {
  if (lineNumber < 0 || lineNumber >= buffer.getLineCount()) return [];
  const lineText = buffer.getLine(lineNumber);
  if (lineText.length === 0) return [];
  // Markdown: use free function directly (bypass method dispatch)
  if (engine._isMarkdown === 1) {
    const inFence = engine.isInsideMarkdownFence(buffer, lineNumber);
    return tokenizeMarkdownLine(lineText, theme, inFence);
  }
  // Other languages: call engine method (may fail after first frame in Perry)
  return engine.getLineTokens(buffer, lineNumber, theme);
}

/**
 * Perry-safe markdown tokenization that doesn't require the engine.
 * Exported for direct use in EditorViewModel when engine method calls fail.
 */
/**
 * Perry-safe fence check: reads engine's _mdFenceCache directly (no method call).
 */
export function isInsideMarkdownFenceDirect(
  engine: KeywordSyntaxEngine,
  lineNumber: number,
): boolean {
  if (lineNumber < engine._mdFenceCache.length) {
    return engine._mdFenceCache.charCodeAt(lineNumber) > 0;
  }
  return false;
}

export function tokenizeMarkdownLineDirect(
  lineText: string,
  theme: EditorTheme,
  inFence: boolean,
): LineToken[] {
  return tokenizeMarkdownLine(lineText, theme, inFence);
}
