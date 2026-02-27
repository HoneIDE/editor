import { describe, expect, test } from 'bun:test';
import { ViewportManager } from '../core/viewport/viewport-manager';
import { LineHeightCache } from '../core/viewport/line-height';
import { ScrollController } from '../core/viewport/scroll';

describe('ViewportManager', () => {
  function makeViewport(totalLines: number, heightPx: number = 600) {
    const vm = new ViewportManager();
    vm.update(800, heightPx);
    vm.setTotalLines(totalLines);
    return vm;
  }

  test('visible range for small document', () => {
    const vm = makeViewport(10);
    const range = vm.getVisibleRange();
    expect(range.startLine).toBe(0);
    expect(range.endLine).toBe(10);
  });

  test('visible range with scroll', () => {
    const vm = makeViewport(1000, 200); // 200px viewport, 20px line height = 10 visible lines
    vm.scroll.scrollTo(500); // scroll to line 25
    const range = vm.getVisibleRange();
    // Should be around line 15-45 (25 +/- 10 buffer + visible lines)
    expect(range.startLine).toBeLessThanOrEqual(15);
    expect(range.endLine).toBeGreaterThanOrEqual(35);
  });

  test('visible range clamped to document bounds', () => {
    const vm = makeViewport(5, 200);
    const range = vm.getVisibleRange();
    expect(range.startLine).toBeGreaterThanOrEqual(0);
    expect(range.endLine).toBeLessThanOrEqual(5);
  });

  test('visible lines excludes hidden lines', () => {
    const vm = makeViewport(20, 400);
    vm.setHiddenLines(new Set([3, 4, 5])); // fold lines 3-5
    const lines = vm.getVisibleLineNumbers();
    expect(lines).not.toContain(3);
    expect(lines).not.toContain(4);
    expect(lines).not.toContain(5);
    expect(lines).toContain(2);
    expect(lines).toContain(6);
  });

  test('getLinesPerPage', () => {
    const vm = makeViewport(100, 200);
    // 200px / 20px = 10 lines, minus 1 = 9
    expect(vm.getLinesPerPage()).toBe(9);
  });

  test('revealLine top', () => {
    const vm = makeViewport(100, 200);
    vm.revealLine(50, 'top');
    expect(vm.scroll.scrollTop).toBe(50 * 20);
  });

  test('revealLine center', () => {
    const vm = makeViewport(100, 200);
    vm.revealLine(50, 'center');
    const expected = 50 * 20 - (200 - 20) / 2;
    expect(vm.scroll.scrollTop).toBe(expected);
  });

  test('ensureLineVisible scrolls down', () => {
    const vm = makeViewport(100, 200);
    vm.ensureLineVisible(50);
    // Line 50 at y=1000, viewport=200, should scroll so line 50 is at bottom
    expect(vm.scroll.scrollTop).toBeGreaterThan(0);
    // Line should now be visible
    const range = vm.getVisibleRange();
    expect(range.startLine).toBeLessThanOrEqual(50);
    expect(range.endLine).toBeGreaterThan(50);
  });

  test('ensureLineVisible does not scroll if already visible', () => {
    const vm = makeViewport(100, 200);
    vm.ensureLineVisible(3); // line 3 is at y=60, well within 200px viewport
    expect(vm.scroll.scrollTop).toBe(0);
  });
});

describe('LineHeightCache', () => {
  test('uniform height', () => {
    const cache = new LineHeightCache(20);
    cache.setTotalLines(100);
    expect(cache.getLineHeight(0)).toBe(20);
    expect(cache.getLineHeight(50)).toBe(20);
    expect(cache.getLineTop(5)).toBe(100);
    expect(cache.getTotalHeight()).toBe(2000);
  });

  test('wrapped line override', () => {
    const cache = new LineHeightCache(20);
    cache.setTotalLines(10);
    cache.setWrapped(3, 3); // line 3 wraps to 3 visual lines
    expect(cache.getLineHeight(3)).toBe(60);
    expect(cache.getLineHeight(2)).toBe(20); // unchanged
    expect(cache.getLineTop(4)).toBe(3 * 20 + 60); // 3 normal + 1 wrapped
    expect(cache.getTotalHeight()).toBe(9 * 20 + 60);
  });

  test('getLineAtY', () => {
    const cache = new LineHeightCache(20);
    cache.setTotalLines(100);
    expect(cache.getLineAtY(0)).toBe(0);
    expect(cache.getLineAtY(19)).toBe(0);
    expect(cache.getLineAtY(20)).toBe(1);
    expect(cache.getLineAtY(100)).toBe(5);
  });

  test('getLineAtY with overrides', () => {
    const cache = new LineHeightCache(20);
    cache.setTotalLines(10);
    cache.setWrapped(2, 3); // line 2 is 60px tall

    expect(cache.getLineAtY(39)).toBe(1);  // y=39 is in line 1
    expect(cache.getLineAtY(40)).toBe(2);  // y=40 is in line 2 (which starts at 40)
    expect(cache.getLineAtY(99)).toBe(2);  // y=99 still in line 2 (60px tall)
    expect(cache.getLineAtY(100)).toBe(3); // y=100 is line 3
  });

  test('clearOverride', () => {
    const cache = new LineHeightCache(20);
    cache.setTotalLines(10);
    cache.setWrapped(3, 2);
    expect(cache.getLineHeight(3)).toBe(40);
    cache.clearOverride(3);
    expect(cache.getLineHeight(3)).toBe(20);
  });
});

describe('ScrollController', () => {
  test('scroll clamps to bounds', () => {
    const lhc = new LineHeightCache(20);
    lhc.setTotalLines(100); // 2000px total
    const sc = new ScrollController(lhc);
    sc.setViewport(800, 200);

    sc.scrollTo(-100);
    expect(sc.scrollTop).toBe(0);

    sc.scrollTo(5000);
    expect(sc.scrollTop).toBe(1800); // 2000 - 200
  });

  test('scrollBy', () => {
    const lhc = new LineHeightCache(20);
    lhc.setTotalLines(100);
    const sc = new ScrollController(lhc);
    sc.setViewport(800, 200);

    sc.scrollBy(0, 100);
    expect(sc.scrollTop).toBe(100);

    sc.scrollBy(0, -50);
    expect(sc.scrollTop).toBe(50);
  });

  test('ensureLineVisible', () => {
    const lhc = new LineHeightCache(20);
    lhc.setTotalLines(100);
    const sc = new ScrollController(lhc);
    sc.setViewport(800, 200);

    sc.ensureLineVisible(50);
    // Line 50 is at y=1000. Viewport is 200px.
    // scrollTop should be 1000 - 200 + 20 = 820
    expect(sc.scrollTop).toBe(820);
  });
});
