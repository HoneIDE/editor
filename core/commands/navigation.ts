/**
 * Navigation commands: move by char/word/line/page, go to line, matching bracket.
 */

import { CommandRegistry, CommandContext } from './registry';

export function registerNavigationCommands(registry: CommandRegistry): void {
  // Basic cursor movement
  registry.register('editor.action.moveCursorLeft', (ctx) => {
    ctx.editor.cursorManager.move('left', false);
  });

  registry.register('editor.action.moveCursorRight', (ctx) => {
    ctx.editor.cursorManager.move('right', false);
  });

  registry.register('editor.action.moveCursorUp', (ctx) => {
    ctx.editor.cursorManager.move('up', false);
  });

  registry.register('editor.action.moveCursorDown', (ctx) => {
    ctx.editor.cursorManager.move('down', false);
  });

  // Cursor movement with selection
  registry.register('editor.action.selectLeft', (ctx) => {
    ctx.editor.cursorManager.move('left', true);
  });

  registry.register('editor.action.selectRight', (ctx) => {
    ctx.editor.cursorManager.move('right', true);
  });

  registry.register('editor.action.selectUp', (ctx) => {
    ctx.editor.cursorManager.move('up', true);
  });

  registry.register('editor.action.selectDown', (ctx) => {
    ctx.editor.cursorManager.move('down', true);
  });

  // Word movement
  registry.register('editor.action.moveCursorWordLeft', (ctx) => {
    ctx.editor.cursorManager.moveByWord('left', false);
  });

  registry.register('editor.action.moveCursorWordRight', (ctx) => {
    ctx.editor.cursorManager.moveByWord('right', false);
  });

  registry.register('editor.action.selectWordLeft', (ctx) => {
    ctx.editor.cursorManager.moveByWord('left', true);
  });

  registry.register('editor.action.selectWordRight', (ctx) => {
    ctx.editor.cursorManager.moveByWord('right', true);
  });

  // Line start/end
  registry.register('editor.action.moveCursorToLineStart', (ctx) => {
    ctx.editor.cursorManager.move('lineStart', false);
  });

  registry.register('editor.action.moveCursorToLineEnd', (ctx) => {
    ctx.editor.cursorManager.move('lineEnd', false);
  });

  registry.register('editor.action.selectToLineStart', (ctx) => {
    ctx.editor.cursorManager.move('lineStart', true);
  });

  registry.register('editor.action.selectToLineEnd', (ctx) => {
    ctx.editor.cursorManager.move('lineEnd', true);
  });

  // Document start/end
  registry.register('editor.action.moveCursorToDocumentStart', (ctx) => {
    ctx.editor.cursorManager.move('documentStart', false);
  });

  registry.register('editor.action.moveCursorToDocumentEnd', (ctx) => {
    ctx.editor.cursorManager.move('documentEnd', false);
  });

  registry.register('editor.action.selectToDocumentStart', (ctx) => {
    ctx.editor.cursorManager.move('documentStart', true);
  });

  registry.register('editor.action.selectToDocumentEnd', (ctx) => {
    ctx.editor.cursorManager.move('documentEnd', true);
  });

  // Page up/down
  registry.register('editor.action.pageUp', (ctx) => {
    ctx.editor.cursorManager.move('pageUp', false);
  });

  registry.register('editor.action.pageDown', (ctx) => {
    ctx.editor.cursorManager.move('pageDown', false);
  });

  registry.register('editor.action.selectPageUp', (ctx) => {
    ctx.editor.cursorManager.move('pageUp', true);
  });

  registry.register('editor.action.selectPageDown', (ctx) => {
    ctx.editor.cursorManager.move('pageDown', true);
  });

  // Go to line
  registry.register('editor.action.goToLine', (ctx, args: { lineNumber: number }) => {
    const line = Math.max(0, Math.min(args.lineNumber, ctx.editor.document.buffer.getLineCount() - 1));
    ctx.editor.cursorManager.reset(line, 0);
    ctx.editor.viewport.revealLine(line, 'center');
  });
}
