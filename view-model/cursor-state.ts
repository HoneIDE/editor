/**
 * Cursor rendering state: blink timer, cursor style, IME composition state.
 */

export type CursorStyle = 'line' | 'block' | 'underline';

export interface CursorRenderState {
  /** Whether the cursor is currently visible (blink state). */
  visible: boolean;
  /** Cursor style. */
  style: CursorStyle;
  /** Whether the editor is focused. */
  focused: boolean;
  /** IME composition text (null if not composing). */
  compositionText: string | null;
}

export class CursorBlinkController {
  private _visible: boolean = true;
  private _style: CursorStyle = 'line';
  private _focused: boolean = true;
  private _composing: boolean = false;
  private _compositionText: string | null = null;
  private blinkInterval: number = 500; // ms
  private _timer: any = null;

  get renderState(): CursorRenderState {
    return {
      visible: this._focused && (this._visible || this._composing),
      style: this._style,
      focused: this._focused,
      compositionText: this._compositionText,
    };
  }

  /** Reset blink to visible (call on any cursor movement or edit). */
  resetBlink(): void {
    this._visible = true;
    this.restartTimer();
  }

  setStyle(style: CursorStyle): void {
    this._style = style;
  }

  setFocused(focused: boolean): void {
    this._focused = focused;
    if (focused) {
      this.resetBlink();
    } else {
      this.stopTimer();
    }
  }

  startComposition(): void {
    this._composing = true;
    this._visible = false; // hide cursor during composition
  }

  updateComposition(text: string): void {
    this._compositionText = text;
  }

  endComposition(): void {
    this._composing = false;
    this._compositionText = null;
    this.resetBlink();
  }

  /** Start/restart the blink timer. Override for platform-specific timing. */
  private restartTimer(): void {
    this.stopTimer();
    // Note: In actual Perry integration, this would use perry/system timer.
    // For core testing, we just track state without actual timers.
  }

  private stopTimer(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Toggle blink state (called by timer). */
  tick(): void {
    if (!this._composing) {
      this._visible = !this._visible;
    }
  }

  destroy(): void {
    this.stopTimer();
  }
}
