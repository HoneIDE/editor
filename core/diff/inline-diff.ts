/**
 * Character-level inline diff within changed lines.
 *
 * Uses the same Myers algorithm but at the character level.
 * For very long lines (> 1000 chars), falls back to word-level diff.
 */

import { InlineDiffSegment } from './diff-model';

/**
 * Compute character-level diff between two lines.
 */
export function computeInlineDiff(
  originalLine: string,
  modifiedLine: string,
): InlineDiffSegment[] {
  if (originalLine === modifiedLine) {
    return [{ text: originalLine, type: 'unchanged' }];
  }

  if (originalLine.length === 0) {
    return [{ text: modifiedLine, type: 'added' }];
  }

  if (modifiedLine.length === 0) {
    return [{ text: originalLine, type: 'deleted' }];
  }

  // For very long lines, use word-level diff
  if (originalLine.length > 1000 || modifiedLine.length > 1000) {
    return wordLevelDiff(originalLine, modifiedLine);
  }

  return charLevelDiff(originalLine, modifiedLine);
}

function charLevelDiff(a: string, b: string): InlineDiffSegment[] {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;
  const vOffset = MAX;
  const vSize = 2 * MAX + 1;
  const v = new Int32Array(vSize);
  v.fill(0);

  const trace: Int32Array[] = [];

  for (let d = 0; d <= MAX; d++) {
    trace.push(new Int32Array(v));

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + vOffset] < v[k + 1 + vOffset])) {
        x = v[k + 1 + vOffset];
      } else {
        x = v[k - 1 + vOffset] + 1;
      }

      let y = x - k;

      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + vOffset] = x;

      if (x >= N && y >= M) {
        return buildInlineSegments(trace, d, vOffset, N, M, a, b);
      }
    }
  }

  // Fallback
  return [
    { text: a, type: 'deleted' },
    { text: b, type: 'added' },
  ];
}

function buildInlineSegments(
  trace: Int32Array[],
  d: number,
  vOffset: number,
  N: number,
  M: number,
  a: string,
  b: string,
): InlineDiffSegment[] {
  const ops: { type: 'equal' | 'insert' | 'delete'; char: string }[] = [];
  let x = N;
  let y = M;

  for (let i = d; i > 0; i--) {
    const k = x - y;
    const vPrev = trace[i]; // v at START of iteration i

    let prevK: number;
    if (k === -i || (k !== i && vPrev[k - 1 + vOffset] < vPrev[k + 1 + vOffset])) {
      prevK = k + 1; // insert
    } else {
      prevK = k - 1; // delete
    }

    const prevX = vPrev[prevK + vOffset];

    if (prevK === k + 1) {
      // Insert: diagonal from (prevX, prevY+1) to (x, y)
      while (x > prevX) {
        x--;
        y--;
        ops.push({ type: 'equal', char: a[x] });
      }
      y--;
      ops.push({ type: 'insert', char: b[y] });
    } else {
      // Delete: diagonal from (prevX+1, prevY) to (x, y)
      while (x > prevX + 1) {
        x--;
        y--;
        ops.push({ type: 'equal', char: a[x] });
      }
      x--;
      ops.push({ type: 'delete', char: a[x] });
    }
  }

  // Remaining d=0 diagonal
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'equal', char: a[x] });
  }

  ops.reverse();

  // Coalesce adjacent ops of same type into segments
  return coalesceOps(ops);
}

function coalesceOps(ops: { type: 'equal' | 'insert' | 'delete'; char: string }[]): InlineDiffSegment[] {
  if (ops.length === 0) return [];

  const segments: InlineDiffSegment[] = [];
  let currentType = ops[0].type;
  let currentText = ops[0].char;

  for (let i = 1; i < ops.length; i++) {
    if (ops[i].type === currentType) {
      currentText += ops[i].char;
    } else {
      segments.push({
        text: currentText,
        type: currentType === 'equal' ? 'unchanged' : currentType === 'insert' ? 'added' : 'deleted',
      });
      currentType = ops[i].type;
      currentText = ops[i].char;
    }
  }

  segments.push({
    text: currentText,
    type: currentType === 'equal' ? 'unchanged' : currentType === 'insert' ? 'added' : 'deleted',
  });

  return segments;
}

function wordLevelDiff(a: string, b: string): InlineDiffSegment[] {
  const aWords = splitWords(a);
  const bWords = splitWords(b);

  // Simple LCS on words
  const segments: InlineDiffSegment[] = [];
  let ai = 0;
  let bi = 0;

  while (ai < aWords.length && bi < bWords.length) {
    if (aWords[ai] === bWords[bi]) {
      segments.push({ text: aWords[ai], type: 'unchanged' });
      ai++;
      bi++;
    } else {
      // Try to find the next matching word
      let foundA = -1;
      let foundB = -1;

      for (let j = bi + 1; j < Math.min(bi + 10, bWords.length); j++) {
        if (aWords[ai] === bWords[j]) { foundB = j; break; }
      }

      for (let j = ai + 1; j < Math.min(ai + 10, aWords.length); j++) {
        if (aWords[j] === bWords[bi]) { foundA = j; break; }
      }

      if (foundB !== -1 && (foundA === -1 || foundB - bi <= foundA - ai)) {
        // Words were inserted in b
        for (let j = bi; j < foundB; j++) {
          segments.push({ text: bWords[j], type: 'added' });
        }
        bi = foundB;
      } else if (foundA !== -1) {
        // Words were deleted from a
        for (let j = ai; j < foundA; j++) {
          segments.push({ text: aWords[j], type: 'deleted' });
        }
        ai = foundA;
      } else {
        segments.push({ text: aWords[ai], type: 'deleted' });
        segments.push({ text: bWords[bi], type: 'added' });
        ai++;
        bi++;
      }
    }
  }

  while (ai < aWords.length) {
    segments.push({ text: aWords[ai], type: 'deleted' });
    ai++;
  }
  while (bi < bWords.length) {
    segments.push({ text: bWords[bi], type: 'added' });
    bi++;
  }

  return segments;
}

function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') {
      if (current) words.push(current);
      words.push(ch);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);

  return words;
}
