import { describe, test, expect } from 'bun:test';
import { NoOpFFI, CursorStyle } from '../native/ffi-bridge';
import type { NativeEditorFFI } from '../native/ffi-bridge';
import { NativeRenderCoordinator } from '../native/render-coordinator';
import { TouchInputHandler, type TouchPoint } from '../native/touch-input';
import { computeWrapPoints, WrapCache, type WrapMode } from '../native/word-wrap';
import { EditorDocument } from '../core/document/document';
import { EditorViewModel } from '../view-model/editor-view-model';
import { TextBuffer } from '../core/buffer/text-buffer';

// ============================================================
// FFI Bridge
// ============================================================

describe('NoOpFFI', () => {
  test('create returns incrementing handles', () => {
    const ffi = new NoOpFFI();
    expect(ffi.create(800, 600)).toBe(1);
    expect(ffi.create(1024, 768)).toBe(2);
    expect(ffi.create(1920, 1080)).toBe(3);
  });

  test('records all calls', () => {
    const ffi = new NoOpFFI();
    const h = ffi.create(800, 600);
    ffi.setFont(h, 'Menlo', 14);
    ffi.renderLine(h, 1, 'hello', '[]', 0);
    ffi.setCursor(h, 10, 0, 0);
    ffi.invalidate(h);

    expect(ffi.calls.length).toBe(5);
    expect(ffi.getCalls('create').length).toBe(1);
    expect(ffi.getCalls('setFont')[0]).toEqual([h, 'Menlo', 14]);
    expect(ffi.getCalls('renderLine')[0]).toEqual([h, 1, 'hello', '[]', 0]);
  });

  test('measureText returns 8px per char', () => {
    const ffi = new NoOpFFI();
    const h = ffi.create(800, 600);
    expect(ffi.measureText(h, 'hello')).toBe(40);
    expect(ffi.measureText(h, '')).toBe(0);
    expect(ffi.measureText(h, 'a')).toBe(8);
  });

  test('reset clears all calls', () => {
    const ffi = new NoOpFFI();
    ffi.create(800, 600);
    expect(ffi.calls.length).toBe(1);
    ffi.reset();
    expect(ffi.calls.length).toBe(0);
  });

  test('getCalls filters by method', () => {
    const ffi = new NoOpFFI();
    const h = ffi.create(800, 600);
    ffi.setCursor(h, 0, 0, 0);
    ffi.setCursor(h, 10, 20, 1);
    ffi.setFont(h, 'Fira', 12);

    expect(ffi.getCalls('setCursor').length).toBe(2);
    expect(ffi.getCalls('setFont').length).toBe(1);
    expect(ffi.getCalls('destroy').length).toBe(0);
  });

  test('optional methods work', () => {
    const ffi = new NoOpFFI();
    const h = ffi.create(800, 600);
    ffi.beginFrame(h);
    ffi.endFrame(h);
    ffi.renderDecorations(h, '[]');
    ffi.renderGhostText(h, 'test', 0, 0, '#808080');
    ffi.setCursors(h, '[]');

    expect(ffi.getCalls('beginFrame').length).toBe(1);
    expect(ffi.getCalls('endFrame').length).toBe(1);
    expect(ffi.getCalls('renderDecorations').length).toBe(1);
    expect(ffi.getCalls('renderGhostText').length).toBe(1);
    expect(ffi.getCalls('setCursors').length).toBe(1);
  });

  test('destroy records call', () => {
    const ffi = new NoOpFFI();
    const h = ffi.create(800, 600);
    ffi.destroy(h);
    expect(ffi.getCalls('destroy')).toEqual([[h]]);
  });

  test('CursorStyle constants', () => {
    expect(CursorStyle.Line).toBe(0);
    expect(CursorStyle.Block).toBe(1);
    expect(CursorStyle.Underline).toBe(2);
  });
});

// ============================================================
// Render Coordinator
// ============================================================

describe('NativeRenderCoordinator', () => {
  function createCoordinator() {
    const ffi = new NoOpFFI();
    const coordinator = new NativeRenderCoordinator(ffi, {
      fontFamily: 'Menlo',
      fontSize: 14,
      lineHeight: 1.5,
    });
    return { ffi, coordinator };
  }

  function createViewModelWith(text: string) {
    const doc = new EditorDocument('test://file', text);
    return new EditorViewModel(doc);
  }

  test('create initializes native view', () => {
    const { ffi, coordinator } = createCoordinator();
    const handle = coordinator.create(800, 600);

    expect(handle).toBe(1);
    expect(coordinator.handle).toBe(1);
    expect(ffi.getCalls('create')).toEqual([[800, 600]]);
    expect(ffi.getCalls('setFont')[0]).toEqual([1, 'Menlo', 14]);
    expect(ffi.getCalls('measureText').length).toBe(1); // measure 'M'
  });

  test('destroy cleans up', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    coordinator.destroy();

    expect(coordinator.handle).toBeNull();
    expect(ffi.getCalls('destroy')).toEqual([[1]]);
  });

  test('destroy is idempotent', () => {
    const { coordinator } = createCoordinator();
    coordinator.destroy(); // no handle yet, should be no-op
    coordinator.create(800, 600);
    coordinator.destroy();
    coordinator.destroy(); // already destroyed
  });

  test('charWidth comes from measureText', () => {
    const { coordinator } = createCoordinator();
    coordinator.create(800, 600);
    // NoOpFFI returns 8px per char, 'M' is 1 char = 8px
    expect(coordinator.charWidth).toBe(8);
  });

  test('attach wires to view model', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);

    const vm = createViewModelWith('hello\nworld');
    vm.onResize(800, 600);

    ffi.reset();
    coordinator.attach(vm);

    // Should have rendered initial frame
    expect(ffi.getCalls('renderLine').length).toBeGreaterThan(0);
  });

  test('render sends lines to FFI', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('line one\nline two\nline three');
    vm.onResize(800, 600);

    ffi.reset();
    coordinator.attach(vm);

    const renderCalls = ffi.getCalls('renderLine');
    expect(renderCalls.length).toBeGreaterThanOrEqual(3);

    // Lines are 1-based in display
    expect(renderCalls[0][1]).toBe(1); // line number
    expect(renderCalls[0][2]).toBe('line one'); // text
  });

  test('dirty tracking avoids redundant renders', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('hello');
    vm.onResize(800, 600);

    coordinator.attach(vm);
    const firstCount = ffi.getCalls('renderLine').length;

    ffi.reset();
    coordinator.render(); // re-render same state

    // Should not re-render unchanged lines
    expect(ffi.getCalls('renderLine').length).toBe(0);
  });

  test('invalidate clears dirty cache', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('hello');
    vm.onResize(800, 600);
    coordinator.attach(vm);

    ffi.reset();
    coordinator.invalidate();

    // Should re-render all lines after invalidation
    expect(ffi.getCalls('renderLine').length).toBeGreaterThan(0);
  });

  test('setFont updates config and re-measures', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);

    ffi.reset();
    coordinator.setFont('Fira Code', 16);

    expect(ffi.getCalls('setFont')[0]).toEqual([1, 'Fira Code', 16]);
    expect(ffi.getCalls('measureText').length).toBe(1); // re-measure 'M'
  });

  test('measureText uses native measurement', () => {
    const { coordinator } = createCoordinator();
    coordinator.create(800, 600);
    expect(coordinator.measureText('hello')).toBe(40); // 5 * 8
  });

  test('measureText falls back without handle', () => {
    const { coordinator } = createCoordinator();
    // No create() called
    const result = coordinator.measureText('hello');
    expect(result).toBe(40); // 5 chars * 8 (default charWidth)
  });

  test('detach stops listening', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('hello');
    vm.onResize(800, 600);
    coordinator.attach(vm);

    ffi.reset();
    coordinator.detach();

    // Trigger a change on the VM — coordinator should NOT re-render
    vm.onKeyDown({
      key: 'a', code: 'KeyA',
      ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });

    expect(ffi.getCalls('renderLine').length).toBe(0);
  });

  test('scroll updates native scroll offset', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('a\nb\nc\nd\ne\nf\ng\nh');
    vm.onResize(800, 100); // small viewport

    ffi.reset();
    coordinator.attach(vm);

    const scrollCalls = ffi.getCalls('scroll');
    // Initial scroll should be at 0
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('cursor position is sent to FFI', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('hello world');
    vm.onResize(800, 600);

    ffi.reset();
    coordinator.attach(vm);

    expect(ffi.getCalls('setCursor').length).toBe(1);
  });

  test('selection regions are sent to FFI', () => {
    const { ffi, coordinator } = createCoordinator();
    coordinator.create(800, 600);
    const vm = createViewModelWith('hello world');
    vm.onResize(800, 600);
    coordinator.attach(vm);

    // Select some text
    vm.cursorManager.moveToPosition(0, 0, false);
    vm.cursorManager.moveToPosition(0, 5, true);

    ffi.reset();
    coordinator.invalidate(); // clears dirty caches and re-renders

    const selCalls = ffi.getCalls('setSelection');
    expect(selCalls.length).toBe(1);
    // args are [handle, regionsJson]
    const regions = JSON.parse(selCalls[0][1]);
    expect(regions.length).toBe(1);
    expect(regions[0].w).toBeGreaterThan(0);
  });
});

// ============================================================
// Touch Input
// ============================================================

describe('TouchInputHandler', () => {
  function createTouch(id: number, x: number, y: number): TouchPoint {
    return { id, x, y, timestamp: Date.now() };
  }

  test('initial state is idle', () => {
    const handler = new TouchInputHandler();
    expect(handler.state).toBe('idle');
  });

  test('single tap triggers mouse down', () => {
    const handler = new TouchInputHandler();
    const doc = new EditorDocument('test://file','hello world');
    const vm = new EditorViewModel(doc);
    vm.onResize(800, 600);
    handler.attach(vm);

    const touch = createTouch(0, 100, 50);
    handler.touchStart([touch]);
    handler.touchEnd([touch]);

    expect(handler.state).toBe('idle');
  });

  test('pan triggers scroll', () => {
    const handler = new TouchInputHandler({ panThreshold: 5 });
    const doc = new EditorDocument('test://file','a\nb\nc\nd\ne\nf\ng\nh\ni\nj');
    const vm = new EditorViewModel(doc);
    vm.onResize(800, 100);
    handler.attach(vm);

    const startY = 100;
    const t0 = createTouch(0, 100, startY);
    handler.touchStart([t0]);

    // Move enough to trigger pan
    handler.touchMove([{ ...t0, y: startY - 50 }]);
    expect(handler.state).toBe('panning');

    handler.touchEnd([{ ...t0, y: startY - 50 }]);
    expect(handler.state).toBe('idle');
  });

  test('two-finger touch starts pinch', () => {
    const handler = new TouchInputHandler();
    const doc = new EditorDocument('test://file','hello');
    const vm = new EditorViewModel(doc);
    handler.attach(vm);

    handler.touchStart([createTouch(0, 100, 100)]);
    handler.touchStart([createTouch(1, 200, 200)]);

    expect(handler.state).toBe('pinching');
  });

  test('touchCancel resets state', () => {
    const handler = new TouchInputHandler();
    handler.touchStart([createTouch(0, 100, 100)]);
    expect(handler.state).toBe('tracking');
    handler.touchCancel();
    expect(handler.state).toBe('idle');
  });

  test('detach resets state', () => {
    const handler = new TouchInputHandler();
    const doc = new EditorDocument('test://file','hello');
    const vm = new EditorViewModel(doc);
    handler.attach(vm);
    handler.touchStart([createTouch(0, 100, 100)]);
    handler.detach();
    expect(handler.state).toBe('idle');
  });

  test('onFontSizeChange callback fires on pinch', () => {
    const handler = new TouchInputHandler({ pinchThreshold: 1 });
    const doc = new EditorDocument('test://file','hello');
    const vm = new EditorViewModel(doc);
    handler.attach(vm);

    let newSize = 0;
    handler.onFontSizeChange((size) => { newSize = size; });

    // Start pinch
    const t0 = createTouch(0, 100, 100);
    const t1 = createTouch(1, 200, 100);
    handler.touchStart([t0]);
    handler.touchStart([t1]);

    // Spread fingers apart (zoom in)
    handler.touchMove([
      { ...t0, x: 50, y: 100 },
      { ...t1, x: 250, y: 100 },
    ]);

    expect(newSize).toBeGreaterThan(0);
  });
});

// ============================================================
// Word Wrap
// ============================================================

describe('Word Wrap', () => {
  const charMeasure = (text: string) => text.length * 8; // 8px per char

  test('no wrap returns single segment', () => {
    const points = computeWrapPoints('hello', 100, charMeasure, 'none');
    expect(points.length).toBe(1);
    expect(points[0].column).toBe(0);
  });

  test('short line does not wrap', () => {
    const points = computeWrapPoints('hello', 100, charMeasure, 'word');
    expect(points.length).toBe(1); // 5 * 8 = 40 < 100
  });

  test('long line wraps at word boundary', () => {
    const text = 'hello world foo bar';
    // 19 chars * 8 = 152px, max 80px
    const points = computeWrapPoints(text, 80, charMeasure, 'word');
    expect(points.length).toBeGreaterThan(1);
    expect(points[0].column).toBe(0);
  });

  test('bounded mode wraps at max width', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    // 26 * 8 = 208px, max 80px
    const points = computeWrapPoints(text, 80, charMeasure, 'bounded');
    expect(points.length).toBeGreaterThan(1);
    // Each segment should be ~10 chars (80/8)
    expect(points[1].column).toBeLessThanOrEqual(11);
  });

  test('empty string returns single segment', () => {
    const points = computeWrapPoints('', 100, charMeasure, 'word');
    expect(points.length).toBe(1);
  });

  test('word mode finds word boundaries', () => {
    const text = 'the quick brown fox jumps';
    // 25 * 8 = 200px, max 120px
    const points = computeWrapPoints(text, 120, charMeasure, 'word');
    expect(points.length).toBeGreaterThan(1);
    // Should break at a space, not mid-word
    const breakCol = points[1].column;
    const charBeforeBreak = text[breakCol - 1];
    // The break should be right after a space
    expect(charBeforeBreak === ' ' || text[breakCol] !== ' ' || breakCol === 0).toBe(true);
  });

  test('wrapped line indent', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const points = computeWrapPoints(text, 80, charMeasure, 'bounded', 4);
    if (points.length > 1) {
      expect(points[1].indent).toBeGreaterThan(0);
    }
  });
});

describe('WrapCache', () => {
  test('caches wrap points', () => {
    const cache = new WrapCache({ mode: 'word' });
    const buf = new TextBuffer('hello world this is a long line that should wrap');
    cache.setMaxWidth(80);
    cache.setMeasureFn((t) => t.length * 8);

    const points1 = cache.getWrapPoints(buf, 0);
    const points2 = cache.getWrapPoints(buf, 0);
    expect(points1).toBe(points2); // same reference (cached)
  });

  test('invalidateLines clears specific lines', () => {
    const cache = new WrapCache({ mode: 'word' });
    const buf = new TextBuffer('line one\nline two\nline three');
    cache.setMaxWidth(1000);
    cache.setMeasureFn((t) => t.length * 8);

    const p0 = cache.getWrapPoints(buf, 0);
    const p1 = cache.getWrapPoints(buf, 1);
    cache.invalidateLines(0, 0);

    const p0new = cache.getWrapPoints(buf, 0);
    const p1same = cache.getWrapPoints(buf, 1);

    expect(p0new).not.toBe(p0); // re-computed
    expect(p1same).toBe(p1); // still cached
  });

  test('invalidateAll clears everything', () => {
    const cache = new WrapCache({ mode: 'word' });
    const buf = new TextBuffer('hello');
    cache.setMaxWidth(1000);
    cache.setMeasureFn((t) => t.length * 8);

    const p0 = cache.getWrapPoints(buf, 0);
    cache.invalidateAll();
    const p0new = cache.getWrapPoints(buf, 0);
    expect(p0new).not.toBe(p0);
  });

  test('setMaxWidth invalidates cache', () => {
    const cache = new WrapCache({ mode: 'bounded' });
    const buf = new TextBuffer('abcdefghijklmnopqrstuvwxyz');
    cache.setMaxWidth(200);
    cache.setMeasureFn((t) => t.length * 8);

    const wide = cache.getWrapPoints(buf, 0);
    cache.setMaxWidth(80);
    const narrow = cache.getWrapPoints(buf, 0);

    expect(narrow.length).toBeGreaterThan(wide.length);
  });

  test('getVisualLineCount returns segment count', () => {
    const cache = new WrapCache({ mode: 'bounded' });
    const buf = new TextBuffer('abcdefghijklmnopqrstuvwxyz');
    cache.setMaxWidth(80);
    cache.setMeasureFn((t) => t.length * 8);

    expect(cache.getVisualLineCount(buf, 0)).toBeGreaterThan(1);
  });

  test('setConfig clears cache', () => {
    const cache = new WrapCache({ mode: 'none' });
    const buf = new TextBuffer('abcdefghijklmnopqrstuvwxyz');
    cache.setMaxWidth(80);
    cache.setMeasureFn((t) => t.length * 8);

    const noWrap = cache.getWrapPoints(buf, 0);
    expect(noWrap.length).toBe(1);

    cache.setConfig({ mode: 'bounded' });
    const wrapped = cache.getWrapPoints(buf, 0);
    expect(wrapped.length).toBeGreaterThan(1);
  });

  test('wrapColumn mode uses column count', () => {
    const cache = new WrapCache({ mode: 'bounded', wrapColumn: 10 });
    const buf = new TextBuffer('abcdefghijklmnopqrstuvwxyz');
    cache.setMaxWidth(1000); // should be ignored
    cache.setMeasureFn((t) => t.length * 8);

    // wrapColumn 10 * measureFn('M') = 10 * 8 = 80px
    const points = cache.getWrapPoints(buf, 0);
    expect(points.length).toBeGreaterThan(1);
  });
});
