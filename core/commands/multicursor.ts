/**
 * Multi-cursor commands: add cursor above/below, select all occurrences, Ctrl+D.
 */

import { CommandRegistry, CommandContext } from './registry';

export function registerMulticursorCommands(registry: CommandRegistry): void {
  registry.register('editor.action.addCursorAbove', (ctx) => {
    ctx.editor.cursorManager.addCursorAbove();
  });

  registry.register('editor.action.addCursorBelow', (ctx) => {
    ctx.editor.cursorManager.addCursorBelow();
  });

  registry.register('editor.action.addNextOccurrence', (ctx) => {
    ctx.editor.cursorManager.addNextOccurrence();
  });

  registry.register('editor.action.selectAllOccurrences', (ctx) => {
    ctx.editor.cursorManager.selectAllOccurrences();
  });

  registry.register('editor.action.addCursorAtPosition', (ctx, args: { line: number; column: number }) => {
    ctx.editor.cursorManager.addCursorAt(args.line, args.column);
  });

  // SHIP-V1-GAPS.md #80 — column / box selection (Alt+drag in the editor).
  // Callers pass anchor + head positions; the manager fans them into one
  // cursor per line.
  registry.register('editor.action.setColumnSelection', (ctx, args: {
    startLine: number; startColumn: number; endLine: number; endColumn: number;
  }) => {
    ctx.editor.cursorManager.setColumnSelection(
      args.startLine, args.startColumn, args.endLine, args.endColumn,
    );
  });
}
