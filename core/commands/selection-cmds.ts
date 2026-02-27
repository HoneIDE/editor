/**
 * Selection commands: select word, select line, select all, expand/shrink selection.
 */

import { CommandRegistry, CommandContext } from './registry';
import { getWordAtColumn } from '../cursor/word-boundary';

export function registerSelectionCommands(registry: CommandRegistry): void {
  registry.register('editor.action.selectAll', (ctx) => {
    const { editor } = ctx;
    const lastLine = editor.document.buffer.getLineCount() - 1;
    const lastCol = editor.document.buffer.getLineLength(lastLine);
    editor.cursorManager.reset(lastLine, lastCol);
    editor.cursorManager.primary.selectionAnchor = { line: 0, column: 0 };
  });

  registry.register('editor.action.selectWord', (ctx) => {
    const { editor } = ctx;
    const cursor = editor.cursorManager.primary;
    const lineText = editor.document.buffer.getLine(cursor.line);
    const [start, end] = getWordAtColumn(lineText, cursor.column);
    cursor.selectionAnchor = { line: cursor.line, column: start };
    cursor.column = end;
    cursor.desiredColumn = end;
  });

  registry.register('editor.action.selectLine', (ctx) => {
    const { editor } = ctx;
    const cursor = editor.cursorManager.primary;
    cursor.selectionAnchor = { line: cursor.line, column: 0 };
    if (cursor.line < editor.document.buffer.getLineCount() - 1) {
      cursor.line++;
      cursor.column = 0;
    } else {
      cursor.column = editor.document.buffer.getLineLength(cursor.line);
    }
    cursor.desiredColumn = cursor.column;
  });
}
