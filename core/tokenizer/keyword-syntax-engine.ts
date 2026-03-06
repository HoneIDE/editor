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

// Perry AOT: Object.keys() is not supported in native codegen.
// List languages explicitly instead of deriving from the Record.
const SUPPORTED_LANGUAGES = [
  'typescript', 'javascript', 'python', 'rust', 'html', 'css', 'json', 'markdown', 'c', 'cpp',
  'go', 'java', 'swift', 'shell', 'ruby', 'php', 'yaml', 'toml', 'sql', 'xml',
];

// ---------------------------------------------------------------------------
// Token classification helpers
// ---------------------------------------------------------------------------

// Use indexOf instead of character range comparisons (c >= 'a' && c <= 'z').
// Perry AOT native codegen does NOT support range-based string comparisons;
// indexOf on a module-level constant string is the safe equivalent.
const WORD_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$';
const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DECIMAL_CHARS = '0123456789';
const HEX_CHARS = '0123456789abcdefABCDEF';
const OCTAL_CHARS = '01234567';

function isWordChar(c: string): boolean {
  return WORD_CHARS.indexOf(c) >= 0;
}

function isUpperCase(c: string): boolean {
  return UPPER_CHARS.indexOf(c) >= 0;
}

const OPERATORS = '=+-*/<>!&|?:%~^';

// ---------------------------------------------------------------------------
// KeywordSyntaxEngine
// ---------------------------------------------------------------------------

// Block comment depth cache — precomputed once per parse/render cycle.
// blockCommentDepths[i] = depth of block comment nesting AT THE START of line i.
let blockCommentDepths: number[] = [];
let blockCommentCacheLineCount: number = 0;

function precomputeBlockCommentDepths(buffer: TextBuffer): void {
  const lineCount = buffer.getLineCount();
  blockCommentDepths = [];
  blockCommentCacheLineCount = lineCount;
  let depth = 0;
  for (let i = 0; i < lineCount; i++) {
    blockCommentDepths[i] = depth;
    const line = buffer.getLine(i);
    let j = 0;
    while (j < line.length) {
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
}

export class KeywordSyntaxEngine implements ISyntaxEngine {
  private languageId: string = '';
  private keywords: string[] = [];
  private lineComment: string = '//';
  private parsed: boolean = false;

  setLanguage(languageId: string): void {
    this.languageId = languageId;
    // Explicit if-else instead of Record[variable] lookup — Perry doesn't support
    // dynamic key access on module-level Record constants in AOT native codegen.
    if (languageId === 'typescript' || languageId === 'javascript') {
      this.keywords = TYPESCRIPT_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'python') {
      this.keywords = PYTHON_KEYWORDS;
      this.lineComment = '#';
    } else if (languageId === 'rust') {
      this.keywords = RUST_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'html') {
      this.keywords = HTML_KEYWORDS;
      this.lineComment = '';
    } else if (languageId === 'css') {
      this.keywords = CSS_KEYWORDS;
      this.lineComment = '';
    } else if (languageId === 'json') {
      this.keywords = JSON_KEYWORDS;
      this.lineComment = '';
    } else if (languageId === 'markdown') {
      this.keywords = MARKDOWN_KEYWORDS;
      this.lineComment = '';
    } else if (languageId === 'c' || languageId === 'cpp') {
      this.keywords = RUST_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'go') {
      this.keywords = GO_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'java') {
      this.keywords = JAVA_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'swift') {
      this.keywords = SWIFT_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'shell') {
      this.keywords = SHELL_KEYWORDS;
      this.lineComment = '#';
    } else if (languageId === 'ruby') {
      this.keywords = RUBY_KEYWORDS;
      this.lineComment = '#';
    } else if (languageId === 'php') {
      this.keywords = PHP_KEYWORDS;
      this.lineComment = '//';
    } else if (languageId === 'yaml') {
      this.keywords = YAML_KEYWORDS;
      this.lineComment = '#';
    } else if (languageId === 'toml') {
      this.keywords = TOML_KEYWORDS;
      this.lineComment = '#';
    } else if (languageId === 'sql') {
      this.keywords = SQL_KEYWORDS;
      this.lineComment = '--';
    } else if (languageId === 'xml') {
      this.keywords = XML_KEYWORDS;
      this.lineComment = '';
    } else {
      this.keywords = [];
      this.lineComment = '//';
    }
    this.parsed = false;
  }

  parse(_buffer: TextBuffer, _changedRanges?: { fromOffset: number; toOffset: number }[]): any {
    this.parsed = true;
    // Precompute block comment depth for all lines in O(N)
    if (this.languageId !== 'python') {
      precomputeBlockCommentDepths(_buffer);
    }
    return true;
  }

  getLineTokens(buffer: TextBuffer, lineNumber: number, theme: EditorTheme): LineToken[] {
    if (lineNumber < 0 || lineNumber >= buffer.getLineCount()) return [];

    const lineText = buffer.getLine(lineNumber);
    if (lineText.length === 0) return [];

    const tokens: LineToken[] = [];
    let i = 0;

    // Check if we're inside a block comment using precomputed cache
    let inBlockComment = false;
    if (this.languageId !== 'python') {
      // Ensure cache is populated (may not be if parse() wasn't called)
      if (blockCommentCacheLineCount < 1 || blockCommentCacheLineCount !== buffer.getLineCount()) {
        precomputeBlockCommentDepths(buffer);
      }
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
      // Use indexOf instead of range comparisons — Perry AOT does not support
      // c >= '0' && c <= '9' style checks. indexOf on a constant string is safe.
      if (DECIMAL_CHARS.indexOf(c) >= 0 || (c === '.' && i + 1 < lineText.length && DECIMAL_CHARS.indexOf(lineText.charAt(i + 1)) >= 0)) {
        let j = i;
        if (c === '0' && j + 1 < lineText.length) {
          const next = lineText.charAt(j + 1);
          if (next === 'x' || next === 'X') {
            j += 2;
            while (j < lineText.length && (HEX_CHARS.indexOf(lineText.charAt(j)) >= 0 || lineText.charAt(j) === '_')) j++;
          } else if (next === 'b' || next === 'B') {
            j += 2;
            while (j < lineText.length && (lineText.charAt(j) === '0' || lineText.charAt(j) === '1' || lineText.charAt(j) === '_')) j++;
          } else if (next === 'o' || next === 'O') {
            j += 2;
            while (j < lineText.length && (OCTAL_CHARS.indexOf(lineText.charAt(j)) >= 0 || lineText.charAt(j) === '_')) j++;
          } else {
            while (j < lineText.length && (DECIMAL_CHARS.indexOf(lineText.charAt(j)) >= 0 || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
          }
        } else {
          while (j < lineText.length && (DECIMAL_CHARS.indexOf(lineText.charAt(j)) >= 0 || lineText.charAt(j) === '.' || lineText.charAt(j) === 'e' || lineText.charAt(j) === 'E' || lineText.charAt(j) === '_')) j++;
        }
        // Numeric suffix (Rust: u32, i64, f64, etc.)
        if (this.languageId === 'rust' && j < lineText.length && (lineText.charAt(j) === 'u' || lineText.charAt(j) === 'i' || lineText.charAt(j) === 'f')) {
          j++;
          while (j < lineText.length && DECIMAL_CHARS.indexOf(lineText.charAt(j)) >= 0) j++;
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

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isInsideBlockComment(buffer: TextBuffer, lineNumber: number): boolean {
    // Use precomputed cache (O(1) lookup instead of O(N) scan)
    if (lineNumber < blockCommentCacheLineCount) {
      return blockCommentDepths[lineNumber] > 0;
    }
    // Fallback: recompute if cache is stale
    precomputeBlockCommentDepths(buffer);
    if (lineNumber < blockCommentCacheLineCount) {
      return blockCommentDepths[lineNumber] > 0;
    }
    return false;
  }
}
