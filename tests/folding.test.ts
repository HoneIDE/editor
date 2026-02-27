import { describe, test, expect } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { FoldState } from '../core/folding/fold-state';
import { computeIndentFoldRanges } from '../core/folding/fold-provider';

function makeBuffer(text: string): TextBuffer {
  return new TextBuffer(text);
}

describe('computeIndentFoldRanges', () => {
  test('finds indent-based fold ranges', () => {
    const buf = makeBuffer([
      'function hello() {',
      '  console.log("hi");',
      '  if (true) {',
      '    return 1;',
      '  }',
      '}',
    ].join('\n'));

    const ranges = computeIndentFoldRanges(buf);
    expect(ranges.length).toBeGreaterThan(0);
    // First range should start at line 0 (function body is indented)
    expect(ranges[0].startLine).toBe(0);
  });

  test('handles flat code (no fold ranges)', () => {
    const buf = makeBuffer([
      'a = 1',
      'b = 2',
      'c = 3',
    ].join('\n'));

    const ranges = computeIndentFoldRanges(buf);
    expect(ranges.length).toBe(0);
  });

  test('skips blank lines', () => {
    const buf = makeBuffer([
      'def foo():',
      '  a = 1',
      '',
      '  b = 2',
    ].join('\n'));

    const ranges = computeIndentFoldRanges(buf);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0].startLine).toBe(0);
    expect(ranges[0].endLine).toBe(3);
  });
});

describe('FoldState', () => {
  const sampleRanges = [
    { startLine: 0, endLine: 5 },
    { startLine: 2, endLine: 4 },
    { startLine: 7, endLine: 10 },
  ];

  test('fold and unfold', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);

    fs.fold(0);
    expect(fs.getFoldState(0)).toBe('collapsed');
    expect(fs.isLineHidden(1)).toBe(true);
    expect(fs.isLineHidden(5)).toBe(true);
    expect(fs.isLineHidden(6)).toBe(false);

    fs.unfold(0);
    expect(fs.getFoldState(0)).toBe('expanded');
    expect(fs.isLineHidden(1)).toBe(false);
  });

  test('toggle', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);

    fs.toggle(0);
    expect(fs.getFoldState(0)).toBe('collapsed');

    fs.toggle(0);
    expect(fs.getFoldState(0)).toBe('expanded');
  });

  test('foldAll / unfoldAll', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);

    fs.foldAll();
    expect(fs.foldedCount).toBe(3);
    expect(fs.isLineHidden(1)).toBe(true);
    expect(fs.isLineHidden(3)).toBe(true);
    expect(fs.isLineHidden(8)).toBe(true);

    fs.unfoldAll();
    expect(fs.foldedCount).toBe(0);
    expect(fs.isLineHidden(1)).toBe(false);
  });

  test('getFoldState returns none for non-fold lines', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);

    expect(fs.getFoldState(1)).toBe('none');
    expect(fs.getFoldState(6)).toBe('none');
  });

  test('getHiddenLines returns all hidden line numbers', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);

    fs.fold(0);
    const hidden = fs.getHiddenLines();
    expect(hidden.has(1)).toBe(true);
    expect(hidden.has(2)).toBe(true);
    expect(hidden.has(3)).toBe(true);
    expect(hidden.has(4)).toBe(true);
    expect(hidden.has(5)).toBe(true);
    expect(hidden.has(0)).toBe(false);
    expect(hidden.has(6)).toBe(false);
  });

  test('onBufferEdit shifts ranges after edit', () => {
    const fs = new FoldState();
    fs.setAvailableRanges([{ startLine: 5, endLine: 10 }]);
    fs.fold(5);
    expect(fs.isLineHidden(7)).toBe(true);

    // Insert 3 lines at line 2 — foldedRanges shift, hidden lines move
    fs.onBufferEdit(2, 3);

    // The folded range moved from 5-10 to 8-13
    // isLineHidden checks foldedRanges which were shifted
    expect(fs.isLineHidden(9)).toBe(true);
    expect(fs.isLineHidden(13)).toBe(true);
    expect(fs.isLineHidden(7)).toBe(false);
  });

  test('onBufferEdit adjusts range containing edit', () => {
    const fs = new FoldState();
    fs.setAvailableRanges([{ startLine: 2, endLine: 8 }]);
    fs.fold(2);

    // Delete 2 lines within the range
    fs.onBufferEdit(4, -2);

    // Range should shrink: 2-6
    expect(fs.isLineHidden(3)).toBe(true);
    expect(fs.isLineHidden(6)).toBe(true);
    expect(fs.isLineHidden(7)).toBe(false);
  });

  test('setAvailableRanges removes stale folds', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);
    fs.fold(0);
    fs.fold(7);
    expect(fs.foldedCount).toBe(2);

    // Update available ranges — line 0 no longer foldable
    fs.setAvailableRanges([{ startLine: 7, endLine: 10 }]);
    expect(fs.foldedCount).toBe(1);
    expect(fs.getFoldState(0)).toBe('none');
    expect(fs.getFoldState(7)).toBe('collapsed');
  });

  test('fold non-existent range is no-op', () => {
    const fs = new FoldState();
    fs.setAvailableRanges(sampleRanges);
    fs.fold(99);
    expect(fs.foldedCount).toBe(0);
  });
});
