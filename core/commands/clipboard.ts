/**
 * Clipboard commands: copy, cut, paste.
 *
 * Uses a simple internal clipboard for the core module.
 * The actual platform clipboard integration is handled by the view layer
 * through perry/system clipboard API.
 */

import { CommandRegistry, CommandContext } from './registry';
import { normalizeSelection } from '../cursor/selection';

/** Internal clipboard for testing/core usage. Platform clipboard is injected. */
let internalClipboard: string = '';

export function setClipboard(text: string): void {
  internalClipboard = text;
}

export function getClipboard(): string {
  return internalClipboard;
}

export function registerClipboardCommands(registry: CommandRegistry): void {
  registry.register('editor.action.copy', (ctx) => {
    const { editor } = ctx;
    const cursor = editor.cursorManager.primary;

    if (cursor.selectionAnchor) {
      const sel = normalizeSelection(
        cursor.selectionAnchor,
        { line: cursor.line, column: cursor.column },
      );
      const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
      const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
      const text = editor.document.buffer.getTextRange(startOffset, endOffset);
      setClipboard(text);
    } else {
      // No selection: copy entire line
      const lineText = editor.document.buffer.getLine(cursor.line);
      setClipboard(lineText + '\n');
    }
  });

  registry.register('editor.action.cut', (ctx) => {
    const { editor } = ctx;
    // First copy
    registry.execute('editor.action.copy', ctx);

    // Then delete
    const cursor = editor.cursorManager.primary;
    if (cursor.selectionAnchor) {
      registry.execute('editor.action.deleteLeft', ctx);
    } else {
      // Cut entire line
      const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
      const lineOffset = editor.document.buffer.getLineOffset(cursor.line);
      const lineLen = editor.document.buffer.getLineLength(cursor.line);
      let deleteCount = lineLen;
      // Also delete the newline if not the last line
      if (cursor.line < editor.document.buffer.getLineCount() - 1) {
        deleteCount += 1; // include \n
      }
      const deletedText = editor.document.buffer.getTextRange(lineOffset, lineOffset + deleteCount);
      const edits = [{ offset: lineOffset, deleteCount, insertText: '' }];
      editor.document.buffer.applyEdits(edits);
      cursor.column = 0;
      cursor.desiredColumn = 0;
      const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
      editor.undoManager.push(edits, [deletedText], cursorsBefore, cursorsAfter, true);
    }
  });

  registry.register('editor.action.paste', (ctx) => {
    const { editor } = ctx;
    const text = getClipboard();
    if (text.length === 0) return;

    // If clipboard has N lines and there are N cursors, distribute one line per cursor
    const lines = text.split('\n');
    const cursorCount = editor.cursorManager.cursors.length;

    if (lines.length === cursorCount && cursorCount > 1) {
      // Distribute lines to cursors
      const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
      const edits: any[] = [];
      const deletedTexts: string[] = [];

      const cursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
        if (a.line !== b.line) return b.line - a.line;
        return b.column - a.column;
      });

      for (let i = 0; i < cursors.length; i++) {
        const cursor = cursors[i];
        const pasteText = lines[cursors.length - 1 - i]; // reverse order
        const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
        edits.push({ offset, deleteCount: 0, insertText: pasteText });
        deletedTexts.push('');
      }

      editor.document.buffer.applyEdits(edits);

      for (let i = 0; i < editor.cursorManager.cursors.length; i++) {
        const cursor = editor.cursorManager.cursors[i] as any;
        cursor.column += lines[i].length;
        cursor.desiredColumn = cursor.column;
        cursor.selectionAnchor = null;
      }

      const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
      editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter, true);
    } else {
      // Paste full text at each cursor
      registry.execute('editor.action.type', ctx, { text });
    }
  });
}
