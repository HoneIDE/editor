//! Rust-side line tokenizer for live syntax highlighting during Rust-handled edits.
//!
//! Mirrors keyword-syntax-engine.ts so that token colors stay correct immediately
//! after on_text_input / on_action edits, without waiting for TypeScript to re-render.
//! Currently handles TypeScript/JavaScript (the demo language).

/// Token produced by the tokenizer — start/end column, color hex, style name.
pub struct RenderToken {
    pub start: usize,
    pub end: usize,
    pub color: String,
    pub style: String,
}

// --- VS Code dark theme colors (must match DARK_THEME in view-model/theme.ts) ---
const COLOR_KEYWORD:  &str = "#569cd6";
const COLOR_STRING:   &str = "#ce9178";
const COLOR_COMMENT:  &str = "#6a9955";
const COLOR_VARIABLE: &str = "#9cdcfe";
const COLOR_TYPE:     &str = "#4ec9b0";
const COLOR_FUNCTION: &str = "#dcdcaa";
const COLOR_NUMBER:   &str = "#b5cea8";
const COLOR_DEFAULT:  &str = "#d4d4d4";

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
    RenderToken { start: s, end: e, color: color.to_string(), style: st.to_string() }
}

/// Tokenize a single line of TypeScript source. Returns byte-indexed RenderTokens.
pub fn tokenize_line(line: &str) -> Vec<RenderToken> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut tokens = Vec::new();
    let mut i = 0usize;

    while i < len {
        // --- Line comment: // ---
        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            tokens.push(tok(i, len, COLOR_COMMENT, "italic"));
            return tokens;
        }

        // --- Block comment: /* ... */ ---
        if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            if let Some(rel) = line[i + 2..].find("*/") {
                let end = i + 2 + rel + 2;
                tokens.push(tok(i, end, COLOR_COMMENT, "italic"));
                i = end;
                continue;
            } else {
                tokens.push(tok(i, len, COLOR_COMMENT, "italic"));
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
            tokens.push(tok(i, j, COLOR_STRING, "normal"));
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
            tokens.push(tok(i, j, COLOR_NUMBER, "normal"));
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

            let is_kw = TYPESCRIPT_KEYWORDS.iter().any(|&kw| kw == word);

            let color = if is_kw {
                COLOR_KEYWORD
            } else if is_func {
                COLOR_FUNCTION
            } else if word.len() > 1 && bytes[i].is_ascii_uppercase() {
                COLOR_TYPE
            } else {
                COLOR_VARIABLE
            };

            tokens.push(tok(i, j, color, "normal"));
            i = j;
            continue;
        }

        // --- Operator sequence ---
        if is_operator_byte(bytes[i]) {
            let mut j = i;
            while j < len && is_operator_byte(bytes[j]) { j += 1; }
            tokens.push(tok(i, j, COLOR_DEFAULT, "normal"));
            i = j;
            continue;
        }

        // --- Punctuation ---
        if is_punct_byte(bytes[i]) {
            tokens.push(tok(i, i + 1, COLOR_DEFAULT, "normal"));
            i += 1;
            continue;
        }

        // --- Whitespace / other ---
        tokens.push(tok(i, i + 1, COLOR_DEFAULT, "normal"));
        i += 1;
    }

    tokens
}
