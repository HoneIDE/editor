/**
 * web-tree-sitter bridge for the web target.
 *
 * Implements the editor's `hone_editor_ts_*` FFI by parsing source through
 * web-tree-sitter and mapping syntax-node types to the TextMate-style scope
 * strings the editor's TreeSitterEngine consumes
 * (`core/tokenizer/tree-sitter-engine.ts`).
 *
 * Architecturally analogous to `native/macos/src/tree_sitter_bridge.rs`: same
 * FFI contract, same scope strings, different language (TS vs Rust) because the
 * platform-native parser implementation differs.
 *
 * Grammars are fetched async at boot — `initTreeSitter()` resolves once all
 * requested grammars are loaded, after which parsing is synchronous.
 */

// web-tree-sitter v0.20 ships a default-export Parser with Language as a
// namespace member. (v0.26+ moved Language to a named export.) We pin to
// v0.20 to match the grammar wasms from tree-sitter-wasms, which were built
// against the older tree-sitter ABI.
import Parser from 'web-tree-sitter';
type Language = any; // Parser.Language at runtime

// Language IDs — must match `LANG_*` constants in
// core/tokenizer/tree-sitter-engine.ts:31. Only a subset is wired up today;
// the rest fall back to KeywordSyntaxEngine through CompositeEngine.
const LANG_TYPESCRIPT = 0;
const LANG_PYTHON = 1;
const LANG_RUST = 2;
const LANG_JAVASCRIPT = 4;
const LANG_JSON = 5;
const LANG_CSS = 7;
const LANG_TSX = 9;

/**
 * Configuration for which grammars to load. Each value is a URL to a
 * tree-sitter language WASM file (e.g. tree-sitter-typescript.wasm).
 * Omitted languages fall back to the keyword tokenizer.
 */
export interface GrammarUrls {
  webTreeSitter: string;   // URL of web-tree-sitter's runtime WASM
  typescript?: string;
  tsx?: string;
  javascript?: string;
  python?: string;
  rust?: string;
  json?: string;
  css?: string;
}

interface FlatToken {
  start: number;  // byte offset
  end: number;    // byte offset
  scope: string;  // TextMate-style scope
}

let _parser: any | null = null;
const _languages = new Map<number, Language>();
let _lastTokens: FlatToken[] = [];

/**
 * Initialize web-tree-sitter and load the requested grammars. Resolves when
 * everything's ready. Call before bootPerryWasm().
 */
export async function initTreeSitter(urls: GrammarUrls): Promise<void> {
  await Parser.init({
    locateFile: (path: string) => {
      // web-tree-sitter looks for its own wasm relative to the loader URL.
      // Redirect to the URL the caller passed.
      if (path.endsWith('.wasm')) return urls.webTreeSitter;
      return path;
    },
  });
  _parser = new Parser();

  const loadIfSet = async (langId: number, url: string | undefined) => {
    if (!url) return;
    const lang = await (Parser as any).Language.load(url);
    _languages.set(langId, lang);
  };

  await Promise.all([
    loadIfSet(LANG_TYPESCRIPT, urls.typescript),
    loadIfSet(LANG_TSX, urls.tsx),
    loadIfSet(LANG_JAVASCRIPT, urls.javascript),
    loadIfSet(LANG_PYTHON, urls.python),
    loadIfSet(LANG_RUST, urls.rust),
    loadIfSet(LANG_JSON, urls.json),
    loadIfSet(LANG_CSS, urls.css),
  ]);
}

/**
 * Build the subset of FFI functions that the editor's TreeSitterEngine calls.
 * Merge the returned object into your `createDomFfi(...)` FFI before passing
 * to bootPerryWasm.
 */
export function createTreeSitterFFI(): Record<string, (...args: any[]) => any> {
  return {
    hone_editor_ts_parse(source: string, langId: number): number {
      if (!_parser) return 0;
      const lang = _languages.get(langId);
      if (!lang) return 0;
      _parser.setLanguage(lang);
      const tree = _parser.parse(source);
      if (!tree) { _lastTokens = []; return 0; }
      _lastTokens = flattenTree(tree, langId);
      tree.delete();
      return _lastTokens.length;
    },

    hone_editor_ts_clear(): void {
      _lastTokens = [];
    },

    hone_editor_ts_token_count(): number {
      return _lastTokens.length;
    },

    hone_editor_ts_token_start(idx: number): number {
      const t = _lastTokens[idx | 0];
      return t ? t.start : 0;
    },

    hone_editor_ts_token_end(idx: number): number {
      const t = _lastTokens[idx | 0];
      return t ? t.end : 0;
    },

    hone_editor_ts_token_scope(idx: number): string {
      const t = _lastTokens[idx | 0];
      return t ? t.scope : '';
    },
  };
}

/** Walk the tree and emit a flat array of tokens with TextMate scopes. */
function flattenTree(tree: any, langId: number): FlatToken[] {
  const out: FlatToken[] = [];
  const cursor = tree.walk();
  const mapNode = pickMapper(langId);
  let visitedChildren = false;

  while (true) {
    // v0.20 API: `currentNode` is a method, not a getter. v0.26+ made it a
    // getter. Support both.
    const node = typeof cursor.currentNode === 'function'
      ? cursor.currentNode()
      : cursor.currentNode;
    if (!visitedChildren) {
      const scope = mapNode(node, cursor);
      if (scope && node.startIndex < node.endIndex) {
        out.push({ start: node.startIndex, end: node.endIndex, scope });
      }
      if (cursor.gotoFirstChild()) continue;
      visitedChildren = true;
    }
    if (cursor.gotoNextSibling()) {
      visitedChildren = false;
      continue;
    }
    if (!cursor.gotoParent()) break;
    visitedChildren = true;
  }
  cursor.delete();

  // Sort by start offset so token_start(i) is monotonically increasing — the
  // editor's tree-sitter-engine relies on this when slicing per-line.
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

type NodeMapper = (node: any, cursor: any) => string | null;

function pickMapper(langId: number): NodeMapper {
  if (langId === LANG_TYPESCRIPT || langId === LANG_TSX || langId === LANG_JAVASCRIPT) {
    return mapTypeScriptNode;
  }
  if (langId === LANG_PYTHON) return mapPythonNode;
  if (langId === LANG_RUST) return mapRustNode;
  if (langId === LANG_JSON) return mapJsonNode;
  if (langId === LANG_CSS) return mapCssNode;
  return mapGenericNode;
}

// ---- TypeScript / JavaScript ----

const TS_KEYWORDS = new Set([
  'import', 'export', 'from', 'as', 'class', 'extends', 'implements', 'interface',
  'type', 'enum', 'namespace', 'function', 'const', 'let', 'var',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'new', 'this', 'super',
  'async', 'await', 'yield',
  'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'is', 'keyof', 'void',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'override',
  'declare', 'module', 'get', 'set',
]);

function mapTypeScriptNode(node: any, _cursor: any): string | null {
  const t = node.type;
  // Leaves first.
  if (t === 'comment') return 'comment';
  if (t === 'string' || t === 'template_string' || t === 'string_fragment') return 'string';
  if (t === 'regex' || t === 'regex_pattern') return 'string.regexp';
  if (t === 'number') return 'constant.numeric';
  if (t === 'true' || t === 'false') return 'constant.language';
  if (t === 'null' || t === 'undefined') return 'constant.language';
  if (t === 'escape_sequence') return 'constant.character.escape';
  if (t === 'predefined_type') return 'support.type';
  if (t === 'type_identifier') return 'entity.name.type';
  if (t === 'property_identifier') {
    // Method definition's name → function name; otherwise property access.
    const p = node.parent;
    if (p && (p.type === 'method_definition' || p.type === 'method_signature')) {
      return 'entity.name.function';
    }
    if (p && p.type === 'call_expression') return 'entity.name.function.call';
    return 'variable.other.property';
  }
  if (t === 'identifier') {
    const p = node.parent;
    if (p) {
      if (p.type === 'call_expression') return 'entity.name.function.call';
      if (p.type === 'function_declaration' || p.type === 'function_expression' || p.type === 'arrow_function') {
        return 'entity.name.function';
      }
      if (p.type === 'class_declaration') return 'entity.name.class';
      if (p.type === 'enum_declaration') return 'entity.name.type';
      if (p.type === 'new_expression') return 'entity.name.class';
    }
    return 'variable';
  }
  if (TS_KEYWORDS.has(t)) return 'keyword.control';
  // Single-character operators/punctuation — let bracket-pair colorization
  // happen on the editor side. Don't emit scopes for these; the renderer falls
  // through to the default foreground color.
  return null;
}

// ---- Python ----

const PY_KEYWORDS = new Set([
  'import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else',
  'for', 'while', 'break', 'continue', 'pass', 'raise', 'try', 'except',
  'finally', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal',
  'assert', 'del', 'in', 'not', 'and', 'or', 'is', 'True', 'False', 'None',
  'async', 'await',
]);

function mapPythonNode(node: any, _cursor: any): string | null {
  const t = node.type;
  if (t === 'comment') return 'comment';
  if (t === 'string' || t === 'string_content') return 'string';
  if (t === 'integer' || t === 'float') return 'constant.numeric';
  if (t === 'true' || t === 'false' || t === 'none') return 'constant.language';
  if (t === 'identifier') {
    const p = node.parent;
    if (p && p.type === 'call') return 'entity.name.function.call';
    if (p && (p.type === 'function_definition' || p.type === 'class_definition')) {
      return p.type === 'class_definition' ? 'entity.name.class' : 'entity.name.function';
    }
    return 'variable';
  }
  if (PY_KEYWORDS.has(t)) return 'keyword.control';
  return null;
}

// ---- Rust ----

const RS_KEYWORDS = new Set([
  'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl',
  'pub', 'use', 'mod', 'crate', 'extern', 'as',
  'if', 'else', 'match', 'for', 'while', 'loop', 'break', 'continue', 'return',
  'unsafe', 'async', 'await', 'move', 'ref',
  'self', 'Self', 'super', 'where', 'dyn',
  'true', 'false',
]);

function mapRustNode(node: any, _cursor: any): string | null {
  const t = node.type;
  if (t === 'line_comment' || t === 'block_comment') return 'comment';
  if (t === 'string_literal' || t === 'string_content' || t === 'raw_string_literal') return 'string';
  if (t === 'integer_literal' || t === 'float_literal') return 'constant.numeric';
  if (t === 'boolean_literal') return 'constant.language';
  if (t === 'identifier') {
    const p = node.parent;
    if (p && p.type === 'call_expression') return 'entity.name.function.call';
    if (p && (p.type === 'function_item' || p.type === 'function_signature_item')) {
      return 'entity.name.function';
    }
    return 'variable';
  }
  if (t === 'type_identifier') return 'entity.name.type';
  if (t === 'primitive_type') return 'support.type';
  if (RS_KEYWORDS.has(t)) return 'keyword.control';
  return null;
}

// ---- JSON / CSS / fallback ----

function mapJsonNode(node: any, _cursor: any): string | null {
  const t = node.type;
  if (t === 'comment') return 'comment';
  if (t === 'string' || t === 'string_content') return 'string';
  if (t === 'number') return 'constant.numeric';
  if (t === 'true' || t === 'false' || t === 'null') return 'constant.language';
  return null;
}

function mapCssNode(node: any, _cursor: any): string | null {
  const t = node.type;
  if (t === 'comment') return 'comment';
  if (t === 'string_value') return 'string';
  if (t === 'integer_value' || t === 'float_value') return 'constant.numeric';
  if (t === 'tag_name') return 'entity.name.tag';
  if (t === 'class_name' || t === 'id_name') return 'entity.other.attribute-name';
  if (t === 'property_name') return 'variable.other.property';
  return null;
}

function mapGenericNode(node: any, _cursor: any): string | null {
  const t = node.type;
  if (t === 'comment') return 'comment';
  if (t === 'string') return 'string';
  if (t === 'number') return 'constant.numeric';
  return null;
}
