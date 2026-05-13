//! Tree-sitter PoC demo (SHIP-V1-GAPS.md #16).
//!
//! Run: `cargo run --example demo_treesitter`
//!
//! Parses small TS and Python samples through tree-sitter, prints the resulting
//! TextMate scopes per token. Used to validate that the compile chain works
//! before Phase 1 wires this through Perry FFI.

use hone_editor_macos::tree_sitter_bridge::{tokenize, LangId, ScopedToken};
use std::time::Instant;

const TS_SAMPLE: &str = r#"// A small TS sample
import { foo } from './bar';

interface Point {
    x: number;
    y: number;
}

class Greeter extends Base {
    private greeting: string;

    constructor(message: string) {
        super();
        this.greeting = message;
    }

    public async greet(name: string): Promise<void> {
        return await say(`Hello, ${name}!`);
    }
}

const re = /[A-Z]+\d{2,}/g;
const p: Point = { x: 1, y: 2.5 };
"#;

const PY_SAMPLE: &str = r#"# A small Python sample
from typing import Optional
import json

class Greeter:
    """A class that greets people."""

    def __init__(self, message: str) -> None:
        self.greeting = message

    async def greet(self, name: str) -> Optional[str]:
        if not name:
            return None
        return f"Hello, {name}!"


PI = 3.14159
flag = True
"#;

fn print_tokens(label: &str, source: &str, tokens: &[ScopedToken]) {
    println!("\n=== {} ({} tokens) ===", label, tokens.len());
    for tok in tokens.iter().take(40) {
        let text = &source[tok.start_byte..tok.end_byte];
        let display: String = text.chars().take(40).collect();
        println!(
            "  [{:4}..{:4}] {:30} {}",
            tok.start_byte,
            tok.end_byte,
            tok.scope,
            display.replace('\n', "\\n"),
        );
    }
    if tokens.len() > 40 {
        println!("  ... and {} more", tokens.len() - 40);
    }
}

fn bench(label: &str, source: &str, lang: LangId, iters: usize) {
    let start = Instant::now();
    let mut last_count = 0;
    for _ in 0..iters {
        last_count = tokenize(source, lang).len();
    }
    let elapsed = start.elapsed();
    let per_iter = elapsed / iters as u32;
    println!(
        "\nBench {}: {} iters of {} bytes ({} tokens/parse) — total {:?}, per-parse {:?}",
        label,
        iters,
        source.len(),
        last_count,
        elapsed,
        per_iter,
    );
}

const RS_SAMPLE: &str = r#"// Rust sample
use std::collections::HashMap;

pub struct Counter<T: Hash + Eq> {
    items: HashMap<T, u64>,
}

impl<T: Hash + Eq> Counter<T> {
    pub fn new() -> Self {
        Self { items: HashMap::new() }
    }

    pub fn bump(&mut self, key: T) -> u64 {
        let n = self.items.entry(key).or_insert(0);
        *n += 1;
        *n
    }
}

fn main() {
    let mut c = Counter::<String>::new();
    let n = c.bump("hello".to_string());
    println!("count = {}", n);
}
"#;

const JS_SAMPLE: &str = r#"// JavaScript sample
const greet = (name) => {
    return `Hello, ${name}!`;
};

class Greeter {
    constructor(message) { this.message = message; }
    say() { console.log(this.message); }
}
"#;

const JSON_SAMPLE: &str = r#"{
  "name": "hone",
  "version": "0.1.0",
  "tags": ["editor", "native"],
  "meta": { "stars": 42, "ok": true, "nope": null }
}
"#;

const CSS_SAMPLE: &str = r#"/* CSS sample */
:root {
    --accent: #00d4aa;
}

.container {
    background: var(--accent);
    padding: 16px;
}

#header > h1.title { font-size: 24px; color: red; }
"#;

fn main() {
    let ts = tokenize(TS_SAMPLE, LangId::TypeScript);
    print_tokens("TypeScript", TS_SAMPLE, &ts);

    let py = tokenize(PY_SAMPLE, LangId::Python);
    print_tokens("Python", PY_SAMPLE, &py);

    let rs = tokenize(RS_SAMPLE, LangId::Rust);
    print_tokens("Rust", RS_SAMPLE, &rs);

    let js = tokenize(JS_SAMPLE, LangId::JavaScript);
    print_tokens("JavaScript", JS_SAMPLE, &js);

    let json = tokenize(JSON_SAMPLE, LangId::Json);
    print_tokens("JSON", JSON_SAMPLE, &json);

    let css = tokenize(CSS_SAMPLE, LangId::Css);
    print_tokens("CSS", CSS_SAMPLE, &css);

    // Sanity: a few scope categories must show up
    let ts_scopes: std::collections::HashSet<&str> =
        ts.iter().map(|t| t.scope.as_str()).collect();
    let expected = ["keyword.control", "string.quoted", "comment", "constant.numeric"];
    for s in expected.iter() {
        let ok = ts_scopes.contains(s);
        println!("  TS scope present? {:25} {}", s, if ok { "OK" } else { "MISSING" });
    }

    let py_scopes: std::collections::HashSet<&str> =
        py.iter().map(|t| t.scope.as_str()).collect();
    for s in expected.iter() {
        let ok = py_scopes.contains(s);
        println!("  PY scope present? {:25} {}", s, if ok { "OK" } else { "MISSING" });
    }

    // Quick perf check — small file shouldn't take more than a few hundred microseconds
    bench("TS small file", TS_SAMPLE, LangId::TypeScript, 200);
    bench("PY small file", PY_SAMPLE, LangId::Python, 200);
}
