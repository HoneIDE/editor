import { describe, test, expect } from 'bun:test';
import { expandSnippet } from '../core/snippets/snippet-engine';

describe('expandSnippet', () => {
  test('plain text', () => {
    const r = expandSnippet('hello', {}, '');
    expect(r.text).toBe('hello');
    expect(r.tabStops.length).toBe(0);
  });

  test('simple tab stops $1 $2 $0', () => {
    const r = expandSnippet('a$1 b$2 c$0', {}, '');
    expect(r.text).toBe('a b c');
    expect(r.tabStops.length).toBe(3);
    expect(r.tabStops[0].index).toBe(1);
    expect(r.tabStops[1].index).toBe(2);
    expect(r.tabStops[2].index).toBe(0);
  });

  test('tab stop with default ${1:foo}', () => {
    const r = expandSnippet('x ${1:foo} y', {}, '');
    expect(r.text).toBe('x foo y');
    expect(r.tabStops[0].index).toBe(1);
    expect(r.tabStops[0].length).toBe(3);
  });

  // SHIP-V1-GAPS.md #83 — choices
  test('choices ${1|a,b,c|} pre-fill with first option', () => {
    const r = expandSnippet('${1|red,green,blue|}', {}, '');
    expect(r.text).toBe('red');
    expect(r.tabStops.length).toBe(1);
    expect(r.tabStops[0].choices).toEqual(['red', 'green', 'blue']);
    expect(r.tabStops[0].length).toBe(3);
  });

  // SHIP-V1-GAPS.md #83 — transforms
  test('transform ${1/re/sub/flags} parses regex/sub/flags', () => {
    const r = expandSnippet('${1/foo/bar/g}', {}, '');
    expect(r.text).toBe('');
    expect(r.tabStops.length).toBe(1);
    expect(r.tabStops[0].transform).toEqual({ regex: 'foo', sub: 'bar', flags: 'g' });
  });

  // SHIP-V1-GAPS.md #83 — nested
  test('nested ${1:func(${2:arg})}', () => {
    const r = expandSnippet('${1:func(${2:arg})}', {}, '');
    expect(r.text).toBe('func(arg)');
    expect(r.tabStops.length).toBe(2);
    // $1 should cover the full string, $2 should be inside.
    expect(r.tabStops[0].index).toBe(1);
    expect(r.tabStops[0].length).toBe('func(arg)'.length);
    expect(r.tabStops[1].index).toBe(2);
    expect(r.tabStops[1].length).toBe(3);
    expect(r.tabStops[1].offset).toBe('func('.length);
  });
});
