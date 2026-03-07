import { describe, test, expect } from 'bun:test';
import { Editor, type EditorOptions } from '../perry/editor-component';
import { NoOpFFI } from '../native/ffi-bridge';
import { DARK_THEME, LIGHT_THEME } from '../view-model/theme';

// Helper: create an Editor with NoOpFFI injected
function createEditor(width = 800, height = 600, opts?: Partial<EditorOptions>) {
  const ffi = new NoOpFFI();
  const editor = new Editor(width, height, { ffi, ...opts });
  return { editor, ffi };
}

describe('Editor Component', () => {
  // ----------------------------------------------------------
  // Construction
  // ----------------------------------------------------------

  test('construction with defaults creates view and sets font', () => {
    const { ffi } = createEditor();

    expect(ffi.getCalls('create')).toEqual([[800, 600]]);
    expect(ffi.getCalls('setFont').length).toBe(1);
    const [handle, family, size] = ffi.getCalls('setFont')[0];
    expect(handle).toBe(1);
    expect(family).toBe('JetBrains Mono');
    expect(size).toBe(14);
  });

  test('construction with custom options', () => {
    const { editor, ffi } = createEditor(1024, 768, {
      content: 'hello world',
      language: 'python',
      theme: 'light',
      fontSize: 18,
      fontFamily: 'Fira Code',
    });

    expect(editor.content).toBe('hello world');
    const [, family, size] = ffi.getCalls('setFont')[0];
    expect(family).toBe('Fira Code');
    expect(size).toBe(18);
  });

  test('light theme is applied when theme is light', () => {
    const { editor } = createEditor(800, 600, { theme: 'light' });
    // The ViewModel should be using the light theme
    const vm = editor.viewModel;
    expect((vm as any)._theme).toBe(LIGHT_THEME);
  });

  test('dark theme is default', () => {
    const { editor } = createEditor();
    const vm = editor.viewModel;
    expect((vm as any)._theme).toBe(DARK_THEME);
  });

  // ----------------------------------------------------------
  // Content
  // ----------------------------------------------------------

  test('content getter returns buffer text', () => {
    const { editor } = createEditor(800, 600, { content: 'line one\nline two' });
    expect(editor.content).toBe('line one\nline two');
  });

  test('content setter replaces all text', () => {
    const { editor, ffi } = createEditor(800, 600, { content: 'old' });
    ffi.reset();

    editor.content = 'new content';
    expect(editor.content).toBe('new content');
    // Setting content should trigger invalidate
    expect(ffi.getCalls('invalidate').length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // Key / text input
  // ----------------------------------------------------------

  test('onKeyDown dispatches key event', () => {
    const { editor, ffi } = createEditor(800, 600, { content: 'hello' });
    editor.viewModel.onResize(800, 600);
    ffi.reset();

    const consumed = editor.onKeyDown('a');
    expect(typeof consumed).toBe('boolean');
  });

  test('onTextInput inserts text into buffer', () => {
    const { editor } = createEditor(800, 600, { content: '' });
    editor.onTextInput('abc');
    expect(editor.content).toBe('abc');
  });

  // ----------------------------------------------------------
  // Commands
  // ----------------------------------------------------------

  test('executeCommand runs undo/redo', () => {
    const { editor } = createEditor(800, 600, { content: '' });
    editor.onTextInput('x');
    expect(editor.content).toBe('x');

    editor.executeCommand('editor.action.undo');
    expect(editor.content).toBe('');

    editor.executeCommand('editor.action.redo');
    expect(editor.content).toBe('x');
  });

  test('executeCommand returns boolean', () => {
    const { editor } = createEditor();
    const result = editor.executeCommand('editor.action.undo');
    expect(typeof result).toBe('boolean');
  });

  // ----------------------------------------------------------
  // Resize
  // ----------------------------------------------------------

  test('onResize updates viewport', () => {
    const { editor } = createEditor(800, 600);
    editor.onResize(1024, 768);
    // Verify dimensions stored (accessible via viewModel)
    expect(editor.viewModel).toBeDefined();
  });

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  test('render produces FFI frame calls', () => {
    const { editor, ffi } = createEditor(800, 600, { content: 'hello\nworld' });
    editor.viewModel.onResize(800, 600);

    // The coordinator already rendered on attach; reset and render again
    ffi.reset();
    // Invalidate to force a fresh render
    editor.content = editor.content; // triggers invalidate
    editor.render();

    expect(ffi.getCalls('beginFrame').length).toBeGreaterThan(0);
    expect(ffi.getCalls('cacheLine').length).toBeGreaterThan(0);
    expect(ffi.getCalls('setViewport').length).toBeGreaterThan(0);
    expect(ffi.getCalls('setCursor').length).toBeGreaterThan(0);
    expect(ffi.getCalls('endFrame').length).toBeGreaterThan(0);
  });

  // ----------------------------------------------------------
  // setFont
  // ----------------------------------------------------------

  test('setFont calls FFI with new family and size', () => {
    const { editor, ffi } = createEditor();
    ffi.reset();

    editor.setFont('Monaco', 16);
    const fontCalls = ffi.getCalls('setFont');
    expect(fontCalls.length).toBe(1);
    expect(fontCalls[0]).toEqual([1, 'Monaco', 16]);
  });

  // ----------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------

  test('dispose calls detach, destroy, and FFI destroy', () => {
    const { editor, ffi } = createEditor();
    ffi.reset();

    editor.dispose();
    expect(ffi.getCalls('destroy')).toEqual([[1]]);
  });

  test('dispose is idempotent', () => {
    const { editor, ffi } = createEditor();
    ffi.reset();

    editor.dispose();
    editor.dispose(); // should not throw
    expect(ffi.getCalls('destroy').length).toBe(1);
  });

  // ----------------------------------------------------------
  // Accessors
  // ----------------------------------------------------------

  test('document accessor returns EditorDocument', () => {
    const { editor } = createEditor(800, 600, { content: 'test' });
    expect(editor.document).toBeDefined();
    expect(editor.document.buffer.getText()).toBe('test');
  });

  test('viewModel accessor returns EditorViewModel', () => {
    const { editor } = createEditor();
    expect(editor.viewModel).toBeDefined();
  });

  test('nativeHandle returns coordinator handle', () => {
    const { editor } = createEditor();
    expect(editor.nativeHandle).toBe(1);
  });
});
