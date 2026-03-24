/**
 * Literal and regex search across the buffer, match result collection.
 *
 * Two modes:
 * 1. Literal search: string scan with optional case-insensitive mode.
 * 2. Regex search: compiled regex, scanned line-by-line.
 *
 * For large files, search is performed in chunks.
 */

import { TextBuffer } from '../buffer/text-buffer';

export interface SearchMatch {
  /** Character offset of the match start. */
  offset: number;
  /** Length of the match in characters. */
  length: number;
  /** Zero-based line number. */
  line: number;
  /** Zero-based column of match start. */
  column: number;
  /** The matched text. */
  text: string;
  /** Capture groups (regex mode only). */
  captures?: string[];
}

export interface SearchOptions {
  /** Use regex mode. */
  isRegex: boolean;
  /** Case-sensitive matching. */
  caseSensitive: boolean;
  /** Match whole words only. */
  wholeWord: boolean;
}

const DEFAULT_OPTIONS: SearchOptions = {
  isRegex: false,
  caseSensitive: true,
  wholeWord: false,
};

/**
 * Search the buffer for all matches of a query.
 */
export function searchAll(
  buffer: TextBuffer,
  query: string,
  options: Partial<SearchOptions> = {},
): SearchMatch[] {
  if (query.length === 0) return [];

  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.isRegex) {
    return regexSearch(buffer, query, opts);
  }
  return literalSearch(buffer, query, opts);
}

/**
 * Find the next match after a given offset.
 */
export function searchNext(
  buffer: TextBuffer,
  query: string,
  afterOffset: number,
  options: Partial<SearchOptions> = {},
): SearchMatch | null {
  if (query.length === 0) return null;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const text = buffer.getText();
  const searchText = opts.caseSensitive ? text : text.toLowerCase();
  const searchQuery = opts.caseSensitive ? query : query.toLowerCase();

  if (opts.isRegex) {
    try {
      const flags = opts.caseSensitive ? 'g' : 'gi';
      const re = new RegExp(query, flags);
      re.lastIndex = afterOffset;
      let match = re.exec(text);
      if (!match) {
        // Wrap around
        re.lastIndex = 0;
        match = re.exec(text);
      }
      if (match) {
        return createMatch(buffer, match.index, match[0].length, match[0],
          Array.from(match).slice(1));
      }
    } catch {
      return null; // Invalid regex
    }
    return null;
  }

  // Literal search
  let idx = searchText.indexOf(searchQuery, afterOffset);
  if (idx === -1) {
    // Wrap around
    idx = searchText.indexOf(searchQuery, 0);
  }
  if (idx === -1) return null;

  const matchText = text.substring(idx, idx + query.length);
  if (opts.wholeWord && !isWholeWord(text, idx, query.length)) {
    // Skip this match and search for next
    return searchNext(buffer, query, idx + 1, options);
  }

  return createMatch(buffer, idx, query.length, matchText);
}

/**
 * Find the previous match before a given offset.
 */
export function searchPrev(
  buffer: TextBuffer,
  query: string,
  beforeOffset: number,
  options: Partial<SearchOptions> = {},
): SearchMatch | null {
  if (query.length === 0) return null;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const text = buffer.getText();
  const searchText = opts.caseSensitive ? text : text.toLowerCase();
  const searchQuery = opts.caseSensitive ? query : query.toLowerCase();

  if (opts.isRegex) {
    // For regex prev search, find all matches and pick the one before offset
    const matches = searchAll(buffer, query, options);
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].offset < beforeOffset) return matches[i];
    }
    // Wrap around: return last match
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  let idx = searchText.lastIndexOf(searchQuery, beforeOffset - 1);
  if (idx === -1) {
    // Wrap around
    idx = searchText.lastIndexOf(searchQuery);
  }
  if (idx === -1) return null;

  const matchText = text.substring(idx, idx + query.length);
  if (opts.wholeWord && !isWholeWord(text, idx, query.length)) {
    return searchPrev(buffer, query, idx, options);
  }

  return createMatch(buffer, idx, query.length, matchText);
}

function literalSearch(buffer: TextBuffer, query: string, opts: SearchOptions): SearchMatch[] {
  const text = buffer.getText();
  const matches: SearchMatch[] = [];

  if (opts.caseSensitive) {
    // Direct search on original text — no copy needed
    let pos = 0;
    while (pos < text.length) {
      const idx = text.indexOf(query, pos);
      if (idx === -1) break;

      if (opts.wholeWord && !isWholeWord(text, idx, query.length)) {
        pos = idx + 1;
        continue;
      }

      const matchText = text.substring(idx, idx + query.length);
      matches.push(createMatch(buffer, idx, query.length, matchText));
      pos = idx + query.length;
    }
  } else {
    // Case-insensitive: lowercase the query only, scan text with charCode comparison
    const lowerQuery = query.toLowerCase();
    const qLen = query.length;
    const firstQChar = lowerQuery.charCodeAt(0);

    let pos = 0;
    while (pos <= text.length - qLen) {
      // Fast ASCII check for first character
      const ch = text.charCodeAt(pos);
      const lch = (ch >= 65 && ch <= 90) ? ch + 32 : ch;
      if (lch !== firstQChar) {
        pos++;
        continue;
      }

      // Check remaining characters
      let matched = true;
      for (let j = 1; j < qLen; j++) {
        const c = text.charCodeAt(pos + j);
        const lc = (c >= 65 && c <= 90) ? c + 32 : c;
        if (lc !== lowerQuery.charCodeAt(j)) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        pos++;
        continue;
      }

      if (opts.wholeWord && !isWholeWord(text, pos, qLen)) {
        pos++;
        continue;
      }

      const matchText = text.substring(pos, pos + qLen);
      matches.push(createMatch(buffer, pos, qLen, matchText));
      pos += qLen;
    }
  }

  return matches;
}

// 2-slot regex compilation cache
let _reCacheKey1 = '';
let _reCacheFlags1 = '';
let _reCacheRe1: RegExp | null = null;
let _reCacheKey2 = '';
let _reCacheFlags2 = '';
let _reCacheRe2: RegExp | null = null;

function getCachedRegExp(pattern: string, flags: string): RegExp {
  if (_reCacheKey1 === pattern && _reCacheFlags1 === flags && _reCacheRe1 !== null) {
    _reCacheRe1.lastIndex = 0;
    return _reCacheRe1;
  }
  if (_reCacheKey2 === pattern && _reCacheFlags2 === flags && _reCacheRe2 !== null) {
    _reCacheRe2.lastIndex = 0;
    return _reCacheRe2;
  }
  // Evict slot 2, move slot 1 to slot 2
  _reCacheKey2 = _reCacheKey1;
  _reCacheFlags2 = _reCacheFlags1;
  _reCacheRe2 = _reCacheRe1;
  // Create new regex in slot 1
  const re = new RegExp(pattern, flags);
  _reCacheKey1 = pattern;
  _reCacheFlags1 = flags;
  _reCacheRe1 = re;
  return re;
}

function regexSearch(buffer: TextBuffer, pattern: string, opts: SearchOptions): SearchMatch[] {
  const matches: SearchMatch[] = [];

  try {
    const flags = opts.caseSensitive ? 'g' : 'gi';
    const re = getCachedRegExp(pattern, flags);
    const text = buffer.getText();

    let match: RegExpExecArray | null;
    let safetyCounter = 0;
    const maxMatches = 100000;

    while ((match = re.exec(text)) !== null && safetyCounter < maxMatches) {
      if (match[0].length === 0) {
        re.lastIndex++;
        continue;
      }

      matches.push(createMatch(
        buffer, match.index, match[0].length, match[0],
        Array.from(match).slice(1),
      ));
      safetyCounter++;
    }
  } catch {
    // Invalid regex — return empty
  }

  return matches;
}

function createMatch(
  buffer: TextBuffer,
  offset: number,
  length: number,
  text: string,
  captures?: string[],
): SearchMatch {
  const line = buffer.getOffsetLine(offset);
  const column = offset - buffer.getLineOffset(line);
  return { offset, length, line, column, text, captures };
}

function isWholeWord(text: string, offset: number, length: number): boolean {
  if (offset > 0 && isWordChar(text.charCodeAt(offset - 1))) return false;
  const end = offset + length;
  if (end < text.length && isWordChar(text.charCodeAt(end))) return false;
  return true;
}

function isWordChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) ||
         (ch >= 48 && ch <= 57) || ch === 95;
}
