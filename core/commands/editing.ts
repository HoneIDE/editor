/**
 * Core editing commands: insert, delete, backspace, indent, outdent, toggle comment.
 */

import { CommandRegistry, CommandContext } from './registry';

export function registerEditingCommands(registry: CommandRegistry): void {
  registry.register('editor.action.type', (ctx: CommandContext, args: { text: string }) => {
    const { editor } = ctx;
    const text = args.text;

    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    const edits: any[] = [];
    const deletedTexts: string[] = [];

    // Process cursors in reverse order (bottom to top) to maintain offsets
    const cursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

    for (const cursor of cursors) {
      const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;

      if (cursor.selectionAnchor) {
        // Replace selection
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
        const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
        const deleteCount = endOffset - startOffset;
        const deletedText = editor.document.buffer.getTextRange(startOffset, endOffset);
        edits.push({ offset: startOffset, deleteCount, insertText: text });
        deletedTexts.push(deletedText);
      } else {
        edits.push({ offset, deleteCount: 0, insertText: text });
        deletedTexts.push('');
      }
    }

    editor.document.buffer.applyEdits(edits);

    // Update cursor positions after insert
    for (const cursor of editor.cursorManager.cursors) {
      if (cursor.selectionAnchor) {
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        cursor.line = sel.startLine;
        cursor.column = sel.startColumn;
        cursor.selectionAnchor = null;
      }
      // Advance cursor by the inserted text
      const lines = text.split('\n');
      if (lines.length > 1) {
        cursor.line += lines.length - 1;
        cursor.column = lines[lines.length - 1].length;
      } else {
        cursor.column += text.length;
      }
      cursor.desiredColumn = cursor.column;
    }

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter);
  });

  registry.register('editor.action.deleteLeft', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    const edits: any[] = [];
    const deletedTexts: string[] = [];

    const cursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

    for (const cursor of cursors) {
      if (cursor.selectionAnchor) {
        // Delete selection
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
        const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
        const deletedText = editor.document.buffer.getTextRange(startOffset, endOffset);
        edits.push({ offset: startOffset, deleteCount: endOffset - startOffset, insertText: '' });
        deletedTexts.push(deletedText);
      } else if (cursor.column > 0) {
        const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
        const deletedText = editor.document.buffer.getTextRange(offset - 1, offset);
        edits.push({ offset: offset - 1, deleteCount: 1, insertText: '' });
        deletedTexts.push(deletedText);
      } else if (cursor.line > 0) {
        // At start of line, join with previous line
        const prevLineLen = editor.document.buffer.getLineLength(cursor.line - 1);
        const offset = editor.document.buffer.getLineOffset(cursor.line) - 1;
        edits.push({ offset, deleteCount: 1, insertText: '' });
        deletedTexts.push('\n');
      }
    }

    if (edits.length === 0) return;
    editor.document.buffer.applyEdits(edits);

    // Update cursors
    for (const cursor of editor.cursorManager.cursors) {
      if (cursor.selectionAnchor) {
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        cursor.line = sel.startLine;
        cursor.column = sel.startColumn;
        cursor.selectionAnchor = null;
      } else if (cursor.column > 0) {
        cursor.column--;
      } else if (cursor.line > 0) {
        cursor.line--;
        cursor.column = editor.document.buffer.getLineLength(cursor.line);
      }
      cursor.desiredColumn = cursor.column;
    }

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter);
  });

  registry.register('editor.action.deleteRight', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    const edits: any[] = [];
    const deletedTexts: string[] = [];

    const cursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

    for (const cursor of cursors) {
      if (cursor.selectionAnchor) {
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
        const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
        const deletedText = editor.document.buffer.getTextRange(startOffset, endOffset);
        edits.push({ offset: startOffset, deleteCount: endOffset - startOffset, insertText: '' });
        deletedTexts.push(deletedText);
      } else {
        const lineLen = editor.document.buffer.getLineLength(cursor.line);
        const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
        if (cursor.column < lineLen) {
          const deletedText = editor.document.buffer.getTextRange(offset, offset + 1);
          edits.push({ offset, deleteCount: 1, insertText: '' });
          deletedTexts.push(deletedText);
        } else if (cursor.line < editor.document.buffer.getLineCount() - 1) {
          // At end of line, join with next line
          edits.push({ offset, deleteCount: 1, insertText: '' });
          deletedTexts.push('\n');
        }
      }
    }

    if (edits.length === 0) return;
    editor.document.buffer.applyEdits(edits);

    // For deleteRight, cursor position doesn't change (unless selection)
    for (const cursor of editor.cursorManager.cursors) {
      if (cursor.selectionAnchor) {
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        cursor.line = sel.startLine;
        cursor.column = sel.startColumn;
        cursor.selectionAnchor = null;
      }
      cursor.desiredColumn = cursor.column;
    }

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter);
  });

  registry.register('editor.action.insertLineAfter', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));

    // Get auto-indent from current line
    const cursor = editor.cursorManager.primary;
    const currentLine = editor.document.buffer.getLine(cursor.line);
    const indentMatch = currentLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const insertText = '\n' + indent;

    const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
    const edits = [{ offset, deleteCount: 0, insertText }];
    const deletedTexts = [''];

    editor.document.buffer.applyEdits(edits);

    // Move cursor to new line with indent
    cursor.line++;
    cursor.column = indent.length;
    cursor.selectionAnchor = null;
    cursor.desiredColumn = cursor.column;

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter, true);
  });

  registry.register('editor.action.indent', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    const tabText = '  '; // 2-space indent
    const edits: any[] = [];
    const deletedTexts: string[] = [];

    for (const cursor of editor.cursorManager.cursors) {
      if (cursor.selectionAnchor) {
        // Indent all lines in selection
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        for (let line = sel.startLine; line <= sel.endLine; line++) {
          const lineOffset = editor.document.buffer.getLineOffset(line);
          edits.push({ offset: lineOffset, deleteCount: 0, insertText: tabText });
          deletedTexts.push('');
        }
      } else {
        // Insert tab at cursor
        const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
        edits.push({ offset, deleteCount: 0, insertText: tabText });
        deletedTexts.push('');
      }
    }

    editor.document.buffer.applyEdits(edits);

    // Update cursors
    for (const cursor of editor.cursorManager.cursors) {
      if (cursor.selectionAnchor) {
        cursor.selectionAnchor.column += tabText.length;
        cursor.column += tabText.length;
      } else {
        cursor.column += tabText.length;
      }
      cursor.desiredColumn = cursor.column;
    }

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter, true);
  });

  registry.register('editor.action.outdent', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    const edits: any[] = [];
    const deletedTexts: string[] = [];
    const indentSize = 2;

    const processedLines = new Set<number>();

    for (const cursor of editor.cursorManager.cursors) {
      const startLine = cursor.selectionAnchor
        ? Math.min(cursor.line, cursor.selectionAnchor.line)
        : cursor.line;
      const endLine = cursor.selectionAnchor
        ? Math.max(cursor.line, cursor.selectionAnchor.line)
        : cursor.line;

      for (let line = startLine; line <= endLine; line++) {
        if (processedLines.has(line)) continue;
        processedLines.add(line);

        const lineText = editor.document.buffer.getLine(line);
        let removeCount = 0;
        for (let i = 0; i < Math.min(indentSize, lineText.length); i++) {
          if (lineText[i] === ' ') removeCount++;
          else if (lineText[i] === '\t') { removeCount++; break; }
          else break;
        }
        if (removeCount > 0) {
          const lineOffset = editor.document.buffer.getLineOffset(line);
          const deletedText = editor.document.buffer.getTextRange(lineOffset, lineOffset + removeCount);
          edits.push({ offset: lineOffset, deleteCount: removeCount, insertText: '' });
          deletedTexts.push(deletedText);
        }
      }
    }

    if (edits.length === 0) return;
    editor.document.buffer.applyEdits(edits);

    // Update cursors
    for (const cursor of editor.cursorManager.cursors) {
      cursor.column = Math.max(0, cursor.column - indentSize);
      if (cursor.selectionAnchor) {
        cursor.selectionAnchor.column = Math.max(0, cursor.selectionAnchor.column - indentSize);
      }
      cursor.desiredColumn = cursor.column;
    }

    const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
    editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter, true);
  });

  registry.register('editor.action.undo', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursors = editor.undoManager.undo();
    if (cursors) {
      // Restore cursor positions
      editor.cursorManager.reset(cursors[0].line, cursors[0].column);
      if (cursors[0].selectionAnchor) {
        // TODO: restore full multi-cursor state
      }
    }
  });

  registry.register('editor.action.redo', (ctx: CommandContext) => {
    const { editor } = ctx;
    const cursors = editor.undoManager.redo();
    if (cursors) {
      editor.cursorManager.reset(cursors[0].line, cursors[0].column);
    }
  });
}

function normalizeSelection(anchor: any, cursor: any) {
  if (anchor.line < cursor.line || (anchor.line === cursor.line && anchor.column <= cursor.column)) {
    return { startLine: anchor.line, startColumn: anchor.column, endLine: cursor.line, endColumn: cursor.column };
  }
  return { startLine: cursor.line, startColumn: cursor.column, endLine: anchor.line, endColumn: anchor.column };
}
