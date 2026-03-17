import { describe, expect, test } from 'bun:test';
import { TextBuffer } from '../core/buffer/text-buffer';
import { KeywordSyntaxEngine } from '../core/tokenizer/keyword-syntax-engine';
import { DARK_THEME } from '../view-model/theme';

describe('KeywordSyntaxEngine', () => {
  // -----------------------------------------------------------------------
  // All 20 languages return tokens for representative snippets
  // -----------------------------------------------------------------------

  test('tokenizes TypeScript', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('typescript');
    const buf = new TextBuffer('const x: number = 42;');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'const'
  });

  test('tokenizes JavaScript', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('javascript');
    const buf = new TextBuffer('function hello() { return 42; }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'function'
  });

  test('tokenizes Python', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('python');
    const buf = new TextBuffer('def hello():\n    return 42');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'def'
  });

  test('tokenizes Rust', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('rust');
    const buf = new TextBuffer('fn main() { let x = 42u32; }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'fn'
  });

  test('tokenizes HTML', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('html');
    const buf = new TextBuffer('<div class="hello">world</div>');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes CSS', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('css');
    const buf = new TextBuffer('.container { color: red; }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes JSON', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('json');
    const buf = new TextBuffer('{"key": true, "num": 42}');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes Markdown', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('markdown');
    const buf = new TextBuffer('# Hello World');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes C', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('c');
    const buf = new TextBuffer('int main() { return 0; }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes C++', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('cpp');
    const buf = new TextBuffer('struct Foo { static const int x = 0; };');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes Go', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('go');
    const buf = new TextBuffer('func main() { fmt.Println("hello") }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'func'
  });

  test('tokenizes Java', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('java');
    const buf = new TextBuffer('public class Main { public static void main(String[] args) {} }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'public'
  });

  test('tokenizes Swift', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('swift');
    const buf = new TextBuffer('func greet() -> String { return "hello" }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'func'
  });

  test('tokenizes Shell', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('shell');
    const buf = new TextBuffer('if [ -f "$FILE" ]; then echo "exists"; fi');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'if'
  });

  test('tokenizes Ruby', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('ruby');
    const buf = new TextBuffer('def hello\n  puts "world"\nend');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'def'
  });

  test('tokenizes PHP', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('php');
    const buf = new TextBuffer('function hello() { return "world"; }');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'function'
  });

  test('tokenizes YAML', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('yaml');
    const buf = new TextBuffer('enabled: true\ncount: 42');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes TOML', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('toml');
    const buf = new TextBuffer('[package]\nname = "hello"\nversion = "0.1.0"');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('tokenizes SQL', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('sql');
    const buf = new TextBuffer('SELECT id, name FROM users WHERE active = true;');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'SELECT'
  });

  test('tokenizes XML', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('xml');
    const buf = new TextBuffer('<?xml version="1.0" encoding="UTF-8"?>');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Language switching produces correct keyword colors
  // -----------------------------------------------------------------------

  test('language switching: TypeScript then Python', () => {
    const engine = new KeywordSyntaxEngine();

    // Start with TypeScript
    engine.setLanguage('typescript');
    const buf = new TextBuffer('def hello():');
    engine.parse(buf);
    let tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    // 'def' is NOT a TypeScript keyword
    expect(tokens[0].color).not.toBe(DARK_THEME.tokens.keyword);

    // Switch to Python
    engine.setLanguage('python');
    engine.parse(buf);
    tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    // 'def' IS a Python keyword
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword);
  });

  test('language switching: Go then Rust', () => {
    const engine = new KeywordSyntaxEngine();

    engine.setLanguage('go');
    const buf = new TextBuffer('func main() {}');
    engine.parse(buf);
    let tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'func' in Go

    engine.setLanguage('rust');
    engine.parse(buf);
    tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    // 'func' is NOT a Rust keyword (Rust uses 'fn')
    expect(tokens[0].color).not.toBe(DARK_THEME.tokens.keyword);
  });

  // -----------------------------------------------------------------------
  // Block comment cache invalidation after content change (same line count)
  // -----------------------------------------------------------------------

  test('block comment cache invalidation on content change with same line count', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('typescript');

    // First content: line 1 starts a block comment
    const buf1 = new TextBuffer('/* comment\nstill comment */');
    engine.parse(buf1);
    let tokens = engine.getLineTokens(buf1, 1, DARK_THEME);
    // Line 1 should be a comment (inside block comment)
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);

    // Second content: same line count, no block comment
    const buf2 = new TextBuffer('const x = 1;\nconst y = 2;');
    engine.parse(buf2);
    tokens = engine.getLineTokens(buf2, 1, DARK_THEME);
    // Line 1 should NOT be a comment
    expect(tokens[0].color).toBe(DARK_THEME.tokens.keyword); // 'const'
  });

  // -----------------------------------------------------------------------
  // SQL dual-case keywords
  // -----------------------------------------------------------------------

  test('SQL recognizes both uppercase and lowercase keywords', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('sql');

    const buf = new TextBuffer('SELECT id FROM users;\nselect name from products;');
    engine.parse(buf);

    // Uppercase SELECT
    const tokens1 = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens1[0].color).toBe(DARK_THEME.tokens.keyword);

    // Lowercase select
    const tokens2 = engine.getLineTokens(buf, 1, DARK_THEME);
    expect(tokens2[0].color).toBe(DARK_THEME.tokens.keyword);
  });

  // -----------------------------------------------------------------------
  // Supported languages list
  // -----------------------------------------------------------------------

  test('supported languages includes all 20', () => {
    const engine = new KeywordSyntaxEngine();
    const langs = engine.getSupportedLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('python');
    expect(langs).toContain('rust');
    expect(langs).toContain('html');
    expect(langs).toContain('css');
    expect(langs).toContain('json');
    expect(langs).toContain('markdown');
    expect(langs).toContain('c');
    expect(langs).toContain('cpp');
    expect(langs).toContain('go');
    expect(langs).toContain('java');
    expect(langs).toContain('swift');
    expect(langs).toContain('shell');
    expect(langs).toContain('ruby');
    expect(langs).toContain('php');
    expect(langs).toContain('yaml');
    expect(langs).toContain('toml');
    expect(langs).toContain('sql');
    expect(langs).toContain('xml');
    expect(langs.length).toBe(20);
  });

  test('hasLanguage returns true for all 20 languages', () => {
    const engine = new KeywordSyntaxEngine();
    const all = ['typescript', 'javascript', 'python', 'rust', 'html', 'css', 'json',
      'markdown', 'c', 'cpp', 'go', 'java', 'swift', 'shell', 'ruby', 'php',
      'yaml', 'toml', 'sql', 'xml'];
    for (let i = 0; i < all.length; i++) {
      expect(engine.hasLanguage(all[i])).toBe(true);
    }
    expect(engine.hasLanguage('cobol')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Line comment styles
  // -----------------------------------------------------------------------

  test('Go uses // line comments', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('go');
    const buf = new TextBuffer('// this is a comment');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBe(1);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);
  });

  test('Shell uses # line comments', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('shell');
    const buf = new TextBuffer('# this is a comment');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBe(1);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);
  });

  test('Ruby uses # line comments', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('ruby');
    const buf = new TextBuffer('# this is a comment');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBe(1);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);
  });

  test('SQL uses -- line comments', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('sql');
    const buf = new TextBuffer('-- this is a comment');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBe(1);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);
  });

  test('YAML uses # line comments', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('yaml');
    const buf = new TextBuffer('# this is a comment');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    expect(tokens.length).toBe(1);
    expect(tokens[0].color).toBe(DARK_THEME.tokens.comment);
  });

  // -----------------------------------------------------------------------
  // Plain-text-like languages use foreground for all words
  // -----------------------------------------------------------------------

  test('markdown words use foreground color, not typeName/variableName', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('markdown');
    // "Hello World" — uppercase H would be typeName in code languages, lowercase 'world' would be variableName
    const buf = new TextBuffer('Hello world Something test');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // No word should be typeName (green) or variableName (cyan) or functionName (yellow)
      expect(t.color).not.toBe(DARK_THEME.tokens.typeName);
      expect(t.color).not.toBe(DARK_THEME.tokens.variableName);
      expect(t.color).not.toBe(DARK_THEME.tokens.functionName);
      // All words should be foreground
      expect(t.color).toBe(DARK_THEME.foreground);
    }
  });

  test('yaml words use foreground color for non-keyword identifiers', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('yaml');
    const buf = new TextBuffer('name: MyService');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 0, DARK_THEME);
    // 'name' and 'MyService' should use foreground, not typeName/variableName
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.color !== DARK_THEME.tokens.keyword && t.color !== DARK_THEME.tokens.string) {
        expect(t.color).not.toBe(DARK_THEME.tokens.typeName);
        expect(t.color).not.toBe(DARK_THEME.tokens.variableName);
      }
    }
  });

  test('toml words use foreground color for non-keyword identifiers', () => {
    const engine = new KeywordSyntaxEngine();
    engine.setLanguage('toml');
    const buf = new TextBuffer('[package]\nname = "hello"');
    engine.parse(buf);
    const tokens = engine.getLineTokens(buf, 1, DARK_THEME);
    // 'name' should be foreground (not variableName cyan)
    expect(tokens[0].color).toBe(DARK_THEME.foreground);
  });
});
