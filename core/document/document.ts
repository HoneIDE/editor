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
    this.languageId = languageId ?? this.detectLanguage(uri);
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
    const ext = uri.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      py: 'python', pyw: 'python',
      rs: 'rust',
      go: 'go',
      c: 'c', h: 'c',
      cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', hxx: 'cpp',
      html: 'html', htm: 'html',
      css: 'css', scss: 'css', less: 'css',
      json: 'json', jsonc: 'json',
      md: 'markdown', markdown: 'markdown',
      yaml: 'yaml', yml: 'yaml',
      xml: 'xml', svg: 'xml',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      sql: 'sql',
      toml: 'toml',
      txt: 'plaintext',
    };
    return map[ext] ?? 'plaintext';
  }
}
