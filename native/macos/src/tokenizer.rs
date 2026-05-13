//! Rust-side line tokenizer for live syntax highlighting during Rust-handled edits.
//!
//! Mirrors keyword-syntax-engine.ts so that token colors stay correct immediately
//! after on_text_input / on_action edits, without waiting for TypeScript to re-render.
//!
//! SHIP-V1-GAPS.md #17: tokenizer is now per-language (8 languages) and theme-aware.
//! TS pushes the current language id and the theme palette via FFI; tokenize_line
//! reads both at call time. Default palette stays VS Code Dark for safety.

use std::cell::RefCell;
use crate::text_renderer::RenderToken;

// --- Theme palette (mutable). TS calls hone_editor_set_token_colors on theme change. ---
thread_local! {
    static PALETTE: RefCell<Palette> = RefCell::new(Palette::default());
    static CURRENT_LANG: RefCell<LangId> = RefCell::new(LangId::TypeScript);
}

#[derive(Clone)]
struct Palette {
    keyword: String,
    string: String,
    comment: String,
    variable: String,
    typename: String,
    function: String,
    number: String,
    default: String,
}

impl Default for Palette {
    fn default() -> Self {
        Self {
            keyword: "#569cd6".to_string(),
            string:  "#ce9178".to_string(),
            comment: "#6a9955".to_string(),
            variable: "#9cdcfe".to_string(),
            typename: "#4ec9b0".to_string(),
            function: "#dcdcaa".to_string(),
            number:  "#b5cea8".to_string(),
            default: "#d4d4d4".to_string(),
        }
    }
}

#[derive(Clone, Copy)]
enum LangId {
    TypeScript, // 0
    JavaScript, // 1
    Python,     // 2
    Rust,       // 3
    Go,         // 4
    Swift,      // 5
    Java,       // 6
    CCpp,       // 7
}

fn lang_from_i32(v: i32) -> LangId {
    match v {
        1 => LangId::JavaScript,
        2 => LangId::Python,
        3 => LangId::Rust,
        4 => LangId::Go,
        5 => LangId::Swift,
        6 => LangId::Java,
        7 => LangId::CCpp,
        _ => LangId::TypeScript,
    }
}

// --- FFI: TS pushes language + theme on tab change / theme change. ---

/// Set the active language. id: 0=TS, 1=JS, 2=Python, 3=Rust, 4=Go, 5=Swift,
/// 6=Java, 7=C/C++.
#[no_mangle]
pub extern "C" fn hone_editor_set_tokenizer_language(lang_id: f64) {
    CURRENT_LANG.with(|c| *c.borrow_mut() = lang_from_i32(lang_id as i32));
}

/// Push the active theme's token colors. Each argument is a 6-digit hex
/// (`0xRRGGBB`) encoded as an f64 so it travels cleanly through Perry's
/// numeric FFI without needing string allocation.
#[no_mangle]
pub extern "C" fn hone_editor_set_token_colors(
    keyword: f64, string: f64, comment: f64, variable: f64,
    typename: f64, function: f64, number: f64, default: f64,
) {
    let to_hex = |v: f64| -> String {
        let n = v as u32 & 0xFFFFFF;
        format!("#{:06x}", n)
    };
    PALETTE.with(|p| {
        let mut palette = p.borrow_mut();
        palette.keyword = to_hex(keyword);
        palette.string  = to_hex(string);
        palette.comment = to_hex(comment);
        palette.variable = to_hex(variable);
        palette.typename = to_hex(typename);
        palette.function = to_hex(function);
        palette.number  = to_hex(number);
        palette.default = to_hex(default);
    });
}

// --- Per-language keyword tables. ---

const TYPESCRIPT_KEYWORDS: &[&str] = &[
    "import", "export", "from", "const", "let", "var", "function", "return",
    "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
    "new", "this", "class", "extends", "implements", "interface", "type",
    "enum", "namespace", "module", "declare", "abstract", "readonly",
    "public", "private", "protected", "static", "async", "await",
    "try", "catch", "finally", "throw", "typeof", "instanceof",
    "in", "of", "as", "is", "keyof", "void", "null", "undefined",
    "true", "false", "default", "yield", "super", "delete",
];

const JAVASCRIPT_KEYWORDS: &[&str] = &[
    "import", "export", "from", "const", "let", "var", "function", "return",
    "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
    "new", "this", "class", "extends", "static", "async", "await",
    "try", "catch", "finally", "throw", "typeof", "instanceof",
    "in", "of", "as", "true", "false", "null", "undefined", "yield",
    "super", "delete", "default", "void",
];

const PYTHON_KEYWORDS: &[&str] = &[
    "def", "class", "return", "import", "from", "as", "if", "elif", "else",
    "for", "while", "in", "not", "and", "or", "is", "try", "except", "finally",
    "raise", "with", "lambda", "yield", "global", "nonlocal", "pass", "break",
    "continue", "assert", "del", "async", "await", "True", "False", "None",
    "self",
];

const RUST_KEYWORDS: &[&str] = &[
    "fn", "let", "mut", "const", "static", "pub", "use", "mod", "crate", "super",
    "self", "Self", "struct", "enum", "trait", "impl", "for", "where", "as", "in",
    "if", "else", "while", "loop", "match", "return", "break", "continue", "move",
    "ref", "async", "await", "dyn", "unsafe", "extern", "type", "true", "false",
    "Some", "None", "Ok", "Err",
];

const GO_KEYWORDS: &[&str] = &[
    "func", "var", "const", "type", "struct", "interface", "map", "chan", "package",
    "import", "return", "if", "else", "for", "range", "switch", "case", "default",
    "break", "continue", "goto", "fallthrough", "go", "defer", "select",
    "true", "false", "nil",
];

const SWIFT_KEYWORDS: &[&str] = &[
    "func", "var", "let", "class", "struct", "enum", "protocol", "extension",
    "if", "else", "for", "in", "while", "repeat", "switch", "case", "default",
    "break", "continue", "return", "throw", "throws", "rethrows", "try", "catch",
    "guard", "defer", "do", "import", "public", "private", "internal", "fileprivate",
    "open", "static", "final", "async", "await", "init", "self", "Self",
    "true", "false", "nil", "where",
];

const JAVA_KEYWORDS: &[&str] = &[
    "public", "private", "protected", "static", "final", "abstract", "synchronized",
    "class", "interface", "extends", "implements", "package", "import",
    "if", "else", "for", "while", "do", "switch", "case", "default", "break",
    "continue", "return", "throw", "throws", "try", "catch", "finally", "new",
    "this", "super", "void", "true", "false", "null", "instanceof",
    "enum", "transient", "volatile",
];

const CPP_KEYWORDS: &[&str] = &[
    "int", "char", "void", "float", "double", "long", "short", "signed", "unsigned",
    "auto", "const", "static", "extern", "register", "volatile", "inline",
    "if", "else", "for", "while", "do", "switch", "case", "default", "break",
    "continue", "return", "goto",
    "struct", "union", "enum", "typedef", "sizeof",
    "class", "public", "private", "protected", "virtual", "override", "namespace",
    "new", "delete", "this", "template", "typename", "using",
    "true", "false", "nullptr", "NULL",
    "try", "catch", "throw", "noexcept", "constexpr", "decltype",
];

fn keywords_for(lang: LangId) -> &'static [&'static str] {
    match lang {
        LangId::TypeScript => TYPESCRIPT_KEYWORDS,
        LangId::JavaScript => JAVASCRIPT_KEYWORDS,
        LangId::Python => PYTHON_KEYWORDS,
        LangId::Rust => RUST_KEYWORDS,
        LangId::Go => GO_KEYWORDS,
        LangId::Swift => SWIFT_KEYWORDS,
        LangId::Java => JAVA_KEYWORDS,
        LangId::CCpp => CPP_KEYWORDS,
    }
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn is_digit_byte(b: u8) -> bool {
    b.is_ascii_digit()
}

fn is_operator_byte(b: u8) -> bool {
    matches!(b, b'=' | b'+' | b'-' | b'*' | b'/' | b'<' | b'>' | b'!'
               | b'&' | b'|' | b'?' | b':' | b'%' | b'~' | b'^')
}

fn is_punct_byte(b: u8) -> bool {
    matches!(b, b'{' | b'}' | b'[' | b']' | b'(' | b')' | b'.' | b',' | b';' | b'@' | b'#')
}

fn tok(s: usize, e: usize, color: &str, st: &str) -> RenderToken {
    RenderToken { s, e, c: color.to_string(), st: st.to_string() }
}

/// Tokenize a single line. Uses the language + palette pushed via FFI.
/// SHIP-V1-GAPS.md #17: per-language keyword tables; theme-aware colors.
pub fn tokenize_line(line: &str) -> Vec<RenderToken> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut tokens = Vec::new();
    let mut i = 0usize;

    // Snapshot palette + lang once per call to avoid repeated thread_local hits.
    let palette = PALETTE.with(|p| p.borrow().clone());
    let lang = CURRENT_LANG.with(|c| *c.borrow());
    let kw_table = keywords_for(lang);

    // Python uses `#` as the line-comment prefix instead of `//`.
    let py_comment = matches!(lang, LangId::Python);

    while i < len {
        // --- Line comment ---
        if py_comment && bytes[i] == b'#' {
            tokens.push(tok(i, len, &palette.comment, "italic"));
            return tokens;
        }
        if !py_comment && bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            tokens.push(tok(i, len, &palette.comment, "italic"));
            return tokens;
        }

        // --- Block comment: /* ... */ (not Python). ---
        if !py_comment && bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            if let Some(rel) = line[i + 2..].find("*/") {
                let end = i + 2 + rel + 2;
                tokens.push(tok(i, end, &palette.comment, "italic"));
                i = end;
                continue;
            } else {
                tokens.push(tok(i, len, &palette.comment, "italic"));
                return tokens;
            }
        }

        // --- String: ', ", ` ---
        if bytes[i] == b'\'' || bytes[i] == b'"' || bytes[i] == b'`' {
            let quote = bytes[i];
            let mut j = i + 1;
            while j < len {
                if bytes[j] == b'\\' {
                    j += 2; // skip escaped char (ASCII-safe for escape sequences)
                } else if bytes[j] == quote {
                    j += 1;
                    break;
                } else {
                    j += 1;
                }
            }
            tokens.push(tok(i, j, &palette.string, "normal"));
            i = j;
            continue;
        }

        // --- Number ---
        let next_is_digit = i + 1 < len && is_digit_byte(bytes[i + 1]);
        if is_digit_byte(bytes[i]) || (bytes[i] == b'.' && next_is_digit) {
            let mut j = i;
            while j < len && (is_digit_byte(bytes[j]) || bytes[j] == b'.' || bytes[j] == b'_'
                    || bytes[j] == b'e' || bytes[j] == b'E'
                    || bytes[j] == b'x' || bytes[j] == b'X'
                    || (bytes[j] >= b'a' && bytes[j] <= b'f')
                    || (bytes[j] >= b'A' && bytes[j] <= b'F')) {
                j += 1;
            }
            tokens.push(tok(i, j, &palette.number, "normal"));
            i = j;
            continue;
        }

        // --- Word: identifier / keyword ---
        if is_word_byte(bytes[i]) {
            let mut j = i;
            while j < len && is_word_byte(bytes[j]) {
                j += 1;
            }
            let word = &line[i..j];

            // Look ahead past spaces for '(' to detect function calls
            let mut after = j;
            while after < len && bytes[after] == b' ' { after += 1; }
            let is_func = after < len && bytes[after] == b'(';

            let is_kw = kw_table.iter().any(|&kw| kw == word);

            let color = if is_kw {
                &palette.keyword
            } else if is_func {
                &palette.function
            } else if word.len() > 1 && bytes[i].is_ascii_uppercase() {
                &palette.typename
            } else {
                &palette.variable
            };

            tokens.push(tok(i, j, color, "normal"));
            i = j;
            continue;
        }

        // --- Operator sequence ---
        if is_operator_byte(bytes[i]) {
            let mut j = i;
            while j < len && is_operator_byte(bytes[j]) { j += 1; }
            tokens.push(tok(i, j, &palette.default, "normal"));
            i = j;
            continue;
        }

        // --- Punctuation ---
        if is_punct_byte(bytes[i]) {
            tokens.push(tok(i, i + 1, &palette.default, "normal"));
            i += 1;
            continue;
        }

        // --- Whitespace / other ---
        tokens.push(tok(i, i + 1, &palette.default, "normal"));
        i += 1;
    }

    tokens
}
