/**
 * Hunk operations: merge adjacent hunks, split hunks, hunk navigation.
 */

import { DiffHunk } from './diff-model';

/**
 * Merge hunks that are within `contextLines` of each other.
 */
export function mergeAdjacentHunks(hunks: DiffHunk[], contextLines: number = 3): DiffHunk[] {
  if (hunks.length <= 1) return [...hunks];

  const result: DiffHunk[] = [{ ...hunks[0] }];

  for (let i = 1; i < hunks.length; i++) {
    const prev = result[result.length - 1];
    const curr = hunks[i];

    const gap = curr.originalRange.startLine - prev.originalRange.endLine;

    if (gap <= contextLines * 2) {
      // Merge
      prev.type = 'modify';
      prev.originalRange.endLine = curr.originalRange.endLine;
      prev.modifiedRange.endLine = curr.modifiedRange.endLine;
      // If either is pending, the merged hunk is pending
      if (curr.state === 'pending') prev.state = 'pending';
    } else {
      result.push({ ...curr });
    }
  }

  return result;
}

/**
 * Split a hunk at a line boundary.
 * Returns [before, after] or null if the line is not within the hunk.
 */
export function splitHunk(hunk: DiffHunk, splitLine: number): [DiffHunk, DiffHunk] | null {
  const origStart = hunk.originalRange.startLine;
  const origEnd = hunk.originalRange.endLine;

  if (splitLine <= origStart || splitLine >= origEnd) return null;

  const modSplit = hunk.modifiedRange.startLine + (splitLine - origStart);

  const before: DiffHunk = {
    type: hunk.type,
    originalRange: { startLine: origStart, endLine: splitLine },
    modifiedRange: { startLine: hunk.modifiedRange.startLine, endLine: modSplit },
    state: hunk.state,
  };

  const after: DiffHunk = {
    type: hunk.type,
    originalRange: { startLine: splitLine, endLine: origEnd },
    modifiedRange: { startLine: modSplit, endLine: hunk.modifiedRange.endLine },
    state: hunk.state,
  };

  return [before, after];
}

/**
 * Find the next/previous hunk from the current line.
 */
export function navigateHunks(
  hunks: DiffHunk[],
  currentLine: number,
  direction: 'next' | 'prev',
): DiffHunk | null {
  if (hunks.length === 0) return null;

  if (direction === 'next') {
    for (const hunk of hunks) {
      if (hunk.originalRange.startLine > currentLine) return hunk;
    }
    return hunks[0]; // wrap around
  }

  for (let i = hunks.length - 1; i >= 0; i--) {
    if (hunks[i].originalRange.startLine < currentLine) return hunks[i];
  }
  return hunks[hunks.length - 1]; // wrap around
}
