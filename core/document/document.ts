/**
 * EditorDocument: uri, buffer, languageId, version, isDirty, encoding.
 *
 * Wraps a TextBuffer with metadata and provides transactional editing.
 */

import { TextBuffer, BufferSnapshot, TextEdit } from '../buffer/text-buffer';
import { EditBuilder } from './edit-builder';
import { Encoding, detectLineEnding } from './encoding';

export class EditorDocument {
  readonly uri: string;
  readonly buffer: TextBuffer;
  languageId: string;
  encoding: Encoding;
  lineEnding: '\n' | '\r\n' | '\r';

  private _version: number = 0;
  private _savedSnapshot: BufferSnapshot;
  private _onEdit: ((edits: TextEdit[]) => void) | null = null;

  constructor(uri: string, content: string, languageId?: string) {
    this.uri = uri;
    this.encoding = 'utf-8';
    this.lineEnding = detectLineEnding(content);
    this.buffer = new TextBuffer(content);
    // Perry AOT: ?? (nullish coalescing) is not compiled — use explicit if check.
    if (languageId !== undefined && languageId !== null && languageId !== '') {
      this.languageId = languageId;
    } else {
      this.languageId = this.detectLanguage(uri);
    }
    this._savedSnapshot = this.buffer.snapshot();
  }

  get version(): number {
    return this._version;
  }

  get isDirty(): boolean {
    return this.buffer.snapshot().id !== this._savedSnapshot.id;
  }

  /**
   * Apply an edit transaction. All edits within the callback are grouped
   * as a single undo step.
   */
  edit(callback: (builder: EditBuilder) => void): TextEdit[] {
    const builder = new EditBuilder();
    callback(builder);
    const edits = builder.commit();
    if (edits.length > 0) {
      this.buffer.applyEdits(edits);
      this._version++;
      if (this._onEdit) this._onEdit(edits);
    }
    return edits;
  }

  /**
   * Register a callback that fires after every edit.
   * Used by the undo manager and syntax engine to react to changes.
   */
  onEdit(callback: (edits: TextEdit[]) => void): void {
    this._onEdit = callback;
  }

  /** Mark the current state as saved. */
  markSaved(): void {
    this._savedSnapshot = this.buffer.snapshot();
  }

  /** Revert to the last saved state. */
  revert(): void {
    this.buffer.restoreSnapshot(this._savedSnapshot);
    this._version++;
  }

  private detectLanguage(uri: string): string {
    // Perry AOT: uri.split('.').pop()?.toLowerCase() ?? '' — both ?. and ?? are broken.
    // Use explicit suffix scan instead.
    let ext = '';
    const dotIdx = uri.lastIndexOf('.');
    if (dotIdx >= 0 && dotIdx < uri.length - 1) {
      ext = uri.substring(dotIdx + 1);
      // Lowercase manually (Perry-safe: charCode arithmetic)
      let lower = '';
      for (let i = 0; i < ext.length; i++) {
        const code = ext.charCodeAt(i);
        if (code >= 65 && code <= 90) {
          lower += String.fromCharCode(code + 32);
        } else {
          lower += ext.charAt(i);
        }
      }
      ext = lower;
    }
    // Perry AOT: map[variable] dynamic key access on Record is broken.
    // Use explicit if-else chain instead.
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
    if (ext === 'py' || ext === 'pyw') return 'python';
    if (ext === 'rs') return 'rust';
    if (ext === 'go') return 'go';
    if (ext === 'c' || ext === 'h') return 'c';
    if (ext === 'cpp' || ext === 'cxx' || ext === 'cc' || ext === 'hpp' || ext === 'hxx') return 'cpp';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
    if (ext === 'json' || ext === 'jsonc') return 'json';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'yaml' || ext === 'yml') return 'yaml';
    if (ext === 'xml' || ext === 'svg') return 'xml';
    if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
    if (ext === 'sql') return 'sql';
    if (ext === 'toml') return 'toml';
    if (ext === 'txt') return 'plaintext';
    return 'plaintext';
  }
}
