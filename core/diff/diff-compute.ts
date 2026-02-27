/**
 * Myers diff algorithm implementation.
 *
 * Based on "An O(ND) Difference Algorithm and Its Variations" by Eugene Myers.
 * Computes the shortest edit script between two arrays of lines.
 */

import { DiffResult, DiffHunk } from './diff-model';

interface EditOp {
  type: 'insert' | 'delete' | 'equal';
  originalLine: number;
  modifiedLine: number;
}

/**
 * Compute a line-level diff between two text contents.
 */
export function computeDiff(originalText: string, modifiedText: string): DiffResult {
  const originalLines = originalText.length === 0 ? [] : originalText.split('\n');
  const modifiedLines = modifiedText.length === 0 ? [] : modifiedText.split('\n');

  return computeLineDiff(originalLines, modifiedLines);
}

/**
 * Compute diff between two arrays of lines.
 */
export function computeLineDiff(originalLines: string[], modifiedLines: string[]): DiffResult {
  const N = originalLines.length;
  const M = modifiedLines.length;

  if (N === 0 && M === 0) {
    return { hunks: [], totalAdded: 0, totalDeleted: 0 };
  }

  if (N === 0) {
    return {
      hunks: [{
        type: 'add',
        originalRange: { startLine: 0, endLine: 0 },
        modifiedRange: { startLine: 0, endLine: M },
        state: 'pending',
      }],
      totalAdded: M,
      totalDeleted: 0,
    };
  }

  if (M === 0) {
    return {
      hunks: [{
        type: 'delete',
        originalRange: { startLine: 0, endLine: N },
        modifiedRange: { startLine: 0, endLine: 0 },
        state: 'pending',
      }],
      totalAdded: 0,
      totalDeleted: N,
    };
  }

  // Hash lines for fast comparison
  const originalHashes = originalLines.map(hashLine);
  const modifiedHashes = modifiedLines.map(hashLine);

  // Myers algorithm
  const editOps = myersDiff(originalLines, modifiedLines, originalHashes, modifiedHashes);

  // Group edit operations into hunks
  return buildHunks(editOps, N, M);
}

function myersDiff(
  a: string[],
  b: string[],
  aHashes: number[],
  bHashes: number[],
): EditOp[] {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;

  // Timeout protection: if diff is too large, fall back
  if (MAX > 200000) {
    return fallbackDiff(N, M);
  }

  const vSize = 2 * MAX + 1;
  const v = new Int32Array(vSize);
  v.fill(0);
  const vOffset = MAX;

  // Store trace for path reconstruction
  const trace: Int32Array[] = [];

  for (let d = 0; d <= MAX; d++) {
    // Save v state BEFORE this iteration for backtracking
    trace.push(new Int32Array(v));

    for (let k = -d; k <= d; k += 2) {
      let x: number;

      if (k === -d || (k !== d && v[k - 1 + vOffset] < v[k + 1 + vOffset])) {
        x = v[k + 1 + vOffset]; // move down (insert)
      } else {
        x = v[k - 1 + vOffset] + 1; // move right (delete)
      }

      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < N && y < M && aHashes[x] === bHashes[y] && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + vOffset] = x;

      if (x >= N && y >= M) {
        // Found the shortest edit script
        return backtrack(trace, d, vOffset, N, M, a, b);
      }
    }
  }

  // Should not reach here for valid inputs
  return fallbackDiff(N, M);
}

function backtrack(
  trace: Int32Array[],
  d: number,
  vOffset: number,
  N: number,
  M: number,
  a: string[],
  b: string[],
): EditOp[] {
  const ops: EditOp[] = [];
  let x = N;
  let y = M;

  for (let i = d; i > 0; i--) {
    const k = x - y;
    const vPrev = trace[i]; // v state at START of iteration i (before the edit move)

    let prevK: number;
    if (k === -i || (k !== i && vPrev[k - 1 + vOffset] < vPrev[k + 1 + vOffset])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vPrev[prevK + vOffset];
    const prevY = prevX - prevK;

    // Walk diagonal backwards from (x,y) to post-edit position, then do the edit move
    if (prevK === k + 1) {
      // Insert: post-edit position is (prevX, prevY+1), diagonal to (x, y)
      while (x > prevX) {
        x--;
        y--;
        ops.push({ type: 'equal', originalLine: x, modifiedLine: y });
      }
      // Edit move: insert (move down)
      y--;
      ops.push({ type: 'insert', originalLine: x, modifiedLine: y });
    } else {
      // Delete: post-edit position is (prevX+1, prevY), diagonal to (x, y)
      while (x > prevX + 1) {
        x--;
        y--;
        ops.push({ type: 'equal', originalLine: x, modifiedLine: y });
      }
      // Edit move: delete (move right)
      x--;
      ops.push({ type: 'delete', originalLine: x, modifiedLine: y });
    }
  }

  // Remaining diagonal at the start (d=0 diagonal)
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'equal', originalLine: x, modifiedLine: y });
  }

  ops.reverse();
  return ops;
}

function fallbackDiff(N: number, M: number): EditOp[] {
  const ops: EditOp[] = [];
  for (let i = 0; i < N; i++) {
    ops.push({ type: 'delete', originalLine: i, modifiedLine: 0 });
  }
  for (let i = 0; i < M; i++) {
    ops.push({ type: 'insert', originalLine: N, modifiedLine: i });
  }
  return ops;
}

function buildHunks(ops: EditOp[], originalLineCount: number, modifiedLineCount: number): DiffResult {
  const hunks: DiffHunk[] = [];
  let totalAdded = 0;
  let totalDeleted = 0;
  let i = 0;

  while (i < ops.length) {
    // Skip equal operations
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }

    // Collect consecutive non-equal operations into a hunk
    let deleteStart = -1;
    let deleteEnd = -1;
    let insertStart = -1;
    let insertEnd = -1;

    while (i < ops.length && ops[i].type !== 'equal') {
      const op = ops[i];
      if (op.type === 'delete') {
        if (deleteStart === -1) deleteStart = op.originalLine;
        deleteEnd = op.originalLine + 1;
        totalDeleted++;
      } else if (op.type === 'insert') {
        if (insertStart === -1) insertStart = op.modifiedLine;
        insertEnd = op.modifiedLine + 1;
        totalAdded++;
      }
      i++;
    }

    let type: DiffHunk['type'];
    if (deleteStart !== -1 && insertStart !== -1) {
      type = 'modify';
    } else if (deleteStart !== -1) {
      type = 'delete';
    } else {
      type = 'add';
    }

    hunks.push({
      type,
      originalRange: {
        startLine: deleteStart === -1 ? (insertStart !== -1 ? insertStart : 0) : deleteStart,
        endLine: deleteEnd === -1 ? (insertStart !== -1 ? insertStart : 0) : deleteEnd,
      },
      modifiedRange: {
        startLine: insertStart === -1 ? (deleteStart !== -1 ? deleteStart : 0) : insertStart,
        endLine: insertEnd === -1 ? (deleteStart !== -1 ? deleteStart : 0) : insertEnd,
      },
      state: 'pending',
    });
  }

  return { hunks, totalAdded, totalDeleted };
}

/**
 * Simple FNV-1a hash for fast line comparison.
 */
function hashLine(line: string): number {
  let hash = 2166136261;
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i);
    hash = (hash * 16777619) | 0;
  }
  return hash;
}
