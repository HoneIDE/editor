/**
 * Piece table primitives: original buffer + add buffer + piece descriptors.
 *
 * The piece table maintains two immutable string buffers:
 * 1. Original buffer: file content as loaded from disk. Never modified.
 * 2. Add buffer: append-only buffer for all inserted text.
 *
 * A piece descriptor references a span in one of these buffers.
 * The document content is the concatenation of all pieces in order.
 */

export type BufferType = 'original' | 'add';

export interface PieceDescriptor {
  /** Which buffer this piece references. */
  bufferType: BufferType;
  /** Start offset within that buffer. */
  start: number;
  /** Length of the piece in characters. */
  length: number;
  /** Number of line breaks (\n) in this piece. */
  lineBreakCount: number;
}

/**
 * Count the number of newline characters in a string range.
 */
export function countLineBreaks(text: string, start: number, length: number): number {
  let count = 0;
  const end = start + length;
  for (let i = start; i < end; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

/**
 * Find positions of all newlines in a string range.
 * Returns offsets relative to the start of the buffer (not the range).
 */
export function findLineBreakPositions(text: string, start: number, length: number): number[] {
  const positions: number[] = [];
  const end = start + length;
  for (let i = start; i < end; i++) {
    if (text.charCodeAt(i) === 10) positions.push(i);
  }
  return positions;
}

/**
 * Low-level piece table without tree indexing.
 * Pieces are stored in a flat array — this is wrapped by the rope B-tree
 * for efficient access in large documents.
 */
export class PieceTable {
  /** The original file content. Never modified after construction. */
  readonly originalBuffer: string;
  /** Append-only buffer for all insertions. */
  private _addBuffer: string;
  /** Ordered array of piece descriptors. */
  private _pieces: PieceDescriptor[];

  constructor(originalContent: string) {
    this.originalBuffer = originalContent;
    this._addBuffer = '';

    if (originalContent.length > 0) {
      this._pieces = [{
        bufferType: 'original',
        start: 0,
        length: originalContent.length,
        lineBreakCount: countLineBreaks(originalContent, 0, originalContent.length),
      }];
    } else {
      this._pieces = [];
    }
  }

  get addBuffer(): string {
    return this._addBuffer;
  }

  get pieces(): readonly PieceDescriptor[] {
    return this._pieces;
  }

  /** Append text to the add buffer and return its start offset in the add buffer. */
  appendToAddBuffer(text: string): number {
    const start = this._addBuffer.length;
    this._addBuffer += text;
    return start;
  }

  /** Get the text content of a piece. */
  getPieceText(piece: PieceDescriptor): string {
    const buffer = piece.bufferType === 'original' ? this.originalBuffer : this._addBuffer;
    return buffer.substring(piece.start, piece.start + piece.length);
  }

  /** Replace the pieces array (used by the rope for tree-level operations). */
  setPieces(pieces: PieceDescriptor[]): void {
    this._pieces = pieces;
  }

  /** Clone the piece table state (shares buffer strings, copies piece array). */
  clone(): PieceTable {
    const pt = new PieceTable('');
    // @ts-ignore - we need to set readonly field for cloning
    (pt as any).originalBuffer = this.originalBuffer;
    (pt as any)._addBuffer = this._addBuffer;
    pt._pieces = this._pieces.map(p => ({ ...p }));
    return pt;
  }
}
