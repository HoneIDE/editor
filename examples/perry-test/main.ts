/**
 * Hone Editor — TypeScript Control Validation App
 *
 * Tests that the Perry component can be fully controlled from TypeScript:
 * content set/get, key events, text input, commands, onChange callbacks,
 * and FFI call verification. All tests use NoOpFFI so no native layer is
 * required — the same suite runs both under `bun run` and when Perry-compiled.
 *
 * Run standalone:
 *   bun run examples/perry-test/main.ts
 *
 * Build + run natively:
 *   perry compile examples/perry-test/main.ts --target macos
 *   ./examples/perry-test/main
 */

import { Editor } from '../../perry/editor-component';
import { NoOpFFI } from '../../native/ffi-bridge';

// ─── Inline test framework ────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;
let _currentSuite = '';
const _failures: string[] = [];

function suite(name: string): void {
  _currentSuite = name;
  console.log(`\n${name}`);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    _passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    _failed++;
    const msg = e instanceof Error ? e.message : String(e);
    _failures.push(`[${_currentSuite}] ${name}: ${msg}`);
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label = 'value'): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertContains(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`expected "${haystack}" to contain "${needle}"`);
  }
}

function assertGreater(actual: number, min: number, label = 'value'): void {
  if (actual <= min) {
    throw new Error(`${label}: expected > ${min}, got ${actual}`);
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEditor(opts?: { content?: string; language?: string; theme?: 'dark' | 'light'; fontSize?: number; fontFamily?: string }) {
  const ffi = new NoOpFFI();
  const editor = new Editor(800, 600, { ffi, ...opts });
  return { editor, ffi };
}

// ─── Suite 1: Construction ────────────────────────────────────────────────────

suite('Construction');

test('FFI create called with correct dimensions', () => {
  const { ffi } = makeEditor();
  const calls = ffi.getCalls('create');
  assertEqual(calls.length, 1, 'create call count');
  assertEqual(calls[0][0], 800, 'width');
  assertEqual(calls[0][1], 600, 'height');
});

test('default font applied to FFI', () => {
  const { ffi } = makeEditor();
  const calls = ffi.getCalls('setFont');
  assertGreater(calls.length, 0, 'setFont call count');
  const [, family, size] = calls[0];
  assertEqual(family, 'JetBrains Mono', 'font family');
  assertEqual(size, 14, 'font size');
});

test('custom font applied to FFI', () => {
  const { ffi } = makeEditor({ fontFamily: 'Fira Code', fontSize: 16 });
  const calls = ffi.getCalls('setFont');
  const [, family, size] = calls[0];
  assertEqual(family, 'Fira Code', 'font family');
  assertEqual(size, 16, 'font size');
});

test('nativeHandle is set after construction', () => {
  const { editor } = makeEditor();
  assert(editor.nativeHandle !== null, 'nativeHandle should not be null');
});

test('viewModel is accessible', () => {
  const { editor } = makeEditor();
  assert(editor.viewModel !== undefined, 'viewModel should be defined');
});

test('document is accessible', () => {
  const { editor } = makeEditor();
  assert(editor.document !== undefined, 'document should be defined');
});

test('initial content from opts', () => {
  const { editor } = makeEditor({ content: 'hello world' });
  assertEqual(editor.content, 'hello world', 'initial content');
});

test('default content is empty', () => {
  const { editor } = makeEditor();
  assertEqual(editor.content, '', 'default content');
});

// ─── Suite 2: Content control ─────────────────────────────────────────────────

suite('Content control');

test('setContent replaces buffer text', () => {
  const { editor } = makeEditor();
  editor.setContent('foo bar baz');
  assertEqual(editor.content, 'foo bar baz', 'content after setContent');
});

test('setContent overwrites previous content', () => {
  const { editor } = makeEditor({ content: 'old text' });
  editor.setContent('new text');
  assertEqual(editor.content, 'new text', 'content after overwrite');
});

test('setContent with empty string clears buffer', () => {
  const { editor } = makeEditor({ content: 'something' });
  editor.setContent('');
  assertEqual(editor.content, '', 'content after clear');
});

test('setContent triggers FFI invalidate', () => {
  const { editor, ffi } = makeEditor();
  ffi.reset();
  editor.setContent('trigger');
  assertGreater(ffi.getCalls('invalidate').length, 0, 'invalidate call count');
});

test('content setter (property) works', () => {
  const { editor } = makeEditor();
  editor.content = 'via setter';
  assertEqual(editor.content, 'via setter', 'content via setter');
});

test('document buffer reflects content', () => {
  const { editor } = makeEditor({ content: 'buffer check' });
  assertEqual(editor.document.buffer.getText(), 'buffer check', 'buffer text');
});

// ─── Suite 3: Text input ──────────────────────────────────────────────────────

suite('Text input');

test('onTextInput appends characters to empty buffer', () => {
  const { editor } = makeEditor();
  editor.onTextInput('hello');
  assertEqual(editor.content, 'hello', 'content after input');
});

test('onTextInput appends to existing content', () => {
  const { editor } = makeEditor();
  editor.onTextInput('foo');
  editor.onTextInput(' bar');
  assertEqual(editor.content, 'foo bar', 'content after two inputs');
});

test('onTextInput handles newlines', () => {
  const { editor } = makeEditor();
  editor.onTextInput('line1\nline2');
  assertContains(editor.content, 'line1');
  assertContains(editor.content, 'line2');
});

test('onTextInput single characters accumulate', () => {
  const { editor } = makeEditor();
  editor.onTextInput('a');
  editor.onTextInput('b');
  editor.onTextInput('c');
  assertEqual(editor.content, 'abc', 'content after single chars');
});

// ─── Suite 4: Key events ──────────────────────────────────────────────────────

suite('Key events');

test('onKeyDown returns boolean', () => {
  const { editor } = makeEditor({ content: 'test' });
  const result = editor.onKeyDown('ArrowRight');
  assertEqual(typeof result, 'boolean', 'return type');
});

test('Backspace deletes last character', () => {
  const { editor } = makeEditor();
  editor.onTextInput('abc');
  editor.onKeyDown('Backspace');
  assertEqual(editor.content, 'ab', 'content after backspace');
});

test('Enter inserts newline', () => {
  const { editor } = makeEditor({ content: 'line1' });
  editor.onKeyDown('End');
  editor.onKeyDown('Enter');
  assertContains(editor.content, '\n');
});

test('arrow key navigates without changing content', () => {
  const { editor } = makeEditor({ content: 'hello' });
  const before = editor.content;
  editor.onKeyDown('ArrowLeft');
  editor.onKeyDown('ArrowRight');
  assertEqual(editor.content, before, 'content unchanged by arrow keys');
});

test('modifier keys are accepted', () => {
  const { editor } = makeEditor({ content: 'x' });
  // Ctrl+A is select-all, should not throw
  const result = editor.onKeyDown('a', { ctrl: true });
  assertEqual(typeof result, 'boolean', 'modifier key result type');
});

// ─── Suite 5: Commands ────────────────────────────────────────────────────────

suite('Commands');

test('executeCommand returns boolean', () => {
  const { editor } = makeEditor();
  const r = editor.executeCommand('editor.action.undo');
  assertEqual(typeof r, 'boolean', 'return type');
});

test('undo removes last text input', () => {
  const { editor } = makeEditor();
  editor.onTextInput('typed text');
  assertEqual(editor.content, 'typed text', 'content before undo');
  editor.executeCommand('editor.action.undo');
  assertEqual(editor.content, '', 'content after undo');
});

test('redo re-applies undone input', () => {
  const { editor } = makeEditor();
  editor.onTextInput('hello');
  editor.executeCommand('editor.action.undo');
  editor.executeCommand('editor.action.redo');
  assertEqual(editor.content, 'hello', 'content after redo');
});

test('multiple undo steps', () => {
  const { editor } = makeEditor();
  // Each onTextInput call is a separate undo group when text differs enough
  editor.onTextInput('first ');
  editor.onTextInput('second');
  editor.executeCommand('editor.action.undo');
  // After undo, 'second' should be gone; content should have only 'first '
  const afterUndo = editor.content;
  assert(afterUndo.length < 'first second'.length, 'undo reduced content length');
});

test('unknown command returns false', () => {
  const { editor } = makeEditor();
  const r = editor.executeCommand('editor.nonexistent.command');
  assertEqual(r, false, 'unknown command result');
});

// ─── Suite 6: onChange callbacks ──────────────────────────────────────────────

suite('onChange callbacks');

test('onChange fires on text input', () => {
  const { editor } = makeEditor();
  let fired = false;
  editor.onChange(() => { fired = true; });
  editor.onTextInput('x');
  assert(fired, 'onChange should fire after text input');
});

test('onChange fires on setContent', () => {
  const { editor } = makeEditor();
  let count = 0;
  editor.onChange(() => { count++; });
  editor.setContent('new content');
  assertGreater(count, 0, 'onChange fire count');
});

test('onChange fires on key event that modifies content', () => {
  const { editor } = makeEditor();
  editor.onTextInput('abc');
  let fired = false;
  editor.onChange(() => { fired = true; });
  editor.onKeyDown('Backspace');
  assert(fired, 'onChange should fire after backspace');
});

test('onChange fires on resize', () => {
  const { editor } = makeEditor();
  let fired = false;
  editor.onChange(() => { fired = true; });
  editor.onResize(1024, 768);
  assert(fired, 'onChange should fire after resize');
});

test('unsubscribe stops notifications', () => {
  const { editor } = makeEditor();
  let count = 0;
  const unsub = editor.onChange(() => { count++; });
  editor.onTextInput('a');
  const countAfterFirst = count;
  unsub();
  editor.onTextInput('b');
  assertEqual(count, countAfterFirst, 'count should not increase after unsub');
});

test('multiple listeners all receive notification', () => {
  const { editor } = makeEditor();
  let a = 0;
  let b = 0;
  let c = 0;
  editor.onChange(() => { a++; });
  editor.onChange(() => { b++; });
  editor.onChange(() => { c++; });
  editor.onTextInput('trigger');
  assertGreater(a, 0, 'listener a fired');
  assertGreater(b, 0, 'listener b fired');
  assertGreater(c, 0, 'listener c fired');
});

test('onChange count reflects actual change events', () => {
  const { editor } = makeEditor();
  let count = 0;
  editor.onChange(() => { count++; });

  editor.onTextInput('first');
  const afterFirst = count;
  assertGreater(afterFirst, 0, 'fired after first input');

  editor.onTextInput(' second');
  assertGreater(count, afterFirst, 'fired again after second input');
});

// ─── Suite 7: FFI render calls ────────────────────────────────────────────────

suite('FFI render calls');

test('render produces beginFrame + endFrame pair', () => {
  const { editor, ffi } = makeEditor({ content: 'hello' });
  ffi.reset();
  editor.content = editor.content; // trigger invalidate
  editor.render();
  assertGreater(ffi.getCalls('beginFrame').length, 0, 'beginFrame calls');
  assertGreater(ffi.getCalls('endFrame').length, 0, 'endFrame calls');
});

test('render produces renderLine calls for visible content', () => {
  const { editor, ffi } = makeEditor({ content: 'line1\nline2\nline3' });
  ffi.reset();
  editor.content = editor.content; // trigger invalidate
  editor.render();
  assertGreater(ffi.getCalls('renderLine').length, 0, 'renderLine calls');
});

test('render calls setCursor', () => {
  const { editor, ffi } = makeEditor({ content: 'cursor test' });
  ffi.reset();
  editor.content = editor.content;
  editor.render();
  assertGreater(ffi.getCalls('setCursor').length, 0, 'setCursor calls');
});

test('setFont calls FFI setFont with new params', () => {
  const { editor, ffi } = makeEditor();
  ffi.reset();
  editor.setFont('Monaco', 16);
  const calls = ffi.getCalls('setFont');
  assertEqual(calls.length, 1, 'setFont call count');
  const [, family, size] = calls[0];
  assertEqual(family, 'Monaco', 'new font family');
  assertEqual(size, 16, 'new font size');
});

test('renderLine text matches content', () => {
  const { editor, ffi } = makeEditor({ content: 'unique-sentinel' });
  ffi.reset();
  editor.content = editor.content;
  editor.render();
  const lineCalls = ffi.getCalls('renderLine');
  const texts = lineCalls.map((args: any[]) => args[2]); // args: [handle, lineNum, text, tokens, y]
  const found = texts.some((t: string) => t.includes('unique-sentinel'));
  assert(found, 'renderLine should include content text');
});

// ─── Suite 8: Resize ──────────────────────────────────────────────────────────

suite('Resize');

test('onResize accepts new dimensions', () => {
  const { editor } = makeEditor();
  // should not throw
  editor.onResize(1920, 1080);
  assert(true, 'onResize completed');
});

test('onResize triggers re-render', () => {
  const { editor, ffi } = makeEditor({ content: 'resize test' });
  ffi.reset();
  editor.onResize(1024, 768);
  // The coordinator listens to vm.onChange which fires on resize
  assertGreater(ffi.getCalls('beginFrame').length, 0, 're-render on resize');
});

test('multiple resizes are all accepted', () => {
  const { editor } = makeEditor();
  editor.onResize(640, 480);
  editor.onResize(1280, 720);
  editor.onResize(1920, 1080);
  assert(true, 'multiple resizes completed');
});

// ─── Suite 9: Lifecycle (dispose) ─────────────────────────────────────────────

suite('Lifecycle / dispose');

test('dispose calls FFI destroy', () => {
  const { editor, ffi } = makeEditor();
  ffi.reset();
  editor.dispose();
  assertEqual(ffi.getCalls('destroy').length, 1, 'destroy call count');
});

test('dispose is idempotent', () => {
  const { editor, ffi } = makeEditor();
  ffi.reset();
  editor.dispose();
  editor.dispose(); // second call must not throw
  assertEqual(ffi.getCalls('destroy').length, 1, 'only one destroy call');
});

// ─── Suite 10: State readback ─────────────────────────────────────────────────

suite('State readback');

test('cursor is at position 0 after construction', () => {
  const { editor } = makeEditor();
  const cursors = editor.viewModel.cursors;
  assertEqual(cursors.length, 1, 'cursor count');
  assertEqual(cursors[0].line, 0, 'cursor line');
  assertEqual(cursors[0].column, 0, 'cursor column');
});

test('cursor advances after text input', () => {
  const { editor } = makeEditor();
  editor.onTextInput('hello');
  const cursors = editor.viewModel.cursors;
  assertGreater(cursors[0].column, 0, 'cursor column after input');
});

test('scroll state is readable', () => {
  const { editor } = makeEditor({ content: 'scroll test' });
  const scroll = editor.viewModel.scrollState;
  assert(typeof scroll.scrollTop === 'number', 'scrollTop is number');
  assert(typeof scroll.viewportHeight === 'number', 'viewportHeight is number');
});

test('visible lines reflect content', () => {
  const { editor } = makeEditor({ content: 'visible line' });
  const lines = editor.viewModel.visibleLines;
  assertGreater(lines.length, 0, 'visible line count');
  const hasContent = lines.some(l => l.content.includes('visible line'));
  assert(hasContent, 'visible lines should contain content text');
});

test('multiline content produces multiple visible lines', () => {
  const { editor } = makeEditor({ content: 'a\nb\nc\nd\ne' });
  const lines = editor.viewModel.visibleLines;
  assertGreater(lines.length, 1, 'multiple visible lines');
});

// ─── Results ──────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────');
console.log(`Results: ${_passed} passed, ${_failed} failed`);

if (_failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of _failures) {
    console.log(`  ✗ ${f}`);
  }
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
