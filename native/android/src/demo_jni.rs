//! Android demo: DemoEditor + JNI exports for the Kotlin demo app.
//!
//! This module mirrors the editing logic from the macOS and iOS demo_editor
//! examples, but exposes state via JNI for Kotlin to query and render.

use std::ffi::CString;

use jni::objects::{JClass, JString};
use jni::sys::{jdouble, jint, jstring};
use jni::JNIEnv;

use crate::editor_view::EditorView;
use crate::{
    hone_editor_begin_frame, hone_editor_create, hone_editor_end_frame, hone_editor_measure_text,
    hone_editor_render_line, hone_editor_set_cursor, hone_editor_set_font,
    hone_editor_set_selection,
};

// ── DemoEditor state ────────────────────────────────────────────

struct DemoEditor {
    lines: Vec<String>,
    /// Per-line token JSON — maps original line content → token data.
    original_lines: Vec<(String, String)>, // (text, tokens_json)
    line_origins: Vec<usize>,
    cursor_line: usize,
    cursor_col: usize,
    sel_anchor: Option<(usize, usize)>,
    scroll_y: f64,
    view_height: f64,
    editor_ptr: *mut EditorView,
    char_width: f64,
    line_height: f64,
}

// Safety: the demo uses single-threaded access from the Android UI thread.
unsafe impl Send for DemoEditor {}

/// Initial content and token data (VS Code dark theme colors).
fn initial_content() -> Vec<(String, String)> {
    vec![
        (
            "import { TextBuffer } from './buffer';".into(),
            r##"[{"s":0,"e":6,"c":"#c586c0","st":"normal"},{"s":7,"e":8,"c":"#d4d4d4","st":"normal"},{"s":9,"e":19,"c":"#9cdcfe","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"},{"s":22,"e":26,"c":"#c586c0","st":"normal"},{"s":27,"e":37,"c":"#ce9178","st":"normal"},{"s":37,"e":38,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        ("".into(), "[]".into()),
        (
            "export class Editor {".into(),
            r##"[{"s":0,"e":6,"c":"#569cd6","st":"normal"},{"s":7,"e":12,"c":"#569cd6","st":"normal"},{"s":13,"e":19,"c":"#4ec9b0","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "  private buffer: TextBuffer;".into(),
            r##"[{"s":2,"e":9,"c":"#569cd6","st":"normal"},{"s":10,"e":16,"c":"#9cdcfe","st":"normal"},{"s":16,"e":17,"c":"#d4d4d4","st":"normal"},{"s":18,"e":28,"c":"#4ec9b0","st":"normal"},{"s":28,"e":29,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "  private cursorLine: number = 0;".into(),
            r##"[{"s":2,"e":9,"c":"#569cd6","st":"normal"},{"s":10,"e":20,"c":"#9cdcfe","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"},{"s":22,"e":28,"c":"#4ec9b0","st":"normal"},{"s":29,"e":30,"c":"#d4d4d4","st":"normal"},{"s":31,"e":32,"c":"#b5cea8","st":"normal"}]"##.into(),
        ),
        ("".into(), "[]".into()),
        (
            "  constructor(content: string) {".into(),
            r##"[{"s":2,"e":13,"c":"#569cd6","st":"normal"},{"s":13,"e":14,"c":"#d4d4d4","st":"normal"},{"s":14,"e":21,"c":"#9cdcfe","st":"normal"},{"s":21,"e":22,"c":"#d4d4d4","st":"normal"},{"s":23,"e":29,"c":"#4ec9b0","st":"normal"},{"s":29,"e":30,"c":"#d4d4d4","st":"normal"},{"s":31,"e":32,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "    this.buffer = new TextBuffer(content);".into(),
            r##"[{"s":4,"e":8,"c":"#569cd6","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":15,"c":"#9cdcfe","st":"normal"},{"s":16,"e":17,"c":"#d4d4d4","st":"normal"},{"s":18,"e":21,"c":"#569cd6","st":"normal"},{"s":22,"e":32,"c":"#4ec9b0","st":"normal"},{"s":32,"e":33,"c":"#d4d4d4","st":"normal"},{"s":33,"e":40,"c":"#9cdcfe","st":"normal"},{"s":40,"e":41,"c":"#d4d4d4","st":"normal"},{"s":41,"e":42,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "  }".into(),
            r##"[{"s":2,"e":3,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        ("".into(), "[]".into()),
        (
            "  // Insert text at the cursor position".into(),
            r##"[{"s":2,"e":40,"c":"#6a9955","st":"italic"}]"##.into(),
        ),
        (
            "  insert(text: string): void {".into(),
            r##"[{"s":2,"e":8,"c":"#dcdcaa","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":13,"c":"#9cdcfe","st":"normal"},{"s":13,"e":14,"c":"#d4d4d4","st":"normal"},{"s":15,"e":21,"c":"#4ec9b0","st":"normal"},{"s":21,"e":22,"c":"#d4d4d4","st":"normal"},{"s":23,"e":27,"c":"#569cd6","st":"normal"},{"s":28,"e":29,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "    this.buffer.insert(this.cursorLine, text);".into(),
            r##"[{"s":4,"e":8,"c":"#569cd6","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":15,"c":"#9cdcfe","st":"normal"},{"s":15,"e":16,"c":"#d4d4d4","st":"normal"},{"s":16,"e":22,"c":"#dcdcaa","st":"normal"},{"s":22,"e":23,"c":"#d4d4d4","st":"normal"},{"s":23,"e":27,"c":"#569cd6","st":"normal"},{"s":27,"e":28,"c":"#d4d4d4","st":"normal"},{"s":28,"e":38,"c":"#9cdcfe","st":"normal"},{"s":38,"e":39,"c":"#d4d4d4","st":"normal"},{"s":40,"e":44,"c":"#9cdcfe","st":"normal"},{"s":44,"e":45,"c":"#d4d4d4","st":"normal"},{"s":45,"e":46,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "  }".into(),
            r##"[{"s":2,"e":3,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
        (
            "}".into(),
            r##"[{"s":0,"e":1,"c":"#d4d4d4","st":"normal"}]"##.into(),
        ),
    ]
}

// ── Token validation helpers ────────────────────────────────────

fn extract_json_int(s: &str, key: &str) -> Option<usize> {
    let idx = s.find(key)? + key.len();
    let rest = &s[idx..];
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    if end == 0 { return None; }
    rest[..end].parse().ok()
}

fn extract_json_str<'a>(s: &'a str, key: &str) -> &'a str {
    if let Some(idx) = s.find(key) {
        let rest = &s[idx + key.len()..];
        if let Some(end) = rest.find('"') {
            return &rest[..end];
        }
    }
    ""
}

fn validate_tokens_json(tokens_json: &str, orig_text: &str, curr_text: &str) -> String {
    if tokens_json == "[]" || curr_text.is_empty() {
        return "[]".to_string();
    }
    let orig_bytes = orig_text.as_bytes();
    let curr_bytes = curr_text.as_bytes();
    let orig_len = orig_bytes.len();
    let curr_len = curr_bytes.len();
    let mut prefix_len = 0;
    while prefix_len < orig_len && prefix_len < curr_len
        && orig_bytes[prefix_len] == curr_bytes[prefix_len] { prefix_len += 1; }
    let mut suffix_len = 0;
    while suffix_len < (orig_len - prefix_len) && suffix_len < (curr_len - prefix_len)
        && orig_bytes[orig_len - 1 - suffix_len] == curr_bytes[curr_len - 1 - suffix_len] { suffix_len += 1; }

    // Expand changed region to word boundaries so entire affected words go gray
    fn is_word_byte(b: u8) -> bool { b.is_ascii_alphanumeric() || b == b'_' }
    while prefix_len > 0 && is_word_byte(orig_bytes[prefix_len - 1]) { prefix_len -= 1; }
    while suffix_len > 0 && is_word_byte(orig_bytes[orig_len - suffix_len]) { suffix_len -= 1; }

    let delta = curr_len as isize - orig_len as isize;
    let orig_change_end = orig_len - suffix_len;
    let default_c = "#d4d4d4";
    let default_st = "normal";
    let mut colors: Vec<&str> = vec![default_c; curr_len];
    let mut styles: Vec<&str> = vec![default_st; curr_len];
    let json_bytes = tokens_json.as_bytes();
    let json_len = json_bytes.len();
    let mut i = 0;
    while i < json_len {
        if json_bytes[i] == b'{' {
            let start = i;
            let mut depth = 1u32;
            i += 1;
            while i < json_len && depth > 0 {
                if json_bytes[i] == b'{' { depth += 1; }
                if json_bytes[i] == b'}' { depth -= 1; }
                i += 1;
            }
            let obj_str = &tokens_json[start..i];
            if let (Some(s), Some(e)) = (
                extract_json_int(obj_str, "\"s\":"),
                extract_json_int(obj_str, "\"e\":"),
            ) {
                let c = extract_json_str(obj_str, "\"c\":\"");
                let st = extract_json_str(obj_str, "\"st\":\"");
                let c = if c.is_empty() { default_c } else { c };
                let st = if st.is_empty() { default_st } else { st };
                for p in s..e.min(orig_len) {
                    let cp = if p < prefix_len { p as isize }
                        else if p >= orig_change_end { p as isize + delta }
                        else { continue };
                    if cp >= 0 && (cp as usize) < curr_len {
                        colors[cp as usize] = c;
                        styles[cp as usize] = st;
                    }
                }
            }
        } else { i += 1; }
    }
    let mut result = Vec::new();
    let mut span_start = 0;
    for j in 1..=curr_len {
        if j == curr_len || colors[j] != colors[span_start] || styles[j] != styles[span_start] {
            result.push(format!(
                r#"{{"s":{},"e":{},"c":"{}","st":"{}"}}"#,
                span_start, j, colors[span_start], styles[span_start]
            ));
            span_start = j;
        }
    }
    format!("[{}]", result.join(","))
}

/// Global mutable state — required because JNI callbacks can't capture.
static mut DEMO: Option<DemoEditor> = None;

impl DemoEditor {
    fn new(editor_ptr: *mut EditorView, char_width: f64, line_height: f64, view_height: f64) -> Self {
        let content = initial_content();
        let lines: Vec<String> = content.iter().map(|(t, _)| t.clone()).collect();
        let line_origins = (0..lines.len()).collect();
        DemoEditor {
            lines,
            original_lines: content,
            line_origins,
            cursor_line: 0,
            cursor_col: 0,
            sel_anchor: None,
            scroll_y: 0.0,
            view_height,
            editor_ptr,
            char_width,
            line_height,
        }
    }

    fn tokens_for_line(&self, idx: usize) -> String {
        let origin = self.line_origins[idx];
        let (orig_text, orig_tokens) = &self.original_lines[origin];
        let current_text = &self.lines[idx];
        if current_text == orig_text {
            return orig_tokens.clone();
        }
        validate_tokens_json(orig_tokens, orig_text, current_text)
    }

    fn gutter_width(&self) -> f64 {
        let digits = if self.lines.is_empty() {
            2
        } else {
            let d = (self.lines.len() as f64).log10().floor() as i32 + 1;
            d.max(2) as usize
        };
        digits as f64 * self.char_width + 36.0
    }

    fn clamp_cursor(&mut self) {
        if self.cursor_line >= self.lines.len() {
            self.cursor_line = self.lines.len().saturating_sub(1);
        }
        let line_len = self.lines[self.cursor_line].len();
        if self.cursor_col > line_len {
            self.cursor_col = line_len;
        }
    }

    fn total_content_height(&self) -> f64 {
        self.lines.len() as f64 * self.line_height
    }

    fn clamp_scroll(&mut self) {
        let max_scroll = (self.total_content_height() - self.view_height).max(0.0);
        self.scroll_y = self.scroll_y.clamp(0.0, max_scroll);
    }

    fn scroll_to_cursor(&mut self) {
        let cursor_top = self.cursor_line as f64 * self.line_height;
        let cursor_bottom = cursor_top + self.line_height;

        if cursor_top < self.scroll_y {
            self.scroll_y = cursor_top;
        } else if cursor_bottom > self.scroll_y + self.view_height {
            self.scroll_y = cursor_bottom - self.view_height;
        }
        self.clamp_scroll();
    }

    fn selection_range(&self) -> Option<(usize, usize, usize, usize)> {
        let (al, ac) = self.sel_anchor?;
        let (cl, cc) = (self.cursor_line, self.cursor_col);
        if (al, ac) <= (cl, cc) {
            Some((al, ac, cl, cc))
        } else {
            Some((cl, cc, al, ac))
        }
    }

    fn has_selection(&self) -> bool {
        if let Some((al, ac)) = self.sel_anchor {
            al != self.cursor_line || ac != self.cursor_col
        } else {
            false
        }
    }

    fn selected_text(&self) -> String {
        if let Some((sl, sc, el, ec)) = self.selection_range() {
            if sl == el {
                self.lines[sl][sc..ec].to_string()
            } else {
                let mut result = self.lines[sl][sc..].to_string();
                for line_idx in (sl + 1)..el {
                    result.push('\n');
                    result.push_str(&self.lines[line_idx]);
                }
                result.push('\n');
                result.push_str(&self.lines[el][..ec]);
                result
            }
        } else {
            String::new()
        }
    }

    fn select_all(&mut self) {
        self.sel_anchor = Some((0, 0));
        let last = self.lines.len() - 1;
        self.cursor_line = last;
        self.cursor_col = self.lines[last].len();
    }

    fn delete_selection(&mut self) {
        if let Some((sl, sc, el, ec)) = self.selection_range() {
            if sl == el {
                self.lines[sl].replace_range(sc..ec, "");
            } else {
                let tail = self.lines[el][ec..].to_string();
                self.lines[sl].truncate(sc);
                self.lines[sl].push_str(&tail);
                self.lines.drain((sl + 1)..=el);
            }
            self.cursor_line = sl;
            self.cursor_col = sc;
            self.line_origins.drain((sl + 1)..=el);
        }
        self.sel_anchor = None;
    }

    fn insert_text(&mut self, text: &str) {
        if self.has_selection() {
            self.delete_selection();
        }
        let mut parts = text.split('\n');
        if let Some(first) = parts.next() {
            for ch in first.chars() {
                self.lines[self.cursor_line].insert(self.cursor_col, ch);
                self.cursor_col += ch.len_utf8();
            }
            for part in parts {
                let tail = self.lines[self.cursor_line][self.cursor_col..].to_string();
                self.lines[self.cursor_line].truncate(self.cursor_col);
                self.cursor_line += 1;
                self.lines.insert(self.cursor_line, tail);
                self.line_origins.insert(self.cursor_line, self.line_origins[self.cursor_line - 1]);
                self.cursor_col = 0;
                for ch in part.chars() {
                    self.lines[self.cursor_line].insert(self.cursor_col, ch);
                    self.cursor_col += ch.len_utf8();
                }
            }
        }
        self.sel_anchor = None;
        self.scroll_to_cursor();
    }

    fn insert_newline(&mut self) {
        if self.has_selection() {
            self.delete_selection();
        }
        let tail = self.lines[self.cursor_line][self.cursor_col..].to_string();
        self.lines[self.cursor_line].truncate(self.cursor_col);
        self.cursor_line += 1;
        self.lines.insert(self.cursor_line, tail);
        self.line_origins.insert(self.cursor_line, self.line_origins[self.cursor_line - 1]);
        self.cursor_col = 0;
        self.sel_anchor = None;
        self.scroll_to_cursor();
    }

    fn delete_backward(&mut self) {
        if self.has_selection() {
            self.delete_selection();
            return;
        }
        if self.cursor_col > 0 {
            let line = &self.lines[self.cursor_line];
            let prev_char_start = line[..self.cursor_col]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.lines[self.cursor_line].replace_range(prev_char_start..self.cursor_col, "");
            self.cursor_col = prev_char_start;
        } else if self.cursor_line > 0 {
            self.line_origins.remove(self.cursor_line);
            let current_line = self.lines.remove(self.cursor_line);
            self.cursor_line -= 1;
            self.cursor_col = self.lines[self.cursor_line].len();
            self.lines[self.cursor_line].push_str(&current_line);
        }
        self.sel_anchor = None;
        self.scroll_to_cursor();
    }

    fn delete_forward(&mut self) {
        if self.has_selection() {
            self.delete_selection();
            return;
        }
        let line_len = self.lines[self.cursor_line].len();
        if self.cursor_col < line_len {
            let line = &self.lines[self.cursor_line];
            let next_char_end = line[self.cursor_col..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor_col + i)
                .unwrap_or(line_len);
            self.lines[self.cursor_line].replace_range(self.cursor_col..next_char_end, "");
        } else if self.cursor_line + 1 < self.lines.len() {
            self.line_origins.remove(self.cursor_line + 1);
            let next_line = self.lines.remove(self.cursor_line + 1);
            self.lines[self.cursor_line].push_str(&next_line);
        }
        self.sel_anchor = None;
    }

    fn move_left(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        if !extend_selection && self.has_selection() {
            if let Some((sl, sc, _, _)) = self.selection_range() {
                self.cursor_line = sl;
                self.cursor_col = sc;
            }
            self.sel_anchor = None;
            return;
        }
        if self.cursor_col > 0 {
            let line = &self.lines[self.cursor_line];
            self.cursor_col = line[..self.cursor_col]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
        } else if self.cursor_line > 0 {
            self.cursor_line -= 1;
            self.cursor_col = self.lines[self.cursor_line].len();
        }
        if !extend_selection {
            self.sel_anchor = None;
        }
    }

    fn move_right(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        if !extend_selection && self.has_selection() {
            if let Some((_, _, el, ec)) = self.selection_range() {
                self.cursor_line = el;
                self.cursor_col = ec;
            }
            self.sel_anchor = None;
            return;
        }
        let line_len = self.lines[self.cursor_line].len();
        if self.cursor_col < line_len {
            let line = &self.lines[self.cursor_line];
            self.cursor_col = line[self.cursor_col..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor_col + i)
                .unwrap_or(line_len);
        } else if self.cursor_line + 1 < self.lines.len() {
            self.cursor_line += 1;
            self.cursor_col = 0;
        }
        if !extend_selection {
            self.sel_anchor = None;
        }
    }

    fn move_up(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        if !extend_selection && self.has_selection() {
            if let Some((sl, sc, _, _)) = self.selection_range() {
                self.cursor_line = sl;
                self.cursor_col = sc;
            }
            self.sel_anchor = None;
        }
        if self.cursor_line > 0 {
            self.cursor_line -= 1;
            self.clamp_cursor();
        }
        if !extend_selection {
            self.sel_anchor = None;
        }
        self.scroll_to_cursor();
    }

    fn move_down(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        if !extend_selection && self.has_selection() {
            if let Some((_, _, el, ec)) = self.selection_range() {
                self.cursor_line = el;
                self.cursor_col = ec;
            }
            self.sel_anchor = None;
        }
        if self.cursor_line + 1 < self.lines.len() {
            self.cursor_line += 1;
            self.clamp_cursor();
        }
        if !extend_selection {
            self.sel_anchor = None;
        }
        self.scroll_to_cursor();
    }

    fn move_to_beginning_of_line(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        self.cursor_col = 0;
        if !extend_selection {
            self.sel_anchor = None;
        }
    }

    fn move_to_end_of_line(&mut self, extend_selection: bool) {
        if extend_selection && self.sel_anchor.is_none() {
            self.sel_anchor = Some((self.cursor_line, self.cursor_col));
        }
        self.cursor_col = self.lines[self.cursor_line].len();
        if !extend_selection {
            self.sel_anchor = None;
        }
    }

    fn insert_tab(&mut self) {
        if self.has_selection() {
            self.delete_selection();
        }
        self.insert_text("  ");
    }

    /// Position cursor from a tap at (x, y) in view coordinates.
    fn tap_to_cursor(&mut self, x: f64, y: f64) {
        let gutter_w = self.gutter_width();

        let line = ((y + self.scroll_y) / self.line_height).floor() as usize;
        let line = line.min(self.lines.len().saturating_sub(1));

        let text_x = x - gutter_w;
        let col = if text_x <= 0.0 {
            0
        } else {
            // Approximate column from x position using monospace char width
            let approx_col = (text_x / self.char_width).round() as usize;
            approx_col.min(self.lines[line].len())
        };

        self.cursor_line = line;
        self.cursor_col = col;
        self.sel_anchor = None;
    }

    // ── Rendering ───────────────────────────────────────────────

    fn render(&self) {
        let editor = self.editor_ptr;
        let gutter_w = self.gutter_width();

        hone_editor_begin_frame(editor);

        // Only render lines visible in the viewport
        let first_visible = (self.scroll_y / self.line_height).floor() as usize;
        let visible_count = (self.view_height / self.line_height).ceil() as usize + 2;
        let last_visible = (first_visible + visible_count).min(self.lines.len());

        for i in first_visible..last_visible {
            let line_number = (i + 1) as i32;
            let y_offset = i as f64 * self.line_height - self.scroll_y;
            let c_text = CString::new(self.lines[i].as_str()).unwrap_or_default();
            let tok_json = self.tokens_for_line(i);
            let c_tokens = CString::new(tok_json).unwrap_or_default();
            hone_editor_render_line(
                editor,
                line_number,
                c_text.as_ptr(),
                c_tokens.as_ptr(),
                y_offset,
            );
        }

        // Cursor position
        let cursor_x = if self.cursor_col == 0 {
            gutter_w
        } else {
            let prefix = &self.lines[self.cursor_line][..self.cursor_col];
            let c_prefix = CString::new(prefix).unwrap_or_default();
            let text_w = hone_editor_measure_text(editor, c_prefix.as_ptr());
            gutter_w + text_w
        };
        let cursor_y = self.cursor_line as f64 * self.line_height - self.scroll_y;
        hone_editor_set_cursor(editor, cursor_x, cursor_y, 0);

        // Selection rects
        if self.has_selection() {
            if let Some((sl, sc, el, ec)) = self.selection_range() {
                let mut rects = Vec::new();
                for line_idx in sl..=el {
                    let col_start = if line_idx == sl { sc } else { 0 };
                    let col_end = if line_idx == el {
                        ec
                    } else {
                        self.lines[line_idx].len()
                    };

                    let x_start = if col_start == 0 {
                        gutter_w
                    } else {
                        let prefix = &self.lines[line_idx][..col_start];
                        let c_prefix = CString::new(prefix).unwrap_or_default();
                        gutter_w + hone_editor_measure_text(editor, c_prefix.as_ptr())
                    };
                    let x_end = if col_end == 0 {
                        gutter_w
                    } else {
                        let prefix = &self.lines[line_idx][..col_end];
                        let c_prefix = CString::new(prefix).unwrap_or_default();
                        gutter_w + hone_editor_measure_text(editor, c_prefix.as_ptr())
                    };

                    let y = line_idx as f64 * self.line_height - self.scroll_y;
                    let w = (x_end - x_start).max(0.0);
                    if w > 0.0 {
                        rects.push(format!(
                            r#"{{"x":{},"y":{},"w":{},"h":{}}}"#,
                            x_start, y, w, self.line_height
                        ));
                    }
                }
                let sel_json = format!("[{}]", rects.join(","));
                let c_sel = CString::new(sel_json).unwrap();
                hone_editor_set_selection(editor, c_sel.as_ptr());
            }
        }

        hone_editor_end_frame(editor);
    }

    fn handle_action(&mut self, action: &str) {
        match action {
            "insertNewline:" => self.insert_newline(),
            "deleteBackward:" => self.delete_backward(),
            "deleteForward:" => self.delete_forward(),
            "moveLeft:" => self.move_left(false),
            "moveRight:" => self.move_right(false),
            "moveUp:" => self.move_up(false),
            "moveDown:" => self.move_down(false),
            "moveToBeginningOfLine:" => self.move_to_beginning_of_line(false),
            "moveToEndOfLine:" => self.move_to_end_of_line(false),
            "moveLeftAndModifySelection:" => self.move_left(true),
            "moveRightAndModifySelection:" => self.move_right(true),
            "moveUpAndModifySelection:" => self.move_up(true),
            "moveDownAndModifySelection:" => self.move_down(true),
            "moveToBeginningOfLineAndModifySelection:" => {
                self.move_to_beginning_of_line(true)
            }
            "moveToEndOfLineAndModifySelection:" => self.move_to_end_of_line(true),
            "insertTab:" => self.insert_tab(),
            "selectAll:" => self.select_all(),
            "cancelOperation:" => {
                self.sel_anchor = None;
            }
            _ => {}
        }
    }
}

// ── JNI Exports ─────────────────────────────────────────────────

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeInit(
    _env: JNIEnv,
    _class: JClass,
    width: jdouble,
    height: jdouble,
) {
    let editor = hone_editor_create(width, height);
    let font_family = CString::new("monospace").unwrap();
    hone_editor_set_font(editor, font_family.as_ptr(), 14.0);

    let m_char = CString::new("M").unwrap();
    let char_width = hone_editor_measure_text(editor, m_char.as_ptr());
    let line_height = 21.0;

    unsafe {
        DEMO = Some(DemoEditor::new(editor, char_width, line_height, height));
        if let Some(ref demo) = DEMO {
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeSetMetrics(
    _env: JNIEnv,
    _class: JClass,
    char_width: jdouble,
    line_height: jdouble,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.char_width = char_width;
            demo.line_height = line_height;
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
) {
    unsafe {
        if let Some(ref demo) = DEMO {
            crate::hone_editor_destroy(demo.editor_ptr);
        }
        DEMO = None;
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetLineCount(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    unsafe {
        DEMO.as_ref().map(|d| d.lines.len() as jint).unwrap_or(0)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetLineText<'a>(
    env: JNIEnv<'a>,
    _class: JClass,
    line_index: jint,
) -> jstring {
    let text = unsafe {
        DEMO.as_ref()
            .and_then(|d| d.lines.get(line_index as usize))
            .map(|s| s.as_str())
            .unwrap_or("")
    };
    env.new_string(text)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetLineTokens<'a>(
    env: JNIEnv<'a>,
    _class: JClass,
    line_index: jint,
) -> jstring {
    let tokens = unsafe {
        DEMO.as_ref()
            .map(|d| {
                let idx = line_index as usize;
                if idx < d.lines.len() {
                    d.tokens_for_line(idx)
                } else {
                    "[]".to_string()
                }
            })
            .unwrap_or_else(|| "[]".to_string())
    };
    env.new_string(&tokens)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetCursorLine(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    unsafe {
        DEMO.as_ref().map(|d| d.cursor_line as jint).unwrap_or(0)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetCursorCol(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    unsafe {
        DEMO.as_ref().map(|d| d.cursor_col as jint).unwrap_or(0)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetSelAnchor<'a>(
    env: JNIEnv<'a>,
    _class: JClass,
) -> jstring {
    let json = unsafe {
        DEMO.as_ref()
            .map(|d| {
                match d.sel_anchor {
                    Some((l, c)) => format!("[{},{}]", l, c),
                    None => "null".to_string(),
                }
            })
            .unwrap_or_else(|| "null".to_string())
    };
    env.new_string(&json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetScrollY(
    _env: JNIEnv,
    _class: JClass,
) -> jdouble {
    unsafe {
        DEMO.as_ref().map(|d| d.scroll_y).unwrap_or(0.0)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetCharWidth(
    _env: JNIEnv,
    _class: JClass,
) -> jdouble {
    unsafe {
        DEMO.as_ref().map(|d| d.char_width).unwrap_or(8.4)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetLineHeight(
    _env: JNIEnv,
    _class: JClass,
) -> jdouble {
    unsafe {
        DEMO.as_ref().map(|d| d.line_height).unwrap_or(21.0)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeGetGutterWidth(
    _env: JNIEnv,
    _class: JClass,
) -> jdouble {
    unsafe {
        DEMO.as_ref().map(|d| d.gutter_width()).unwrap_or(52.8)
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeOnTextInput(
    mut env: JNIEnv,
    _class: JClass,
    text: JString,
) {
    let text_str: String = env.get_string(&text).map(|s| s.into()).unwrap_or_default();
    if text_str.is_empty() {
        return;
    }
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.insert_text(&text_str);
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeOnAction(
    mut env: JNIEnv,
    _class: JClass,
    action: JString,
) {
    let action_str: String = env.get_string(&action).map(|s| s.into()).unwrap_or_default();
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.handle_action(&action_str);
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeOnTouchDown(
    _env: JNIEnv,
    _class: JClass,
    x: jdouble,
    y: jdouble,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.tap_to_cursor(x, y);
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeOnScroll(
    _env: JNIEnv,
    _class: JClass,
    _dx: jdouble,
    dy: jdouble,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.scroll_y += dy;
            demo.clamp_scroll();
            demo.render();
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_com_honeide_demo_NativeLib_nativeRender(
    _env: JNIEnv,
    _class: JClass,
) {
    unsafe {
        if let Some(ref demo) = DEMO {
            demo.render();
        }
    }
}
