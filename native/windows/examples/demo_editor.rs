//! Interactive demo: opens a Win32 window with a fully editable code editor.
//!
//! Run with: `cargo run --example demo_editor` from `native/windows/`
//!
//! Supports typing, arrow key navigation, selection (Shift+arrows),
//! backspace/delete, enter, home/end, tab, copy/paste/cut, and scrolling.

use std::ffi::{c_char, CStr, CString};

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{UpdateWindow, HBRUSH};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::*;

use hone_editor_windows::{
    hone_editor_add_context_menu_item, hone_editor_begin_frame, hone_editor_create,
    hone_editor_destroy, hone_editor_end_frame, hone_editor_attach_to_view,
    hone_editor_hwnd, hone_editor_measure_text, hone_editor_render_line,
    hone_editor_set_action_callback, hone_editor_set_cursor, hone_editor_set_font,
    hone_editor_set_mouse_down_callback, hone_editor_set_scroll_callback,
    hone_editor_set_selection, hone_editor_set_text_input_callback,
};

// ── DemoEditor state ────────────────────────────────────────────

struct DemoEditor {
    lines: Vec<String>,
    /// Per-line token JSON — maps original line content → token data.
    original_lines: Vec<(String, String)>,
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

/// Global mutable state — required because extern "C" callbacks can't capture.
static mut DEMO: Option<DemoEditor> = None;

impl DemoEditor {
    fn new(editor_ptr: *mut u8, char_width: f64, line_height: f64, view_height: f64) -> Self {
        let content = initial_content();
        let lines: Vec<String> = content.iter().map(|(t, _)| t.clone()).collect();
        DemoEditor {
            lines,
            original_lines: content,
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

    /// Get token JSON for a line. If the line text matches an original line,
    /// use the original tokens (syntax highlighting is restored on undo).
    fn tokens_for_line(&self, idx: usize) -> &str {
        let text = &self.lines[idx];
        for (orig_text, orig_tokens) in &self.original_lines {
            if text == orig_text {
                return orig_tokens;
            }
        }
        "[]"
    }

    /// Position cursor from a click at (x, y) in view coordinates.
    fn click_to_cursor(&mut self, x: f64, y: f64) {
        let editor = self.editor_ptr as *mut hone_editor_windows::EditorView;
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
                let tail = self.lines[self.cursor_line][self.cursor_col..].to_string();
                self.lines[self.cursor_line].truncate(self.cursor_col);
                self.cursor_line += 1;
                self.lines.insert(self.cursor_line, tail);
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

    // ── Clipboard ───────────────────────────────────────────────

    fn copy_to_clipboard(&self) {
        if !self.has_selection() {
            return;
        }
        let text = self.selected_text();
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let byte_len = wide.len() * 2;

        unsafe {
            if OpenClipboard(HWND::default()).is_ok() {
                let _ = windows::Win32::System::DataExchange::EmptyClipboard();
                if let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, byte_len) {
                    let ptr = GlobalLock(hmem);
                    if !ptr.is_null() {
                        std::ptr::copy_nonoverlapping(
                            wide.as_ptr() as *const u8,
                            ptr as *mut u8,
                            byte_len,
                        );
                        let _ = GlobalUnlock(hmem);
                        let _ = SetClipboardData(
                            CF_UNICODETEXT.0 as u32,
                            HANDLE(hmem.0 as isize),
                        );
                    }
                }
                let _ = CloseClipboard();
            }
        }
    }

    fn paste_from_clipboard(&mut self) {
        let text = unsafe {
            if OpenClipboard(HWND::default()).is_err() {
                return;
            }
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32);
            let result = if let Ok(handle) = handle {
                let hglobal = HGLOBAL(handle.0 as *mut std::ffi::c_void);
                let ptr = GlobalLock(hglobal) as *const u16;
                if ptr.is_null() {
                    String::new()
                } else {
                    // Find the null terminator
                    let mut len = 0;
                    while *ptr.add(len) != 0 {
                        len += 1;
                    }
                    let slice = std::slice::from_raw_parts(ptr, len);
                    let s = String::from_utf16_lossy(slice);
                    let _ = GlobalUnlock(hglobal);
                    // Normalize \r\n to \n
                    s.replace("\r\n", "\n")
                }
            } else {
                String::new()
            };
            let _ = CloseClipboard();
            result
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
        let editor = self.editor_ptr as *mut hone_editor_windows::EditorView;
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
    _view: *mut hone_editor_windows::EditorView,
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
    _view: *mut hone_editor_windows::EditorView,
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
                "menu:uppercase" => {
                    if demo.has_selection() {
                        let text = demo.selected_text().to_uppercase();
                        demo.delete_selection();
                        demo.insert_text(&text);
                    }
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
    _view: *mut hone_editor_windows::EditorView,
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
    _view: *mut hone_editor_windows::EditorView,
    _dx: f64,
    dy: f64,
) {
    unsafe {
        if let Some(ref mut demo) = DEMO {
            // dy positive = scroll down (content moves up)
            demo.scroll_y += dy;
            demo.clamp_scroll();
            demo.render();
        }
    }
}

// ── Top-level window WndProc ────────────────────────────────────

static mut EDITOR_PTR: *mut hone_editor_windows::EditorView = std::ptr::null_mut();

unsafe extern "system" fn main_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_SIZE => {
            // Resize the editor child to fill the client area
            if !EDITOR_PTR.is_null() {
                let editor_hwnd = HWND(hone_editor_hwnd(EDITOR_PTR));
                let mut rect = windows::Win32::Foundation::RECT::default();
                let _ = GetClientRect(hwnd, &mut rect);
                let _ = SetWindowPos(
                    editor_hwnd,
                    None,
                    0,
                    0,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                    SWP_NOZORDER,
                );

                // Update demo view_height
                if let Some(ref mut demo) = DEMO {
                    demo.view_height = (rect.bottom - rect.top) as f64;
                    demo.render();
                }
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

// ── Main ────────────────────────────────────────────────────────

fn main() {
    unsafe {
        // Initialize COM
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let hmodule = GetModuleHandleW(None).unwrap_or_default();
        let hinstance: HINSTANCE = hmodule.into();

        // Register the main window class
        let class_name = w!("HoneEditorDemoMain");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(main_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: HICON::default(),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            hbrBackground: HBRUSH::default(),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: class_name,
            hIconSm: HICON::default(),
        };
        RegisterClassExW(&wc);

        let view_width = 900;
        let view_height = 650;

        let title = w!("Hone Editor \u{2014} Interactive Demo");

        // Create the main window
        let main_hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            view_width,
            view_height,
            None,
            None,
            hinstance,
            None,
        );

        // Create the editor
        let editor = hone_editor_create(view_width as f64, view_height as f64);
        EDITOR_PTR = editor;

        let font_family = CString::new("Consolas").unwrap();
        hone_editor_set_font(editor, font_family.as_ptr(), 14.0);

        let m_char = CString::new("M").unwrap();
        let char_width = hone_editor_measure_text(editor, m_char.as_ptr());
        let line_height = 21.0;

        // Attach editor as child of main window
        hone_editor_attach_to_view(editor, main_hwnd.0 as i64);

        // Set focus to the editor child window
        let editor_hwnd = HWND(hone_editor_hwnd(editor));
        let _ = SetFocus(editor_hwnd);

        // Create the demo state
        DEMO = Some(DemoEditor::new(
            editor as *mut u8,
            char_width,
            line_height,
            view_height as f64,
        ));

        // Set callbacks
        hone_editor_set_text_input_callback(editor, on_text_input);
        hone_editor_set_action_callback(editor, on_action);
        hone_editor_set_mouse_down_callback(editor, on_mouse_down);
        hone_editor_set_scroll_callback(editor, on_scroll);

        // Add a custom context menu item to demonstrate extensibility
        let title = CString::new("Uppercase Selection").unwrap();
        let action = CString::new("menu:uppercase").unwrap();
        hone_editor_add_context_menu_item(editor, title.as_ptr(), action.as_ptr());

        // Initial render
        if let Some(ref demo) = DEMO {
            demo.render();
        }

        let _ = ShowWindow(main_hwnd, SW_SHOW);
        let _ = UpdateWindow(main_hwnd);

        // Message loop
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        DEMO = None;
        hone_editor_destroy(editor);
        EDITOR_PTR = std::ptr::null_mut();
    }
}
