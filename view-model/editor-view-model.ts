/**
 * Main ViewModel: bridges core state to rendering state.
 *
 * The EditorViewModel connects all core subsystems and exposes
 * state for the rendering layer. In Perry, these would be State() bindings
 * that trigger native re-renders. For now, we use plain properties
 * with a change notification pattern.
 */

import { TextBuffer, TextEdit } from '../core/buffer/text-buffer';
import { EditorDocument } from '../core/document/document';
import { CursorManager, CursorState } from '../core/cursor/cursor-manager';
import { SelectionRange } from '../core/cursor/selection';
import { UndoManager } from '../core/history/undo-manager';
import { ViewportManager } from '../core/viewport/viewport-manager';
import { CommandRegistry, CommandContext } from '../core/commands/registry';
import { registerEditingCommands } from '../core/commands/editing';
import { registerNavigationCommands } from '../core/commands/navigation';
import { registerSelectionCommands } from '../core/commands/selection-cmds';
import { getWordAtColumn } from '../core/cursor/word-boundary';
import { registerClipboardCommands } from '../core/commands/clipboard';
import { registerMulticursorCommands } from '../core/commands/multicursor';
import type { ISyntaxEngine } from '../core/tokenizer/tokenizer-interface';
import { getLineTokensDirect } from '../core/tokenizer/keyword-syntax-engine';

// Module-level variables for direct tokenization state.
let _perryLangIsMarkdown: number = 0;
let _perryFenceCache: string = '';
let _perryUseDirectTokens: number = 0;

// ---------------------------------------------------------------------------
// Perry-safe cursor position (module-level, readable from any context).
// Updated by all Perry-safe command handlers. Read by _syncCursor in
// editor-component.ts via exported getter.
// ---------------------------------------------------------------------------
let _perryCursorLine = 0;
let _perryCursorCol = 0;
let _perryAnchorLine = -1;  // -1 = no selection
let _perryAnchorCol = 0;
let _perryClipboard = '';  // Module-level clipboard (Perry can't read class fields reliably)

export function getPerryCursorState(): { line: number; col: number; anchorLine: number; anchorCol: number } {
  return { line: _perryCursorLine, col: _perryCursorCol, anchorLine: _perryAnchorLine, anchorCol: _perryAnchorCol };
}

export function getPerryClipboard(): string {
  return _perryClipboard;
}

export function setPerryCursorPos(line: number, col: number): void {
  _perryCursorLine = line;
  _perryCursorCol = col;
  _perryAnchorLine = line;
  _perryAnchorCol = col;
}

// ---------------------------------------------------------------------------
// Perry-safe snapshot undo/redo (module-level, no class-field arrays).
// Each entry stores: full buffer text, cursor line, cursor column.
// Coalescing: single-char edits within 500ms share one snapshot.
// ---------------------------------------------------------------------------
let _undoTexts: string[] = [];
let _undoLines: number[] = [];
let _undoCols: number[] = [];
let _undoCount = 0;
let _lastUndoTime = 0;
let _lastUndoWasSingleChar = 0;

let _redoTexts: string[] = [];
let _redoLines: number[] = [];
let _redoCols: number[] = [];
let _redoCount = 0;

function _pushUndoSnapshot(text: string, line: number, col: number, isSingleChar: number, isNewline: number): void {
  const now = Date.now();
  const shouldCoalesce = isSingleChar === 1 && isNewline === 0 &&
                          _lastUndoWasSingleChar === 1 &&
                          _undoCount > 0 &&
                          (now - _lastUndoTime) < 500;
  _lastUndoTime = now;
  _lastUndoWasSingleChar = isSingleChar;

  if (shouldCoalesce) {
    // Don't push — previous snapshot is still the correct "before" state.
    return;
  }
  // New undo group
  _undoTexts[_undoCount] = text;
  _undoLines[_undoCount] = line;
  _undoCols[_undoCount] = col;
  _undoCount = _undoCount + 1;
  // Clear redo stack on new edit
  _redoCount = 0;
}

// Perry-safe: module-level theme colors for tokenization.
// Dark mode defaults (VS Code dark theme).
let _tKwColor = '#569cd6';
let _tStrColor = '#ce9178';
let _tCmtColor = '#6a9955';
let _tVarColor = '#9cdcfe';
let _tTypeColor = '#4ec9b0';
let _tFnColor = '#dcdcaa';
let _tNumColor = '#b5cea8';
let _tOpColor = '#d4d4d4';
let _tFgColor = '#d4d4d4';
let _tBoolColor = '#569cd6';
let _tCodeBg = '#282830';
let _tHeadingColor = '#4fc1ff';
let _tBoldColor = '#d7ba7d';
let _tMetaColor = '#569cd6';

/** Switch tokenizer colors between dark and light mode. mode=0 dark, mode=1 light. */
export function setPerryTokenTheme(mode: number): void {
  if (mode === 1) {
    // Light theme colors (VS Code Light+)
    _tKwColor = '#0000FF';
    _tStrColor = '#A31515';
    _tCmtColor = '#008000';
    _tVarColor = '#001080';
    _tTypeColor = '#267F99';
    _tFnColor = '#795E26';
    _tNumColor = '#098658';
    _tOpColor = '#000000';
    _tFgColor = '#333333';
    _tBoolColor = '#0000FF';
    _tCodeBg = '#F0F0F0';
    _tHeadingColor = '#0070C1';
    _tBoldColor = '#795E26';
    _tMetaColor = '#0000FF';
  } else {
    // Dark theme colors (VS Code dark)
    _tKwColor = '#569cd6';
    _tStrColor = '#ce9178';
    _tCmtColor = '#6a9955';
    _tVarColor = '#9cdcfe';
    _tTypeColor = '#4ec9b0';
    _tFnColor = '#dcdcaa';
    _tNumColor = '#b5cea8';
    _tOpColor = '#d4d4d4';
    _tFgColor = '#d4d4d4';
    _tBoolColor = '#569cd6';
    _tCodeBg = '#282830';
    _tHeadingColor = '#4fc1ff';
    _tBoldColor = '#d7ba7d';
    _tMetaColor = '#569cd6';
  }
}

// Perry-safe: module-level keyword/comment state for non-markdown tokenization.
// Keywords stored as delimited STRING (not array) — Perry module-level array
// reassignment doesn't work reliably. Use indexOf('|word|') for lookup.
let _perryKeywordStr: string = '';
let _perryLineComment: string = '//';
let _perryLangId: string = '';

export function setPerryMarkdownState(isMarkdown: number, fenceCache: string): void {
  _perryLangIsMarkdown = isMarkdown;
  _perryFenceCache = fenceCache;
}

export function setPerryDirectTokens(enabled: number): void {
  _perryUseDirectTokens = enabled;
}

// Keyword strings — delimited with | for indexOf lookup.
// Perry can't handle module-level array reassignment or array iteration in getters.
// String indexOf('|word|') is Perry-safe.
const _KWS_TS = '|import|export|from|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|implements|interface|type|enum|namespace|module|declare|abstract|readonly|public|private|protected|static|async|await|try|catch|finally|throw|typeof|instanceof|in|of|as|is|keyof|void|null|undefined|true|false|default|yield|super|delete|';
const _KWS_PY = '|import|from|def|class|return|if|elif|else|for|while|break|continue|pass|raise|try|except|finally|with|as|lambda|yield|global|nonlocal|assert|del|in|not|and|or|is|True|False|None|async|await|print|self|';
const _KWS_RS = '|fn|let|mut|const|static|struct|enum|impl|trait|pub|use|mod|crate|super|self|Self|where|if|else|match|loop|while|for|in|break|continue|return|as|ref|move|type|unsafe|extern|async|await|dyn|true|false|';
const _KWS_GO = '|package|import|func|return|var|const|type|struct|interface|map|chan|go|defer|select|case|default|if|else|for|range|switch|break|continue|fallthrough|goto|true|false|nil|make|new|len|cap|append|delete|copy|panic|recover|';
const _KWS_JAVA = '|import|package|class|interface|extends|implements|public|private|protected|static|final|abstract|void|int|long|double|float|boolean|char|byte|short|return|if|else|for|while|do|switch|case|break|continue|default|new|this|super|try|catch|finally|throw|throws|instanceof|enum|assert|synchronized|volatile|transient|native|null|true|false|';
const _KWS_SWIFT = '|import|class|struct|enum|protocol|extension|func|var|let|return|if|else|guard|switch|case|default|for|in|while|repeat|break|continue|fallthrough|do|try|catch|throw|throws|rethrows|public|private|internal|fileprivate|open|static|override|final|mutating|nonmutating|lazy|weak|unowned|self|Self|super|nil|true|false|as|is|init|deinit|typealias|associatedtype|where|async|await|';
const _KWS_SHELL = '|if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|local|export|readonly|declare|typeset|unset|shift|exit|echo|printf|read|test|set|source|eval|exec|true|false|cd|pwd|pushd|popd|';
const _KWS_RUBY = '|def|class|module|end|if|elsif|else|unless|while|until|for|do|begin|rescue|ensure|raise|return|yield|require|require_relative|include|extend|attr_reader|attr_writer|attr_accessor|self|super|nil|true|false|and|or|not|puts|print|p|lambda|proc|new|';
const _KWS_PHP = '|function|class|interface|trait|extends|implements|public|private|protected|static|abstract|final|return|if|else|elseif|for|foreach|while|do|switch|case|break|continue|default|match|new|echo|print|var|const|use|namespace|try|catch|finally|throw|null|true|false|array|list|isset|unset|empty|';
const _KWS_JSON = '|true|false|null|';
const _KWS_YAML = '|true|false|null|yes|no|on|off|';
const _KWS_TOML = '|true|false|';
const _KWS_HTML = '|doctype|html|head|body|div|span|script|style|link|meta|';
const _KWS_CSS = '|import|media|keyframes|font-face|supports|charset|';
const _KWS_XML = '|xml|xmlns|version|encoding|standalone|';
const _KWS_SQL = '|select|SELECT|from|FROM|where|WHERE|insert|INSERT|into|INTO|update|UPDATE|set|SET|delete|DELETE|create|CREATE|table|TABLE|drop|DROP|alter|ALTER|join|JOIN|left|LEFT|right|RIGHT|inner|INNER|outer|OUTER|on|ON|as|AS|and|AND|or|OR|not|NOT|null|NULL|is|IS|in|IN|order|ORDER|by|BY|group|GROUP|having|HAVING|limit|LIMIT|values|VALUES|true|TRUE|false|FALSE|begin|BEGIN|end|END|';

/** Set module-level language state for Perry-safe code tokenization. */
export function setPerryLanguageState(langId: string): void {
  _perryLangId = langId;
  // Perry AOT: explicit if-else, not Record[variable].
  // Assign keyword STRING (not array) — Perry can't reassign module-level arrays.
  if (langId === 'typescript' || langId === 'javascript') {
    _perryKeywordStr = _KWS_TS; _perryLineComment = '//';
  } else if (langId === 'python') {
    _perryKeywordStr = _KWS_PY; _perryLineComment = '#';
  } else if (langId === 'rust' || langId === 'c' || langId === 'cpp') {
    _perryKeywordStr = _KWS_RS; _perryLineComment = '//';
  } else if (langId === 'go') {
    _perryKeywordStr = _KWS_GO; _perryLineComment = '//';
  } else if (langId === 'java') {
    _perryKeywordStr = _KWS_JAVA; _perryLineComment = '//';
  } else if (langId === 'swift') {
    _perryKeywordStr = _KWS_SWIFT; _perryLineComment = '//';
  } else if (langId === 'shell') {
    _perryKeywordStr = _KWS_SHELL; _perryLineComment = '#';
  } else if (langId === 'ruby') {
    _perryKeywordStr = _KWS_RUBY; _perryLineComment = '#';
  } else if (langId === 'php') {
    _perryKeywordStr = _KWS_PHP; _perryLineComment = '//';
  } else if (langId === 'json') {
    _perryKeywordStr = _KWS_JSON; _perryLineComment = '';
  } else if (langId === 'yaml') {
    _perryKeywordStr = _KWS_YAML; _perryLineComment = '#';
  } else if (langId === 'toml') {
    _perryKeywordStr = _KWS_TOML; _perryLineComment = '#';
  } else if (langId === 'html') {
    _perryKeywordStr = _KWS_HTML; _perryLineComment = '';
  } else if (langId === 'css') {
    _perryKeywordStr = _KWS_CSS; _perryLineComment = '';
  } else if (langId === 'xml') {
    _perryKeywordStr = _KWS_XML; _perryLineComment = '';
  } else if (langId === 'sql') {
    _perryKeywordStr = _KWS_SQL; _perryLineComment = '--';
  } else {
    _perryKeywordStr = ''; _perryLineComment = '//';
  }
}

/**
 * Module-level markdown tokenizer. Must be in the SAME file as the getter
 * that calls it — Perry AOT silently drops cross-module function calls from getters.
 * Uses hardcoded VS Code dark theme colors (no theme parameter needed).
 */
function _tokenizeMdLine(line: string, inFence: number): LineToken[] {
  const tokens: LineToken[] = [];
  const len = line.length;
  if (len === 0) return tokens;

  const codeBg = _tCodeBg;
  const headingColor = _tHeadingColor;
  const stringColor = _tStrColor;
  const metaColor = _tMetaColor;
  const boldColor = _tBoldColor;
  const fgColor = _tFgColor;

  // Trim leading whitespace for detection
  let trimStart = 0;
  while (trimStart < len && (line.charCodeAt(trimStart) === 32 || line.charCodeAt(trimStart) === 9)) {
    trimStart++;
  }

  // Code fence (```)
  if (len - trimStart >= 3 && line.charAt(trimStart) === '`' && line.charAt(trimStart + 1) === '`' && line.charAt(trimStart + 2) === '`') {
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    tokens.push({ startColumn: 0, endColumn: len, color: metaColor, fontStyle: 'normal' });
    return tokens;
  }

  // Inside a fenced code block
  if (inFence === 1) {
    tokens.push({ startColumn: -1, endColumn: -1, color: codeBg, fontStyle: 'normal' });
    tokens.push({ startColumn: 0, endColumn: len, color: stringColor, fontStyle: 'normal' });
    return tokens;
  }

  // Heading: starts with # followed by space
  if (line.charAt(trimStart) === '#') {
    let level = 0;
    let hi = trimStart;
    while (hi < len && line.charAt(hi) === '#' && level < 6) {
      level++;
      hi++;
    }
    if (hi < len && line.charCodeAt(hi) === 32) {
      const headingStyle = level <= 2 ? 'heading-lg' : 'heading-md';
      tokens.push({ startColumn: 0, endColumn: len, color: headingColor, fontStyle: headingStyle });
      return tokens;
    }
  }

  // Horizontal rule: --- or *** or ___
  if (len - trimStart >= 3) {
    const hrC = line.charCodeAt(trimStart);
    if (hrC === 45 || hrC === 42 || hrC === 95) { // - * _
      let allMatch = true;
      for (let i = trimStart; i < len; i++) {
        const c = line.charCodeAt(i);
        if (c !== hrC && c !== 32) { allMatch = false; break; }
      }
      if (allMatch) {
        tokens.push({ startColumn: 0, endColumn: len, color: metaColor, fontStyle: 'normal' });
        return tokens;
      }
    }
  }

  // Blockquote: > prefix
  if (line.charAt(trimStart) === '>') {
    tokens.push({ startColumn: 0, endColumn: len, color: stringColor, fontStyle: 'italic' });
    return tokens;
  }

  // List item: - or * or + or 1.
  if (trimStart < len) {
    const lc = line.charCodeAt(trimStart);
    if (lc === 45 || lc === 42 || lc === 43) { // - * +
      if (trimStart + 1 < len && line.charCodeAt(trimStart + 1) === 32) {
        // Bullet point — just color the bullet, rest is normal
        tokens.push({ startColumn: 0, endColumn: trimStart + 2, color: metaColor, fontStyle: 'normal' });
        if (trimStart + 2 < len) {
          tokens.push({ startColumn: trimStart + 2, endColumn: len, color: fgColor, fontStyle: 'normal' });
        }
        return tokens;
      }
    }
  }

  // Inline formatting: scan for **, *, `, []()
  let pos = 0;
  let lastEnd = 0;
  while (pos < len) {
    const ch = line.charCodeAt(pos);

    // Inline code: `...`
    if (ch === 96) { // backtick
      let end = pos + 1;
      while (end < len && line.charCodeAt(end) !== 96) end++;
      if (end < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 1, color: stringColor, fontStyle: 'normal' });
        lastEnd = end + 1;
        pos = end + 1;
        continue;
      }
    }

    // Bold: **...**
    if (ch === 42 && pos + 1 < len && line.charCodeAt(pos + 1) === 42) {
      let end = pos + 2;
      while (end + 1 < len) {
        if (line.charCodeAt(end) === 42 && line.charCodeAt(end + 1) === 42) break;
        end++;
      }
      if (end + 1 < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 2, color: boldColor, fontStyle: 'bold' });
        lastEnd = end + 2;
        pos = end + 2;
        continue;
      }
    }

    // Italic: *...*  (single asterisk, not followed by another)
    if (ch === 42 && (pos + 1 >= len || line.charCodeAt(pos + 1) !== 42)) {
      let end = pos + 1;
      while (end < len && line.charCodeAt(end) !== 42) end++;
      if (end < len) {
        if (pos > lastEnd) {
          tokens.push({ startColumn: lastEnd, endColumn: pos, color: fgColor, fontStyle: 'normal' });
        }
        tokens.push({ startColumn: pos, endColumn: end + 1, color: fgColor, fontStyle: 'italic' });
        lastEnd = end + 1;
        pos = end + 1;
        continue;
      }
    }

    pos++;
  }

  // Remaining text
  if (lastEnd < len) {
    tokens.push({ startColumn: lastEnd, endColumn: len, color: fgColor, fontStyle: 'normal' });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Perry-safe inline keyword tokenizer for non-markdown languages.
// Must be in the SAME file as the visibleLines getter (Perry AOT drops
// cross-module function calls from getters).
// ---------------------------------------------------------------------------

const _WORD_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$';
const _UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const _DIGIT_CHARS = '0123456789';
const _HEX_CHARS = '0123456789abcdefABCDEF';
const _OPERATORS = '=+-*/<>!&|?:%~^';

function _tokenizeCodeLine(line: string, inBlockComment: number): LineToken[] {
  const tokens: LineToken[] = [];
  const len = line.length;
  if (len === 0) return tokens;

  // Theme-aware colors from module-level vars (set by setPerryTokenTheme)
  const kwColor = _tKwColor;
  const strColor = _tStrColor;
  const cmtColor = _tCmtColor;
  const varColor = _tVarColor;
  const typeColor = _tTypeColor;
  const fnColor = _tFnColor;
  const numColor = _tNumColor;
  const opColor = _tOpColor;
  const puncColor = _tOpColor;
  const boolColor = _tBoolColor;
  const fgColor = _tFgColor;

  let i = 0;
  const kwStr = _perryKeywordStr;
  const lcmt = _perryLineComment;

  // If we're inside a block comment from a previous line
  if (inBlockComment === 1) {
    const endIdx = line.indexOf('*/');
    if (endIdx >= 0) {
      tokens.push({ startColumn: 0, endColumn: endIdx + 2, color: cmtColor, fontStyle: 'italic' });
      i = endIdx + 2;
    } else {
      tokens.push({ startColumn: 0, endColumn: len, color: cmtColor, fontStyle: 'italic' });
      return tokens;
    }
  }

  while (i < len) {
    const c = line.charAt(i);

    // Line comment
    if (lcmt.length > 0 && i + lcmt.length <= len) {
      let match = true;
      for (let ci = 0; ci < lcmt.length; ci++) {
        if (line.charAt(i + ci) !== lcmt.charAt(ci)) { match = false; break; }
      }
      if (match) {
        tokens.push({ startColumn: i, endColumn: len, color: cmtColor, fontStyle: 'italic' });
        return tokens;
      }
    }

    // Block comment start
    if (c === '/' && i + 1 < len && line.charAt(i + 1) === '*') {
      const endIdx = line.indexOf('*/', i + 2);
      if (endIdx >= 0) {
        tokens.push({ startColumn: i, endColumn: endIdx + 2, color: cmtColor, fontStyle: 'italic' });
        i = endIdx + 2;
        continue;
      } else {
        tokens.push({ startColumn: i, endColumn: len, color: cmtColor, fontStyle: 'italic' });
        return tokens;
      }
    }

    // Python # comment
    if (_perryLangId === 'python' && c === '#') {
      tokens.push({ startColumn: i, endColumn: len, color: cmtColor, fontStyle: 'italic' });
      return tokens;
    }

    // Strings: single quote
    if (c === "'") {
      let j = i + 1;
      while (j < len) {
        if (line.charAt(j) === '\\') { j = j + 2; continue; }
        if (line.charAt(j) === "'") { j = j + 1; break; }
        j = j + 1;
      }
      tokens.push({ startColumn: i, endColumn: j, color: strColor, fontStyle: 'normal' });
      i = j;
      continue;
    }
    // Strings: double quote
    if (c === '"') {
      let j = i + 1;
      while (j < len) {
        if (line.charAt(j) === '\\') { j = j + 2; continue; }
        if (line.charAt(j) === '"') { j = j + 1; break; }
        j = j + 1;
      }
      tokens.push({ startColumn: i, endColumn: j, color: strColor, fontStyle: 'normal' });
      i = j;
      continue;
    }
    // Strings: backtick
    if (c === '`') {
      let j = i + 1;
      while (j < len) {
        if (line.charAt(j) === '`') { j = j + 1; break; }
        j = j + 1;
      }
      tokens.push({ startColumn: i, endColumn: j, color: strColor, fontStyle: 'normal' });
      i = j;
      continue;
    }

    // Numbers
    if (_DIGIT_CHARS.indexOf(c) >= 0 || (c === '.' && i + 1 < len && _DIGIT_CHARS.indexOf(line.charAt(i + 1)) >= 0)) {
      let j = i;
      if (c === '0' && j + 1 < len) {
        const next = line.charAt(j + 1);
        if (next === 'x' || next === 'X') {
          j = j + 2;
          while (j < len && (_HEX_CHARS.indexOf(line.charAt(j)) >= 0 || line.charAt(j) === '_')) j = j + 1;
        } else if (next === 'b' || next === 'B') {
          j = j + 2;
          while (j < len && (line.charAt(j) === '0' || line.charAt(j) === '1' || line.charAt(j) === '_')) j = j + 1;
        } else {
          while (j < len && (_DIGIT_CHARS.indexOf(line.charAt(j)) >= 0 || line.charAt(j) === '.' || line.charAt(j) === 'e' || line.charAt(j) === 'E' || line.charAt(j) === '_')) j = j + 1;
        }
      } else {
        while (j < len && (_DIGIT_CHARS.indexOf(line.charAt(j)) >= 0 || line.charAt(j) === '.' || line.charAt(j) === 'e' || line.charAt(j) === 'E' || line.charAt(j) === '_')) j = j + 1;
      }
      tokens.push({ startColumn: i, endColumn: j, color: numColor, fontStyle: 'normal' });
      i = j;
      continue;
    }

    // Words (keywords, types, functions, identifiers)
    if (_WORD_CHARS.indexOf(c) >= 0) {
      let j = i;
      while (j < len && _WORD_CHARS.indexOf(line.charAt(j)) >= 0) j = j + 1;
      const word = line.slice(i, j);

      let color = fgColor;
      let fontStyle: 'normal' | 'italic' | 'bold' | 'bold-italic' = 'normal';

      // Look ahead for function call: word(
      let afterWord = j;
      while (afterWord < len && line.charAt(afterWord) === ' ') afterWord = afterWord + 1;
      const isFunc = afterWord < len && line.charAt(afterWord) === '(';

      // Check keyword via string indexOf (Perry-safe: no array iteration)
      // kwStr is '|import|export|...|' — search for '|word|'
      // Use += (not +) — Perry string + is broken, += works.
      let needle = '|';
      needle += word;
      needle += '|';
      const isKw = kwStr.indexOf(needle) >= 0;

      if (isKw) {
        color = kwColor;
        if (word === 'true' || word === 'false' || word === 'True' || word === 'False') {
          color = boolColor;
        } else if (word === 'self' || word === 'Self' || word === 'this' || word === 'super') {
          color = kwColor;
          fontStyle = 'italic';
        }
      } else if (isFunc) {
        color = fnColor;
      } else if (_UPPER_CHARS.indexOf(word.charAt(0)) >= 0 && word.length > 1) {
        color = typeColor;
      } else {
        // Check if after : or < (type annotation)
        let before = i - 1;
        while (before >= 0 && line.charAt(before) === ' ') before = before - 1;
        if (before >= 0 && (line.charAt(before) === ':' || line.charAt(before) === '<')) {
          color = typeColor;
        } else {
          color = varColor;
        }
      }

      tokens.push({ startColumn: i, endColumn: j, color: color, fontStyle: fontStyle });
      i = j;
      continue;
    }

    // Operators
    if (_OPERATORS.indexOf(c) >= 0) {
      let j = i;
      while (j < len && _OPERATORS.indexOf(line.charAt(j)) >= 0) j = j + 1;
      tokens.push({ startColumn: i, endColumn: j, color: opColor, fontStyle: 'normal' });
      i = j;
      continue;
    }

    // Punctuation
    if ('{}[]().,;@#'.indexOf(c) >= 0) {
      tokens.push({ startColumn: i, endColumn: i + 1, color: puncColor, fontStyle: 'normal' });
      i = i + 1;
      continue;
    }

    // Whitespace and other
    let j = i;
    while (j < len &&
           !_WORD_CHARS.indexOf(line.charAt(j)) >= 0 &&
           _OPERATORS.indexOf(line.charAt(j)) < 0 &&
           '{}[]().,;@#'.indexOf(line.charAt(j)) < 0 &&
           line.charAt(j) !== '/' &&
           line.charAt(j) !== "'" &&
           line.charAt(j) !== '"' &&
           line.charAt(j) !== '`') {
      j = j + 1;
    }
    if (j === i) j = i + 1;
    tokens.push({ startColumn: i, endColumn: j, color: fgColor, fontStyle: 'normal' });
    i = j;
  }

  return tokens;
}

/**
 * Compute block comment state for visible lines (Perry-safe: no cross-module calls).
 * Returns 1 if lineNumber starts inside a block comment, 0 otherwise.
 */
function _computeBlockCommentState(buf: TextBuffer, targetLine: number): number {
  if (_perryLangId === 'python') return 0;
  let depth = 0;
  for (let i = 0; i < targetLine; i++) {
    const ln = buf.getLine(i);
    let j = 0;
    while (j < ln.length) {
      if (ln.charAt(j) === "'") {
        j = j + 1;
        while (j < ln.length) {
          if (ln.charAt(j) === '\\') { j = j + 2; continue; }
          if (ln.charAt(j) === "'") { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (ln.charAt(j) === '"') {
        j = j + 1;
        while (j < ln.length) {
          if (ln.charAt(j) === '\\') { j = j + 2; continue; }
          if (ln.charAt(j) === '"') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (ln.charAt(j) === '`') {
        j = j + 1;
        while (j < ln.length) {
          if (ln.charAt(j) === '`') { j = j + 1; break; }
          j = j + 1;
        }
        continue;
      }
      if (ln.charAt(j) === '/' && j + 1 < ln.length && ln.charAt(j + 1) === '/') break;
      if (ln.charAt(j) === '/' && j + 1 < ln.length && ln.charAt(j + 1) === '*') {
        depth = depth + 1; j = j + 2;
      } else if (ln.charAt(j) === '*' && j + 1 < ln.length && ln.charAt(j + 1) === '/') {
        if (depth > 0) depth = depth - 1; j = j + 2;
      } else {
        j = j + 1;
      }
    }
  }
  return depth > 0 ? 1 : 0;
}

import { IncrementalTokenCache } from '../core/tokenizer/incremental';
import { FoldState } from '../core/folding/fold-state';
import { CursorBlinkController, CursorRenderState } from './cursor-state';
import { GutterRenderer } from './gutter';
import { FindWidgetController } from './find-widget';
import { GhostTextController } from './ghost-text';
import { OverlayManager } from './overlays';
import { DiffViewModel } from './diff-view-model';
import { RenderedLine, computeRenderedLines, LineToken, LineDecoration } from './line-layout';
import { searchDecorations } from './decorations';
import { EditorTheme, DARK_THEME } from './theme';

/** No-op syntax engine for backward compatibility when none is provided. */
const NO_OP_SYNTAX_ENGINE: ISyntaxEngine = {
  setLanguage() {},
  parse() { return null; },
  getLineTokens() { return []; },
  getFoldRanges() { return []; },
  findMatchingBracket() { return null; },
  getSupportedLanguages() { return []; },
  hasLanguage() { return false; },
};

export interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface KeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface MouseEvent {
  x: number;
  y: number;
  button: number;
  clickCount: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ScrollEvent {
  deltaX: number;
  deltaY: number;
}

type ChangeListener = () => void;

export class EditorViewModel {
  // Core subsystems
  readonly document: EditorDocument;
  readonly cursorManager: CursorManager;
  readonly viewport: ViewportManager;
  readonly undoManager: UndoManager;
  readonly commandRegistry: CommandRegistry;

  // Phase 1 subsystems
  readonly syntaxEngine: ISyntaxEngine;
  readonly tokenCache: IncrementalTokenCache;
  readonly foldState: FoldState;
  readonly findWidget: FindWidgetController;
  readonly ghostText: GhostTextController;
  readonly overlays: OverlayManager;
  readonly diffView: DiffViewModel;

  // Rendering state
  private _cursorBlink: CursorBlinkController;
  private _gutter: GutterRenderer;
  private _theme: EditorTheme;
  private _charWidth: number = 8; // default, updated by native renderer
  private _perryMode: boolean = false; // set true to use Perry-safe command handlers
  private _clipboardText: string = ''; // internal clipboard for Perry-safe copy/paste
  private _listener: ChangeListener | null = null;

  // Token/decoration providers (set by syntax engine)
  private _tokenProvider: ((lineNumber: number) => LineToken[]) | null = null;
  private _decorationProvider: ((lineNumber: number) => LineDecoration[]) | null = null;
  private _foldStateProvider: ((lineNumber: number) => 'expanded' | 'collapsed' | 'none') | null = null;

  // Direct tokenization mode: when set to 1, visibleLines inlines tokenization.
  private _useDirectTokens: number = 0;
  _langIsMarkdown: number = 0;
  _fenceCache: string = '';

  constructor(doc: EditorDocument, theme?: EditorTheme, syntaxEngine?: ISyntaxEngine) {
    this.document = doc;
    this._theme = theme ?? DARK_THEME;

    this.cursorManager = new CursorManager(doc.buffer);
    this.viewport = new ViewportManager();
    this.undoManager = new UndoManager(doc.buffer);
    this.commandRegistry = new CommandRegistry();

    this.syntaxEngine = syntaxEngine ?? NO_OP_SYNTAX_ENGINE;
    this.tokenCache = new IncrementalTokenCache(this.syntaxEngine);
    this.foldState = new FoldState();
    this.findWidget = new FindWidgetController();
    this.ghostText = new GhostTextController();
    this.overlays = new OverlayManager();
    this.diffView = new DiffViewModel();

    this._cursorBlink = new CursorBlinkController();
    this._gutter = new GutterRenderer();

    // Register all command groups
    registerEditingCommands(this.commandRegistry);
    registerNavigationCommands(this.commandRegistry);
    registerSelectionCommands(this.commandRegistry);
    registerClipboardCommands(this.commandRegistry);
    registerMulticursorCommands(this.commandRegistry);

    // Sync viewport with buffer
    this.viewport.setTotalLines(doc.buffer.getLineCount());

    // Set viewport line height from theme
    const lineHeightPx = this._theme.fontSize * this._theme.lineHeight;
    this.viewport.lineHeightCache.setBaseLineHeight(lineHeightPx);

    // Set page size for cursor
    this.cursorManager.setPageSize(this.viewport.getLinesPerPage());

    // Wire syntax engine to document language
    if (doc.languageId && this.syntaxEngine.hasLanguage(doc.languageId)) {
      this.syntaxEngine.setLanguage(doc.languageId);
      this.syntaxEngine.parse(doc.buffer);
      this.updateFoldRanges();
    }

    // Wire token provider from syntax engine (bypasses IncrementalTokenCache).
    this._tokenProvider = (lineNumber: number) => {
      return this.syntaxEngine.getLineTokens(doc.buffer, lineNumber, this._theme);
    };

    // Wire fold state provider
    this._foldStateProvider = (lineNumber: number) => {
      return this.foldState.getFoldState(lineNumber);
    };

    // Wire hidden lines from fold state into viewport
    this.viewport.setHiddenLines(this.foldState.getHiddenLines());
  }

  get theme(): EditorTheme {
    return this._theme;
  }

  setTheme(theme: EditorTheme): void {
    this._theme = theme;
    const lineHeightPx = theme.fontSize * theme.lineHeight;
    this.viewport.lineHeightCache.setBaseLineHeight(lineHeightPx);
    this.notifyChange();
  }

  setCharWidth(width: number): void {
    this._charWidth = width;
    this._gutter.setCharWidth(width);
  }

  getCharWidth(): number {
    return this._charWidth;
  }

  getClipboardText(): string {
    return this._clipboardText;
  }

  /** Enable Perry-safe command handlers (avoids destructuring, .map(), spread). */
  setPerryMode(enabled: boolean): void {
    this._perryMode = enabled;
  }

  /** Enable direct tokenization (bypass _tokenProvider closure for Perry). */
  setDirectTokens(enabled: number): void {
    this._useDirectTokens = enabled;
    // Also set module-level flag — this is called from within the same module's
    // class method, which CAN update module-level state (unlike cross-module calls).
    _perryUseDirectTokens = enabled;
  }

  /** Perry-safe: set markdown flag directly (avoids engine property access). */
  setMarkdownMode(isMarkdown: number): void {
    this._langIsMarkdown = isMarkdown;
  }

  /** Perry-safe: set fence cache string directly (avoids engine property access). */
  setFenceCache(cache: string): void {
    this._fenceCache = cache;
  }

  /** Direct tokenization for a single line (Perry-safe: bypasses ISyntaxEngine vtable). */
  tokenizeLine(lineNum: number): LineToken[] {
    return getLineTokensDirect(
      this.syntaxEngine as any, this.document.buffer, lineNum, this._theme,
    );
  }

  setTokenProvider(provider: (lineNumber: number) => LineToken[]): void {
    this._tokenProvider = provider;
  }

  /**
   * Re-create the _tokenProvider closure so Perry captures the CURRENT
   * syntax engine state (language, keywords, lineComment). Must be called
   * after engine.setLanguage() because Perry closures capture by value —
   * the constructor-time closure holds stale engine state.
   */
  refreshTokenProvider(): void {
    const engine = this.syntaxEngine;
    const buf = this.document.buffer;
    const theme = this._theme;
    this._tokenProvider = (lineNumber: number) => {
      return engine.getLineTokens(buf, lineNumber, theme);
    };
  }

  setDecorationProvider(provider: (lineNumber: number) => LineDecoration[]): void {
    this._decorationProvider = provider;
  }

  setFoldStateProvider(provider: (lineNumber: number) => 'expanded' | 'collapsed' | 'none'): void {
    this._foldStateProvider = provider;
  }

  /** Subscribe to state changes. */
  onChange(listener: ChangeListener): () => void {
    this._listener = listener;
    return () => { this._listener = null; };
  }

  private notifyChange(): void {
    if (this._listener !== null && this._listener !== undefined) {
      this._listener();
    }
  }

  /**
   * Notify all change listeners without modifying any state.
   * Call this after external buffer modifications (e.g. setContent) to ensure
   * onChange subscribers and the render coordinator are updated.
   */
  touch(): void {
    this.notifyChange();
  }

  // === Computed State ===

  get visibleLines(): RenderedLine[] {
    // Only send visible viewport lines to Rust (not the entire file).
    // Rust clears frame_lines on begin_frame and only needs lines that
    // will actually be drawn. Sending ALL lines was O(N) per frame which
    // made scrolling laggy on files with hundreds of lines.
    const visRange = this.viewport.getVisibleRange();

    const lineNumbers: number[] = [];
    for (let i = visRange.startLine; i < visRange.endLine; i++) {
      lineNumbers.push(i);
    }

    // Direct tokenization path: inline tokenization using module-level functions.
    if (_perryUseDirectTokens === 1) {
      const result: RenderedLine[] = [];
      const buf = this.document.buffer;
      const firstLine = lineNumbers.length > 0 ? lineNumbers[0] : 0;

      if (_perryLangIsMarkdown === 1) {
        // Markdown path: compute fence state up to the first visible line
        let fenceState = 0;
        for (let fl = 0; fl < firstLine; fl++) {
          const ftext = buf.getLine(fl);
          let fts = 0;
          while (fts < ftext.length && (ftext.charCodeAt(fts) === 32 || ftext.charCodeAt(fts) === 9)) fts++;
          if (ftext.length - fts >= 3 && ftext.charAt(fts) === '`' && ftext.charAt(fts + 1) === '`' && ftext.charAt(fts + 2) === '`') {
            fenceState = fenceState === 0 ? 1 : 0;
          }
        }
        for (let li = 0; li < lineNumbers.length; li++) {
          const lineNum = lineNumbers[li];
          const content = buf.getLine(lineNum);
          let tokens: LineToken[] = [];
          let lineBg = '';
          if (content.length > 0) {
            const mdTokens = _tokenizeMdLine(content, fenceState);
            if (mdTokens.length > 0) {
              for (let ti = 0; ti < mdTokens.length; ti++) {
                if (mdTokens[ti].startColumn === -1) {
                  lineBg = mdTokens[ti].color;
                } else {
                  tokens.push(mdTokens[ti]);
                }
              }
            }
          }
          // Update fence state for next line
          if (content.length > 0) {
            let fts2 = 0;
            while (fts2 < content.length && (content.charCodeAt(fts2) === 32 || content.charCodeAt(fts2) === 9)) fts2++;
            if (content.length - fts2 >= 3 && content.charAt(fts2) === '`' && content.charAt(fts2 + 1) === '`' && content.charAt(fts2 + 2) === '`') {
              fenceState = fenceState === 0 ? 1 : 0;
            }
          }
          if (tokens.length === 0 && content.length > 0) {
            tokens = [{
              startColumn: 0, endColumn: content.length,
              color: this._theme.foreground, fontStyle: 'normal',
            }];
          }
          const gutterItems = this._gutter.getGutterItems(lineNum, 'none', false, null, null);
          const line: RenderedLine = {
            lineNumber: lineNum, content: content, tokens: tokens,
            decorations: [], foldState: 'none', gutterItems: gutterItems, lineBg: lineBg,
          };
          result.push(line);
        }
      } else {
        // Code path: compute block comment state, then tokenize with keywords
        let blockState = _computeBlockCommentState(buf, firstLine);
        for (let li = 0; li < lineNumbers.length; li++) {
          const lineNum = lineNumbers[li];
          const content = buf.getLine(lineNum);
          let tokens: LineToken[] = [];
          if (content.length > 0) {
            tokens = _tokenizeCodeLine(content, blockState);
            // Update block comment state for next line
            let d = blockState;
            let j = 0;
            while (j < content.length) {
              if (content.charAt(j) === "'") { j = j + 1; while (j < content.length) { if (content.charAt(j) === '\\') { j = j + 2; continue; } if (content.charAt(j) === "'") { j = j + 1; break; } j = j + 1; } continue; }
              if (content.charAt(j) === '"') { j = j + 1; while (j < content.length) { if (content.charAt(j) === '\\') { j = j + 2; continue; } if (content.charAt(j) === '"') { j = j + 1; break; } j = j + 1; } continue; }
              if (content.charAt(j) === '`') { j = j + 1; while (j < content.length) { if (content.charAt(j) === '`') { j = j + 1; break; } j = j + 1; } continue; }
              if (content.charAt(j) === '/' && j + 1 < content.length && content.charAt(j + 1) === '/') break;
              if (content.charAt(j) === '/' && j + 1 < content.length && content.charAt(j + 1) === '*') { d = d + 1; j = j + 2; }
              else if (content.charAt(j) === '*' && j + 1 < content.length && content.charAt(j + 1) === '/') { if (d > 0) d = d - 1; j = j + 2; }
              else { j = j + 1; }
            }
            blockState = d > 0 ? 1 : 0;
          } else {
            tokens = [];
          }
          if (tokens.length === 0 && content.length > 0) {
            tokens = [{
              startColumn: 0, endColumn: content.length,
              color: this._theme.foreground, fontStyle: 'normal',
            }];
          }
          const gutterItems = this._gutter.getGutterItems(lineNum, 'none', false, null, null);
          const line: RenderedLine = {
            lineNumber: lineNum, content: content, tokens: tokens,
            decorations: [], foldState: 'none', gutterItems: gutterItems, lineBg: '',
          };
          result.push(line);
        }
      }
      return result;
    }

    return computeRenderedLines(
      this.document.buffer,
      lineNumbers,
      this._gutter,
      this._tokenProvider,
    );
  }

  get cursors(): readonly CursorState[] {
    return this.cursorManager.cursors;
  }

  get selections(): SelectionRange[] {
    return this.cursorManager.getSelections();
  }

  get scrollState(): ScrollState {
    return {
      scrollTop: this.viewport.scroll.scrollTop,
      scrollLeft: this.viewport.scroll.scrollLeft,
      scrollHeight: this.viewport.lineHeightCache.getTotalHeight(),
      scrollWidth: 0, // TODO: compute from longest line
      viewportHeight: this.viewport.heightPx,
      viewportWidth: this.viewport.widthPx,
    };
  }

  get gutterWidth(): number {
    return this._gutter.computeGutterWidth(this.document.buffer.getLineCount());
  }

  get cursorRenderState(): CursorRenderState {
    return this._cursorBlink.renderState;
  }

  // === Event Handlers ===

  /** Execute a command by ID. */
  executeCommand(commandId: string, args?: any): boolean {
    // Handle Phase 1 commands directly
    switch (commandId) {
      case 'editor.action.find':
        this.findWidget.open(this.document.buffer);
        this.notifyChange();
        return true;
      case 'editor.action.replace':
        this.findWidget.open(this.document.buffer);
        this.findWidget.toggleReplace();
        this.notifyChange();
        return true;
      case 'editor.action.findNext':
        this.findWidget.nextMatch();
        this.notifyChange();
        return true;
      case 'editor.action.findPrev':
        this.findWidget.prevMatch();
        this.notifyChange();
        return true;
      case 'editor.action.escape':
        if (this.findWidget.state.isOpen) {
          this.findWidget.close();
        }
        this.overlays.hideAll();
        this.ghostText.dismiss();
        this.notifyChange();
        return true;
      case 'editor.action.fold': {
        const primary = this.cursorManager.primary;
        this.foldState.fold(primary.line);
        this.viewport.setHiddenLines(this.foldState.getHiddenLines());
        this.notifyChange();
        return true;
      }
      case 'editor.action.unfold': {
        const primary = this.cursorManager.primary;
        this.foldState.unfold(primary.line);
        this.viewport.setHiddenLines(this.foldState.getHiddenLines());
        this.notifyChange();
        return true;
      }
      case 'editor.action.acceptGhostText': {
        const text = this.ghostText.accept();
        if (text) {
          this.executeCommand('editor.action.type', { text });
        }
        return true;
      }
    }

    // Perry-safe command handlers: run BEFORE the command registry because
    // registered handlers use destructuring, .map(), spread, for...of — all
    // broken in Perry AOT. These use only Perry-safe patterns.
    // Only active when setPerryMode(true) has been called.
    if (this._perryMode) {

    const cursors0 = this.cursorManager.cursors;
    if (cursors0.length === 0) return false;
    const cursor0 = cursors0[0];

    // Perry-safe undo/redo using module-level snapshot stacks.
    if (commandId === 'editor.action.undo') {
      if (_undoCount <= 0) return true;
      _undoCount = _undoCount - 1;
      // Save current state for redo
      _redoTexts[_redoCount] = this.document.buffer.getText();
      _redoLines[_redoCount] = cursor0.line;
      _redoCols[_redoCount] = cursor0.column;
      _redoCount = _redoCount + 1;
      // Restore buffer from snapshot
      const buf = this.document.buffer;
      const len = buf.getLength();
      if (len > 0) { buf.delete(0, len); }
      buf.insert(0, _undoTexts[_undoCount]);
      cursor0.line = _undoLines[_undoCount];
      cursor0.column = _undoCols[_undoCount];
      cursor0.desiredColumn = cursor0.column;
      cursor0.selectionAnchor = null;
      // Reset coalescing so next edit starts a new group
      _lastUndoWasSingleChar = 0;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.redo') {
      if (_redoCount <= 0) return true;
      _redoCount = _redoCount - 1;
      // Save current state for undo (no coalescing for redo-then-edit)
      _undoTexts[_undoCount] = this.document.buffer.getText();
      _undoLines[_undoCount] = cursor0.line;
      _undoCols[_undoCount] = cursor0.column;
      _undoCount = _undoCount + 1;
      // Restore buffer from redo snapshot
      const buf = this.document.buffer;
      const len = buf.getLength();
      if (len > 0) { buf.delete(0, len); }
      buf.insert(0, _redoTexts[_redoCount]);
      cursor0.line = _redoLines[_redoCount];
      cursor0.column = _redoCols[_redoCount];
      cursor0.desiredColumn = cursor0.column;
      cursor0.selectionAnchor = null;
      _lastUndoWasSingleChar = 0;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.type') {
      const text = args !== null && args !== undefined ? args.text : '';
      if (text === null || text === undefined || text.length === 0) return false;

      // Record undo snapshot before edit
      const isSingle = text.length === 1 ? 1 : 0;
      const isNl = text === '\n' ? 1 : 0;
      _pushUndoSnapshot(this.document.buffer.getText(), cursor0.line, cursor0.column, isSingle, isNl);

      const lineContent = this.document.buffer.getLine(cursor0.line);
      const lineOffset = this.document.buffer.getLineOffset(cursor0.line);
      const ch = text.charAt(0);

      // Auto-bracket: single character handling
      if (text.length === 1) {
        // Over-type check: if typing a closing bracket/quote and next char matches, skip insert
        const nextChar = cursor0.column < lineContent.length ? lineContent.charAt(cursor0.column) : '';
        if (ch === ')' || ch === '}' || ch === ']' || ch === '"' || ch === "'" || ch === '`') {
          if (nextChar === ch) {
            cursor0.column = cursor0.column + 1;
            cursor0.desiredColumn = cursor0.column;
            cursor0.selectionAnchor = null;
            this.notifyChange();
            return true;
          }
        }

        // Auto-close: opening bracket → insert pair, cursor between
        let closeChar = '';
        if (ch === '(') closeChar = ')';
        else if (ch === '{') closeChar = '}';
        else if (ch === '[') closeChar = ']';
        else if (ch === '"') closeChar = '"';
        else if (ch === "'") closeChar = "'";
        else if (ch === '`') closeChar = '`';

        if (closeChar.length > 0) {
          // For quotes, don't auto-close if adjacent to word char
          let shouldClose = true;
          if (ch === '"' || ch === "'" || ch === '`') {
            if (cursor0.column < lineContent.length) {
              const nc = lineContent.charCodeAt(cursor0.column);
              if ((nc >= 97 && nc <= 122) || (nc >= 65 && nc <= 90) || (nc >= 48 && nc <= 57) || nc === 95) {
                shouldClose = false;
              }
            }
            if (cursor0.column > 0) {
              const pc = lineContent.charCodeAt(cursor0.column - 1);
              if ((pc >= 97 && pc <= 122) || (pc >= 65 && pc <= 90) || (pc >= 48 && pc <= 57) || pc === 95) {
                shouldClose = false;
              }
            }
          }
          if (shouldClose) {
            let pair = '';
            pair += ch;
            pair += closeChar;
            this.document.buffer.insert(lineOffset + cursor0.column, pair);
            cursor0.column = cursor0.column + 1;
            cursor0.desiredColumn = cursor0.column;
            cursor0.selectionAnchor = null;
            this.afterEdit();
            return true;
          }
        }
      }

      // Plain insert (no auto-bracket)
      this.document.buffer.insert(lineOffset + cursor0.column, text);
      cursor0.column = cursor0.column + text.length;
      cursor0.desiredColumn = cursor0.column;
      cursor0.selectionAnchor = null;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.insertLineAfter') {
      _pushUndoSnapshot(this.document.buffer.getText(), cursor0.line, cursor0.column, 0, 1);
      const currentLine = this.document.buffer.getLine(cursor0.line);
      // Get leading whitespace (Perry-safe: no regex)
      let indentEnd = 0;
      for (let wi = 0; wi < currentLine.length; wi++) {
        const wc = currentLine.charAt(wi);
        if (wc === ' ' || wc === '\t') {
          indentEnd = wi + 1;
        } else {
          break;
        }
      }
      const indent = currentLine.substring(0, indentEnd);

      // Check char before and after cursor for smart indent
      const charBefore = cursor0.column > 0 ? currentLine.charAt(cursor0.column - 1) : '';
      const charAfter = cursor0.column < currentLine.length ? currentLine.charAt(cursor0.column) : '';

      // Check if last non-ws char before cursor is '{'
      let endsWithBrace = false;
      for (let bi = cursor0.column - 1; bi >= 0; bi--) {
        const bc = currentLine.charAt(bi);
        if (bc === ' ' || bc === '\t') continue;
        if (bc === '{') endsWithBrace = true;
        break;
      }

      let insertText = '\n';
      let newLine = cursor0.line + 1;
      let newCol = 0;

      if (charBefore === '{' && charAfter === '}') {
        // Smart Enter between braces: {|} → {\n  indent\n indent}
        insertText += indent;
        insertText += '  ';
        insertText += '\n';
        insertText += indent;
        newCol = indentEnd + 2;
      } else if (endsWithBrace) {
        // After opening brace: increase indent
        insertText += indent;
        insertText += '  ';
        newCol = indentEnd + 2;
      } else {
        // Normal Enter: preserve indent
        insertText += indent;
        newCol = indentEnd;
      }

      const offset = this.document.buffer.getLineOffset(cursor0.line) + cursor0.column;
      this.document.buffer.insert(offset, insertText);
      cursor0.line = newLine;
      cursor0.column = newCol;
      cursor0.desiredColumn = newCol;
      cursor0.selectionAnchor = null;
      this.afterEdit();
      return true;
    }

    if (commandId === 'editor.action.deleteLeft') {
      _pushUndoSnapshot(this.document.buffer.getText(), cursor0.line, cursor0.column, 1, 0);
      if (cursor0.selectionAnchor !== null && cursor0.selectionAnchor !== undefined) {
        // Delete selection
        const anchorLine = cursor0.selectionAnchor.line;
        const anchorCol = cursor0.selectionAnchor.column;
        let startLine = cursor0.line;
        let startCol = cursor0.column;
        let endLine = anchorLine;
        let endCol = anchorCol;
        if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
          startLine = anchorLine;
          startCol = anchorCol;
          endLine = cursor0.line;
          endCol = cursor0.column;
        }
        const startOff = this.document.buffer.getLineOffset(startLine) + startCol;
        const endOff = this.document.buffer.getLineOffset(endLine) + endCol;
        if (endOff > startOff) {
          this.document.buffer.delete(startOff, endOff - startOff);
        }
        cursor0.line = startLine;
        cursor0.column = startCol;
        cursor0.desiredColumn = startCol;
        cursor0.selectionAnchor = null;
        this.afterEdit();
        return true;
      }
      // Auto-delete pair: if between matching brackets, delete both
      if (cursor0.column > 0) {
        const delLine = this.document.buffer.getLine(cursor0.line);
        const prevCh = delLine.charAt(cursor0.column - 1);
        const nextCh = cursor0.column < delLine.length ? delLine.charAt(cursor0.column) : '';
        let isPair = false;
        if (prevCh === '(' && nextCh === ')') isPair = true;
        else if (prevCh === '{' && nextCh === '}') isPair = true;
        else if (prevCh === '[' && nextCh === ']') isPair = true;
        else if (prevCh === '"' && nextCh === '"') isPair = true;
        else if (prevCh === "'" && nextCh === "'") isPair = true;
        else if (prevCh === '`' && nextCh === '`') isPair = true;
        if (isPair) {
          const lineOff = this.document.buffer.getLineOffset(cursor0.line);
          this.document.buffer.delete(lineOff + cursor0.column - 1, 2);
          cursor0.column = cursor0.column - 1;
          cursor0.desiredColumn = cursor0.column;
          this.afterEdit();
          return true;
        }
      }
      if (cursor0.column > 0) {
        const lineOff = this.document.buffer.getLineOffset(cursor0.line);
        this.document.buffer.delete(lineOff + cursor0.column - 1, 1);
        cursor0.column = cursor0.column - 1;
        cursor0.desiredColumn = cursor0.column;
        this.afterEdit();
        return true;
      } else if (cursor0.line > 0) {
        const prevLineLen = this.document.buffer.getLineLength(cursor0.line - 1);
        const joinOffset = this.document.buffer.getLineOffset(cursor0.line) - 1;
        this.document.buffer.delete(joinOffset, 1);
        cursor0.line = cursor0.line - 1;
        cursor0.column = prevLineLen;
        cursor0.desiredColumn = cursor0.column;
        this.afterEdit();
        return true;
      }
      return false;
    }

    // Perry-safe selection commands (avoid destructuring in command registry handlers)
    if (commandId === 'editor.action.selectWord') {
      const lineText = this.document.buffer.getLine(cursor0.line);
      const wordRange = getWordAtColumn(lineText, cursor0.column);
      const wordStart = wordRange[0];
      const wordEnd = wordRange[1];
      cursor0.selectionAnchor = { line: cursor0.line, column: wordStart };
      cursor0.column = wordEnd;
      cursor0.desiredColumn = wordEnd;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectLine') {
      cursor0.selectionAnchor = { line: cursor0.line, column: 0 };
      if (cursor0.line < this.document.buffer.getLineCount() - 1) {
        cursor0.line = cursor0.line + 1;
        cursor0.column = 0;
      } else {
        cursor0.column = this.document.buffer.getLineLength(cursor0.line);
      }
      cursor0.desiredColumn = cursor0.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectAll') {
      const lastLine = this.document.buffer.getLineCount() - 1;
      const lastCol = this.document.buffer.getLineLength(lastLine);
      cursor0.selectionAnchor = { line: 0, column: 0 };
      cursor0.line = lastLine;
      cursor0.column = lastCol;
      cursor0.desiredColumn = lastCol;
      this.notifyChange();
      return true;
    }

    // Perry-safe clipboard: copy/cut store in internal clipboard
    // The actual system clipboard is handled by editor-component.ts via FFI
    if (commandId === 'editor.action.copy') {
      if (cursor0.selectionAnchor) {
        const anchor = cursor0.selectionAnchor;
        let startLine = anchor.line;
        let startCol = anchor.column;
        let endLine = cursor0.line;
        let endCol = cursor0.column;
        if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
          const tl = startLine; const tc = startCol;
          startLine = endLine; startCol = endCol;
          endLine = tl; endCol = tc;
        }
        const startOff = this.document.buffer.getLineOffset(startLine) + startCol;
        const endOff = this.document.buffer.getLineOffset(endLine) + endCol;
        const text = this.document.buffer.getTextRange(startOff, endOff);
        this._clipboardText = text;
        _perryClipboard = text;
      } else {
        const lineText = this.document.buffer.getLine(cursor0.line);
        this._clipboardText = lineText + '\n';
        _perryClipboard = lineText + '\n';
      }
      return true;
    }

    if (commandId === 'editor.action.cut') {
      // deleteLeft below will push its own undo snapshot
      this.executeCommand('editor.action.copy');
      if (cursor0.selectionAnchor) {
        this.executeCommand('editor.action.deleteLeft');
      }
      return true;
    }

    if (commandId === 'editor.action.paste') {
      const pasteText = this._clipboardText;
      if (pasteText.length === 0) return true;
      _pushUndoSnapshot(this.document.buffer.getText(), cursor0.line, cursor0.column, 0, 0);
      // Delete selection first if any
      if (cursor0.selectionAnchor) {
        this.executeCommand('editor.action.deleteLeft');
      }
      const lineOff = this.document.buffer.getLineOffset(cursor0.line);
      const insertOff = lineOff + cursor0.column;
      this.document.buffer.insert(insertOff, pasteText);
      // Move cursor to end of pasted text
      let pastedLine = cursor0.line;
      let pastedCol = cursor0.column;
      for (let pi = 0; pi < pasteText.length; pi = pi + 1) {
        if (pasteText.charCodeAt(pi) === 10) {
          pastedLine = pastedLine + 1;
          pastedCol = 0;
        } else {
          pastedCol = pastedCol + 1;
        }
      }
      cursor0.line = pastedLine;
      cursor0.column = pastedCol;
      cursor0.desiredColumn = pastedCol;
      cursor0.selectionAnchor = null;
      this.afterEdit();
      return true;
    }

    } // end if (this._perryMode)

    // For commands without Perry-safe fallbacks, try the command registry
    const ctx: CommandContext = { editor: this };
    const result = this.commandRegistry.execute(commandId, ctx, args);
    if (result) {
      this.afterEdit();
      return true;
    }

    // Cursor movement commands (outside Perry mode — use standard cursors)
    const cursorsF = this.cursorManager.cursors;
    if (cursorsF.length === 0) return false;
    const cursorF = cursorsF[0];

    // --- Selection commands (Shift+Arrow) ---
    // Use cursorManager.moveToPosition(line, col, true) to set selectionAnchor
    // and move cursor internally — avoids Perry issues with modifying cursor
    // properties through external references.
    if (commandId === 'editor.action.selectLeft') {
      let newLine = cursorF.line;
      let newCol = cursorF.column;
      if (newCol > 0) {
        newCol = newCol - 1;
      } else if (newLine > 0) {
        newLine = newLine - 1;
        newCol = this.document.buffer.getLineLength(newLine);
      }
      this.cursorManager.moveToPosition(newLine, newCol, true);
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectRight') {
      let newLine = cursorF.line;
      let newCol = cursorF.column;
      const lineLen0s = this.document.buffer.getLineLength(newLine);
      if (newCol < lineLen0s) {
        newCol = newCol + 1;
      } else if (newLine < this.document.buffer.getLineCount() - 1) {
        newLine = newLine + 1;
        newCol = 0;
      }
      this.cursorManager.moveToPosition(newLine, newCol, true);
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectUp') {
      let newLine = cursorF.line;
      let newCol = cursorF.column;
      if (newLine > 0) {
        newLine = newLine - 1;
        const lineLen1s = this.document.buffer.getLineLength(newLine);
        if (newCol > lineLen1s) {
          newCol = lineLen1s;
        }
      }
      this.cursorManager.moveToPosition(newLine, newCol, true);
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectDown') {
      let newLine = cursorF.line;
      let newCol = cursorF.column;
      const totalLinesS = this.document.buffer.getLineCount();
      if (newLine < totalLinesS - 1) {
        newLine = newLine + 1;
        const lineLen2s = this.document.buffer.getLineLength(newLine);
        if (newCol > lineLen2s) {
          newCol = lineLen2s;
        }
      }
      this.cursorManager.moveToPosition(newLine, newCol, true);
      this.notifyChange();
      return true;
    }

    // --- Movement commands (no selection) ---
    if (commandId === 'editor.action.moveCursorLeft') {
      if (cursorF.selectionAnchor !== null && cursorF.selectionAnchor !== undefined) {
        // Collapse selection to the left side
        const a = cursorF.selectionAnchor;
        if (a.line < cursorF.line || (a.line === cursorF.line && a.column < cursorF.column)) {
          cursorF.line = a.line;
          cursorF.column = a.column;
        }
        cursorF.selectionAnchor = null;
      } else if (cursorF.column > 0) {
        cursorF.column = cursorF.column - 1;
      } else if (cursorF.line > 0) {
        cursorF.line = cursorF.line - 1;
        cursorF.column = this.document.buffer.getLineLength(cursorF.line);
      }
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = cursorF.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorRight') {
      if (cursorF.selectionAnchor !== null && cursorF.selectionAnchor !== undefined) {
        // Collapse selection to the right side
        const a = cursorF.selectionAnchor;
        if (a.line > cursorF.line || (a.line === cursorF.line && a.column > cursorF.column)) {
          cursorF.line = a.line;
          cursorF.column = a.column;
        }
        cursorF.selectionAnchor = null;
      } else {
        const lineLen0 = this.document.buffer.getLineLength(cursorF.line);
        if (cursorF.column < lineLen0) {
          cursorF.column = cursorF.column + 1;
        } else if (cursorF.line < this.document.buffer.getLineCount() - 1) {
          cursorF.line = cursorF.line + 1;
          cursorF.column = 0;
        }
      }
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = cursorF.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorUp') {
      if (cursorF.line > 0) {
        cursorF.line = cursorF.line - 1;
        const lineLen1 = this.document.buffer.getLineLength(cursorF.line);
        if (cursorF.column > lineLen1) {
          cursorF.column = lineLen1;
        }
      }
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = cursorF.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorDown') {
      const totalLines = this.document.buffer.getLineCount();
      if (cursorF.line < totalLines - 1) {
        cursorF.line = cursorF.line + 1;
        const lineLen2 = this.document.buffer.getLineLength(cursorF.line);
        if (cursorF.column > lineLen2) {
          cursorF.column = lineLen2;
        }
      }
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = cursorF.column;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectToLineStart') {
      this.cursorManager.moveToPosition(cursorF.line, 0, true);
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.selectToLineEnd') {
      const endCol = this.document.buffer.getLineLength(cursorF.line);
      this.cursorManager.moveToPosition(cursorF.line, endCol, true);
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorToLineStart') {
      cursorF.column = 0;
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = 0;
      this.notifyChange();
      return true;
    }

    if (commandId === 'editor.action.moveCursorToLineEnd') {
      cursorF.column = this.document.buffer.getLineLength(cursorF.line);
      cursorF.selectionAnchor = null;
      cursorF.desiredColumn = cursorF.column;
      this.notifyChange();
      return true;
    }

    return false;
  }

  /** Handle keyboard input. */
  onKeyDown(event: KeyEvent): boolean {
    const cmd = this.resolveKeybinding(event);
    if (cmd) {
      this.executeCommand(cmd);
      return true;
    }

    // Regular text input
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      this.executeCommand('editor.action.type', { text: event.key });
      return true;
    }

    return false;
  }

  /** Handle text input (IME result). */
  onTextInput(text: string): void {
    // Use explicit form (not shorthand) — Perry AOT shorthand captures stale values.
    this.executeCommand('editor.action.type', { text: text });
  }

  /** Handle mouse click. */
  onMouseDown(event: MouseEvent): void {
    // Avoid destructuring — Perry AOT may not support it correctly.
    const _clickPos = this.pixelToPosition(event.x, event.y);
    const line = _clickPos.line;
    const column = _clickPos.column;

    if (event.altKey) {
      // Alt+click: add cursor
      this.cursorManager.addCursorAt(line, column);
    } else if (event.shiftKey) {
      // Shift+click: extend selection
      this.cursorManager.moveToPosition(line, column, true);
      _perryCursorLine = line;
      _perryCursorCol = column;
      // anchor stays from before
    } else {
      // Regular click: move cursor
      if (event.clickCount === 2) {
        // Double click: select word
        this.cursorManager.reset(line, column);
        this.executeCommand('editor.action.selectWord');
        // Sync perry anchor from the selection set by selectWord
        const _dblCursor = this.cursorManager.cursors[0];
        if (_dblCursor.selectionAnchor) {
          _perryAnchorLine = _dblCursor.selectionAnchor.line;
          _perryAnchorCol = _dblCursor.selectionAnchor.column;
          _perryCursorLine = _dblCursor.line;
          _perryCursorCol = _dblCursor.column;
        }
      } else if (event.clickCount === 3) {
        // Triple click: select line
        this.cursorManager.reset(line, 0);
        this.executeCommand('editor.action.selectLine');
        // Sync perry anchor from the selection set by selectLine
        const _tplCursor = this.cursorManager.cursors[0];
        if (_tplCursor.selectionAnchor) {
          _perryAnchorLine = _tplCursor.selectionAnchor.line;
          _perryAnchorCol = _tplCursor.selectionAnchor.column;
          _perryCursorLine = _tplCursor.line;
          _perryCursorCol = _tplCursor.column;
        }
      } else {
        this.cursorManager.reset(line, column);
        _perryCursorLine = line;
        _perryCursorCol = column;
        _perryAnchorLine = -1;
      }
    }

    this._cursorBlink.resetBlink();
    this.notifyChange();
  }

  /** Handle mouse drag (selection). */
  onMouseMove(event: MouseEvent): void {
    if (event.button === 0) {
      const _movePos = this.pixelToPosition(event.x, event.y);
      this.cursorManager.moveToPosition(_movePos.line, _movePos.column, true);
      this.notifyChange();
    }
  }

  onMouseUp(_event: MouseEvent): void {
    // Selection end — nothing special needed
  }

  /** Handle scroll events. */
  onScroll(event: ScrollEvent): void {
    this.viewport.scroll.scrollBy(event.deltaX, event.deltaY);
    this.notifyChange();
  }

  /** Handle resize. */
  onResize(width: number, height: number): void {
    this.viewport.update(width, height);
    this.cursorManager.setPageSize(this.viewport.getLinesPerPage());
    this.notifyChange();
  }

  /** Handle focus. */
  onFocus(): void {
    this._cursorBlink.setFocused(true);
    this.notifyChange();
  }

  /** Handle blur. */
  onBlur(): void {
    this._cursorBlink.setFocused(false);
    this.notifyChange();
  }

  // IME
  onCompositionStart(): void {
    this._cursorBlink.startComposition();
  }

  onCompositionUpdate(text: string): void {
    this._cursorBlink.updateComposition(text);
    this.notifyChange();
  }

  onCompositionEnd(text: string): void {
    this._cursorBlink.endComposition();
    this.onTextInput(text);
  }

  // === Private ===

  /** Sync cursor to module-level vars before afterEdit/notifyChange. */
  private _syncPerryCursor(): void {
    const _spcCursors = this.cursorManager.cursors;
    if (_spcCursors.length > 0) {
      const _spc0 = _spcCursors[0];
      // Direct field reads on the cursor object (not via getter)
      _perryCursorLine = _spc0.line;
      _perryCursorCol = _spc0.column;
      if (_spc0.selectionAnchor !== null && _spc0.selectionAnchor !== undefined) {
        _perryAnchorLine = _spc0.selectionAnchor.line;
        _perryAnchorCol = _spc0.selectionAnchor.column;
      } else {
        _perryAnchorLine = -1;
      }
    }
  }

  /** Called after any edit or cursor change. */
  private afterEdit(): void {
    this.viewport.setTotalLines(this.document.buffer.getLineCount());

    // Re-parse for syntax highlighting
    const langId = this.document.languageId;
    if (langId !== null && langId !== undefined && this.syntaxEngine.hasLanguage(langId)) {
      this.syntaxEngine.parse(this.document.buffer);
      this.updateFoldRanges();
    }

    // Dismiss ghost text on edit
    this.ghostText.markStale();

    // Perry-safe: sync cursor to module-level vars and ensure visible.
    this._syncPerryCursor();
    this.viewport.ensureLineVisible(_perryCursorLine);
    this._cursorBlink.resetBlink();
    this.notifyChange();
  }

  /** Update fold ranges from syntax engine. */
  private updateFoldRanges(): void {
    const ranges = this.syntaxEngine.getFoldRanges(this.document.buffer);
    this.foldState.setAvailableRanges(ranges);
    this.viewport.setHiddenLines(this.foldState.getHiddenLines());
  }

  /** Convert pixel coordinates to buffer position. */
  private pixelToPosition(x: number, y: number): { line: number; column: number } {
    const scrollTop = this.viewport.scroll.scrollTop;
    const scrollLeft = this.viewport.scroll.scrollLeft;

    const lineHeight = this.viewport.lineHeightCache.baseLineHeight;
    const line = Math.max(0, Math.min(
      Math.floor((y + scrollTop) / lineHeight),
      this.document.buffer.getLineCount() - 1,
    ));

    const gutterW = this.gutterWidth;
    const column = Math.max(0, Math.round((x + scrollLeft - gutterW) / this._charWidth));
    const lineLen = this.document.buffer.getLineLength(line);

    return { line: line, column: Math.min(column, lineLen) };
  }

  /** Map key events to command IDs. */
  private resolveKeybinding(event: KeyEvent): string | null {
    const meta = event.metaKey || event.ctrlKey; // Cmd on macOS, Ctrl on others
    const shift = event.shiftKey;
    const alt = event.altKey;

    // Undo/Redo
    if (meta && !shift && event.key === 'z') return 'editor.action.undo';
    if (meta && shift && event.key === 'z') return 'editor.action.redo';
    if (meta && event.key === 'y') return 'editor.action.redo';

    // Navigation
    if (event.key === 'ArrowLeft') {
      if (meta && shift) return 'editor.action.selectToLineStart';
      if (meta) return 'editor.action.moveCursorToLineStart';
      if (alt && shift) return 'editor.action.selectWordLeft';
      if (alt) return 'editor.action.moveCursorWordLeft';
      if (shift) return 'editor.action.selectLeft';
      return 'editor.action.moveCursorLeft';
    }
    if (event.key === 'ArrowRight') {
      if (meta && shift) return 'editor.action.selectToLineEnd';
      if (meta) return 'editor.action.moveCursorToLineEnd';
      if (alt && shift) return 'editor.action.selectWordRight';
      if (alt) return 'editor.action.moveCursorWordRight';
      if (shift) return 'editor.action.selectRight';
      return 'editor.action.moveCursorRight';
    }
    if (event.key === 'ArrowUp') {
      if (meta && alt) return 'editor.action.addCursorAbove';
      if (meta && shift) return 'editor.action.selectToDocumentStart';
      if (meta) return 'editor.action.moveCursorToDocumentStart';
      if (shift) return 'editor.action.selectUp';
      return 'editor.action.moveCursorUp';
    }
    if (event.key === 'ArrowDown') {
      if (meta && alt) return 'editor.action.addCursorBelow';
      if (meta && shift) return 'editor.action.selectToDocumentEnd';
      if (meta) return 'editor.action.moveCursorToDocumentEnd';
      if (shift) return 'editor.action.selectDown';
      return 'editor.action.moveCursorDown';
    }

    if (event.key === 'Home') {
      if (shift) return 'editor.action.selectToLineStart';
      return 'editor.action.moveCursorToLineStart';
    }
    if (event.key === 'End') {
      if (shift) return 'editor.action.selectToLineEnd';
      return 'editor.action.moveCursorToLineEnd';
    }
    if (event.key === 'PageUp') {
      if (shift) return 'editor.action.selectPageUp';
      return 'editor.action.pageUp';
    }
    if (event.key === 'PageDown') {
      if (shift) return 'editor.action.selectPageDown';
      return 'editor.action.pageDown';
    }

    // Editing
    if (event.key === 'Backspace') return 'editor.action.deleteLeft';
    if (event.key === 'Delete') return 'editor.action.deleteRight';
    if (event.key === 'Enter') return 'editor.action.insertLineAfter';
    if (event.key === 'Tab') {
      if (shift) return 'editor.action.outdent';
      return 'editor.action.indent';
    }

    // Selection
    if (meta && event.key === 'a') return 'editor.action.selectAll';
    if (meta && event.key === 'd') return 'editor.action.addNextOccurrence';
    if (meta && shift && event.key === 'l') return 'editor.action.selectAllOccurrences';

    // Clipboard
    if (meta && event.key === 'c') return 'editor.action.copy';
    if (meta && event.key === 'x') return 'editor.action.cut';
    if (meta && event.key === 'v') return 'editor.action.paste';

    // Find/Replace
    if (meta && event.key === 'f') return 'editor.action.find';
    if (meta && event.key === 'h') return 'editor.action.replace';
    if (event.key === 'Escape') return 'editor.action.escape';
    if (meta && event.key === 'g') {
      if (shift) return 'editor.action.findPrev';
      return 'editor.action.findNext';
    }

    // Folding
    if (meta && shift && event.key === '[') return 'editor.action.fold';
    if (meta && shift && event.key === ']') return 'editor.action.unfold';

    // Ghost text
    if (event.key === 'Tab' && !shift && this.ghostText.state) return 'editor.action.acceptGhostText';

    return null;
  }

  destroy(): void {
    this._cursorBlink.destroy();
  }
}
