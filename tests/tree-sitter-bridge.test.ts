/**
 * Web tree-sitter bridge resilience (gh#5).
 *
 * web-tree-sitter 0.20.x's Emscripten runtime fails to instantiate in some
 * browsers (Firefox: reportUndefinedSymbols) and can hang. `mount()` awaits
 * init before constructing the editor, so a raw throw/hang failed the whole
 * mount. `initTreeSitterSafe` makes init best-effort so callers can fall back
 * to the keyword tokenizer instead. Tests inject a fake initializer (the real
 * one needs a browser + wasm).
 */
import { describe, test, expect } from 'bun:test';
import { initTreeSitterSafe } from '../native/web/tree-sitter-bridge';

const URLS = { webTreeSitter: 'about:blank' } as any;

// Swallow the expected fallback warning while running fn.
async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; warned: boolean }> {
  const orig = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const result = await fn();
    return { result, warned };
  } finally {
    console.warn = orig;
  }
}

describe('initTreeSitterSafe (gh#5)', () => {
  test('returns true when init resolves', async () => {
    const ok = await initTreeSitterSafe(URLS, 1000, () => Promise.resolve());
    expect(ok).toBe(true);
  });

  test('returns false (does not throw) when init rejects', async () => {
    const { result, warned } = await quiet(() =>
      initTreeSitterSafe(URLS, 1000, () => Promise.reject(new Error('reportUndefinedSymbols'))));
    expect(result).toBe(false);
    expect(warned).toBe(true); // emits a fallback warning
  });

  test('returns false when init hangs past the timeout', async () => {
    const start = Date.now();
    const { result } = await quiet(() =>
      initTreeSitterSafe(URLS, 60, () => new Promise<void>(() => { /* never settles */ })));
    expect(result).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  test('a slow-but-successful init within the timeout returns true', async () => {
    const ok = await initTreeSitterSafe(URLS, 500, () => new Promise<void>((r) => setTimeout(r, 20)));
    expect(ok).toBe(true);
  });
});
