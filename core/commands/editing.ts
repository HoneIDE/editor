/**
 * Core editing commands: insert, delete, backspace, indent, outdent, toggle comment.
 *
 * Includes VSCode-style auto-closing brackets, over-typing, surround selection,
 * smart Enter, and pair deletion.
 */

import { CommandRegistry, CommandContext } from './registry';

// === Auto-bracket helper functions ===

/** Get the closing character for an auto-close pair. Returns '' if not a pair opener. */
function getMatchingClose(ch: string): string {
  if (ch === '(') return ')';
  if (ch === '{') return '}';
  if (ch === '[') return ']';
  if (ch === '"') return '"';
  if (ch === "'") return "'";
  if (ch === '`') return '`';
  return '';
}

/** True if ch is a closing bracket (not quote). */
function isClosingBracket(ch: string): boolean {
  return ch === ')' || ch === '}' || ch === ']';
}

/** True if ch is a quote character (doubles as both opener and closer). */
function isQuoteChar(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === '`';
}

/** True if open and close form a matching auto-close pair. */
function isPairMatch(open: string, close: string): boolean {
  if (open === '(' && close === ')') return true;
  if (open === '{' && close === '}') return true;
  if (open === '[' && close === ']') return true;
  if (open === '"' && close === '"') return true;
  if (open === "'" && close === "'") return true;
  if (open === '`' && close === '`') return true;
  return false;
}

/** True if ch is a word character (a-z, A-Z, 0-9, _). Uses charCode for Perry safety. */
function isWordChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code >= 97 && code <= 122) return true;  // a-z
  if (code >= 65 && code <= 90) return true;   // A-Z
  if (code >= 48 && code <= 57) return true;   // 0-9
  if (code === 95) return true;                // _
  return false;
}

/** Extract leading whitespace from a line (no regex — Perry safe). */
function getLeadingWhitespace(line: string): string {
  let end = 0;
  for (let i = 0; i < line.length; i++) {
    if (line.charAt(i) === ' ' || line.charAt(i) === '\t') {
      end = i + 1;
    } else {
      break;
    }
  }
  return line.substring(0, end);
}

/** Check if auto-closing a quote is appropriate at this position. */
function shouldAutoCloseQuote(line: string, column: number): boolean {
  // Don't auto-close if next char is a word character
  if (column < line.length && isWordChar(line.charAt(column))) return false;
  // Don't auto-close if previous char is a word character (handles apostrophes like it's)
  if (column > 0 && isWordChar(line.charAt(column - 1))) return false;
  // Don't auto-close if previous char is a backslash (escape sequence)
  if (column > 0 && line.charAt(column - 1) === '\\') return false;
  return true;
}

export function registerEditingCommands(registry: CommandRegistry): void {
  registry.register('editor.action.type', (ctx: CommandContext, args: { text: string }) => {
    const { editor } = ctx;
    const text = args.text;

    const cursorsBefore = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));

    // === Single-character auto-bracket handling ===
    if (text.length === 1) {
      const ch = text;
      const closeChar = getMatchingClose(ch);
      const isClose = isClosingBracket(ch);
      const isQuote = isQuoteChar(ch);

      // --- Over-type check ---
      // For closing brackets: over-type if next char matches
      // For quotes: over-type if next char is the same quote
      if (isClose || isQuote) {
        let allCanOvertype = true;
        const allCursors = editor.cursorManager.cursors;
        for (let i = 0; i < allCursors.length; i++) {
          const c = allCursors[i];
          if (c.selectionAnchor) { allCanOvertype = false; break; }
          const line = editor.document.buffer.getLine(c.line);
          if (c.column >= line.length || line.charAt(c.column) !== ch) {
            allCanOvertype = false;
            break;
          }
        }
        if (allCanOvertype) {
          // Just move all cursors right — no edit, no undo entry (matches VSCode)
          for (let i = 0; i < allCursors.length; i++) {
            allCursors[i].column++;
            allCursors[i].desiredColumn = allCursors[i].column;
            allCursors[i].selectionAnchor = null;
          }
          return;
        }
      }

      // --- Surround selection ---
      // If any cursor has a selection and ch is an opener, wrap all selections
      if (closeChar !== '' && !isClose) {
        let anySelection = false;
        const allCursors = editor.cursorManager.cursors;
        for (let i = 0; i < allCursors.length; i++) {
          if (allCursors[i].selectionAnchor) { anySelection = true; break; }
        }
        if (anySelection) {
          const edits: any[] = [];
          const deletedTexts: string[] = [];
          const sortedCursors = [...allCursors].sort((a: any, b: any) => {
            if (a.line !== b.line) return b.line - a.line;
            return b.column - a.column;
          });

          for (const cursor of sortedCursors) {
            if (cursor.selectionAnchor) {
              const sel = normalizeSelection(cursor.selectionAnchor, cursor);
              const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
              const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
              // Insert close at end first, then open at start (reverse offset order)
              edits.push({ offset: endOffset, deleteCount: 0, insertText: closeChar });
              deletedTexts.push('');
              edits.push({ offset: startOffset, deleteCount: 0, insertText: ch });
              deletedTexts.push('');
            }
          }

          if (edits.length > 0) {
            editor.document.buffer.applyEdits(edits);

            // Adjust cursors: selection shifts right by 1 (opening bracket inserted)
            for (let i = 0; i < allCursors.length; i++) {
              const cursor = allCursors[i];
              if (cursor.selectionAnchor) {
                const isAnchorBefore = cursor.selectionAnchor.line < cursor.line ||
                  (cursor.selectionAnchor.line === cursor.line && cursor.selectionAnchor.column <= cursor.column);
                if (isAnchorBefore) {
                  cursor.selectionAnchor.column++;
                  cursor.column++;
                } else {
                  cursor.column++;
                  cursor.selectionAnchor.column++;
                }
              }
              cursor.desiredColumn = cursor.column;
            }

            const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
            editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter);
          }
          return;
        }
      }

      // --- Auto-close check ---
      // For brackets: always auto-close
      // For quotes: only if position allows it
      if (closeChar !== '' && !isClose) {
        let shouldAutoClose = true;
        if (isQuote) {
          const allCursors = editor.cursorManager.cursors;
          for (let i = 0; i < allCursors.length; i++) {
            const c = allCursors[i];
            if (c.selectionAnchor) continue;
            const line = editor.document.buffer.getLine(c.line);
            if (!shouldAutoCloseQuote(line, c.column)) {
              shouldAutoClose = false;
              break;
            }
          }
        }

        if (shouldAutoClose) {
          // Insert both open and close, cursor positioned between them
          const actualInsert = ch + closeChar;
          const edits: any[] = [];
          const deletedTexts: string[] = [];

          const sortedCursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
            if (a.line !== b.line) return b.line - a.line;
            return b.column - a.column;
          });

          for (const cursor of sortedCursors) {
            const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
            if (cursor.selectionAnchor) {
              const sel = normalizeSelection(cursor.selectionAnchor, cursor);
              const startOffset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
              const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
              const deletedText = editor.document.buffer.getTextRange(startOffset, endOffset);
              edits.push({ offset: startOffset, deleteCount: endOffset - startOffset, insertText: actualInsert });
              deletedTexts.push(deletedText);
            } else {
              edits.push({ offset, deleteCount: 0, insertText: actualInsert });
              deletedTexts.push('');
            }
          }

          editor.document.buffer.applyEdits(edits);

          // Position cursor between the pair (advance by 1, not 2)
          for (const cursor of editor.cursorManager.cursors) {
            if (cursor.selectionAnchor) {
              const sel = normalizeSelection(cursor.selectionAnchor, cursor);
              cursor.line = sel.startLine;
              cursor.column = sel.startColumn;
              cursor.selectionAnchor = null;
            }
            cursor.column += 1; // between open and close
            cursor.desiredColumn = cursor.column;
          }

          const cursorsAfter = editor.cursorManager.cursors.map((c: any) => ({ ...c, selectionAnchor: c.selectionAnchor ? { ...c.selectionAnchor } : null }));
          editor.undoManager.push(edits, deletedTexts, cursorsBefore, cursorsAfter);
          return;
        }
      }
    }

    // === Regular text insert (no bracket magic) ===
    const edits: any[] = [];
    const deletedTexts: string[] = [];

    const cursors = [...editor.cursorManager.cursors].sort((a: any, b: any) => {
      if (a.line !== b.line) return b.line - a.line;
      return b.column - a.column;
    });

    for (const cursor of cursors) {
      const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;

      if (cursor.selectionAnchor) {
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
    // Track which cursors are doing pair deletion (need to know for cursor update)
    const pairDeleteFlags: boolean[] = [];

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
        pairDeleteFlags.push(false);
      } else if (cursor.column > 0) {
        // Check for pair deletion: is cursor between a matching pair?
        const line = editor.document.buffer.getLine(cursor.line);
        const charBefore = line.charAt(cursor.column - 1);
        const charAfter = cursor.column < line.length ? line.charAt(cursor.column) : '';
        if (charAfter.length > 0 && isPairMatch(charBefore, charAfter)) {
          // Delete both characters (the pair)
          const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column - 1;
          const deletedText = editor.document.buffer.getTextRange(offset, offset + 2);
          edits.push({ offset, deleteCount: 2, insertText: '' });
          deletedTexts.push(deletedText);
          pairDeleteFlags.push(true);
        } else {
          // Normal single-char backspace
          const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
          const deletedText = editor.document.buffer.getTextRange(offset - 1, offset);
          edits.push({ offset: offset - 1, deleteCount: 1, insertText: '' });
          deletedTexts.push(deletedText);
          pairDeleteFlags.push(false);
        }
      } else if (cursor.line > 0) {
        // At start of line, join with previous line
        const prevLineLen = editor.document.buffer.getLineLength(cursor.line - 1);
        const offset = editor.document.buffer.getLineOffset(cursor.line) - 1;
        edits.push({ offset, deleteCount: 1, insertText: '' });
        deletedTexts.push('\n');
        pairDeleteFlags.push(false);
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
          edits.push({ offset, deleteCount: 1, insertText: '' });
          deletedTexts.push('\n');
        }
      }
    }

    if (edits.length === 0) return;
    editor.document.buffer.applyEdits(edits);

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

    const cursor = editor.cursorManager.primary;
    const currentLine = editor.document.buffer.getLine(cursor.line);
    const indent = getLeadingWhitespace(currentLine);
    const tabSize = '  '; // 2-space indent

    // Check context around cursor for smart Enter behavior
    const charBefore = cursor.column > 0 ? currentLine.charAt(cursor.column - 1) : '';
    const charAfter = cursor.column < currentLine.length ? currentLine.charAt(cursor.column) : '';

    // Check if last non-whitespace char before cursor is '{'
    let endsWithOpenBrace = false;
    for (let i = cursor.column - 1; i >= 0; i--) {
      const c = currentLine.charAt(i);
      if (c === ' ' || c === '\t') continue;
      if (c === '{') endsWithOpenBrace = true;
      break;
    }

    let insertText: string;
    let newCursorLine: number;
    let newCursorColumn: number;

    if (charBefore === '{' && charAfter === '}') {
      // Smart Enter between braces: {|} → {\n  |\n}
      const newIndent = indent + tabSize;
      insertText = '\n' + newIndent + '\n' + indent;
      newCursorLine = cursor.line + 1;
      newCursorColumn = newIndent.length;
    } else if (endsWithOpenBrace) {
      // After opening brace: increase indent
      const newIndent = indent + tabSize;
      insertText = '\n' + newIndent;
      newCursorLine = cursor.line + 1;
      newCursorColumn = newIndent.length;
    } else {
      // Normal Enter: preserve current line's indent
      insertText = '\n' + indent;
      newCursorLine = cursor.line + 1;
      newCursorColumn = indent.length;
    }

    // Delete selection first if present
    let deleteCount = 0;
    let offset: number;
    const deletedTexts: string[] = [];

    if (cursor.selectionAnchor) {
      const sel = normalizeSelection(cursor.selectionAnchor, cursor);
      offset = editor.document.buffer.getLineOffset(sel.startLine) + sel.startColumn;
      const endOffset = editor.document.buffer.getLineOffset(sel.endLine) + sel.endColumn;
      deleteCount = endOffset - offset;
      deletedTexts.push(editor.document.buffer.getTextRange(offset, endOffset));
    } else {
      offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
      deletedTexts.push('');
    }

    const edits = [{ offset, deleteCount, insertText }];
    editor.document.buffer.applyEdits(edits);

    // Move cursor to new position
    cursor.line = newCursorLine;
    cursor.column = newCursorColumn;
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
        const sel = normalizeSelection(cursor.selectionAnchor, cursor);
        for (let line = sel.startLine; line <= sel.endLine; line++) {
          const lineOffset = editor.document.buffer.getLineOffset(line);
          edits.push({ offset: lineOffset, deleteCount: 0, insertText: tabText });
          deletedTexts.push('');
        }
      } else {
        const offset = editor.document.buffer.getLineOffset(cursor.line) + cursor.column;
        edits.push({ offset, deleteCount: 0, insertText: tabText });
        deletedTexts.push('');
      }
    }

    editor.document.buffer.applyEdits(edits);

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
