/**
 * FFI Bridge: TypeScript abstraction over the native rendering contract.
 *
 * All 6 platforms implement the same set of FFI functions. This bridge
 * provides typed wrappers and allows swapping implementations at runtime
 * (e.g., no-op for testing, DOM for web, Core Text for macOS).
 *
 * In production, Perry auto-generates bindings from the Rust crate's
 * #[no_mangle] functions and injects them via `perry/ffi`.
 */

/**
 * Opaque handle to a native editor view.
 * In Rust, this is a *mut EditorView pointer.
 * In TypeScript, we treat it as an opaque number (pointer value).
 */
export type NativeViewHandle = number;

/**
 * Token data for rendering a line (serialized to JSON for FFI).
 */
export interface RenderToken {
  /** Start column. */
  s: number;
  /** End column. */
  e: number;
  /** Hex color string (e.g., "#569cd6"). */
  c: string;
  /** Font style: "normal", "italic", or "bold". */
  st: string;
}

/**
 * Selection region for rendering (serialized to JSON for FFI).
 */
export interface SelectionRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Decoration overlay for rendering (serialized to JSON for FFI).
 */
export interface DecorationOverlay {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  type: 'background' | 'underline' | 'underline-wavy';
}

/**
 * Cursor style constants.
 */
export const CursorStyle = {
  Line: 0,
  Block: 1,
  Underline: 2,
} as const;

/**
 * The FFI contract that every platform must implement.
 */
export interface NativeEditorFFI {
  /** Create a new editor view with dimensions. Returns opaque handle. */
  create(width: number, height: number): NativeViewHandle;

  /** Destroy an editor view and free all resources. */
  destroy(handle: NativeViewHandle): void;

  /** Set the editor font family and size. */
  setFont(handle: NativeViewHandle, family: string, size: number): void;

  /**
   * Render a single line of text with syntax coloring.
   * @param lineNumber - Display line number (for gutter).
   * @param text - The line content.
   * @param tokensJson - JSON array of RenderToken[].
   * @param yOffset - Vertical pixel position of this line.
   */
  renderLine(
    handle: NativeViewHandle,
    lineNumber: number,
    text: string,
    tokensJson: string,
    yOffset: number,
  ): void;

  /**
   * Set the primary cursor position and style.
   * @param style - 0=line, 1=block, 2=underline.
   */
  setCursor(handle: NativeViewHandle, x: number, y: number, style: number): void;

  /**
   * Set selection highlight regions.
   * @param regionsJson - JSON array of SelectionRegion[].
   */
  setSelection(handle: NativeViewHandle, regionsJson: string): void;

  /**
   * Set the vertical scroll offset.
   */
  scroll(handle: NativeViewHandle, offsetY: number): void;

  /**
   * Measure the width of a text string in the current font.
   * Returns width in pixels.
   */
  measureText(handle: NativeViewHandle, text: string): number;

  /** Invalidate the view, triggering a redraw. */
  invalidate(handle: NativeViewHandle): void;

  /**
   * Render decorations (underlines, backgrounds) for a line.
   * @param decorationsJson - JSON array of DecorationOverlay[].
   */
  renderDecorations?(handle: NativeViewHandle, decorationsJson: string): void;

  /**
   * Render ghost text (semi-transparent inline completion).
   */
  renderGhostText?(handle: NativeViewHandle, text: string, x: number, y: number, color: string): void;

  /**
   * Set multiple cursor positions (for multi-cursor rendering).
   * @param cursorsJson - JSON array of {x, y, style}[].
   */
  setCursors?(handle: NativeViewHandle, cursorsJson: string): void;

  /**
   * Begin a frame batch. Called before rendering visible lines.
   * Native layer can use this to prepare buffers.
   */
  beginFrame?(handle: NativeViewHandle): void;

  /**
   * End a frame batch. Called after all lines are rendered.
   * Native layer can use this to flush/present.
   */
  endFrame?(handle: NativeViewHandle): void;
}

/**
 * No-op FFI implementation for testing.
 * Records all calls for verification.
 */
export class NoOpFFI implements NativeEditorFFI {
  private _nextHandle = 1;
  readonly calls: { method: string; args: any[] }[] = [];

  create(width: number, height: number): NativeViewHandle {
    this.calls.push({ method: 'create', args: [width, height] });
    return this._nextHandle++;
  }

  destroy(handle: NativeViewHandle): void {
    this.calls.push({ method: 'destroy', args: [handle] });
  }

  setFont(handle: NativeViewHandle, family: string, size: number): void {
    this.calls.push({ method: 'setFont', args: [handle, family, size] });
  }

  renderLine(handle: NativeViewHandle, lineNumber: number, text: string, tokensJson: string, yOffset: number): void {
    this.calls.push({ method: 'renderLine', args: [handle, lineNumber, text, tokensJson, yOffset] });
  }

  setCursor(handle: NativeViewHandle, x: number, y: number, style: number): void {
    this.calls.push({ method: 'setCursor', args: [handle, x, y, style] });
  }

  setSelection(handle: NativeViewHandle, regionsJson: string): void {
    this.calls.push({ method: 'setSelection', args: [handle, regionsJson] });
  }

  scroll(handle: NativeViewHandle, offsetY: number): void {
    this.calls.push({ method: 'scroll', args: [handle, offsetY] });
  }

  measureText(handle: NativeViewHandle, text: string): number {
    this.calls.push({ method: 'measureText', args: [handle, text] });
    // Return a fixed width per character for testing (8px monospace)
    return text.length * 8;
  }

  invalidate(handle: NativeViewHandle): void {
    this.calls.push({ method: 'invalidate', args: [handle] });
  }

  renderDecorations(handle: NativeViewHandle, decorationsJson: string): void {
    this.calls.push({ method: 'renderDecorations', args: [handle, decorationsJson] });
  }

  renderGhostText(handle: NativeViewHandle, text: string, x: number, y: number, color: string): void {
    this.calls.push({ method: 'renderGhostText', args: [handle, text, x, y, color] });
  }

  setCursors(handle: NativeViewHandle, cursorsJson: string): void {
    this.calls.push({ method: 'setCursors', args: [handle, cursorsJson] });
  }

  beginFrame(handle: NativeViewHandle): void {
    this.calls.push({ method: 'beginFrame', args: [handle] });
  }

  endFrame(handle: NativeViewHandle): void {
    this.calls.push({ method: 'endFrame', args: [handle] });
  }

  /** Clear recorded calls. */
  reset(): void {
    this.calls.length = 0;
  }

  /** Get calls for a specific method. */
  getCalls(method: string): any[][] {
    return this.calls.filter(c => c.method === method).map(c => c.args);
  }
}
