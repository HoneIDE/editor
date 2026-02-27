import { describe, expect, test } from 'bun:test';
import { TextBuffer, TextEdit } from '../core/buffer/text-buffer';

describe('TextBuffer', () => {
  describe('construction', () => {
    test('empty buffer', () => {
      const buf = new TextBuffer();
      expect(buf.getText()).toBe('');
      expect(buf.getLength()).toBe(0);
      expect(buf.getLineCount()).toBe(1); // always at least 1 line
    });

    test('single line', () => {
      const buf = new TextBuffer('hello');
      expect(buf.getText()).toBe('hello');
      expect(buf.getLength()).toBe(5);
      expect(buf.getLineCount()).toBe(1);
    });

    test('multiple lines', () => {
      const buf = new TextBuffer('line1\nline2\nline3');
      expect(buf.getText()).toBe('line1\nline2\nline3');
      expect(buf.getLineCount()).toBe(3);
    });

    test('normalizes \\r\\n to \\n', () => {
      const buf = new TextBuffer('line1\r\nline2\r\nline3');
      expect(buf.getText()).toBe('line1\nline2\nline3');
      expect(buf.getLineCount()).toBe(3);
    });

    test('normalizes \\r to \\n', () => {
      const buf = new TextBuffer('line1\rline2');
      expect(buf.getText()).toBe('line1\nline2');
      expect(buf.getLineCount()).toBe(2);
    });

    test('trailing newline', () => {
      const buf = new TextBuffer('hello\n');
      expect(buf.getLineCount()).toBe(2);
      expect(buf.getLine(0)).toBe('hello');
      expect(buf.getLine(1)).toBe('');
    });
  });

  describe('insert', () => {
    test('insert at beginning of empty buffer', () => {
      const buf = new TextBuffer();
      buf.insert(0, 'hello');
      expect(buf.getText()).toBe('hello');
    });

    test('insert at beginning', () => {
      const buf = new TextBuffer('world');
      buf.insert(0, 'hello ');
      expect(buf.getText()).toBe('hello world');
    });

    test('insert at middle', () => {
      const buf = new TextBuffer('helo');
      buf.insert(3, 'l');
      expect(buf.getText()).toBe('hello');
    });

    test('insert at end', () => {
      const buf = new TextBuffer('hello');
      buf.insert(5, ' world');
      expect(buf.getText()).toBe('hello world');
    });

    test('insert with newlines updates line count', () => {
      const buf = new TextBuffer('ab');
      buf.insert(1, '\n');
      expect(buf.getLineCount()).toBe(2);
      expect(buf.getLine(0)).toBe('a');
      expect(buf.getLine(1)).toBe('b');
    });

    test('insert multiple newlines', () => {
      const buf = new TextBuffer('ab');
      buf.insert(1, '\n\n\n');
      expect(buf.getLineCount()).toBe(4);
      expect(buf.getText()).toBe('a\n\n\nb');
    });

    test('multiple sequential inserts', () => {
      const buf = new TextBuffer();
      buf.insert(0, 'h');
      buf.insert(1, 'e');
      buf.insert(2, 'l');
      buf.insert(3, 'l');
      buf.insert(4, 'o');
      expect(buf.getText()).toBe('hello');
    });
  });

  describe('delete', () => {
    test('delete single character', () => {
      const buf = new TextBuffer('hello');
      buf.delete(1, 1);
      expect(buf.getText()).toBe('hllo');
    });

    test('delete from beginning', () => {
      const buf = new TextBuffer('hello');
      buf.delete(0, 2);
      expect(buf.getText()).toBe('llo');
    });

    test('delete from end', () => {
      const buf = new TextBuffer('hello');
      buf.delete(3, 2);
      expect(buf.getText()).toBe('hel');
    });

    test('delete entire content', () => {
      const buf = new TextBuffer('hello');
      buf.delete(0, 5);
      expect(buf.getText()).toBe('');
      expect(buf.getLength()).toBe(0);
    });

    test('delete returns deleted text', () => {
      const buf = new TextBuffer('hello world');
      const deleted = buf.delete(5, 6);
      expect(deleted).toBe(' world');
    });

    test('delete newline merges lines', () => {
      const buf = new TextBuffer('line1\nline2');
      buf.delete(5, 1); // delete the \n
      expect(buf.getText()).toBe('line1line2');
      expect(buf.getLineCount()).toBe(1);
    });

    test('delete spanning multiple lines', () => {
      const buf = new TextBuffer('aaa\nbbb\nccc');
      buf.delete(3, 5); // delete \nbbb\n
      expect(buf.getText()).toBe('aaaccc');
      expect(buf.getLineCount()).toBe(1);
    });

    test('delete zero length is no-op', () => {
      const buf = new TextBuffer('hello');
      const deleted = buf.delete(2, 0);
      expect(deleted).toBe('');
      expect(buf.getText()).toBe('hello');
    });
  });

  describe('getLine', () => {
    test('single line document', () => {
      const buf = new TextBuffer('hello');
      expect(buf.getLine(0)).toBe('hello');
    });

    test('multi-line document', () => {
      const buf = new TextBuffer('line1\nline2\nline3');
      expect(buf.getLine(0)).toBe('line1');
      expect(buf.getLine(1)).toBe('line2');
      expect(buf.getLine(2)).toBe('line3');
    });

    test('empty lines', () => {
      const buf = new TextBuffer('\n\n');
      expect(buf.getLineCount()).toBe(3);
      expect(buf.getLine(0)).toBe('');
      expect(buf.getLine(1)).toBe('');
      expect(buf.getLine(2)).toBe('');
    });

    test('out of range returns empty string', () => {
      const buf = new TextBuffer('hello');
      expect(buf.getLine(-1)).toBe('');
      expect(buf.getLine(1)).toBe('');
    });

    test('getLine after insert', () => {
      const buf = new TextBuffer('aaa\nbbb');
      buf.insert(4, 'xxx\n');
      expect(buf.getLine(0)).toBe('aaa');
      expect(buf.getLine(1)).toBe('xxx');
      expect(buf.getLine(2)).toBe('bbb');
    });
  });

  describe('getLineOffset / getOffsetLine', () => {
    test('line offsets for multi-line doc', () => {
      const buf = new TextBuffer('abc\ndef\nghi');
      expect(buf.getLineOffset(0)).toBe(0);
      expect(buf.getLineOffset(1)).toBe(4);
      expect(buf.getLineOffset(2)).toBe(8);
    });

    test('offset to line mapping', () => {
      const buf = new TextBuffer('abc\ndef\nghi');
      expect(buf.getOffsetLine(0)).toBe(0); // 'a'
      expect(buf.getOffsetLine(2)).toBe(0); // 'c'
      expect(buf.getOffsetLine(3)).toBe(0); // '\n'
      expect(buf.getOffsetLine(4)).toBe(1); // 'd'
      expect(buf.getOffsetLine(8)).toBe(2); // 'g'
      expect(buf.getOffsetLine(10)).toBe(2); // 'i'
    });

    test('round-trip: lineOffset -> offsetLine', () => {
      const buf = new TextBuffer('line1\nline2\nline3\nline4');
      for (let line = 0; line < buf.getLineCount(); line++) {
        const offset = buf.getLineOffset(line);
        expect(buf.getOffsetLine(offset)).toBe(line);
      }
    });
  });

  describe('getTextRange', () => {
    test('range within single line', () => {
      const buf = new TextBuffer('hello world');
      expect(buf.getTextRange(0, 5)).toBe('hello');
      expect(buf.getTextRange(6, 11)).toBe('world');
    });

    test('range spanning lines', () => {
      const buf = new TextBuffer('abc\ndef');
      expect(buf.getTextRange(2, 5)).toBe('c\nd');
    });

    test('empty range', () => {
      const buf = new TextBuffer('hello');
      expect(buf.getTextRange(2, 2)).toBe('');
    });
  });

  describe('applyEdits', () => {
    test('single insert edit', () => {
      const buf = new TextBuffer('hello');
      buf.applyEdits([{ offset: 5, deleteCount: 0, insertText: ' world' }]);
      expect(buf.getText()).toBe('hello world');
    });

    test('single delete edit', () => {
      const buf = new TextBuffer('hello world');
      buf.applyEdits([{ offset: 5, deleteCount: 6, insertText: '' }]);
      expect(buf.getText()).toBe('hello');
    });

    test('single replace edit', () => {
      const buf = new TextBuffer('hello world');
      buf.applyEdits([{ offset: 6, deleteCount: 5, insertText: 'there' }]);
      expect(buf.getText()).toBe('hello there');
    });

    test('multiple non-overlapping edits', () => {
      const buf = new TextBuffer('aaa bbb ccc');
      buf.applyEdits([
        { offset: 0, deleteCount: 3, insertText: 'xxx' },
        { offset: 4, deleteCount: 3, insertText: 'yyy' },
        { offset: 8, deleteCount: 3, insertText: 'zzz' },
      ]);
      expect(buf.getText()).toBe('xxx yyy zzz');
    });

    test('multiple edits with different sizes', () => {
      const buf = new TextBuffer('abc');
      buf.applyEdits([
        { offset: 0, deleteCount: 1, insertText: 'xx' },  // a -> xx
        { offset: 2, deleteCount: 1, insertText: '' },      // c -> (deleted)
      ]);
      expect(buf.getText()).toBe('xxb');
    });
  });

  describe('snapshot and restore', () => {
    test('snapshot captures current state', () => {
      const buf = new TextBuffer('hello');
      const snap = buf.snapshot();
      expect(snap.getText()).toBe('hello');
      expect(snap.length).toBe(5);
      expect(snap.lineCount).toBe(1);
    });

    test('snapshot unaffected by later edits', () => {
      const buf = new TextBuffer('hello');
      const snap = buf.snapshot();
      buf.insert(5, ' world');
      expect(snap.getText()).toBe('hello');
      expect(buf.getText()).toBe('hello world');
    });

    test('restore returns to snapshot state', () => {
      const buf = new TextBuffer('hello');
      const snap = buf.snapshot();
      buf.insert(5, ' world');
      buf.delete(0, 5);
      expect(buf.getText()).toBe(' world');
      buf.restoreSnapshot(snap);
      expect(buf.getText()).toBe('hello');
      expect(buf.getLength()).toBe(5);
      expect(buf.getLineCount()).toBe(1);
    });

    test('snapshot getLine works', () => {
      const buf = new TextBuffer('line1\nline2\nline3');
      const snap = buf.snapshot();
      expect(snap.getLine(0)).toBe('line1');
      expect(snap.getLine(1)).toBe('line2');
      expect(snap.getLine(2)).toBe('line3');
    });

    test('snapshot IDs are unique and increasing', () => {
      const buf = new TextBuffer('test');
      const snap1 = buf.snapshot();
      const snap2 = buf.snapshot();
      expect(snap2.id).toBeGreaterThan(snap1.id);
    });
  });

  describe('getLineLength', () => {
    test('single line', () => {
      const buf = new TextBuffer('hello');
      expect(buf.getLineLength(0)).toBe(5);
    });

    test('multi-line', () => {
      const buf = new TextBuffer('abc\ndefg\nhi');
      expect(buf.getLineLength(0)).toBe(3);
      expect(buf.getLineLength(1)).toBe(4);
      expect(buf.getLineLength(2)).toBe(2);
    });

    test('empty lines', () => {
      const buf = new TextBuffer('\n\n');
      expect(buf.getLineLength(0)).toBe(0);
      expect(buf.getLineLength(1)).toBe(0);
      expect(buf.getLineLength(2)).toBe(0);
    });
  });

  describe('insert + delete combined', () => {
    test('insert then delete same position', () => {
      const buf = new TextBuffer('hello');
      buf.insert(2, 'XY');
      expect(buf.getText()).toBe('heXYllo');
      buf.delete(2, 2);
      expect(buf.getText()).toBe('hello');
    });

    test('build up content character by character', () => {
      const buf = new TextBuffer();
      const target = 'the quick brown fox';
      for (let i = 0; i < target.length; i++) {
        buf.insert(i, target[i]);
      }
      expect(buf.getText()).toBe(target);
    });

    test('delete all content character by character from end', () => {
      const buf = new TextBuffer('abcdefgh');
      for (let i = 7; i >= 0; i--) {
        buf.delete(i, 1);
      }
      expect(buf.getText()).toBe('');
      expect(buf.getLength()).toBe(0);
    });
  });

  describe('stress tests', () => {
    test('many sequential inserts', () => {
      const buf = new TextBuffer();
      const n = 10000;
      for (let i = 0; i < n; i++) {
        buf.insert(buf.getLength(), `line ${i}\n`);
      }
      expect(buf.getLineCount()).toBe(n + 1); // n newlines = n+1 lines
      expect(buf.getLine(0)).toBe('line 0');
      expect(buf.getLine(n - 1)).toBe(`line ${n - 1}`);
    });

    test('random inserts and deletes match naive string', () => {
      let naive = '';
      const buf = new TextBuffer();
      const rng = mulberry32(42);

      for (let i = 0; i < 1000; i++) {
        if (naive.length === 0 || rng() < 0.6) {
          // Insert
          const pos = Math.floor(rng() * (naive.length + 1));
          const chars = 'abcdefg\nhijklmn\n';
          const len = Math.floor(rng() * 10) + 1;
          let text = '';
          for (let j = 0; j < len; j++) {
            text += chars[Math.floor(rng() * chars.length)];
          }
          naive = naive.slice(0, pos) + text + naive.slice(pos);
          buf.insert(pos, text);
        } else {
          // Delete
          const pos = Math.floor(rng() * naive.length);
          const maxLen = Math.min(10, naive.length - pos);
          const len = Math.floor(rng() * maxLen) + 1;
          naive = naive.slice(0, pos) + naive.slice(pos + len);
          buf.delete(pos, len);
        }

        // Verify every 100 operations
        if (i % 100 === 99) {
          expect(buf.getText()).toBe(naive);
          expect(buf.getLength()).toBe(naive.length);

          const naiveLines = naive.split('\n');
          expect(buf.getLineCount()).toBe(naiveLines.length);
          for (let l = 0; l < naiveLines.length; l++) {
            expect(buf.getLine(l)).toBe(naiveLines[l]);
          }
        }
      }
    });
  });
});

// Simple deterministic PRNG for reproducible tests
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
