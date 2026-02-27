/**
 * Unicode-aware word boundary detection (simplified UAX #29).
 *
 * Character categories: letter, digit, whitespace, punctuation, other.
 * Word boundary = transition between different categories.
 * Special cases: camelCase and underscore_separated identifiers.
 */

const enum CharCategory {
  Letter,
  UpperLetter,
  Digit,
  Whitespace,
  Punctuation,
  Underscore,
  Other,
}

function categorize(ch: number): CharCategory {
  // ASCII fast path
  if (ch >= 65 && ch <= 90) return CharCategory.UpperLetter;
  if (ch >= 97 && ch <= 122) return CharCategory.Letter;
  if (ch >= 48 && ch <= 57) return CharCategory.Digit;
  if (ch === 95) return CharCategory.Underscore; // _
  if (ch === 32 || ch === 9 || ch === 10 || ch === 13) return CharCategory.Whitespace;
  if (ch >= 33 && ch <= 47) return CharCategory.Punctuation;  // !"#$%&'()*+,-./
  if (ch >= 58 && ch <= 64) return CharCategory.Punctuation;  // :;<=>?@
  if (ch >= 91 && ch <= 94) return CharCategory.Punctuation;  // [\]^
  if (ch === 96) return CharCategory.Punctuation;              // `
  if (ch >= 123 && ch <= 126) return CharCategory.Punctuation; // {|}~

  // Unicode letters (simplified)
  if (ch >= 0xC0 && ch <= 0x024F) return CharCategory.Letter; // Latin Extended
  if (ch >= 0x0400 && ch <= 0x04FF) return CharCategory.Letter; // Cyrillic
  if (ch >= 0x3040 && ch <= 0x30FF) return CharCategory.Letter; // Japanese
  if (ch >= 0x4E00 && ch <= 0x9FFF) return CharCategory.Letter; // CJK
  if (ch >= 0xAC00 && ch <= 0xD7AF) return CharCategory.Letter; // Korean

  return CharCategory.Other;
}

/** Check if categories are in the same "word group". */
function sameWordGroup(a: CharCategory, b: CharCategory): boolean {
  // Letters, uppercase letters, digits, and underscores are word chars
  // but we treat transitions between them as boundaries in some cases
  if (a === b) return true;
  // lowercase + uppercase = same group (but camelCase handled separately)
  if ((a === CharCategory.Letter && b === CharCategory.UpperLetter) ||
      (a === CharCategory.UpperLetter && b === CharCategory.Letter)) return true;
  // letters + digits = same group
  if ((a === CharCategory.Letter || a === CharCategory.UpperLetter) &&
      b === CharCategory.Digit) return true;
  if (a === CharCategory.Digit &&
      (b === CharCategory.Letter || b === CharCategory.UpperLetter)) return true;
  // underscore + word chars = same group
  if (a === CharCategory.Underscore &&
      (b === CharCategory.Letter || b === CharCategory.UpperLetter || b === CharCategory.Digit)) return true;
  if ((a === CharCategory.Letter || a === CharCategory.UpperLetter || a === CharCategory.Digit) &&
      b === CharCategory.Underscore) return true;
  return false;
}

/**
 * Find the start of the word at or before the given column.
 */
export function findWordStart(line: string, column: number): number {
  if (column <= 0) return 0;
  column = Math.min(column, line.length);

  let pos = column - 1;
  const startCat = categorize(line.charCodeAt(pos));

  // Skip whitespace
  if (startCat === CharCategory.Whitespace) {
    while (pos > 0 && categorize(line.charCodeAt(pos - 1)) === CharCategory.Whitespace) {
      pos--;
    }
    if (pos === 0) return 0;
    pos--;
    return findWordStart(line, pos + 1);
  }

  // Move left while in the same word group
  while (pos > 0) {
    const prevCat = categorize(line.charCodeAt(pos - 1));
    if (!sameWordGroup(startCat, prevCat)) break;

    // CamelCase boundary: if we're at an uppercase letter preceded by a lowercase letter
    if (categorize(line.charCodeAt(pos)) === CharCategory.UpperLetter &&
        prevCat === CharCategory.Letter) {
      break;
    }
    pos--;
  }

  return pos;
}

/**
 * Find the end of the word at or after the given column.
 */
export function findWordEnd(line: string, column: number): number {
  if (column >= line.length) return line.length;

  let pos = column;
  const startCat = categorize(line.charCodeAt(pos));

  // Skip whitespace
  if (startCat === CharCategory.Whitespace) {
    while (pos < line.length && categorize(line.charCodeAt(pos)) === CharCategory.Whitespace) {
      pos++;
    }
    if (pos >= line.length) return line.length;
    return findWordEnd(line, pos);
  }

  // Move right while in the same word group
  pos++;
  while (pos < line.length) {
    const nextCat = categorize(line.charCodeAt(pos));
    if (!sameWordGroup(startCat, nextCat)) break;

    // CamelCase boundary: uppercase letter starts a new word
    if (nextCat === CharCategory.UpperLetter &&
        categorize(line.charCodeAt(pos - 1)) === CharCategory.Letter) {
      break;
    }
    pos++;
  }

  return pos;
}

/**
 * Get the word at a given column position.
 * Returns [startColumn, endColumn).
 */
export function getWordAtColumn(line: string, column: number): [number, number] {
  if (line.length === 0) return [0, 0];
  const col = Math.min(Math.max(0, column), line.length - 1);
  const cat = categorize(line.charCodeAt(col));
  if (cat === CharCategory.Whitespace || cat === CharCategory.Punctuation) {
    return [col, col + 1];
  }
  const start = findWordStart(line, col + 1);
  const end = findWordEnd(line, col);
  return [start, end];
}
