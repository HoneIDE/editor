/**
 * Web mount() controller bridge (gh#1) + per-range diagnostics (gh#2).
 *
 * Exercises native/web/dom-ffi.ts against a minimal DOM stub: the host-side
 * accessors on FfiContext (getText / requestSetText / onTextChange /
 * requestSetCursor), the WASM-poll pull functions, focus, and the range
 * diagnostic squiggle rendering + hover tooltip. No browser / WASM needed.
 */
import { describe, test, expect, beforeEach } from 'bun:test';

// ── Minimal DOM stub (only what dom-ffi touches) ───────────────────────────
class FakeStyle {
  [k: string]: any;
  setProperty(k: string, v: string) { this[k] = v; }
}
class FakeElement {
  tagName: string;
  className = '';
  tabIndex = 0;
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  style = new FakeStyle();
  textContent = '';
  clientWidth = 800;
  clientHeight = 600;
  offsetWidth = 120;
  focused = false;
  private _innerHTML = '';
  private _ctx: any = null;
  private listeners: Record<string, Function[]> = {};
  constructor(tag: string) { this.tagName = tag; }
  appendChild(c: FakeElement) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c: FakeElement, ref: FakeElement | null) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
    return c;
  }
  removeChild(c: FakeElement) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  set innerHTML(v: string) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  addEventListener(type: string, fn: Function) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type: string, ev: any) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
  getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight }; }
  focus() { this.focused = true; }
  getContext() {
    if (!this._ctx) this._ctx = { font: '', measureText: (s: string) => ({ width: s.length * 8.4 }) };
    return this._ctx;
  }
  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const c of this.children) { out.push(c); out.push(...c.descendants()); }
    return out;
  }
  querySelectorAll(sel: string) {
    const classes = sel.split(',').map((s) => s.trim().replace(/^\./, '').split('.')[0]);
    const matched = this.descendants().filter((e) =>
      classes.some((cls) => (' ' + e.className + ' ').includes(' ' + cls + ' ')));
    return { forEach: (cb: (e: FakeElement) => void) => matched.forEach(cb), length: matched.length };
  }
}

(globalThis as any).document = {
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (t: string) => { const e = new FakeElement('#text'); e.textContent = t; return e; },
  head: new FakeElement('head'),
};

import {
  createDomFfiCtx,
  severityColor,
  squiggleBackground,
  computeDiagSegments,
  rangeDiagAtPosition,
  type RangeDiag,
} from '../native/web/dom-ffi';

function makeEditor() {
  const mount = new FakeElement('div');
  const ctx = createDomFfiCtx(mount as any, {});
  const h = ctx.ffi.hone_editor_create(800, 600) as number;
  return { ctx, h, mount };
}

// ── Pure helpers ───────────────────────────────────────────────────────────
describe('range-diagnostic helpers (gh#2)', () => {
  test('severityColor maps severities to VS Code palette', () => {
    expect(severityColor(1)).toBe('#f14c4c');
    expect(severityColor(2)).toBe('#cca700');
    expect(severityColor(3)).toBe('#3794ff');
    expect(severityColor(9)).toBe('#888888');
  });

  test('squiggleBackground embeds the color in an svg data uri', () => {
    const bg = squiggleBackground('#f14c4c');
    expect(bg.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(bg)).toContain('#f14c4c');
  });

  test('computeDiagSegments — single-line range', () => {
    const d: RangeDiag = { startLine: 2, startCol: 4, endLine: 2, endCol: 9, severity: 1, message: 'x' };
    const segs = computeDiagSegments(d, [0, 0, 20]);
    expect(segs).toEqual([{ line: 2, startCol: 4, endCol: 9 }]);
  });

  test('computeDiagSegments — multi-line range extends interior lines to EOL', () => {
    const d: RangeDiag = { startLine: 1, startCol: 6, endLine: 3, endCol: 3, severity: 2, message: 'x' };
    const segs = computeDiagSegments(d, [10, 12, 8, 30]);
    expect(segs).toEqual([
      { line: 1, startCol: 6, endCol: 12 }, // start line: from startCol to its length
      { line: 2, startCol: 0, endCol: 8 },  // interior: full line
      { line: 3, startCol: 0, endCol: 3 },  // end line: to endCol
    ]);
  });

  test('computeDiagSegments — zero-width span widened to 1 col', () => {
    const d: RangeDiag = { startLine: 0, startCol: 5, endLine: 0, endCol: 5, severity: 1, message: 'x' };
    const segs = computeDiagSegments(d, [3]); // line shorter than startCol
    expect(segs).toEqual([{ line: 0, startCol: 5, endCol: 6 }]);
  });

  test('rangeDiagAtPosition — containment incl. multi-line', () => {
    const diags: RangeDiag[] = [
      { startLine: 1, startCol: 6, endLine: 3, endCol: 3, severity: 1, message: 'a' },
    ];
    expect(rangeDiagAtPosition(diags, 0, 0)).toBeNull();        // before
    expect(rangeDiagAtPosition(diags, 1, 5)).toBeNull();        // start line, before startCol
    expect(rangeDiagAtPosition(diags, 1, 6)?.message).toBe('a'); // start
    expect(rangeDiagAtPosition(diags, 2, 99)?.message).toBe('a'); // interior, any col
    expect(rangeDiagAtPosition(diags, 3, 3)?.message).toBe('a'); // end col inclusive
    expect(rangeDiagAtPosition(diags, 3, 4)).toBeNull();        // end line, past endCol
    expect(rangeDiagAtPosition(diags, 4, 0)).toBeNull();        // after
  });
});

// ── Host ↔ editor text bridge (gh#1) ───────────────────────────────────────
describe('host text bridge (gh#1)', () => {
  test('getText reflects the last set_buffer_text push', () => {
    const { ctx, h } = makeEditor();
    expect(ctx.getText(h)).toBe('');
    ctx.ffi.hone_editor_set_buffer_text(h, 'hello\nworld');
    expect(ctx.getText(h)).toBe('hello\nworld');
  });

  test('onTextChange fires on push and unsubscribe stops it', () => {
    const { ctx, h } = makeEditor();
    const seen: string[] = [];
    const off = ctx.onTextChange(h, (t) => seen.push(t));
    ctx.ffi.hone_editor_set_buffer_text(h, 'a');
    ctx.ffi.hone_editor_set_buffer_text(h, 'ab');
    off();
    ctx.ffi.hone_editor_set_buffer_text(h, 'abc');
    expect(seen).toEqual(['a', 'ab']);
    expect(ctx.getText(h)).toBe('abc'); // still updates state after unsubscribe
  });

  test('requestSetText queues a pull drained exactly once', () => {
    const { ctx, h } = makeEditor();
    expect(ctx.ffi.hone_editor_has_pending_set_text(h)).toBe(0);
    ctx.requestSetText(h, 'new source');
    expect(ctx.ffi.hone_editor_has_pending_set_text(h)).toBe(1);
    expect(ctx.ffi.hone_editor_take_pending_set_text(h)).toBe('new source');
    expect(ctx.ffi.hone_editor_has_pending_set_text(h)).toBe(0);
    expect(ctx.ffi.hone_editor_take_pending_set_text(h)).toBe('');
  });

  test('setText("") is distinguishable from no-pending', () => {
    const { ctx, h } = makeEditor();
    ctx.requestSetText(h, '');
    expect(ctx.ffi.hone_editor_has_pending_set_text(h)).toBe(1); // empty IS a request
    expect(ctx.ffi.hone_editor_take_pending_set_text(h)).toBe('');
    expect(ctx.ffi.hone_editor_has_pending_set_text(h)).toBe(0);
  });

  test('requestSetCursor queues line/col cleared on demand', () => {
    const { ctx, h } = makeEditor();
    expect(ctx.ffi.hone_editor_has_pending_cursor(h)).toBe(0);
    ctx.requestSetCursor(h, 12, 24);
    expect(ctx.ffi.hone_editor_has_pending_cursor(h)).toBe(1);
    expect(ctx.ffi.hone_editor_pending_cursor_line(h)).toBe(12);
    expect(ctx.ffi.hone_editor_pending_cursor_col(h)).toBe(24);
    ctx.ffi.hone_editor_clear_pending_cursor(h);
    expect(ctx.ffi.hone_editor_has_pending_cursor(h)).toBe(0);
  });

  test('focus focuses the editor root element', () => {
    const { ctx, h, mount } = makeEditor();
    ctx.ffi.hone_editor_focus(h);
    expect(mount.children[0].focused).toBe(true);
  });
});

// ── Per-range diagnostics rendering + hover (gh#2) ──────────────────────────
describe('range diagnostics rendering (gh#2)', () => {
  function root(mount: FakeElement) { return mount.children[0]; }

  test('set/clear renders and removes squiggle overlays', () => {
    const { ctx, h, mount } = makeEditor();
    ctx.ffi.hone_editor_set_buffer_text(h, 'line0\nline1\nline2\nline3\nlet x = 1');
    ctx.ffi.hone_editor_set_range_diagnostics(h, JSON.stringify([
      { startLine: 4, startCol: 4, endLine: 4, endCol: 5, severity: 2, message: 'unused', code: 'ts(6133)' },
    ]));
    let squiggles = root(mount).querySelectorAll('.hone-editor-range-squiggle');
    expect(squiggles.length).toBe(1);

    ctx.ffi.hone_editor_clear_range_diagnostics(h);
    squiggles = root(mount).querySelectorAll('.hone-editor-range-squiggle');
    expect(squiggles.length).toBe(0);
  });

  test('multi-line diagnostic renders one squiggle per spanned line', () => {
    const { ctx, h, mount } = makeEditor();
    ctx.ffi.hone_editor_set_buffer_text(h, 'aaaa\nbbbb\ncccc\ndddd');
    ctx.ffi.hone_editor_set_range_diagnostics(h, JSON.stringify([
      { startLine: 1, startCol: 1, endLine: 3, endCol: 2, severity: 1, message: 'spans' },
    ]));
    expect(root(mount).querySelectorAll('.hone-editor-range-squiggle').length).toBe(3);
  });

  test('hover shows a tooltip with message + code, hides off-range', () => {
    const { ctx, h, mount } = makeEditor();
    ctx.ffi.hone_editor_set_buffer_text(h, 'l0\nl1\nl2\nl3\nconst y: number = "x"');
    ctx.ffi.hone_editor_set_range_diagnostics(h, JSON.stringify([
      { startLine: 4, startCol: 10, endLine: 4, endCol: 20, severity: 1,
        message: "Type 'string' is not assignable to type 'number'", code: 'ts(2322)' },
    ]));
    const r = root(mount);
    // lineHeight 21, charWidth 8.4, gutter 0 → line 4 = y∈[84,105), col∈[10,20] ≈ x∈[84,168]
    r.dispatch('mousemove', { clientX: 110, clientY: 92 });
    const tip = r.querySelectorAll('.hone-editor-range-tooltip');
    expect(tip.length).toBe(1);
    let tipEl: FakeElement | null = null;
    tip.forEach((e: FakeElement) => { tipEl = e; });
    expect(tipEl!.style.display).toBe('');
    expect(tipEl!.querySelectorAll('.hone-editor-range-code').length).toBe(1);

    // Move off the diagnostic range → tooltip hidden.
    r.dispatch('mousemove', { clientX: 110, clientY: 10 });
    expect(tipEl!.style.display).toBe('none');
  });
});
