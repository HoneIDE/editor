import { describe, expect, test } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { CursorManager } from '../core/cursor/cursor-manager';
import { findWordStart, findWordEnd, getWordAtColumn } from '../core/cursor/word-boundary';

describe('CursorManager', () => {
  function makeCursor(text: string) {
    const buf = new TextBuffer(text);
    return { buf, cm: new CursorManager(buf) };
  }

  describe('basic movement', () => {
    test('move right', () => {
      const { cm } = makeCursor('hello');
      cm.move('right', false);
      expect(cm.primary.column).toBe(1);
      cm.move('right', false);
      expect(cm.primary.column).toBe(2);
    });

    test('move left', () => {
      const { cm } = makeCursor('hello');
      cm.moveToPosition(0, 3, false);
      cm.move('left', false);
      expect(cm.primary.column).toBe(2);
    });

    test('move left at start of line wraps to previous', () => {
      const { cm } = makeCursor('abc\ndef');
      cm.moveToPosition(1, 0, false);
      cm.move('left', false);
      expect(cm.primary.line).toBe(0);
      expect(cm.primary.column).toBe(3);
    });

    test('move right at end of line wraps to next', () => {
      const { cm } = makeCursor('abc\ndef');
      cm.moveToPosition(0, 3, false);
      cm.move('right', false);
      expect(cm.primary.line).toBe(1);
      expect(cm.primary.column).toBe(0);
    });

    test('move up', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.moveToPosition(2, 3, false);
      cm.move('up', false);
      expect(cm.primary.line).toBe(1);
      expect(cm.primary.column).toBe(3);
    });

    test('move down', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.move('down', false);
      expect(cm.primary.line).toBe(1);
    });

    test('move up at first line stays', () => {
      const { cm } = makeCursor('hello');
      cm.move('up', false);
      expect(cm.primary.line).toBe(0);
    });

    test('move down at last line stays', () => {
      const { cm } = makeCursor('hello');
      cm.move('down', false);
      expect(cm.primary.line).toBe(0);
    });
  });

  describe('desired column preservation', () => {
    test('preserves desired column across short lines', () => {
      const { cm } = makeCursor('long line here\nhi\nlong line again');
      cm.moveToPosition(0, 10, false);
      expect(cm.primary.desiredColumn).toBe(10);

      cm.move('down', false); // line "hi" is only 2 chars
      expect(cm.primary.line).toBe(1);
      expect(cm.primary.column).toBe(2); // clamped to line end

      cm.move('down', false); // back to long line
      expect(cm.primary.line).toBe(2);
      expect(cm.primary.column).toBe(10); // restored
    });
  });

  describe('line start / line end', () => {
    test('move to line end', () => {
      const { cm } = makeCursor('hello world');
      cm.move('lineEnd', false);
      expect(cm.primary.column).toBe(11);
    });

    test('move to line start (first non-whitespace)', () => {
      const { cm } = makeCursor('  hello');
      cm.moveToPosition(0, 5, false);
      cm.move('lineStart', false);
      expect(cm.primary.column).toBe(2); // first non-ws

      cm.move('lineStart', false);
      expect(cm.primary.column).toBe(0); // column 0
    });

    test('document start / end', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.moveToPosition(1, 3, false);
      cm.move('documentStart', false);
      expect(cm.primary.line).toBe(0);
      expect(cm.primary.column).toBe(0);

      cm.move('documentEnd', false);
      expect(cm.primary.line).toBe(2);
      expect(cm.primary.column).toBe(5);
    });
  });

  describe('selection', () => {
    test('extend selection right', () => {
      const { cm } = makeCursor('hello');
      cm.move('right', true);
      cm.move('right', true);
      expect(cm.primary.selectionAnchor).toEqual({ line: 0, column: 0 });
      expect(cm.primary.column).toBe(2);
    });

    test('collapse selection on non-extend move', () => {
      const { cm } = makeCursor('hello');
      cm.move('right', true);
      cm.move('right', true);
      expect(cm.primary.selectionAnchor).not.toBeNull();

      cm.move('right', false); // should collapse to right edge
      expect(cm.primary.selectionAnchor).toBeNull();
      expect(cm.primary.column).toBe(2);
    });

    test('collapse selection on left move goes to start', () => {
      const { cm } = makeCursor('hello');
      cm.moveToPosition(0, 0, false);
      cm.move('right', true);
      cm.move('right', true);
      cm.move('right', true);
      // Selection: 0-3
      cm.move('left', false); // collapse to start
      expect(cm.primary.column).toBe(0);
      expect(cm.primary.selectionAnchor).toBeNull();
    });

    test('getSelections returns normalized ranges', () => {
      const { cm } = makeCursor('hello');
      // Select right
      cm.move('right', true);
      cm.move('right', true);
      const sels = cm.getSelections();
      expect(sels).toHaveLength(1);
      expect(sels[0]).toEqual({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 2 });
    });
  });

  describe('word movement', () => {
    test('move word right', () => {
      const { cm } = makeCursor('hello world');
      cm.moveByWord('right', false);
      expect(cm.primary.column).toBe(5);
    });

    test('move word left', () => {
      const { cm } = makeCursor('hello world');
      cm.moveToPosition(0, 11, false);
      cm.moveByWord('left', false);
      expect(cm.primary.column).toBe(6);
    });

    test('word right at end of line wraps', () => {
      const { cm } = makeCursor('abc\ndef');
      cm.moveToPosition(0, 3, false);
      cm.moveByWord('right', false);
      expect(cm.primary.line).toBe(1);
      expect(cm.primary.column).toBe(0);
    });

    test('word left at start of line wraps', () => {
      const { cm } = makeCursor('abc\ndef');
      cm.moveToPosition(1, 0, false);
      cm.moveByWord('left', false);
      expect(cm.primary.line).toBe(0);
      expect(cm.primary.column).toBe(3);
    });
  });

  describe('multi-cursor', () => {
    test('add cursor at position', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.addCursorAt(1, 2);
      expect(cm.cursors).toHaveLength(2);
    });

    test('add cursor at same position is no-op', () => {
      const { cm } = makeCursor('hello');
      cm.addCursorAt(0, 0);
      expect(cm.cursors).toHaveLength(1);
    });

    test('add cursor below', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.addCursorBelow();
      expect(cm.cursors).toHaveLength(2);
      expect(cm.cursors[0].line).toBe(0);
      expect(cm.cursors[1].line).toBe(1);
    });

    test('add cursor above', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.moveToPosition(2, 0, false);
      cm.addCursorAbove();
      expect(cm.cursors).toHaveLength(2);
      expect(cm.cursors[0].line).toBe(1);
      expect(cm.cursors[1].line).toBe(2);
    });

    test('cursors are sorted by position', () => {
      const { cm } = makeCursor('line1\nline2\nline3');
      cm.addCursorAt(2, 0);
      cm.addCursorAt(1, 0);
      expect(cm.cursors[0].line).toBe(0);
      expect(cm.cursors[1].line).toBe(1);
      expect(cm.cursors[2].line).toBe(2);
    });

    test('overlapping cursors are merged', () => {
      const { cm } = makeCursor('hello');
      cm.addCursorAt(0, 0); // same as primary
      expect(cm.cursors).toHaveLength(1);
    });

    test('addNextOccurrence (Ctrl+D)', () => {
      const { cm } = makeCursor('foo bar foo baz foo');
      cm.moveToPosition(0, 1, false); // inside first "foo"
      cm.addNextOccurrence(); // selects first "foo" AND adds next occurrence
      // First call: selects word under cursor + finds next
      expect(cm.cursors).toHaveLength(2);
      // First cursor has selection on first "foo"
      expect(cm.cursors[0].selectionAnchor).toEqual({ line: 0, column: 0 });
      expect(cm.cursors[0].column).toBe(3);

      cm.addNextOccurrence(); // adds third "foo"
      expect(cm.cursors).toHaveLength(3);
    });

    test('selectAllOccurrences', () => {
      const { cm } = makeCursor('foo bar foo baz foo');
      cm.moveToPosition(0, 1, false);
      cm.selectAllOccurrences();
      expect(cm.cursors).toHaveLength(3);
    });

    test('reset removes all secondary cursors', () => {
      const { cm } = makeCursor('hello\nworld');
      cm.addCursorAt(1, 0);
      expect(cm.cursors).toHaveLength(2);
      cm.reset(0, 0);
      expect(cm.cursors).toHaveLength(1);
    });
  });
});

describe('Word Boundary', () => {
  test('findWordEnd basic', () => {
    expect(findWordEnd('hello world', 0)).toBe(5);
    expect(findWordEnd('hello world', 5)).toBe(11); // space -> skips to end of "world"
  });

  test('findWordStart basic', () => {
    expect(findWordStart('hello world', 5)).toBe(0);
    expect(findWordStart('hello world', 11)).toBe(6);
  });

  test('camelCase boundaries', () => {
    expect(findWordEnd('camelCase', 0)).toBe(5); // "camel"
    expect(findWordEnd('camelCase', 5)).toBe(9); // "Case"
    expect(findWordStart('camelCase', 9)).toBe(5);
  });

  test('underscore boundaries', () => {
    expect(findWordEnd('snake_case', 0)).toBe(10); // whole word
  });

  test('getWordAtColumn', () => {
    expect(getWordAtColumn('hello world', 2)).toEqual([0, 5]);
    expect(getWordAtColumn('hello world', 7)).toEqual([6, 11]);
  });

  test('punctuation is its own word', () => {
    const [start, end] = getWordAtColumn('a+b', 1);
    expect(start).toBe(1);
    expect(end).toBe(2);
  });

  test('empty string', () => {
    expect(getWordAtColumn('', 0)).toEqual([0, 0]);
  });
});
