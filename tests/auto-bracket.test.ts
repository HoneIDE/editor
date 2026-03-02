import { describe, expect, test } from 'bun:test';
import { EditorDocument } from '../core/document/document';
import { EditorViewModel } from '../view-model/editor-view-model';

describe('Auto-Bracket Features', () => {
  function makeEditor(text: string) {
    const doc = new EditorDocument('test.ts', text);
    return new EditorViewModel(doc);
  }

  // === Auto-close pairs ===

  describe('auto-close brackets', () => {
    test('typing ( inserts ()', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '(' });
      expect(vm.document.buffer.getText()).toBe('()');
      expect(vm.cursors[0].column).toBe(1); // cursor between parens
    });

    test('typing { inserts {}', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('{}');
      expect(vm.cursors[0].column).toBe(1);
    });

    test('typing [ inserts []', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '[' });
      expect(vm.document.buffer.getText()).toBe('[]');
      expect(vm.cursors[0].column).toBe(1);
    });

    test('typing " inserts ""', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('""');
      expect(vm.cursors[0].column).toBe(1);
    });

    test("typing ' inserts ''", () => {
      const vm = makeEditor('');
      vm.executeCommand("editor.action.type", { text: "'" });
      expect(vm.document.buffer.getText()).toBe("''");
      expect(vm.cursors[0].column).toBe(1);
    });

    test('typing ` inserts ``', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '`' });
      expect(vm.document.buffer.getText()).toBe('``');
      expect(vm.cursors[0].column).toBe(1);
    });

    test('auto-close works in middle of line', () => {
      const vm = makeEditor('foo bar');
      vm.cursorManager.moveToPosition(0, 4, false); // after space
      vm.executeCommand('editor.action.type', { text: '(' });
      expect(vm.document.buffer.getText()).toBe('foo ()bar');
      expect(vm.cursors[0].column).toBe(5);
    });

    test('auto-close works at end of line', () => {
      const vm = makeEditor('hello');
      vm.cursorManager.moveToPosition(0, 5, false);
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('hello{}');
      expect(vm.cursors[0].column).toBe(6);
    });
  });

  // === Quote auto-close heuristics ===

  describe('quote auto-close heuristics', () => {
    test('no auto-close quote when next char is word char', () => {
      const vm = makeEditor('hello');
      // cursor at position 0, next char is 'h' (word char)
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('"hello');
      expect(vm.cursors[0].column).toBe(1);
    });

    test('no auto-close quote when prev char is word char', () => {
      const vm = makeEditor('hello');
      vm.cursorManager.moveToPosition(0, 5, false); // after 'o'
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('hello"');
      expect(vm.cursors[0].column).toBe(6);
    });

    test('auto-close quote after space', () => {
      const vm = makeEditor('let x = ');
      vm.cursorManager.moveToPosition(0, 8, false);
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('let x = ""');
      expect(vm.cursors[0].column).toBe(9);
    });

    test('auto-close quote after opening bracket', () => {
      const vm = makeEditor('foo(');
      vm.cursorManager.moveToPosition(0, 4, false);
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('foo(""');
      expect(vm.cursors[0].column).toBe(5);
    });

    test('no auto-close apostrophe in contractions', () => {
      const vm = makeEditor('dont');
      vm.cursorManager.moveToPosition(0, 3, false); // between 'n' and 't'
      vm.executeCommand('editor.action.type', { text: "'" });
      expect(vm.document.buffer.getText()).toBe("don't");
      expect(vm.cursors[0].column).toBe(4);
    });
  });

  // === Over-typing ===

  describe('over-type closing brackets', () => {
    test('type ) when next char is ) — over-type', () => {
      const vm = makeEditor('()');
      vm.cursorManager.moveToPosition(0, 1, false); // between ( and )
      vm.executeCommand('editor.action.type', { text: ')' });
      expect(vm.document.buffer.getText()).toBe('()');
      expect(vm.cursors[0].column).toBe(2);
    });

    test('type } when next char is } — over-type', () => {
      const vm = makeEditor('{}');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.type', { text: '}' });
      expect(vm.document.buffer.getText()).toBe('{}');
      expect(vm.cursors[0].column).toBe(2);
    });

    test('type ] when next char is ] — over-type', () => {
      const vm = makeEditor('[]');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.type', { text: ']' });
      expect(vm.document.buffer.getText()).toBe('[]');
      expect(vm.cursors[0].column).toBe(2);
    });

    test('type " when next char is " — over-type', () => {
      const vm = makeEditor('""');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('""');
      expect(vm.cursors[0].column).toBe(2);
    });

    test("type ' when next char is ' — over-type", () => {
      const vm = makeEditor("''");
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand("editor.action.type", { text: "'" });
      expect(vm.document.buffer.getText()).toBe("''");
      expect(vm.cursors[0].column).toBe(2);
    });

    test('type ) when next char is NOT ) — normal insert', () => {
      const vm = makeEditor('(x');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.type', { text: ')' });
      expect(vm.document.buffer.getText()).toBe('()x');
      expect(vm.cursors[0].column).toBe(2);
    });

    test('type } at end of line — normal insert', () => {
      const vm = makeEditor('{');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.type', { text: '}' });
      expect(vm.document.buffer.getText()).toBe('{}');
      expect(vm.cursors[0].column).toBe(2);
    });
  });

  // === Surround selection ===

  describe('surround selection', () => {
    test('select text and type ( wraps with ()', () => {
      const vm = makeEditor('hello');
      vm.cursorManager.moveToPosition(0, 0, false);
      vm.cursorManager.moveToPosition(0, 5, true); // select "hello"
      vm.executeCommand('editor.action.type', { text: '(' });
      expect(vm.document.buffer.getText()).toBe('(hello)');
    });

    test('select text and type { wraps with {}', () => {
      const vm = makeEditor('world');
      vm.cursorManager.moveToPosition(0, 0, false);
      vm.cursorManager.moveToPosition(0, 5, true);
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('{world}');
    });

    test('select text and type [ wraps with []', () => {
      const vm = makeEditor('items');
      vm.cursorManager.moveToPosition(0, 0, false);
      vm.cursorManager.moveToPosition(0, 5, true);
      vm.executeCommand('editor.action.type', { text: '[' });
      expect(vm.document.buffer.getText()).toBe('[items]');
    });

    test('select text and type " wraps with ""', () => {
      const vm = makeEditor('text');
      vm.cursorManager.moveToPosition(0, 0, false);
      vm.cursorManager.moveToPosition(0, 4, true);
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('"text"');
    });

    test('surround partial selection', () => {
      const vm = makeEditor('hello world');
      vm.cursorManager.moveToPosition(0, 6, false);
      vm.cursorManager.moveToPosition(0, 11, true); // select "world"
      vm.executeCommand('editor.action.type', { text: '(' });
      expect(vm.document.buffer.getText()).toBe('hello (world)');
    });

    test('surround selection preserves selection', () => {
      const vm = makeEditor('abc');
      vm.cursorManager.moveToPosition(0, 0, false);
      vm.cursorManager.moveToPosition(0, 3, true);
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('{abc}');
      // Selection should be maintained around the wrapped text
      expect(vm.cursors[0].selectionAnchor).not.toBeNull();
    });
  });

  // === Smart Enter ===

  describe('smart Enter after braces', () => {
    test('Enter between {} creates indented block', () => {
      const vm = makeEditor('{}');
      vm.cursorManager.moveToPosition(0, 1, false); // between { and }
      vm.executeCommand('editor.action.insertLineAfter');
      const lines = vm.document.buffer.getText().split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('{');
      expect(lines[1]).toBe('  '); // indented line
      expect(lines[2]).toBe('}');
      expect(vm.cursors[0].line).toBe(1);
      expect(vm.cursors[0].column).toBe(2);
    });

    test('Enter between {} with existing indent', () => {
      const vm = makeEditor('  {}');
      vm.cursorManager.moveToPosition(0, 3, false); // between { and }
      vm.executeCommand('editor.action.insertLineAfter');
      const lines = vm.document.buffer.getText().split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('  {');
      expect(lines[1]).toBe('    '); // 2+2 indent
      expect(lines[2]).toBe('  }');
      expect(vm.cursors[0].line).toBe(1);
      expect(vm.cursors[0].column).toBe(4);
    });

    test('Enter after { increases indent', () => {
      const vm = makeEditor('function foo() {');
      vm.cursorManager.moveToPosition(0, 16, false); // end of line after {
      vm.executeCommand('editor.action.insertLineAfter');
      const lines = vm.document.buffer.getText().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('function foo() {');
      expect(lines[1]).toBe('  '); // indented
      expect(vm.cursors[0].line).toBe(1);
      expect(vm.cursors[0].column).toBe(2);
    });

    test('Enter after { with existing indent increases by one level', () => {
      const vm = makeEditor('  if (true) {');
      vm.cursorManager.moveToPosition(0, 13, false);
      vm.executeCommand('editor.action.insertLineAfter');
      const lines = vm.document.buffer.getText().split('\n');
      expect(lines[1]).toBe('    '); // 2+2=4 spaces
    });

    test('Enter on normal line preserves indent', () => {
      const vm = makeEditor('  hello');
      vm.cursorManager.moveToPosition(0, 7, false);
      vm.executeCommand('editor.action.insertLineAfter');
      expect(vm.document.buffer.getLine(1)).toBe('  '); // preserved indent
      expect(vm.cursors[0].line).toBe(1);
      expect(vm.cursors[0].column).toBe(2);
    });

    test('Enter on non-indented line adds newline only', () => {
      const vm = makeEditor('hello');
      vm.cursorManager.moveToPosition(0, 5, false);
      vm.executeCommand('editor.action.insertLineAfter');
      expect(vm.document.buffer.getLine(1)).toBe('');
      expect(vm.cursors[0].line).toBe(1);
      expect(vm.cursors[0].column).toBe(0);
    });
  });

  // === Delete pair ===

  describe('delete pair (backspace between brackets)', () => {
    test('backspace between () deletes both', () => {
      const vm = makeEditor('()');
      vm.cursorManager.moveToPosition(0, 1, false); // between ( and )
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
      expect(vm.cursors[0].column).toBe(0);
    });

    test('backspace between {} deletes both', () => {
      const vm = makeEditor('{}');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
    });

    test('backspace between [] deletes both', () => {
      const vm = makeEditor('[]');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
    });

    test('backspace between "" deletes both', () => {
      const vm = makeEditor('""');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
    });

    test("backspace between '' deletes both", () => {
      const vm = makeEditor("''");
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand("editor.action.deleteLeft");
      expect(vm.document.buffer.getText()).toBe("");
    });

    test('backspace between `` deletes both', () => {
      const vm = makeEditor('``');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
    });

    test('backspace in non-pair position does normal backspace', () => {
      const vm = makeEditor('(x)');
      vm.cursorManager.moveToPosition(0, 2, false); // after x, before )
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('()');
    });

    test('pair delete with surrounding context', () => {
      const vm = makeEditor('foo()bar');
      vm.cursorManager.moveToPosition(0, 4, false); // between ( and )
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('foobar');
      expect(vm.cursors[0].column).toBe(3);
    });
  });

  // === Combined scenarios (real editing patterns) ===

  describe('real-world editing patterns', () => {
    test('type function with auto-close braces and smart Enter', () => {
      const vm = makeEditor('');
      // Type "function foo() {"
      vm.executeCommand('editor.action.type', { text: 'f' });
      vm.executeCommand('editor.action.type', { text: 'u' });
      vm.executeCommand('editor.action.type', { text: 'n' });
      vm.executeCommand('editor.action.type', { text: 'c' });
      vm.executeCommand('editor.action.type', { text: 't' });
      vm.executeCommand('editor.action.type', { text: 'i' });
      vm.executeCommand('editor.action.type', { text: 'o' });
      vm.executeCommand('editor.action.type', { text: 'n' });
      vm.executeCommand('editor.action.type', { text: ' ' });
      vm.executeCommand('editor.action.type', { text: 'f' });
      vm.executeCommand('editor.action.type', { text: 'o' });
      vm.executeCommand('editor.action.type', { text: 'o' });
      // Type ( — auto-closes to ()
      vm.executeCommand('editor.action.type', { text: '(' });
      expect(vm.document.buffer.getText()).toBe('function foo()');
      expect(vm.cursors[0].column).toBe(13); // between parens
      // Over-type the closing )
      vm.executeCommand('editor.action.type', { text: ')' });
      expect(vm.document.buffer.getText()).toBe('function foo()');
      expect(vm.cursors[0].column).toBe(14);
      // Type space and {
      vm.executeCommand('editor.action.type', { text: ' ' });
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('function foo() {}');
      expect(vm.cursors[0].column).toBe(16); // between braces
      // Press Enter for smart indent
      vm.executeCommand('editor.action.insertLineAfter');
      const lines = vm.document.buffer.getText().split('\n');
      expect(lines[0]).toBe('function foo() {');
      expect(lines[1]).toBe('  ');
      expect(lines[2]).toBe('}');
    });

    test('type string literal with auto-close quotes', () => {
      const vm = makeEditor('let x = ');
      vm.cursorManager.moveToPosition(0, 8, false);
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('let x = ""');
      expect(vm.cursors[0].column).toBe(9);
      // Type content between quotes
      vm.executeCommand('editor.action.type', { text: 'h' });
      vm.executeCommand('editor.action.type', { text: 'i' });
      expect(vm.document.buffer.getText()).toBe('let x = "hi"');
      expect(vm.cursors[0].column).toBe(11);
      // Over-type closing quote
      vm.executeCommand('editor.action.type', { text: '"' });
      expect(vm.document.buffer.getText()).toBe('let x = "hi"');
      expect(vm.cursors[0].column).toBe(12);
    });

    test('undo auto-close removes both characters', () => {
      const vm = makeEditor('');
      vm.executeCommand('editor.action.type', { text: '{' });
      expect(vm.document.buffer.getText()).toBe('{}');
      vm.executeCommand('editor.action.undo');
      expect(vm.document.buffer.getText()).toBe('');
    });

    test('undo pair delete restores both characters', () => {
      const vm = makeEditor('()');
      vm.cursorManager.moveToPosition(0, 1, false);
      vm.executeCommand('editor.action.deleteLeft');
      expect(vm.document.buffer.getText()).toBe('');
      vm.executeCommand('editor.action.undo');
      expect(vm.document.buffer.getText()).toBe('()');
    });
  });
});
