/**
 * HoneCodeEditorWidget: Perry UI component wrapping the code editor.
 *
 * Usage in any Perry app:
 *
 *   import { HoneCodeEditorWidget } from '@honeide/editor/perry';
 *
 *   const hed = new HoneCodeEditorWidget(800, 600, {
 *     content: 'hello world',
 *     language: 'typescript',
 *   });
 *
 *   // Add hed.widget to your Perry layout (VStack, HStack, etc.)
 *   // Use hed.onChange / hed.executeCommand / hed.setFont for control.
 */

import { Editor } from './editor-component';
import type { EditorOptions } from './editor-component';

/**
 * A Perry-embeddable code editor. Owns the Editor instance and exposes:
 *   - `widget`  — an opaque Perry widget handle to place in your layout
 *   - `editor`  — the underlying Editor for full TypeScript control
 *   - Convenience pass-throughs: onChange, executeCommand, setFont, content
 */
export class HoneCodeEditorWidget {
  private _editor: Editor;

  /**
   * Opaque Perry widget handle. Pass this directly to VStack / HStack
   * children arrays or widgetAddChild — Perry handles sizing and placement.
   *
   * Obtained via Editor.createPerryWidget(), which owns all FFI and
   * embedNSView knowledge — this class has zero native awareness.
   */
  readonly widget: unknown;

  constructor(width: number, height: number, opts?: EditorOptions) {
    this._editor = new Editor(width, height, opts);
    this.widget = this._editor.createPerryWidget();
  }

  /** The underlying Editor instance — use for commands, callbacks, state. */
  get editor(): Editor {
    return this._editor;
  }

  /** Subscribe to any change (edits, cursor moves, scroll, resize). */
  onChange(listener: () => void): () => void {
    return this._editor.onChange(listener);
  }

  /** Execute a named command (e.g. 'editor.action.undo'). */
  executeCommand(commandId: string): boolean {
    return this._editor.executeCommand(commandId);
  }

  /** Change the rendering font. */
  setFont(family: string, size: number): void {
    this._editor.setFont(family, size);
  }

  /** Get current text content. */
  get content(): string {
    return this._editor.content;
  }

  /** Replace all text content. */
  setContent(text: string): void {
    this._editor.setContent(text);
  }

  /** Free all resources. */
  dispose(): void {
    this._editor.dispose();
  }
}
