import { describe, test, expect } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { searchAll, searchNext, searchPrev } from '../core/search/search-engine';
import { expandReplacement, replaceNext, replaceAll } from '../core/search/replace';
import { IncrementalSearch } from '../core/search/incremental';

const SAMPLE_TEXT = `function hello() {
  console.log("hello world");
  console.log("hello again");
  return "hello";
}`;

function makeBuffer(text: string): TextBuffer {
  return new TextBuffer(text);
}

describe('searchAll', () => {
  test('finds all literal matches', () => {
    const buf = makeBuffer(SAMPLE_TEXT);
    const matches = searchAll(buf, 'hello');
    expect(matches.length).toBe(4);
    expect(matches[0].line).toBe(0);
    expect(matches[0].column).toBe(9);
    expect(matches[1].line).toBe(1);
    expect(matches[2].line).toBe(2);
    expect(matches[3].line).toBe(3);
  });

  test('case insensitive search', () => {
    const buf = makeBuffer('Hello hello HELLO');
    const matches = searchAll(buf, 'hello', { caseSensitive: false });
    expect(matches.length).toBe(3);
  });

  test('case sensitive search', () => {
    const buf = makeBuffer('Hello hello HELLO');
    const matches = searchAll(buf, 'hello', { caseSensitive: true });
    expect(matches.length).toBe(1);
    expect(matches[0].column).toBe(6);
  });

  test('whole word search', () => {
    const buf = makeBuffer('hello helloWorld hello_there hello');
    const matches = searchAll(buf, 'hello', { wholeWord: true });
    expect(matches.length).toBe(2); // first and last
    expect(matches[0].column).toBe(0);
    expect(matches[1].column).toBe(29);
  });

  test('empty query returns empty', () => {
    const buf = makeBuffer(SAMPLE_TEXT);
    expect(searchAll(buf, '')).toEqual([]);
  });

  test('no matches', () => {
    const buf = makeBuffer(SAMPLE_TEXT);
    expect(searchAll(buf, 'xyz123')).toEqual([]);
  });

  test('regex search', () => {
    const buf = makeBuffer(SAMPLE_TEXT);
    const matches = searchAll(buf, 'hello\\b', { isRegex: true });
    expect(matches.length).toBe(4);
  });

  test('regex with capture groups', () => {
    const buf = makeBuffer('foo(1) bar(2) baz(3)');
    const matches = searchAll(buf, '(\\w+)\\((\\d+)\\)', { isRegex: true });
    expect(matches.length).toBe(3);
    expect(matches[0].captures).toEqual(['foo', '1']);
    expect(matches[1].captures).toEqual(['bar', '2']);
    expect(matches[2].captures).toEqual(['baz', '3']);
  });

  test('match has correct offset and length', () => {
    const buf = makeBuffer('abcdefg');
    const matches = searchAll(buf, 'cde');
    expect(matches.length).toBe(1);
    expect(matches[0].offset).toBe(2);
    expect(matches[0].length).toBe(3);
    expect(matches[0].text).toBe('cde');
  });
});

describe('searchNext / searchPrev', () => {
  test('searchNext wraps around', () => {
    const buf = makeBuffer('aaa bbb aaa');
    const m1 = searchNext(buf, 'aaa', 0);
    expect(m1!.offset).toBe(0);

    const m2 = searchNext(buf, 'aaa', 1);
    expect(m2!.offset).toBe(8);

    // Wrap around
    const m3 = searchNext(buf, 'aaa', 9);
    expect(m3!.offset).toBe(0);
  });

  test('searchPrev wraps around', () => {
    const buf = makeBuffer('aaa bbb aaa');
    const m1 = searchPrev(buf, 'aaa', 11);
    expect(m1!.offset).toBe(8);

    const m2 = searchPrev(buf, 'aaa', 8);
    expect(m2!.offset).toBe(0);

    // Wrap around from offset 1 (nothing before offset 1 except the first match at 0)
    const m3 = searchPrev(buf, 'aaa', 1);
    expect(m3!.offset).toBe(0);
  });

  test('searchNext returns null for no match', () => {
    const buf = makeBuffer('hello');
    expect(searchNext(buf, 'xyz', 0)).toBeNull();
  });
});

describe('expandReplacement', () => {
  test('expands capture groups', () => {
    const match = {
      offset: 0, length: 6, line: 0, column: 0,
      text: 'foo(1)', captures: ['foo', '1'],
    };
    expect(expandReplacement('$1=$2', match)).toBe('foo=1');
  });

  test('no captures returns replacement as-is', () => {
    const match = {
      offset: 0, length: 3, line: 0, column: 0,
      text: 'foo',
    };
    expect(expandReplacement('bar', match)).toBe('bar');
  });
});

describe('replaceNext', () => {
  test('replaces current match and finds next', () => {
    const buf = makeBuffer('aaa bbb aaa');
    const matches = searchAll(buf, 'aaa');
    const result = replaceNext(buf, 'aaa', 'xxx', matches[0]);
    expect(buf.getText()).toBe('xxx bbb aaa');
    expect(result.nextMatch).not.toBeNull();
    expect(result.nextMatch!.offset).toBe(8);
  });
});

describe('replaceAll', () => {
  test('replaces all matches', () => {
    const buf = makeBuffer('aaa bbb aaa ccc aaa');
    const result = replaceAll(buf, 'aaa', 'x');
    expect(result.count).toBe(3);
    expect(buf.getText()).toBe('x bbb x ccc x');
  });

  test('replaces with longer text', () => {
    const buf = makeBuffer('a b a');
    replaceAll(buf, 'a', 'xxx');
    expect(buf.getText()).toBe('xxx b xxx');
  });

  test('no matches returns count 0', () => {
    const buf = makeBuffer('hello');
    const result = replaceAll(buf, 'xyz', 'abc');
    expect(result.count).toBe(0);
    expect(buf.getText()).toBe('hello');
  });
});

describe('IncrementalSearch', () => {
  test('setQuery finds all matches', () => {
    const buf = makeBuffer('aaa bbb aaa');
    const search = new IncrementalSearch();
    search.setQuery(buf, 'aaa');
    expect(search.matchCount).toBe(2);
    expect(search.currentIndex).toBe(0);
  });

  test('next and prev navigate', () => {
    const buf = makeBuffer('a b a b a');
    const search = new IncrementalSearch();
    search.setQuery(buf, 'a');
    expect(search.matchCount).toBe(3);

    expect(search.currentMatch!.offset).toBe(0);
    search.next();
    expect(search.currentMatch!.offset).toBe(4);
    search.next();
    expect(search.currentMatch!.offset).toBe(8);
    search.next(); // wrap
    expect(search.currentMatch!.offset).toBe(0);

    search.prev(); // wrap back
    expect(search.currentMatch!.offset).toBe(8);
  });

  test('goToNearest finds nearest match', () => {
    const buf = makeBuffer('a b a b a');
    const search = new IncrementalSearch();
    search.setQuery(buf, 'a');

    const m = search.goToNearest(5);
    expect(m!.offset).toBe(8);
  });

  test('clear resets state', () => {
    const buf = makeBuffer('hello');
    const search = new IncrementalSearch();
    search.setQuery(buf, 'hello');
    expect(search.matchCount).toBe(1);

    search.clear();
    expect(search.matchCount).toBe(0);
    expect(search.currentIndex).toBe(-1);
  });

  test('empty query returns no matches', () => {
    const buf = makeBuffer('hello');
    const search = new IncrementalSearch();
    search.setQuery(buf, '');
    expect(search.matchCount).toBe(0);
  });
});
