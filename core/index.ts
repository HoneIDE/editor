/**
 * Core barrel export: re-exports all public APIs from core/.
 */

// Buffer
export { TextBuffer, type TextEdit, type BufferSnapshot } from './buffer/text-buffer';
export { PieceTable, type PieceDescriptor, type BufferType } from './buffer/piece-table';
export { Rope, type RopeSnapshot } from './buffer/rope';
export { LineIndex } from './buffer/line-index';

// Document
export { EditorDocument } from './document/document';
export { EditBuilder } from './document/edit-builder';
export { detectEncoding, decodeBytes, encodeString, detectLineEnding, type Encoding } from './document/encoding';

// Cursor
export { CursorManager, type CursorState, type CursorDirection } from './cursor/cursor-manager';
export {
  type Position, type SelectionRange,
  comparePositions, normalizeSelection, selectionsOverlap,
  mergeSelections, isSelectionEmpty,
} from './cursor/selection';
export { findWordStart, findWordEnd, getWordAtColumn } from './cursor/word-boundary';

// Commands
export { CommandRegistry, type CommandHandler, type CommandContext } from './commands/registry';
export { registerEditingCommands } from './commands/editing';
export { registerNavigationCommands } from './commands/navigation';
export { registerSelectionCommands } from './commands/selection-cmds';
export { registerClipboardCommands, setClipboard, getClipboard } from './commands/clipboard';
export { registerMulticursorCommands } from './commands/multicursor';

// History
export { UndoManager } from './history/undo-manager';
export { type Operation, computeInverseEdits } from './history/operation';

// Viewport
export { ViewportManager, type VisibleRange } from './viewport/viewport-manager';
export { ScrollController, type ScrollPosition } from './viewport/scroll';
export { LineHeightCache } from './viewport/line-height';
