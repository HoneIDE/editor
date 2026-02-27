/**
 * Command registry: maps string command IDs to handler functions.
 *
 * Command IDs follow a namespaced convention:
 * editor.action.insertLineAfter, editor.action.selectAllOccurrences, etc.
 */

export type CommandHandler = (ctx: CommandContext, args?: any) => void;

/**
 * Context passed to command handlers. Provides access to all editor subsystems.
 */
export interface CommandContext {
  /** The editor instance (EditorViewModel). Set by the view model when executing commands. */
  editor: any;
}

export class CommandRegistry {
  private commands: Map<string, CommandHandler> = new Map();

  register(id: string, handler: CommandHandler): void {
    this.commands.set(id, handler);
  }

  execute(id: string, ctx: CommandContext, args?: any): boolean {
    const handler = this.commands.get(id);
    if (!handler) return false;
    handler(ctx, args);
    return true;
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  getAll(): string[] {
    return [...this.commands.keys()];
  }
}
