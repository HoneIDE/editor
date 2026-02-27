/**
 * AI ghost text: inline completion preview, accept/reject/partial-accept.
 */

import { TextBuffer } from '../core/buffer/text-buffer';
import { findWordEnd } from '../core/cursor/word-boundary';

export interface GhostTextState {
  line: number;
  column: number;
  text: string;
  isStale: boolean;
}

export class GhostTextController {
  private _state: GhostTextState | null = null;

  get state(): GhostTextState | null {
    return this._state;
  }

  /** Show ghost text at a position. */
  show(line: number, column: number, text: string): void {
    this._state = { line, column, text, isStale: false };
  }

  /** Dismiss ghost text. */
  dismiss(): void {
    this._state = null;
  }

  /** Mark ghost text as stale (buffer changed). */
  markStale(): void {
    if (this._state) {
      this._state = null; // Dismiss on any buffer change
    }
  }

  /**
   * Accept the full ghost text.
   * Returns the text to insert.
   */
  accept(): string | null {
    if (!this._state || this._state.isStale) return null;
    const text = this._state.text;
    this._state = null;
    return text;
  }

  /**
   * Accept ghost text up to the next word boundary.
   * Returns the text to insert and updates the remaining ghost text.
   */
  acceptPartial(lineText: string): string | null {
    if (!this._state || this._state.isStale) return null;

    const ghostText = this._state.text;
    // Find the first word boundary in the ghost text
    const firstNewline = ghostText.indexOf('\n');
    const firstLine = firstNewline === -1 ? ghostText : ghostText.substring(0, firstNewline);

    if (firstLine.length === 0 && firstNewline !== -1) {
      // Accept just the newline
      const accepted = '\n';
      const remaining = ghostText.substring(1);
      if (remaining.length === 0) {
        this._state = null;
      } else {
        this._state = {
          line: this._state.line + 1,
          column: 0,
          text: remaining,
          isStale: false,
        };
      }
      return accepted;
    }

    // Accept up to the next word boundary
    const wordEnd = findWordEnd(firstLine, 0);
    const accepted = firstLine.substring(0, wordEnd);

    const remaining = ghostText.substring(wordEnd);
    if (remaining.length === 0) {
      this._state = null;
    } else {
      this._state = {
        line: this._state.line,
        column: this._state.column + wordEnd,
        text: remaining,
        isStale: false,
      };
    }

    return accepted;
  }

  /**
   * Check if a typed character matches the start of the ghost text.
   * If so, advance the ghost text. Otherwise, dismiss.
   */
  onType(char: string): boolean {
    if (!this._state || this._state.isStale) return false;

    if (this._state.text.startsWith(char)) {
      const remaining = this._state.text.substring(char.length);
      if (remaining.length === 0) {
        this._state = null;
      } else {
        this._state = {
          ...this._state,
          column: this._state.column + char.length,
          text: remaining,
        };
      }
      return true;
    }

    // Doesn't match — dismiss
    this._state = null;
    return false;
  }
}
