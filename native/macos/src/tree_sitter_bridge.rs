//! Tree-sitter PoC bridge (SHIP-V1-GAPS.md #16).
//!
//! Proves we can compile and link tree-sitter into hone-editor's native crate,
//! load grammars, parse source, and emit TextMate-style scope strings keyed
//! to (start_byte, end_byte). Phase 1 wires this through Perry FFI to replace
//! the single-color `KeywordSyntaxEngine`.
//!
//! What's intentionally NOT here yet:
//!   * Perry FFI export (Phase 1)
//!   * Incremental reparse on edit (`Parser::parse` with old tree) — Phase 1
//!   * More grammars beyond TS + Python — Phase 1
//!   * Theme resolution (TokenTheme.resolve consumes the scope strings) — Phase 1

use tree_sitter::{Language, Node, Parser, Tree};
use std::cell::RefCell;
use crate::string_header::{str_from_header, StringHeader};
use perry_ffi::alloc_string;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LangId {
    TypeScript,
    Python,
    Rust,
    JavaScript,
    Json,
    Css,
    Tsx,
    // Reserved for the next grammar bump (tree-sitter 0.24+): Go, Html, Markdown.
}

#[derive(Debug, Clone)]
pub struct ScopedToken {
    /// Byte offset in the source where the token starts.
    pub start_byte: usize,
    /// Byte offset where the token ends (exclusive).
    pub end_byte: usize,
    /// TextMate-style scope string (e.g. `keyword.control`, `entity.name.function`).
    pub scope: String,
}

fn language_for(lang: LangId) -> Language {
    match lang {
        LangId::TypeScript => tree_sitter_typescript::language_typescript(),
        LangId::Tsx => tree_sitter_typescript::language_tsx(),
        LangId::Python => tree_sitter_python::language(),
        LangId::Rust => tree_sitter_rust::language(),
        LangId::JavaScript => tree_sitter_javascript::language(),
        LangId::Json => tree_sitter_json::language(),
        LangId::Css => tree_sitter_css::language(),
    }
}

/// Parse a source string and return a flat list of leaf-token scopes in source order.
///
/// Strategy: walk the tree-sitter parse tree depth-first. At every leaf (node with
/// no children) we map the node's kind/parent context to a TextMate scope. A small
/// hand-rolled mapping covers the highlights every theme cares about; the full
/// mapping table moves into a query file in Phase 1.
pub fn tokenize(source: &str, lang: LangId) -> Vec<ScopedToken> {
    let mut parser = Parser::new();
    if parser.set_language(&language_for(lang)).is_err() {
        return Vec::new();
    }
    let tree: Tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return Vec::new(),
    };

    let mut out = Vec::new();
    walk(tree.root_node(), source, lang, &mut out);
    apply_bracket_pair_levels(&mut out, source);
    out
}

/// Post-tokenize: scan tokens scoped `punctuation.bracket` and assign a
/// depth-cycling level scope (`punctuation.bracket.level0/1/2`). SHIP-V1-GAPS.md #22.
///
/// Walks tokens in source order. Each `(`, `[`, `{` increments a depth counter
/// and gets the *pre*-increment depth's color; each matching closer decrements
/// the counter and reuses the *post*-decrement depth's color so the matching
/// pair carries the same level.
fn apply_bracket_pair_levels(tokens: &mut [ScopedToken], source: &str) {
    let bytes = source.as_bytes();
    let mut depth: i32 = 0;
    for tok in tokens.iter_mut() {
        if !tok.scope.starts_with("punctuation.bracket") {
            continue;
        }
        if tok.start_byte >= bytes.len() {
            continue;
        }
        let b = bytes[tok.start_byte];
        // Openers
        if b == b'(' || b == b'[' || b == b'{' {
            let level = depth.rem_euclid(3);
            tok.scope = format!("punctuation.bracket.level{}", level);
            depth += 1;
        // Closers
        } else if b == b')' || b == b']' || b == b'}' {
            depth = (depth - 1).max(0);
            let level = depth.rem_euclid(3);
            tok.scope = format!("punctuation.bracket.level{}", level);
        }
    }
}

fn walk(node: Node, source: &str, lang: LangId, out: &mut Vec<ScopedToken>) {
    // Skip ERROR nodes — they don't carry useful tokens for highlighting.
    if node.is_error() {
        return;
    }

    // Only emit at leaf granularity. Interior nodes are recursed into.
    let mut cursor = node.walk();
    let mut child_count = 0;
    for child in node.children(&mut cursor) {
        walk(child, source, lang, out);
        child_count += 1;
    }
    if child_count > 0 {
        return;
    }

    let kind = node.kind();
    let parent_kind = node.parent().map(|p| p.kind()).unwrap_or("");
    let scope = scope_for(kind, parent_kind, lang, source, &node);
    if scope.is_empty() {
        return;
    }
    out.push(ScopedToken {
        start_byte: node.start_byte(),
        end_byte: node.end_byte(),
        scope,
    });
}

/// Hand-rolled scope mapping. Covers the common token kinds for TypeScript and Python.
/// Phase 1 replaces this with tree-sitter highlight queries (.scm files).
fn scope_for(kind: &str, parent_kind: &str, lang: LangId, source: &str, node: &Node) -> String {
    // Brackets — emitted with a base "punctuation.bracket" scope and then
    // post-processed in `apply_bracket_pair_levels` to a depth-cycling level.
    // SHIP-V1-GAPS.md #22.
    if kind == "(" || kind == ")" || kind == "[" || kind == "]" || kind == "{" || kind == "}" {
        return "punctuation.bracket".to_string();
    }

    // Common across languages — comments, strings, numbers
    if kind == "comment" {
        return "comment".to_string();
    }
    if kind == "string" || kind == "string_fragment" || kind == "template_string" {
        return "string.quoted".to_string();
    }
    if kind == "string_literal" {
        return "string.quoted".to_string();
    }
    if kind == "number" || kind == "integer" || kind == "float" {
        return "constant.numeric".to_string();
    }
    if kind == "true" || kind == "false" || kind == "null" || kind == "None" {
        return "constant.language".to_string();
    }

    match lang {
        LangId::TypeScript | LangId::Tsx | LangId::JavaScript =>
            scope_for_typescript(kind, parent_kind, source, node),
        LangId::Python => scope_for_python(kind, parent_kind),
        LangId::Rust => scope_for_rust(kind, parent_kind),
        LangId::Json => scope_for_json(kind),
        LangId::Css => scope_for_css(kind, parent_kind),
    }
}

fn scope_for_typescript(kind: &str, parent_kind: &str, source: &str, node: &Node) -> String {
    // TS keywords
    const TS_KEYWORDS: &[&str] = &[
        "import", "export", "from", "const", "let", "var", "function", "return",
        "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
        "new", "this", "class", "extends", "implements", "interface", "type",
        "enum", "namespace", "module", "declare", "abstract", "readonly",
        "public", "private", "protected", "static", "async", "await",
        "try", "catch", "finally", "throw", "typeof", "instanceof",
        "in", "of", "as", "is", "keyof", "void", "undefined",
        "yield", "super", "delete",
    ];
    if TS_KEYWORDS.contains(&kind) {
        return "keyword.control".to_string();
    }

    // Identifiers carry no scope on their own; context (parent) decides.
    if kind == "identifier" || kind == "property_identifier" || kind == "type_identifier" {
        let text = &source[node.start_byte()..node.end_byte()];
        match parent_kind {
            "function_declaration" | "method_definition" | "function" | "arrow_function" =>
                "entity.name.function".to_string(),
            "class_declaration" | "class_body" =>
                "entity.name.class".to_string(),
            "interface_declaration" | "type_alias_declaration" =>
                "entity.name.type".to_string(),
            "call_expression" =>
                "entity.name.function.call".to_string(),
            "member_expression" =>
                "variable.other.property".to_string(),
            _ => {
                // Heuristic: PascalCase identifiers are types
                if text.chars().next().map_or(false, |c| c.is_ascii_uppercase()) {
                    "entity.name.type".to_string()
                } else {
                    "variable".to_string()
                }
            }
        }
    } else if kind == "regex" || kind == "regex_pattern" {
        "string.regexp".to_string()
    } else {
        String::new()
    }
}

fn scope_for_rust(kind: &str, parent_kind: &str) -> String {
    const RS_KEYWORDS: &[&str] = &[
        "fn", "let", "mut", "const", "static", "pub", "use", "mod", "crate", "super",
        "self", "Self", "struct", "enum", "trait", "impl", "for", "where", "as", "in",
        "if", "else", "while", "loop", "match", "return", "break", "continue", "move",
        "ref", "async", "await", "dyn", "unsafe", "extern", "type", "true", "false",
        "Some", "None", "Ok", "Err",
    ];
    if RS_KEYWORDS.contains(&kind) { return "keyword.control".to_string(); }
    if kind == "char_literal" || kind == "raw_string_literal" { return "string.quoted".to_string(); }
    if kind == "identifier" || kind == "field_identifier" || kind == "type_identifier" || kind == "primitive_type" {
        return match parent_kind {
            "function_item" | "function_signature_item" => "entity.name.function".to_string(),
            "call_expression" | "macro_invocation" => "entity.name.function.call".to_string(),
            "struct_item" | "enum_item" | "trait_item" | "impl_item" => "entity.name.class".to_string(),
            "type_identifier" | "scoped_type_identifier" => "entity.name.type".to_string(),
            "field_expression" => "variable.other.property".to_string(),
            _ => if kind == "type_identifier" || kind == "primitive_type" {
                "entity.name.type".to_string()
            } else {
                "variable".to_string()
            },
        };
    }
    if kind == "macro_rules!" { return "entity.name.function".to_string(); }
    if kind == "lifetime" { return "storage.modifier".to_string(); }
    String::new()
}

#[allow(dead_code)]
fn scope_for_go(kind: &str, parent_kind: &str) -> String {
    const GO_KEYWORDS: &[&str] = &[
        "func", "var", "const", "type", "struct", "interface", "map", "chan", "package",
        "import", "return", "if", "else", "for", "range", "switch", "case", "default",
        "break", "continue", "goto", "fallthrough", "go", "defer", "select", "true", "false", "nil",
    ];
    if GO_KEYWORDS.contains(&kind) { return "keyword.control".to_string(); }
    if kind == "raw_string_literal" || kind == "interpreted_string_literal" { return "string.quoted".to_string(); }
    if kind == "type_identifier" { return "entity.name.type".to_string(); }
    if kind == "field_identifier" { return "variable.other.property".to_string(); }
    if kind == "package_identifier" { return "entity.name.namespace".to_string(); }
    if kind == "identifier" {
        return match parent_kind {
            "function_declaration" | "method_declaration" => "entity.name.function".to_string(),
            "call_expression" => "entity.name.function.call".to_string(),
            _ => "variable".to_string(),
        };
    }
    String::new()
}

fn scope_for_json(kind: &str) -> String {
    if kind == "string_content" { return "string.quoted".to_string(); }
    if kind == "number" { return "constant.numeric".to_string(); }
    if kind == "true" || kind == "false" || kind == "null" { return "constant.language".to_string(); }
    // String node has children (string_content + quotes); leaves like `"` get punctuation.
    if kind == "\"" { return "punctuation.definition.string".to_string(); }
    String::new()
}

#[allow(dead_code)]
fn scope_for_html(kind: &str, parent_kind: &str) -> String {
    if kind == "tag_name" || kind == "start_tag" || kind == "end_tag" { return "entity.name.tag".to_string(); }
    if kind == "attribute_name" { return "entity.other.attribute-name".to_string(); }
    if kind == "attribute_value" || kind == "quoted_attribute_value" { return "string.quoted".to_string(); }
    if kind == "text" && parent_kind == "element" { return "".to_string(); }
    if kind == "<" || kind == ">" || kind == "</" || kind == "/>" { return "punctuation".to_string(); }
    if kind == "=" { return "punctuation".to_string(); }
    String::new()
}

fn scope_for_css(kind: &str, parent_kind: &str) -> String {
    if kind == "tag_name" { return "entity.name.tag".to_string(); }
    if kind == "class_name" { return "entity.other.attribute-name.class".to_string(); }
    if kind == "id_name" { return "entity.other.attribute-name.id".to_string(); }
    if kind == "property_name" { return "support.type".to_string(); }
    if kind == "plain_value" || kind == "string_value" { return "string.quoted".to_string(); }
    if kind == "integer_value" || kind == "float_value" { return "constant.numeric".to_string(); }
    if kind == "unit" { return "keyword".to_string(); }
    if kind == "color_value" { return "constant.numeric".to_string(); }
    if kind == "@media" || kind == "@import" || kind == "@keyframes" || kind == "@font-face" { return "keyword.control".to_string(); }
    if kind == "at_keyword" { return "keyword.control".to_string(); }
    if parent_kind == "function_name" || kind == "function_name" { return "entity.name.function.call".to_string(); }
    String::new()
}

#[allow(dead_code)]
fn scope_for_markdown(kind: &str) -> String {
    if kind.starts_with("atx_h") || kind == "setext_heading" { return "markup.heading".to_string(); }
    if kind == "fenced_code_block" || kind == "code_fence_content" || kind == "code_span" {
        return "markup.raw".to_string();
    }
    if kind == "link_text" { return "markup.underline.link".to_string(); }
    if kind == "link_destination" { return "markup.underline.link".to_string(); }
    if kind == "emphasis" { return "markup.italic".to_string(); }
    if kind == "strong_emphasis" { return "markup.bold".to_string(); }
    if kind == "list_marker_minus" || kind == "list_marker_plus" || kind == "list_marker_star"
        || kind == "list_marker_dot" || kind == "list_marker_parenthesis" {
        return "punctuation".to_string();
    }
    if kind == "block_quote_marker" || kind == "block_quote" { return "markup.quote".to_string(); }
    String::new()
}

// ---------------------------------------------------------------------------
// Perry FFI
// ---------------------------------------------------------------------------
//
// Perry FFI is one-call-one-value, so we keep parse results in thread-local
// state and expose accessors. TypeScript:
//
//     const n = hone_editor_ts_parse(source, lang);  // lang: 0=TS, 1=Python
//     for (let i = 0; i < n; i++) {
//       const s = hone_editor_ts_token_start(i);
//       const e = hone_editor_ts_token_end(i);
//       const scope = hone_editor_ts_token_scope(i);
//       // apply theme via TokenTheme.resolve(scope)
//     }
//
// Result buffer is single-slot (per thread) — call `ts_parse` again to refresh.

thread_local! {
    static LAST_PARSE: RefCell<Vec<ScopedToken>> = RefCell::new(Vec::new());
}

fn lang_id_from_f64(v: f64) -> Option<LangId> {
    match v as i32 {
        0 => Some(LangId::TypeScript),
        1 => Some(LangId::Python),
        2 => Some(LangId::Rust),
        // 3 reserved for Go — Phase 1 follow-up
        4 => Some(LangId::JavaScript),
        5 => Some(LangId::Json),
        // 6 reserved for HTML
        7 => Some(LangId::Css),
        // 8 reserved for Markdown
        9 => Some(LangId::Tsx),
        _ => None,
    }
}

/// Parse `source` with the named grammar and stash the resulting tokens.
/// Returns the token count (call-site loops from 0..count).
#[no_mangle]
pub extern "C" fn hone_editor_ts_parse(source_ptr: *const u8, lang_id: f64) -> f64 {
    let lang = match lang_id_from_f64(lang_id) {
        Some(l) => l,
        None => return 0.0,
    };
    let source = str_from_header(source_ptr);
    let tokens = tokenize(source, lang);
    let n = tokens.len() as f64;
    LAST_PARSE.with(|cell| {
        *cell.borrow_mut() = tokens;
    });
    n
}

/// Drop the cached parse results. Call when the editor closes or switches files
/// to release the memory.
#[no_mangle]
pub extern "C" fn hone_editor_ts_clear() {
    LAST_PARSE.with(|cell| cell.borrow_mut().clear());
}

#[no_mangle]
pub extern "C" fn hone_editor_ts_token_count() -> f64 {
    LAST_PARSE.with(|cell| cell.borrow().len() as f64)
}

#[no_mangle]
pub extern "C" fn hone_editor_ts_token_start(idx: f64) -> f64 {
    LAST_PARSE.with(|cell| {
        let v = cell.borrow();
        let i = idx as usize;
        if i < v.len() { v[i].start_byte as f64 } else { 0.0 }
    })
}

#[no_mangle]
pub extern "C" fn hone_editor_ts_token_end(idx: f64) -> f64 {
    LAST_PARSE.with(|cell| {
        let v = cell.borrow();
        let i = idx as usize;
        if i < v.len() { v[i].end_byte as f64 } else { 0.0 }
    })
}

/// Returns a NaN-boxed StringHeader pointer (i64 in the manifest) with the
/// TextMate scope string for token `idx`. Returns an empty-string pointer on
/// out-of-bounds rather than null — keeps the TS call site branch-free.
#[no_mangle]
pub extern "C" fn hone_editor_ts_token_scope(idx: f64) -> i64 {
    LAST_PARSE.with(|cell| {
        let v = cell.borrow();
        let i = idx as usize;
        let s: &str = if i < v.len() { v[i].scope.as_str() } else { "" };
        alloc_string(s).as_raw() as i64
    })
}

// Quieten unused-import warnings on platforms where this module compiles but
// no FFI consumer references the bridge symbols yet.
#[allow(dead_code)]
fn _keep_string_header_dep(_: *const StringHeader) {}

fn scope_for_python(kind: &str, parent_kind: &str) -> String {
    const PY_KEYWORDS: &[&str] = &[
        "def", "class", "return", "import", "from", "as", "if", "elif", "else",
        "for", "while", "in", "not", "and", "or", "is", "try", "except", "finally",
        "raise", "with", "lambda", "yield", "global", "nonlocal", "pass", "break",
        "continue", "assert", "del", "async", "await",
    ];
    if PY_KEYWORDS.contains(&kind) {
        return "keyword.control".to_string();
    }
    if kind == "identifier" {
        return match parent_kind {
            "function_definition" => "entity.name.function".to_string(),
            "class_definition" => "entity.name.class".to_string(),
            "call" => "entity.name.function.call".to_string(),
            "attribute" => "variable.other.property".to_string(),
            _ => "variable".to_string(),
        };
    }
    String::new()
}
