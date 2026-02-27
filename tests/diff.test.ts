import { describe, test, expect } from 'bun:test';
import { computeDiff, computeLineDiff } from '../core/diff/diff-compute';
import { mergeAdjacentHunks, splitHunk, navigateHunks } from '../core/diff/hunk';
import { computeInlineDiff } from '../core/diff/inline-diff';
import type { DiffHunk } from '../core/diff/diff-model';

describe('computeDiff', () => {
  test('identical texts produce no hunks', () => {
    const result = computeDiff('hello\nworld', 'hello\nworld');
    expect(result.hunks.length).toBe(0);
    expect(result.totalAdded).toBe(0);
    expect(result.totalDeleted).toBe(0);
  });

  test('empty original to non-empty modified', () => {
    const result = computeDiff('', 'hello\nworld');
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0].type).toBe('add');
    expect(result.totalAdded).toBe(2);
  });

  test('non-empty original to empty modified', () => {
    const result = computeDiff('hello\nworld', '');
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0].type).toBe('delete');
    expect(result.totalDeleted).toBe(2);
  });

  test('single line addition', () => {
    const result = computeDiff('a\nc', 'a\nb\nc');
    expect(result.totalAdded).toBe(1);
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0].type).toBe('add');
  });

  test('single line deletion', () => {
    const result = computeDiff('a\nb\nc', 'a\nc');
    expect(result.totalDeleted).toBe(1);
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0].type).toBe('delete');
  });

  test('modification (delete + add)', () => {
    const result = computeDiff('a\nb\nc', 'a\nB\nc');
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0].type).toBe('modify');
  });

  test('both empty produces no hunks', () => {
    const result = computeDiff('', '');
    expect(result.hunks.length).toBe(0);
  });

  test('multi-hunk diff', () => {
    const original = 'a\nb\nc\nd\ne\nf\ng';
    const modified = 'a\nB\nc\nd\ne\nF\ng';
    const result = computeDiff(original, modified);
    expect(result.hunks.length).toBe(2);
  });

  test('hunks have pending state', () => {
    const result = computeDiff('a', 'b');
    for (const hunk of result.hunks) {
      expect(hunk.state).toBe('pending');
    }
  });
});

describe('computeLineDiff', () => {
  test('array-based diff', () => {
    const result = computeLineDiff(['a', 'b', 'c'], ['a', 'c']);
    expect(result.totalDeleted).toBe(1);
    expect(result.hunks[0].type).toBe('delete');
  });
});

describe('mergeAdjacentHunks', () => {
  test('merges hunks within context range', () => {
    const hunks: DiffHunk[] = [
      { type: 'delete', originalRange: { startLine: 1, endLine: 2 }, modifiedRange: { startLine: 1, endLine: 1 }, state: 'pending' },
      { type: 'add', originalRange: { startLine: 4, endLine: 4 }, modifiedRange: { startLine: 3, endLine: 4 }, state: 'pending' },
    ];
    const merged = mergeAdjacentHunks(hunks, 3);
    expect(merged.length).toBe(1);
    expect(merged[0].type).toBe('modify');
  });

  test('does not merge distant hunks', () => {
    const hunks: DiffHunk[] = [
      { type: 'delete', originalRange: { startLine: 1, endLine: 2 }, modifiedRange: { startLine: 1, endLine: 1 }, state: 'pending' },
      { type: 'add', originalRange: { startLine: 20, endLine: 20 }, modifiedRange: { startLine: 19, endLine: 20 }, state: 'pending' },
    ];
    const merged = mergeAdjacentHunks(hunks, 3);
    expect(merged.length).toBe(2);
  });

  test('single hunk returns copy', () => {
    const hunks: DiffHunk[] = [
      { type: 'add', originalRange: { startLine: 0, endLine: 0 }, modifiedRange: { startLine: 0, endLine: 1 }, state: 'pending' },
    ];
    const merged = mergeAdjacentHunks(hunks);
    expect(merged.length).toBe(1);
  });

  test('empty array returns empty', () => {
    expect(mergeAdjacentHunks([])).toEqual([]);
  });
});

describe('splitHunk', () => {
  test('splits hunk at line boundary', () => {
    const hunk: DiffHunk = {
      type: 'modify',
      originalRange: { startLine: 0, endLine: 10 },
      modifiedRange: { startLine: 0, endLine: 10 },
      state: 'pending',
    };

    const result = splitHunk(hunk, 5);
    expect(result).not.toBeNull();
    expect(result![0].originalRange.endLine).toBe(5);
    expect(result![1].originalRange.startLine).toBe(5);
  });

  test('returns null for out-of-range split', () => {
    const hunk: DiffHunk = {
      type: 'modify',
      originalRange: { startLine: 0, endLine: 10 },
      modifiedRange: { startLine: 0, endLine: 10 },
      state: 'pending',
    };

    expect(splitHunk(hunk, 0)).toBeNull();
    expect(splitHunk(hunk, 10)).toBeNull();
    expect(splitHunk(hunk, 15)).toBeNull();
  });
});

describe('navigateHunks', () => {
  const hunks: DiffHunk[] = [
    { type: 'modify', originalRange: { startLine: 5, endLine: 8 }, modifiedRange: { startLine: 5, endLine: 8 }, state: 'pending' },
    { type: 'modify', originalRange: { startLine: 15, endLine: 18 }, modifiedRange: { startLine: 15, endLine: 18 }, state: 'pending' },
    { type: 'modify', originalRange: { startLine: 25, endLine: 28 }, modifiedRange: { startLine: 25, endLine: 28 }, state: 'pending' },
  ];

  test('next finds next hunk after line', () => {
    const h = navigateHunks(hunks, 10, 'next');
    expect(h!.originalRange.startLine).toBe(15);
  });

  test('next wraps around', () => {
    const h = navigateHunks(hunks, 30, 'next');
    expect(h!.originalRange.startLine).toBe(5);
  });

  test('prev finds previous hunk before line', () => {
    const h = navigateHunks(hunks, 20, 'prev');
    expect(h!.originalRange.startLine).toBe(15);
  });

  test('prev wraps around', () => {
    const h = navigateHunks(hunks, 2, 'prev');
    expect(h!.originalRange.startLine).toBe(25);
  });

  test('empty hunks returns null', () => {
    expect(navigateHunks([], 0, 'next')).toBeNull();
    expect(navigateHunks([], 0, 'prev')).toBeNull();
  });
});

describe('computeInlineDiff', () => {
  test('identical lines', () => {
    const segments = computeInlineDiff('hello world', 'hello world');
    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('unchanged');
    expect(segments[0].text).toBe('hello world');
  });

  test('empty original', () => {
    const segments = computeInlineDiff('', 'hello');
    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('added');
  });

  test('empty modified', () => {
    const segments = computeInlineDiff('hello', '');
    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('deleted');
  });

  test('character-level changes', () => {
    const segments = computeInlineDiff('hello world', 'hello earth');
    // Should have: "hello " unchanged, "world"/"earth" changed
    const unchangedCount = segments.filter(s => s.type === 'unchanged').length;
    const changedCount = segments.filter(s => s.type !== 'unchanged').length;
    expect(unchangedCount).toBeGreaterThan(0);
    expect(changedCount).toBeGreaterThan(0);
  });

  test('insertion in middle', () => {
    const segments = computeInlineDiff('abc', 'aXbc');
    const added = segments.filter(s => s.type === 'added');
    expect(added.length).toBe(1);
    expect(added[0].text).toBe('X');
  });

  test('deletion in middle', () => {
    const segments = computeInlineDiff('aXbc', 'abc');
    const deleted = segments.filter(s => s.type === 'deleted');
    expect(deleted.length).toBe(1);
    expect(deleted[0].text).toBe('X');
  });
});
