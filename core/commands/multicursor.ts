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
}
