/**
 * Touch input handler for mobile platforms (iOS, Android).
 *
 * Translates touch gestures into editor actions:
 * - Single tap → move cursor
 * - Double tap → select word
 * - Triple tap → select line
 * - Long press → enter selection mode
 * - Pan (single finger) → scroll
 * - Two-finger pan → fast scroll
 * - Pinch → zoom (font size change)
 */

import type { EditorViewModel } from '../view-model/editor-view-model';

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface TouchConfig {
  /** Maximum ms between taps for double/triple tap. */
  multiTapTimeout: number;
  /** Maximum pixel distance for taps to be considered same location. */
  tapSlop: number;
  /** Minimum ms for a long press. */
  longPressTimeout: number;
  /** Minimum pixel movement to start a pan. */
  panThreshold: number;
  /** Scroll deceleration factor (0-1). */
  scrollDeceleration: number;
  /** Minimum pinch distance change to trigger zoom. */
  pinchThreshold: number;
}

const DEFAULT_CONFIG: TouchConfig = {
  multiTapTimeout: 300,
  tapSlop: 10,
  longPressTimeout: 500,
  panThreshold: 8,
  scrollDeceleration: 0.95,
  pinchThreshold: 5,
};

type GestureState = 'idle' | 'tracking' | 'panning' | 'selecting' | 'pinching';

export class TouchInputHandler {
  private _viewModel: EditorViewModel | null = null;
  private _config: TouchConfig;
  private _state: GestureState = 'idle';

  // Tap detection
  private _tapCount: number = 0;
  private _lastTapTime: number = 0;
  private _lastTapX: number = 0;
  private _lastTapY: number = 0;

  // Long press
  private _longPressTimer: any = null;

  // Pan / scroll
  private _panStartX: number = 0;
  private _panStartY: number = 0;
  private _lastPanX: number = 0;
  private _lastPanY: number = 0;
  private _velocityX: number = 0;
  private _velocityY: number = 0;
  private _momentumTimer: any = null;

  // Pinch
  private _initialPinchDistance: number = 0;
  private _initialFontSize: number = 14;

  // Active touches
  private _activeTouches: Map<number, TouchPoint> = new Map();

  // Callbacks for native layer
  private _onFontSizeChange: ((size: number) => void) | null = null;

  constructor(config?: Partial<TouchConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  get state(): GestureState {
    return this._state;
  }

  attach(viewModel: EditorViewModel): void {
    this._viewModel = viewModel;
  }

  detach(): void {
    this.cancelLongPress();
    this.stopMomentum();
    this._viewModel = null;
    this._state = 'idle';
    this._activeTouches.clear();
  }

  onFontSizeChange(callback: (size: number) => void): void {
    this._onFontSizeChange = callback;
  }

  // === Touch Events ===

  touchStart(touches: TouchPoint[]): void {
    for (const t of touches) {
      this._activeTouches.set(t.id, t);
    }

    this.stopMomentum();

    if (this._activeTouches.size === 1) {
      const touch = touches[0];
      this._panStartX = touch.x;
      this._panStartY = touch.y;
      this._lastPanX = touch.x;
      this._lastPanY = touch.y;
      this._velocityX = 0;
      this._velocityY = 0;
      this._state = 'tracking';

      // Start long press timer
      this.startLongPress(touch);
    } else if (this._activeTouches.size === 2) {
      this.cancelLongPress();
      const pts = Array.from(this._activeTouches.values());
      this._initialPinchDistance = this.distance(pts[0], pts[1]);
      this._initialFontSize = this._viewModel?.theme.fontSize ?? 14;
      this._state = 'pinching';
    }
  }

  touchMove(touches: TouchPoint[]): void {
    for (const t of touches) {
      this._activeTouches.set(t.id, t);
    }

    if (this._state === 'tracking' && this._activeTouches.size === 1) {
      const touch = touches[0];
      const dx = touch.x - this._panStartX;
      const dy = touch.y - this._panStartY;

      if (Math.abs(dx) > this._config.panThreshold || Math.abs(dy) > this._config.panThreshold) {
        this.cancelLongPress();
        this._state = 'panning';
      }
    }

    if (this._state === 'panning' && this._activeTouches.size === 1) {
      const touch = touches[0];
      const dx = this._lastPanX - touch.x;
      const dy = this._lastPanY - touch.y;

      this._velocityX = dx;
      this._velocityY = dy;
      this._lastPanX = touch.x;
      this._lastPanY = touch.y;

      this._viewModel?.onScroll({ deltaX: dx, deltaY: dy });
    }

    if (this._state === 'selecting' && this._activeTouches.size === 1) {
      const touch = touches[0];
      this._viewModel?.onMouseMove({
        x: touch.x,
        y: touch.y,
        button: 0,
        clickCount: 1,
        ctrlKey: false,
        shiftKey: true, // extend selection
        altKey: false,
        metaKey: false,
      });
    }

    if (this._state === 'pinching' && this._activeTouches.size === 2) {
      const pts = Array.from(this._activeTouches.values());
      const currentDist = this.distance(pts[0], pts[1]);
      const delta = currentDist - this._initialPinchDistance;

      if (Math.abs(delta) > this._config.pinchThreshold) {
        const scale = currentDist / this._initialPinchDistance;
        const newSize = Math.round(Math.max(8, Math.min(72, this._initialFontSize * scale)));
        this._onFontSizeChange?.(newSize);
      }
    }
  }

  touchEnd(touches: TouchPoint[]): void {
    for (const t of touches) {
      this._activeTouches.delete(t.id);
    }

    if (this._activeTouches.size === 0) {
      if (this._state === 'tracking') {
        // This was a tap (no significant movement)
        this.cancelLongPress();
        this.handleTap(touches[0]);
      } else if (this._state === 'panning') {
        // Start momentum scrolling
        this.startMomentum();
      }

      this._state = 'idle';
    } else if (this._activeTouches.size === 1 && this._state === 'pinching') {
      // Transitioned from pinch back to single finger
      const remaining = Array.from(this._activeTouches.values())[0];
      this._panStartX = remaining.x;
      this._panStartY = remaining.y;
      this._lastPanX = remaining.x;
      this._lastPanY = remaining.y;
      this._state = 'tracking';
    }
  }

  touchCancel(): void {
    this.cancelLongPress();
    this.stopMomentum();
    this._activeTouches.clear();
    this._state = 'idle';
  }

  // === Private ===

  private handleTap(touch: TouchPoint): void {
    const now = touch.timestamp;
    const dx = touch.x - this._lastTapX;
    const dy = touch.y - this._lastTapY;
    const distSq = dx * dx + dy * dy;
    const timeDelta = now - this._lastTapTime;

    if (timeDelta < this._config.multiTapTimeout && distSq < this._config.tapSlop * this._config.tapSlop) {
      this._tapCount++;
    } else {
      this._tapCount = 1;
    }

    this._lastTapTime = now;
    this._lastTapX = touch.x;
    this._lastTapY = touch.y;

    const clickCount = Math.min(this._tapCount, 3);

    this._viewModel?.onMouseDown({
      x: touch.x,
      y: touch.y,
      button: 0,
      clickCount,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
  }

  private startLongPress(touch: TouchPoint): void {
    this.cancelLongPress();
    this._longPressTimer = setTimeout(() => {
      if (this._state === 'tracking') {
        this._state = 'selecting';

        // Move cursor to long-press position, then begin selection
        this._viewModel?.onMouseDown({
          x: touch.x,
          y: touch.y,
          button: 0,
          clickCount: 1,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        });

        // Select the word at the cursor position
        this._viewModel?.executeCommand('editor.action.selectWord');
      }
    }, this._config.longPressTimeout);
  }

  private cancelLongPress(): void {
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  private startMomentum(): void {
    this.stopMomentum();
    const decel = this._config.scrollDeceleration;
    let vx = this._velocityX;
    let vy = this._velocityY;

    const tick = () => {
      if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
        this.stopMomentum();
        return;
      }

      this._viewModel?.onScroll({ deltaX: vx, deltaY: vy });
      vx *= decel;
      vy *= decel;
      this._momentumTimer = requestAnimationFrame(tick);
    };

    // Use setTimeout as fallback (Perry may not have requestAnimationFrame)
    if (typeof requestAnimationFrame !== 'undefined') {
      this._momentumTimer = requestAnimationFrame(tick);
    }
  }

  private stopMomentum(): void {
    if (this._momentumTimer !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this._momentumTimer);
      } else {
        clearTimeout(this._momentumTimer);
      }
      this._momentumTimer = null;
    }
  }

  private distance(a: TouchPoint, b: TouchPoint): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
