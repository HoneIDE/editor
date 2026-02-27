import { describe, expect, test } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { UndoManager } from '../core/history/undo-manager';
import { CursorState } from '../core/cursor/cursor-manager';

function makeCursorState(line: number, col: number): CursorState {
  return { line, column: col, selectionAnchor: null, desiredColumn: col };
}

describe('UndoManager', () => {
  test('single edit undo restores original', () => {
    const buf = new TextBuffer('hello');
    const um = new UndoManager(buf);

    const before = [makeCursorState(0, 0)];
    buf.insert(5, ' world');
    const after = [makeCursorState(0, 11)];
    um.push(
      [{ offset: 5, deleteCount: 0, insertText: ' world' }],
      [''],
      before,
      after,
    );

    expect(buf.getText()).toBe('hello world');
    const cursors = um.undo();
    expect(buf.getText()).toBe('hello');
    expect(cursors).toEqual(before);
  });

  test('multiple edits, multiple undos', () => {
    const buf = new TextBuffer('abc');
    const um = new UndoManager(buf);

    // Edit 1: insert 'X' at offset 1
    const before1 = [makeCursorState(0, 1)];
    buf.insert(1, 'X');
    const after1 = [makeCursorState(0, 2)];
    um.push(
      [{ offset: 1, deleteCount: 0, insertText: 'X' }],
      [''],
      before1,
      after1,
      true,
    );
    expect(buf.getText()).toBe('aXbc');

    // Edit 2: insert 'Y' at offset 3
    const before2 = [makeCursorState(0, 3)];
    buf.insert(3, 'Y');
    const after2 = [makeCursorState(0, 4)];
    um.push(
      [{ offset: 3, deleteCount: 0, insertText: 'Y' }],
      [''],
      before2,
      after2,
      true,
    );
    expect(buf.getText()).toBe('aXbYc');

    // Undo edit 2
    um.undo();
    expect(buf.getText()).toBe('aXbc');

    // Undo edit 1
    um.undo();
    expect(buf.getText()).toBe('abc');
  });

  test('undo then redo restores the edit', () => {
    const buf = new TextBuffer('hello');
    const um = new UndoManager(buf);

    buf.insert(5, '!');
    um.push(
      [{ offset: 5, deleteCount: 0, insertText: '!' }],
      [''],
      [makeCursorState(0, 5)],
      [makeCursorState(0, 6)],
    );

    um.undo();
    expect(buf.getText()).toBe('hello');

    const cursors = um.redo();
    expect(buf.getText()).toBe('hello!');
    expect(cursors![0].column).toBe(6);
  });

  test('redo stack cleared on new edit after undo', () => {
    const buf = new TextBuffer('abc');
    const um = new UndoManager(buf);

    buf.insert(3, 'd');
    um.push(
      [{ offset: 3, deleteCount: 0, insertText: 'd' }],
      [''],
      [makeCursorState(0, 3)],
      [makeCursorState(0, 4)],
    );

    um.undo();
    expect(buf.getText()).toBe('abc');
    expect(um.canRedo).toBe(true);

    // New edit should clear redo
    buf.insert(3, 'e');
    um.push(
      [{ offset: 3, deleteCount: 0, insertText: 'e' }],
      [''],
      [makeCursorState(0, 3)],
      [makeCursorState(0, 4)],
    );

    expect(um.canRedo).toBe(false);
  });

  test('delete undo restores deleted text', () => {
    const buf = new TextBuffer('hello world');
    const um = new UndoManager(buf);

    const deleted = buf.delete(5, 6);
    um.push(
      [{ offset: 5, deleteCount: 6, insertText: '' }],
      [deleted],
      [makeCursorState(0, 5)],
      [makeCursorState(0, 5)],
    );

    expect(buf.getText()).toBe('hello');

    um.undo();
    expect(buf.getText()).toBe('hello world');
  });

  test('replace undo restores original text', () => {
    const buf = new TextBuffer('hello world');
    const um = new UndoManager(buf);

    const deleted = buf.getTextRange(6, 11);
    buf.applyEdits([{ offset: 6, deleteCount: 5, insertText: 'there' }]);
    um.push(
      [{ offset: 6, deleteCount: 5, insertText: 'there' }],
      [deleted],
      [makeCursorState(0, 6)],
      [makeCursorState(0, 11)],
    );

    expect(buf.getText()).toBe('hello there');

    um.undo();
    expect(buf.getText()).toBe('hello world');
  });

  test('canUndo / canRedo', () => {
    const buf = new TextBuffer('test');
    const um = new UndoManager(buf);

    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(false);

    buf.insert(4, '!');
    um.push(
      [{ offset: 4, deleteCount: 0, insertText: '!' }],
      [''],
      [makeCursorState(0, 4)],
      [makeCursorState(0, 5)],
    );

    expect(um.canUndo).toBe(true);
    expect(um.canRedo).toBe(false);

    um.undo();
    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(true);
  });

  test('clear removes all history', () => {
    const buf = new TextBuffer('test');
    const um = new UndoManager(buf);

    buf.insert(4, '!');
    um.push(
      [{ offset: 4, deleteCount: 0, insertText: '!' }],
      [''],
      [makeCursorState(0, 4)],
      [makeCursorState(0, 5)],
    );

    um.clear();
    expect(um.canUndo).toBe(false);
    expect(um.canRedo).toBe(false);
  });
});
