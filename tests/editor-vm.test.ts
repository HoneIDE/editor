import { describe, expect, test } from 'bun:test';
import { EditorDocument } from '../core/document/document';
import { EditorViewModel, getPerryCursorState } from '../view-model/editor-view-model';

describe('EditorViewModel', () => {
  function makeEditor(text: string) {
    const doc = new EditorDocument('test.ts', text);
    return new EditorViewModel(doc);
  }

  test('initial state', () => {
    const vm = makeEditor('hello world');
    expect(vm.cursors).toHaveLength(1);
    expect(vm.cursors[0].line).toBe(0);
    expect(vm.cursors[0].column).toBe(0);
    expect(vm.document.buffer.getText()).toBe('hello world');
  });

  test('type text via command', () => {
    const vm = makeEditor('');
    vm.executeCommand('editor.action.type', { text: 'hello' });
    expect(vm.document.buffer.getText()).toBe('hello');
    expect(vm.cursors[0].column).toBe(5);
  });

  test('type then undo', () => {
    const vm = makeEditor('abc');
    vm.executeCommand('editor.action.type', { text: 'X' });
    expect(vm.document.buffer.getText()).toBe('Xabc');
    vm.executeCommand('editor.action.undo');
    expect(vm.document.buffer.getText()).toBe('abc');
  });

  test('backspace', () => {
    const vm = makeEditor('hello');
    vm.cursorManager.moveToPosition(0, 5, false);
    vm.executeCommand('editor.action.deleteLeft');
    expect(vm.document.buffer.getText()).toBe('hell');
  });

  test('delete', () => {
    const vm = makeEditor('hello');
    vm.executeCommand('editor.action.deleteRight');
    expect(vm.document.buffer.getText()).toBe('ello');
  });

  test('enter inserts newline with auto-indent', () => {
    const vm = makeEditor('  hello');
    vm.cursorManager.moveToPosition(0, 7, false);
    vm.executeCommand('editor.action.insertLineAfter');
    expect(vm.document.buffer.getLineCount()).toBe(2);
    expect(vm.document.buffer.getLine(1)).toBe('  '); // auto-indent preserved
    expect(vm.cursors[0].line).toBe(1);
    expect(vm.cursors[0].column).toBe(2);
  });

  test('navigation commands', () => {
    const vm = makeEditor('line1\nline2\nline3');
    vm.executeCommand('editor.action.moveCursorDown');
    expect(vm.cursors[0].line).toBe(1);

    vm.executeCommand('editor.action.moveCursorRight');
    vm.executeCommand('editor.action.moveCursorRight');
    expect(vm.cursors[0].column).toBe(2);

    vm.executeCommand('editor.action.moveCursorToLineEnd');
    expect(vm.cursors[0].column).toBe(5);

    vm.executeCommand('editor.action.moveCursorToDocumentEnd');
    expect(vm.cursors[0].line).toBe(2);
  });

  test('select all', () => {
    const vm = makeEditor('hello\nworld');
    vm.executeCommand('editor.action.selectAll');
    const sels = vm.selections;
    expect(sels).toHaveLength(1);
    expect(sels[0].startLine).toBe(0);
    expect(sels[0].startColumn).toBe(0);
    expect(sels[0].endLine).toBe(1);
    expect(sels[0].endColumn).toBe(5);
  });

  test('key event handling', () => {
    const vm = makeEditor('hello');

    // Type 'a'
    const consumed = vm.onKeyDown({
      key: 'a', code: 'KeyA',
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(consumed).toBe(true);
    expect(vm.document.buffer.getText()).toBe('ahello');

    // Arrow right
    vm.onKeyDown({
      key: 'ArrowRight', code: 'ArrowRight',
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(vm.cursors[0].column).toBe(2);

    // Backspace
    vm.onKeyDown({
      key: 'Backspace', code: 'Backspace',
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(vm.document.buffer.getText()).toBe('aello');

    // Cmd+Z undo
    vm.onKeyDown({
      key: 'z', code: 'KeyZ',
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: true,
    });
    expect(vm.document.buffer.getText()).toBe('ahello');
  });

  // gh#4: in Perry mode (native + web) the caret is rendered from the
  // module-level _perryCursor* state. On web there's no Rust to own the cursor,
  // and the CommandRegistry's dynamic dispatch doesn't fire under Perry's AOT
  // runtime — so executeCommand falls through to the Perry-safe fallback
  // movement handlers. Those move the internal cursor but historically left the
  // _perryCursor* state stale, so arrow keys moved nothing on screen.
  // We emulate the AOT dispatch miss by forcing the registry to report "not
  // handled", which routes movement through exactly that fallback path.
  function makePerryEditor(text: string) {
    const vm = makeEditor(text);
    vm.setPerryMode(true);
    (vm.commandRegistry as any).execute = () => false;
    return vm;
  }
  const press = (vm: EditorViewModel, key: string, shiftKey = false) => vm.onKeyDown({
    key, code: key, ctrlKey: false, shiftKey, altKey: false, metaKey: false,
  });

  test('arrow-key navigation syncs the Perry cursor state (gh#4)', () => {
    const vm = makePerryEditor('hello\nworld');

    press(vm, 'ArrowRight');
    press(vm, 'ArrowRight');
    press(vm, 'ArrowDown');

    const cur = vm.cursors[0];
    expect(cur.line).toBe(1);
    expect(cur.column).toBe(2);

    // The rendered (Perry) cursor must mirror the internal cursor.
    const perry = getPerryCursorState();
    expect(perry.line).toBe(cur.line);
    expect(perry.col).toBe(cur.column);
  });

  test('Home/End navigation syncs the Perry cursor state (gh#4)', () => {
    const vm = makePerryEditor('hello world');
    press(vm, 'End');
    expect(getPerryCursorState().col).toBe(vm.cursors[0].column);
    expect(getPerryCursorState().col).toBe(11);
    press(vm, 'Home');
    expect(getPerryCursorState().col).toBe(0);
  });

  test('shift+arrow selection syncs the Perry anchor (gh#4)', () => {
    const vm = makePerryEditor('hello world');

    press(vm, 'ArrowRight');           // cursor → col 1, no selection
    expect(getPerryCursorState().anchorLine).toBe(-1);

    press(vm, 'ArrowRight', true);     // shift+right: start selecting
    press(vm, 'ArrowRight', true);
    const perry = getPerryCursorState();
    expect(perry.col).toBe(vm.cursors[0].column);
    expect(perry.anchorLine).toBeGreaterThanOrEqual(0); // anchor now set
  });

  test('visibleLines', () => {
    const vm = makeEditor('line1\nline2\nline3');
    vm.onResize(800, 600);
    const lines = vm.visibleLines;
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0].lineNumber).toBe(0);
    expect(lines[0].content).toBe('line1');
    expect(lines[0].gutterItems.length).toBeGreaterThan(0);
  });

  test('gutter width scales with line count', () => {
    const vm1 = makeEditor('a');
    const vm2 = makeEditor(Array(1000).fill('line').join('\n'));
    // 1000+ lines needs more gutter width than 1 line
    expect(vm2.gutterWidth).toBeGreaterThanOrEqual(vm1.gutterWidth);
  });

  test('scroll state', () => {
    const vm = makeEditor(Array(100).fill('line').join('\n'));
    vm.onResize(800, 200);
    const ss = vm.scrollState;
    expect(ss.viewportHeight).toBe(200);
    expect(ss.viewportWidth).toBe(800);
    expect(ss.scrollHeight).toBeGreaterThan(200);
    expect(ss.scrollTop).toBe(0);
  });

  test('onChange listener fires', () => {
    const vm = makeEditor('hello');
    let changeCount = 0;
    vm.onChange(() => changeCount++);
    vm.executeCommand('editor.action.type', { text: 'x' });
    expect(changeCount).toBeGreaterThan(0);
  });

  test('mouse click moves cursor', () => {
    const vm = makeEditor('hello\nworld');
    vm.onResize(800, 600);
    vm.setCharWidth(8);
    // Click at approximate position for line 1, column 3
    const lineHeight = vm.theme.fontSize * vm.theme.lineHeight;
    vm.onMouseDown({
      x: vm.gutterWidth + 3 * 8, y: lineHeight + 1,
      button: 0, clickCount: 1,
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(vm.cursors[0].line).toBe(1);
    expect(vm.cursors[0].column).toBe(3);
  });

  test('indent / outdent', () => {
    const vm = makeEditor('hello');
    vm.executeCommand('editor.action.indent');
    expect(vm.document.buffer.getLine(0)).toBe('  hello');

    vm.executeCommand('editor.action.outdent');
    expect(vm.document.buffer.getLine(0)).toBe('hello');
  });

  test('document isDirty', () => {
    const doc = new EditorDocument('test.ts', 'hello');
    const vm = new EditorViewModel(doc);

    // Note: isDirty compares snapshot IDs, each snapshot gets a new ID
    vm.executeCommand('editor.action.type', { text: '!' });
    expect(doc.isDirty).toBe(true);
  });

  test('document language detection', () => {
    expect(new EditorDocument('test.ts', '').languageId).toBe('typescript');
    expect(new EditorDocument('test.py', '').languageId).toBe('python');
    expect(new EditorDocument('test.rs', '').languageId).toBe('rust');
    expect(new EditorDocument('test.go', '').languageId).toBe('go');
    expect(new EditorDocument('test.md', '').languageId).toBe('markdown');
    expect(new EditorDocument('test.json', '').languageId).toBe('json');
    expect(new EditorDocument('test.html', '').languageId).toBe('html');
    expect(new EditorDocument('test.css', '').languageId).toBe('css');
  });
});
