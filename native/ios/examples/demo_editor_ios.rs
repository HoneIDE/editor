//! Interactive demo: opens a full-screen UIKit editor in the iOS Simulator.
//!
//! Run with: `bash run-demo.sh` from `native/ios/`
//!
//! Supports typing via software keyboard, tap to reposition cursor,
//! pan to scroll, backspace/delete, and copy/paste via UIPasteboard.

#[macro_use]
extern crate objc;

use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr::null_mut;

use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel, BOOL, YES};

use hone_editor_ios::{
    hone_editor_attach_to_view, hone_editor_begin_frame, hone_editor_create,
    hone_editor_end_frame, hone_editor_measure_text, hone_editor_render_line,
    hone_editor_set_action_callback, hone_editor_set_cursor, hone_editor_set_font,
    hone_editor_set_mouse_down_callback, hone_editor_set_scroll_callback,
    hone_editor_set_selection, hone_editor_set_text_input_callback, hone_editor_uiview,
};

/// Alias for Objective-C object pointer.
type Id = *mut Object;

/// Null Objective-C pointer.
const NIL: Id = null_mut();

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
    editor_ptr: *mut u8,
    char_width: f64,
    line_height: f64,
}

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

/// Global mutable state — required because extern "C" callbacks can't capture.
static mut DEMO: Option<DemoEditor> = None;

impl DemoEditor {
    fn new(editor_ptr: *mut u8, char_width: f64, line_height: f64, view_height: f64) -> Self {
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

    /// Get token JSON for a line, validating individual token spans.
    fn tokens_for_line(&self, idx: usize) -> String {
        let origin = self.line_origins[idx];
        let (orig_text, orig_tokens) = &self.original_lines[origin];
        let current_text = &self.lines[idx];
        if current_text == orig_text {
            return orig_tokens.clone();
        }
        validate_tokens_json(orig_tokens, orig_text, current_text)
    }

    /// Position cursor from a tap at (x, y) in view coordinates.
    fn click_to_cursor(&mut self, x: f64, y: f64) {
        let editor = self.editor_ptr as *mut hone_editor_ios::EditorView;
        let gutter_w = self.gutter_width();

        // Determine line from y (account for scroll offset)
        let line = ((y + self.scroll_y) / self.line_height).floor() as usize;
        let line = line.min(self.lines.len().saturating_sub(1));

        // Determine column from x
        let text_x = x - gutter_w;
        let col = if text_x <= 0.0 {
            0
        } else {
            let line_str = &self.lines[line];
            let mut best_col = 0;
            let mut best_dist = text_x;
            for (byte_idx, _) in line_str.char_indices() {
                let end = byte_idx + line_str[byte_idx..].chars().next().unwrap().len_utf8();
                let prefix = &line_str[..end];
                let c_prefix = CString::new(prefix).unwrap_or_default();
                let px = hone_editor_measure_text(editor, c_prefix.as_ptr());
                let dist = (text_x - px).abs();
                if dist < best_dist {
                    best_dist = dist;
                    best_col = end;
                }
                if px > text_x + self.char_width {
                    break;
                }
            }
            best_col
        };

        self.cursor_line = line;
        self.cursor_col = col;
        self.sel_anchor = None;
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

    /// Ensure cursor is visible by adjusting scroll offset.
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

    /// Get ordered selection range: (start_line, start_col, end_line, end_col)
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

    /// Get selected text as a String.
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

    /// Delete the selected text, leaving the cursor at the start of the selection.
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
        // Handle multi-line paste
        let mut parts = text.split('\n');
        if let Some(first) = parts.next() {
            for ch in first.chars() {
                self.lines[self.cursor_line].insert(self.cursor_col, ch);
                self.cursor_col += ch.len_utf8();
            }
            for part in parts {
                // Split line at cursor (same as insert_newline)
                let tail = self.lines[self.cursor_line][self.cursor_col..].to_string();
                self.lines[self.cursor_line].truncate(self.cursor_col);
                self.cursor_line += 1;
                self.lines.insert(self.cursor_line, tail);
                self.line_origins.insert(self.cursor_line, self.line_origins[self.cursor_line - 1]);
                self.cursor_col = 0;
                // Insert the text
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

    // ── Clipboard (UIPasteboard) ────────────────────────────────

    fn copy_to_clipboard(&self) {
        if !self.has_selection() {
            return;
        }
        let text = self.selected_text();
        unsafe {
            let pb: Id = msg_send![class!(UIPasteboard), generalPasteboard];
            let ns_str: Id = msg_send![class!(NSString), alloc];
            let c_text = CString::new(text).unwrap_or_default();
            let ns_str: Id = msg_send![ns_str, initWithUTF8String: c_text.as_ptr()];
            let _: () = msg_send![pb, setString: ns_str];
        }
    }

    fn paste_from_clipboard(&mut self) {
        let text = unsafe {
            let pb: Id = msg_send![class!(UIPasteboard), generalPasteboard];
            let ns_str: Id = msg_send![pb, string];
            if ns_str == NIL {
                return;
            }
            let utf8: *const i8 = msg_send![ns_str, UTF8String];
            if utf8.is_null() {
                return;
            }
            CStr::from_ptr(utf8).to_str().unwrap_or("").to_string()
        };
        if !text.is_empty() {
            self.insert_text(&text);
        }
    }

    fn cut_to_clipboard(&mut self) {
        self.copy_to_clipboard();
        if self.has_selection() {
            self.delete_selection();
        }
    }

    // ── Rendering ───────────────────────────────────────────────

    fn render(&self) {
        let editor = self.editor_ptr as *mut hone_editor_ios::EditorView;
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
}

// ── Callbacks ───────────────────────────────────────────────────

extern "C" fn on_text_input(
    _view: *mut hone_editor_ios::EditorView,
    text: *const c_char,
) {
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    if text_str.is_empty() {
        return;
    }
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.insert_text(text_str);
            demo.render();
        }
    }
}

extern "C" fn on_action(
    _view: *mut hone_editor_ios::EditorView,
    selector: *const c_char,
) {
    let sel_str = unsafe { CStr::from_ptr(selector) }.to_str().unwrap_or("");
    unsafe {
        if let Some(ref mut demo) = DEMO {
            match sel_str {
                "insertNewline:" => demo.insert_newline(),
                "deleteBackward:" => demo.delete_backward(),
                "deleteForward:" => demo.delete_forward(),
                "moveLeft:" => demo.move_left(false),
                "moveRight:" => demo.move_right(false),
                "moveUp:" => demo.move_up(false),
                "moveDown:" => demo.move_down(false),
                "moveToBeginningOfLine:" => demo.move_to_beginning_of_line(false),
                "moveToEndOfLine:" => demo.move_to_end_of_line(false),
                "moveLeftAndModifySelection:" => demo.move_left(true),
                "moveRightAndModifySelection:" => demo.move_right(true),
                "moveUpAndModifySelection:" => demo.move_up(true),
                "moveDownAndModifySelection:" => demo.move_down(true),
                "moveToBeginningOfLineAndModifySelection:" => {
                    demo.move_to_beginning_of_line(true)
                }
                "moveToEndOfLineAndModifySelection:" => demo.move_to_end_of_line(true),
                "insertTab:" => demo.insert_tab(),
                "insertBacktab:" => {}
                "cancelOperation:" => {
                    demo.sel_anchor = None;
                }
                "copy:" => {
                    demo.copy_to_clipboard();
                }
                "paste:" => {
                    demo.paste_from_clipboard();
                }
                "cut:" => {
                    demo.cut_to_clipboard();
                }
                "selectAll:" => {
                    demo.select_all();
                }
                _ => {
                    eprintln!("unhandled selector: {}", sel_str);
                }
            }
            demo.render();
        }
    }
}

extern "C" fn on_mouse_down(
    _view: *mut hone_editor_ios::EditorView,
    x: f64,
    y: f64,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            demo.click_to_cursor(x, y);
            demo.render();
        }
    }
}

extern "C" fn on_scroll(
    _view: *mut hone_editor_ios::EditorView,
    _dx: f64,
    dy: f64,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            // Pan gesture: dy negative = scroll down (content moves up)
            demo.scroll_y -= dy;
            demo.clamp_scroll();
            demo.render();
        }
    }
}

// ── UIKit bootstrapping via objc runtime ────────────────────────

#[repr(C)]
#[derive(Copy, Clone)]
struct ObjCPoint {
    x: f64,
    y: f64,
}

unsafe impl objc::Encode for ObjCPoint {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGPoint=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
struct ObjCSize {
    width: f64,
    height: f64,
}

unsafe impl objc::Encode for ObjCSize {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGSize=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
struct ObjCRect {
    origin: ObjCPoint,
    size: ObjCSize,
}

unsafe impl objc::Encode for ObjCRect {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
    }
}

#[link(name = "UIKit", kind = "framework")]
extern "C" {
    fn UIApplicationMain(
        argc: i32,
        argv: *const *const c_char,
        principal_class_name: Id,
        delegate_class_name: Id,
    ) -> i32;
}

/// Register DemoAppDelegate as a UIResponder + UIApplicationDelegate subclass.
fn register_app_delegate() {
    let superclass = Class::get("UIResponder").expect("UIResponder class not found");
    let mut decl = ClassDecl::new("DemoAppDelegate", superclass)
        .expect("Failed to create DemoAppDelegate class");

    unsafe {
        decl.add_method(
            objc::sel!(application:didFinishLaunchingWithOptions:),
            app_did_finish_launching as extern "C" fn(&Object, Sel, Id, Id) -> BOOL,
        );
        decl.add_method(
            objc::sel!(application:configurationForConnectingSceneSession:options:),
            app_configuration_for_scene
                as extern "C" fn(&Object, Sel, Id, Id, Id) -> Id,
        );
    }

    decl.register();
}

extern "C" fn app_did_finish_launching(
    _this: &Object,
    _sel: Sel,
    _application: Id,
    _options: Id,
) -> BOOL {
    YES
}

extern "C" fn app_configuration_for_scene(
    _this: &Object,
    _sel: Sel,
    _application: Id,
    _scene_session: Id,
    _options: Id,
) -> Id {
    unsafe {
        let role: Id = msg_send![_scene_session, role];
        let config: Id = msg_send![class!(UISceneConfiguration), alloc];
        let name: Id = msg_send![class!(NSString), alloc];
        let c_name = CString::new("Default Configuration").unwrap();
        let name: Id = msg_send![name, initWithUTF8String: c_name.as_ptr()];
        let config: Id = msg_send![config, initWithName: name sessionRole: role];

        // Point to our scene delegate class
        let delegate_cls = Class::get("DemoSceneDelegate").unwrap();
        let _: () = msg_send![config, setDelegateClass: delegate_cls];

        config
    }
}

/// Register DemoSceneDelegate as a UIWindowSceneDelegate.
fn register_scene_delegate() {
    let superclass = Class::get("UIResponder").expect("UIResponder class not found");
    let mut decl = ClassDecl::new("DemoSceneDelegate", superclass)
        .expect("Failed to create DemoSceneDelegate class");

    // Conform to UIWindowSceneDelegate protocol
    if let Some(proto) = objc::runtime::Protocol::get("UIWindowSceneDelegate") {
        decl.add_protocol(proto);
    }

    // Ivar to hold the window
    decl.add_ivar::<*mut c_void>("_window");

    unsafe {
        decl.add_method(
            objc::sel!(scene:willConnectToSession:options:),
            scene_will_connect as extern "C" fn(&Object, Sel, Id, Id, Id),
        );

        // UIWindowSceneDelegate requires a `window` property
        decl.add_method(
            objc::sel!(window),
            scene_get_window as extern "C" fn(&Object, Sel) -> Id,
        );
        decl.add_method(
            objc::sel!(setWindow:),
            scene_set_window as extern "C" fn(&Object, Sel, Id),
        );
    }

    decl.register();
}

extern "C" fn scene_will_connect(
    this: &Object,
    _sel: Sel,
    scene: Id,
    _session: Id,
    _options: Id,
) {
    unsafe {
        // Create UIWindow connected to the window scene
        let window: Id = msg_send![class!(UIWindow), alloc];
        let window: Id = msg_send![window, initWithWindowScene: scene];

        // Create DemoViewController
        let vc: Id = msg_send![class!(DemoViewController), alloc];
        let vc: Id = msg_send![vc, init];

        // Set root view controller and make visible
        let _: () = msg_send![window, setRootViewController: vc];
        let _: () = msg_send![window, makeKeyAndVisible];

        // Store window in ivar to keep it alive
        let this_mut = this as *const Object as *mut Object;
        (*this_mut).set_ivar("_window", window as *mut c_void);
    }
}

extern "C" fn scene_get_window(this: &Object, _sel: Sel) -> Id {
    unsafe {
        let ptr: *mut c_void = *this.get_ivar("_window");
        ptr as Id
    }
}

extern "C" fn scene_set_window(this: &Object, _sel: Sel, window: Id) {
    unsafe {
        let this_mut = this as *const Object as *mut Object;
        (*this_mut).set_ivar("_window", window as *mut c_void);
    }
}

/// Register DemoViewController as a UIViewController subclass.
fn register_view_controller() {
    let superclass = Class::get("UIViewController").expect("UIViewController class not found");
    let mut decl = ClassDecl::new("DemoViewController", superclass)
        .expect("Failed to create DemoViewController class");

    // Ivar to store the editor UIView pointer for becomeFirstResponder in viewDidAppear
    decl.add_ivar::<*mut c_void>("_editorUIView");

    unsafe {
        decl.add_method(
            objc::sel!(viewDidLoad),
            view_did_load as extern "C" fn(&Object, Sel),
        );
        decl.add_method(
            objc::sel!(viewDidAppear:),
            view_did_appear as extern "C" fn(&Object, Sel, BOOL),
        );
        decl.add_method(
            objc::sel!(prefersStatusBarHidden),
            prefers_status_bar_hidden as extern "C" fn(&Object, Sel) -> BOOL,
        );
    }

    decl.register();
}

extern "C" fn view_did_load(this: &Object, _sel: Sel) {
    unsafe {
        // Call super viewDidLoad
        let superclass = Class::get("UIViewController").unwrap();
        let _: () = msg_send![super(this, superclass), viewDidLoad];

        // Get self.view and its bounds
        let root_view: Id = msg_send![this, view];
        let bounds: ObjCRect = msg_send![root_view, bounds];
        let view_width = bounds.size.width;
        let view_height = bounds.size.height;

        // Create the editor
        let editor = hone_editor_create(view_width, view_height);

        // Set font
        let font_family = CString::new("Menlo").unwrap();
        hone_editor_set_font(editor, font_family.as_ptr(), 14.0);

        // Measure character width
        let m_char = CString::new("M").unwrap();
        let char_width = hone_editor_measure_text(editor, m_char.as_ptr());
        let line_height = 21.0;

        // Attach editor UIView to root view
        hone_editor_attach_to_view(editor, root_view as i64);

        // Store the editor UIView for becomeFirstResponder in viewDidAppear
        let uiview = hone_editor_uiview(editor);
        let this_mut = this as *const Object as *mut Object;
        (*this_mut).set_ivar("_editorUIView", uiview as *mut c_void);

        // Initialize demo state
        DEMO = Some(DemoEditor::new(
            editor as *mut u8,
            char_width,
            line_height,
            view_height,
        ));

        // Register callbacks
        hone_editor_set_text_input_callback(editor, on_text_input);
        hone_editor_set_action_callback(editor, on_action);
        hone_editor_set_mouse_down_callback(editor, on_mouse_down);
        hone_editor_set_scroll_callback(editor, on_scroll);

        // Initial render
        if let Some(ref demo) = DEMO {
            demo.render();
        }
    }
}

extern "C" fn view_did_appear(this: &Object, _sel: Sel, _animated: BOOL) {
    unsafe {
        // Call super viewDidAppear:
        let superclass = Class::get("UIViewController").unwrap();
        let _: () = msg_send![super(this, superclass), viewDidAppear: _animated];

        // Now the view is in the window hierarchy — make editor first responder to show keyboard
        let uiview_ptr: *mut c_void = *this.get_ivar("_editorUIView");
        if !uiview_ptr.is_null() {
            let uiview = uiview_ptr as Id;
            let _: BOOL = msg_send![uiview, becomeFirstResponder];
        }
    }
}

extern "C" fn prefers_status_bar_hidden(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

// ── Main ────────────────────────────────────────────────────────

fn main() {
    // Register UIKit subclasses
    register_app_delegate();
    register_scene_delegate();
    register_view_controller();

    // Launch UIKit application
    unsafe {
        let delegate_name: Id = msg_send![class!(NSString), alloc];
        let c_name = CString::new("DemoAppDelegate").unwrap();
        let delegate_name: Id = msg_send![delegate_name, initWithUTF8String: c_name.as_ptr()];

        UIApplicationMain(0, std::ptr::null(), NIL, delegate_name);
    }
}
