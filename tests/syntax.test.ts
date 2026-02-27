import { describe, expect, test } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { SyntaxEngine } from '../core/tokenizer/syntax-engine';
import { IncrementalTokenCache } from '../core/tokenizer/incremental';
import { DARK_THEME } from '../view-model/theme';

describe('SyntaxEngine', () => {
  test('supported languages', () => {
    const engine = new SyntaxEngine();
    const langs = engine.getSupportedLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('html');
    expect(langs).toContain('css');
    expect(langs).toContain('json');
    expect(langs).toContain('markdown');
    expect(langs).toContain('python');
    expect(langs).toContain('rust');
    expect(langs).toContain('cpp');
    expect(langs).toContain('c');
  });

  test('parse TypeScript', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('const x: number = 42;');

    engine.setLanguage('typescript');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse JavaScript', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('function hello() { return "world"; }');

    engine.setLanguage('javascript');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse Python', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('def hello():\n    return "world"');

    engine.setLanguage('python');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse JSON', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('{"key": "value", "num": 42, "bool": true}');

    engine.setLanguage('json');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse HTML', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('<div class="hello">World</div>');

    engine.setLanguage('html');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse CSS', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('body { color: red; font-size: 14px; }');

    engine.setLanguage('css');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse Rust', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('fn main() {\n    println!("hello");\n}');

    engine.setLanguage('rust');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse C++', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('#include <stdio.h>\nint main() { return 0; }');

    engine.setLanguage('cpp');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('parse Markdown', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('# Heading\n\nSome **bold** text.');

    engine.setLanguage('markdown');
    const tree = engine.parse(buf);
    expect(tree).not.toBeNull();
  });

  test('getLineTokens produces colored tokens for TypeScript', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('const x = 42;');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);

    // Check that we have different colors (not all default)
    const colors = new Set(tokens.map(t => t.color));
    expect(colors.size).toBeGreaterThan(1); // At least keyword vs number
  });

  test('getLineTokens covers entire line', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('const x = 42;');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);

    // Tokens should cover from column 0 to end of line
    expect(tokens[0].startColumn).toBe(0);
    const lastToken = tokens[tokens.length - 1];
    expect(lastToken.endColumn).toBe(13); // "const x = 42;" length
  });

  test('getLineTokens for multi-line document', () => {
    const engine = new SyntaxEngine();
    const code = `function greet(name: string): string {
  const msg = "hello " + name;
  return msg;
}`;
    const buf = new TextBuffer(code);

    engine.setLanguage('typescript');
    engine.parse(buf);

    for (let i = 0; i < buf.getLineCount(); i++) {
      const tokens = engine.getLineTokens(buf, i, DARK_THEME);
      expect(tokens.length).toBeGreaterThan(0);

      // Verify no gaps or overlaps
      for (let j = 1; j < tokens.length; j++) {
        expect(tokens[j].startColumn).toBe(tokens[j - 1].endColumn);
      }
    }
  });

  test('getLineTokens for empty line', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('line1\n\nline3');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const tokens = engine.getLineTokens(buf, 1, DARK_THEME);
    expect(tokens).toHaveLength(0);
  });

  test('unsupported language returns null tree', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('some code');

    engine.setLanguage('zig'); // not supported
    const tree = engine.parse(buf);
    expect(tree).toBeNull();
  });

  test('unsupported language returns empty tokens', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('some code');

    engine.setLanguage('zig');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens).toHaveLength(0);
  });

  test('getFoldRanges for TypeScript', () => {
    const engine = new SyntaxEngine();
    const code = `function hello() {
  if (true) {
    console.log("hi");
  }
}`;
    const buf = new TextBuffer(code);

    engine.setLanguage('typescript');
    engine.parse(buf);

    const ranges = engine.getFoldRanges(buf);
    expect(ranges.length).toBeGreaterThan(0);

    // Should have fold range for the function body
    const functionFold = ranges.find(r => r.startLine === 0);
    expect(functionFold).toBeDefined();
    expect(functionFold!.endLine).toBe(4);
  });
});

describe('IncrementalTokenCache', () => {
  test('caches tokens', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('const x = 42;\nlet y = "hi";');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const cache = new IncrementalTokenCache(engine);

    const tokens1 = cache.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens1.length).toBeGreaterThan(0);
    expect(cache.size).toBe(1);

    const tokens2 = cache.getLineTokens(buf, 1, DARK_THEME);
    expect(tokens2.length).toBeGreaterThan(0);
    expect(cache.size).toBe(2);
  });

  test('invalidateAll clears cache', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('const x = 42;');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const cache = new IncrementalTokenCache(engine);
    cache.getLineTokens(buf, 0, DARK_THEME);
    expect(cache.size).toBe(1);

    cache.invalidateAll();
    expect(cache.size).toBe(0);
  });

  test('tokenizeRange pre-caches', () => {
    const engine = new SyntaxEngine();
    const buf = new TextBuffer('line1\nline2\nline3\nline4\nline5');

    engine.setLanguage('typescript');
    engine.parse(buf);

    const cache = new IncrementalTokenCache(engine);
    cache.tokenizeRange(buf, 0, 5, DARK_THEME);
    expect(cache.size).toBe(5);
  });
});
