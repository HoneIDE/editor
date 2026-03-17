//! EditorView: top-level state for a Linux editor instance.
//!
//! Owns the FontSet, GTK widget, and frame buffer. Between beginFrame/endFrame
//! the TS coordinator pushes line data, cursor, and selection state. On
//! endFrame the widget is invalidated, and the draw handler calls draw() which
//! paints everything via Cairo / Pango.
//!
//! ## Perry mode
//!
//! Perry's AOT runtime does NOT fire setInterval/RAF after startup, so TypeScript
//! only renders twice at startup. After that, Rust handles all interaction directly:
//! - Input events are queued in `pending_events` for TypeScript's polling loop.
//! - Editing actions mutate `frame_lines` in-place and call `widget::invalidate_widget()`.
//! - Rust tracks cursor position independently via `rust_cursor_line` / `rust_col`.

use gdk4::prelude::DisplayExt;
use serde::Deserialize;

use std::ffi::{c_char, CString};

use crate::text_renderer::{self, FontSet, RenderToken};
use crate::widget;

// ── Event queue (for Perry polling) ──────────────────────────────

pub mod event_type {
    pub const TEXT:       i32 = 1;
    pub const ACTION:     i32 = 2;
    pub const SCROLL:     i32 = 3;
    pub const MOUSE_DOWN: i32 = 4;
}

pub mod action_id {
    pub const MOVE_LEFT:         i32 = 1;
    pub const MOVE_RIGHT:        i32 = 2;
    pub const MOVE_UP:           i32 = 3;
    pub const MOVE_DOWN:         i32 = 4;
    pub const MOVE_BOL:          i32 = 5;
    pub const MOVE_EOL:          i32 = 6;
    pub const MOVE_BOD:          i32 = 7;
    pub const MOVE_EOD:          i32 = 8;
    pub const INSERT_NEWLINE:    i32 = 9;
    pub const DELETE_BACKWARD:   i32 = 10;
    pub const DELETE_FORWARD:    i32 = 11;
    pub const INSERT_TAB:        i32 = 12;
    pub const MOVE_WORD_LEFT:    i32 = 13;
    pub const MOVE_WORD_RIGHT:   i32 = 14;
    pub const MOVE_LEFT_SEL:     i32 = 15;
    pub const MOVE_RIGHT_SEL:    i32 = 16;
    pub const MOVE_UP_SEL:       i32 = 17;
    pub const MOVE_DOWN_SEL:     i32 = 18;
    pub const MOVE_BOL_SEL:      i32 = 19;
    pub const MOVE_EOL_SEL:      i32 = 20;
    pub const SELECT_ALL:        i32 = 21;
    pub const CUT:               i32 = 22;
    pub const COPY:              i32 = 23;
    pub const PASTE:             i32 = 24;
    pub const UNDO:              i32 = 25;
    pub const REDO:              i32 = 26;
    pub const DELETE_WORD_BACKWARD: i32 = 27;
    pub const PAGE_UP:           i32 = 28;
    pub const PAGE_DOWN:         i32 = 29;
}

pub struct PendingEvent {
    pub event_type: i32,
    pub char_code:  u32,
    pub action_id:  i32,
    pub x: f64,
    pub y: f64,
}

/// Map a macOS-style selector string to a numeric action ID.
pub fn selector_to_action_id(selector: &str) -> i32 {
    match selector {
        "moveLeft:"                                    => action_id::MOVE_LEFT,
        "moveRight:"                                   => action_id::MOVE_RIGHT,
        "moveUp:"                                      => action_id::MOVE_UP,
        "moveDown:"                                    => action_id::MOVE_DOWN,
        "moveToBeginningOfLine:"                       => action_id::MOVE_BOL,
        "moveToEndOfLine:"                             => action_id::MOVE_EOL,
        "moveToBeginningOfDocument:"                   => action_id::MOVE_BOD,
        "moveToEndOfDocument:"                         => action_id::MOVE_EOD,
        "insertNewline:"                               => action_id::INSERT_NEWLINE,
        "deleteBackward:"                              => action_id::DELETE_BACKWARD,
        "deleteForward:"                               => action_id::DELETE_FORWARD,
        "insertTab:"                                   => action_id::INSERT_TAB,
        "moveWordLeft:"                                => action_id::MOVE_WORD_LEFT,
        "moveWordRight:"                               => action_id::MOVE_WORD_RIGHT,
        "moveLeftAndModifySelection:"                  => action_id::MOVE_LEFT_SEL,
        "moveRightAndModifySelection:"                 => action_id::MOVE_RIGHT_SEL,
        "moveUpAndModifySelection:"                    => action_id::MOVE_UP_SEL,
        "moveDownAndModifySelection:"                  => action_id::MOVE_DOWN_SEL,
        "moveToBeginningOfLineAndModifySelection:"     => action_id::MOVE_BOL_SEL,
        "moveToEndOfLineAndModifySelection:"           => action_id::MOVE_EOL_SEL,
        "selectAll:"                                   => action_id::SELECT_ALL,
        "cut:"                                         => action_id::CUT,
        "copy:"                                        => action_id::COPY,
        "paste:"                                       => action_id::PASTE,
        "undo:"                                        => action_id::UNDO,
        "redo:"                                        => action_id::REDO,
        "deleteWordBackward:"                          => action_id::DELETE_WORD_BACKWARD,
        "pageUp:"                                      => action_id::PAGE_UP,
        "pageDown:"                                    => action_id::PAGE_DOWN,
        _                                              => 0,
    }
}

// ── Callback types ──────────────────────────────────────────────

/// Called when the user types printable text. `text` is a null-terminated UTF-8 C string.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);

/// Called when an action selector fires (arrow keys, delete, enter, etc.).
/// `selector` is the selector name as a null-terminated UTF-8 C string (e.g. "moveLeft:").
pub type ActionCallback = extern "C" fn(view: *mut EditorView, selector: *const c_char);

/// Called when the user clicks in the editor view. `x` and `y` are in view coordinates.
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user scrolls. `dx`/`dy` are pixel deltas (dy positive = scroll down).
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

/// A custom context menu item added by the host application.
pub struct ContextMenuItem {
    pub title: String,
    pub action_id: String,
}

// ── Data structures ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SelectionRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Deserialize)]
pub struct CursorData {
    pub x: f64,
    pub y: f64,
    pub style: i32,
}

#[derive(Debug, Deserialize)]
pub struct DecorationOverlay {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub color: String,
    #[serde(rename = "type")]
    pub kind: String,
}

pub struct LineRenderData {
    pub line_number: i32,
    pub text: String,
    pub tokens: Vec<RenderToken>,
    pub y_offset: f64,
}

struct GhostTextData {
    text: String,
    x: f64,
    y: f64,
    color: (f64, f64, f64),
}

// ── EditorView ───────────────────────────────────────────────────

/// Top-level editor view state.
///
/// This is the object behind the opaque `*mut EditorView` pointer
/// returned by `hone_editor_create()`.
pub struct EditorView {
    pub renderer: FontSet,
    widget: *mut std::ffi::c_void,
    pub parent_view: *mut std::ffi::c_void,
    width: f64,
    height: f64,

    // Frame buffer (populated between beginFrame/endFrame)
    pub frame_lines: Vec<LineRenderData>,
    pub cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    pub selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    ghost_text: Option<GhostTextData>,
    scroll_offset: f64,
    pub max_line_number: i32,

    // Input callbacks
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (for Perry polling)
    pub pending_events: Vec<PendingEvent>,
    pub event_callback: Option<extern "C" fn()>,

    // Rust-side interactive state (Perry mode).
    // Perry's AOT runtime doesn't fire setInterval/RAF after startup, so
    // TypeScript can't poll events. Rust handles editing directly by mutating
    // frame_lines in-place and calling invalidate().
    pub rust_cursor_line: i32,   // 1-based line number of the cursor
    pub rust_col: usize,         // byte offset within that line's text
    // Selection anchor; None = no active selection.
    pub rust_sel_anchor: Option<(i32, usize)>,  // (line_number, byte_col)
    // Once the user manually clicks, don't let TypeScript re-renders override the cursor.
    pub user_has_clicked: bool,
    // y_offset of frame_lines[0] as received from the first TypeScript frame.
    // Used as the upper scroll bound so content can't be dragged below its initial position.
    pub initial_top_y: Option<f64>,

    // Internal clipboard buffer — avoids Wayland deadlock when copy-pasting
    // within the same process. See read_from_clipboard() for details.
    clipboard_buf: String,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,

    // Read-only mode flag
    pub read_only: bool,

    // Theme colors
    background_color: (f64, f64, f64),
    gutter_bg_color: (f64, f64, f64),
    gutter_fg_color: (f64, f64, f64),
    default_text_color: (f64, f64, f64),
    selection_color: (f64, f64, f64, f64),
    cursor_color: (f64, f64, f64),
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        let renderer = FontSet::new("monospace", 14.0);

        EditorView {
            renderer,
            widget: std::ptr::null_mut(),
            parent_view: std::ptr::null_mut(),
            width,
            height,
            frame_lines: Vec::with_capacity(64),
            cursor: None,
            cursors: Vec::new(),
            selections: Vec::new(),
            decorations: Vec::new(),
            ghost_text: None,
            scroll_offset: 0.0,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            scroll_callback: None,
            pending_events: Vec::new(),
            event_callback: None,
            rust_cursor_line: 1,
            rust_col: 0,
            rust_sel_anchor: None,
            user_has_clicked: false,
            initial_top_y: None,
            read_only: false,
            clipboard_buf: String::new(),
            context_menu_items: Vec::new(),
            // VS Code dark theme defaults
            background_color: (0.118, 0.118, 0.118),     // #1e1e1e
            gutter_bg_color: (0.118, 0.118, 0.118),      // same as bg
            gutter_fg_color: (0.525, 0.525, 0.525),      // #858585
            default_text_color: (0.843, 0.843, 0.843),   // #d7d7d7
            selection_color: (0.153, 0.306, 0.482, 0.4), // #264f7a @ 40%
            cursor_color: (0.918, 0.918, 0.918),          // #eaeaea
        }
    }

    /// Update stored dimensions from GTK's allocated size (called from draw handler).
    pub fn set_dimensions(&mut self, w: f64, h: f64) {
        self.width = w;
        self.height = h;
    }

    /// Return the stored view width (updated each draw frame by GTK allocation).
    pub fn view_width(&self) -> f64 { self.width }
    /// Return the stored view height (updated each draw frame by GTK allocation).
    pub fn view_height(&self) -> f64 { self.height }

    /// Called from lib.rs after the EditorView has a stable address.
    pub fn init_widget(&mut self) {
        let self_ptr = self as *mut EditorView;
        self.widget = widget::create_editor_widget(self.width, self.height, self_ptr);
    }

    /// Get the underlying GtkWidget handle.
    pub fn widget_ptr(&self) -> *mut std::ffi::c_void {
        self.widget
    }

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    /// Called from the widget's key handler for printable text.
    pub fn on_text_input(&mut self, text: &str) {
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
            return;
        }
        // Rust-side editing: insert into the cursor line in frame_lines directly.
        if self.cursor_line_idx().is_some() {
            self.delete_selection_if_any();
            // Re-lookup idx after potential selection delete
            if let Some(idx) = self.cursor_line_idx() {
                for ch in text.chars() {
                    let col = self.rust_col.min(self.frame_lines[idx].text.len());
                    self.frame_lines[idx].text.insert(col, ch);
                    self.rust_col = col + ch.len_utf8();
                }
                // Retokenize the whole line so keyword colors are immediately correct.
                self.frame_lines[idx].tokens =
                    crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
                self.sync_cursor_x();
                self.invalidate();
            }
        }
        // Queue events for TypeScript's polling loop.
        for ch in text.chars() {
            self.pending_events.push(PendingEvent {
                event_type: event_type::TEXT,
                char_code: ch as u32,
                action_id: 0,
                x: 0.0,
                y: 0.0,
            });
        }
    }

    /// Called from the widget's key handler for action selectors.
    pub fn on_action(&mut self, selector: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_sel) = CString::new(selector) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_sel.as_ptr());
            }
            return;
        }
        // Rust-side action handling.
        let mut dirty = false;
        match selector {
            // ── Editing ─────────────────────────────────────────────────────
            "insertNewline:" => {
                self.delete_selection_if_any();
                if let Some(idx) = self.cursor_line_idx() {
                    let ts_line_h = self.ts_line_height();
                    let col = self.rust_col.min(self.frame_lines[idx].text.len());
                    let right_text = self.frame_lines[idx].text[col..].to_string();
                    self.frame_lines[idx].text.truncate(col);
                    self.frame_lines[idx].tokens =
                        crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);

                    let new_line_number = self.frame_lines[idx].line_number + 1;
                    let new_y = self.frame_lines[idx].y_offset + ts_line_h;
                    let new_tokens = crate::tokenizer::tokenize_line(&right_text);

                    for j in (idx + 1)..self.frame_lines.len() {
                        self.frame_lines[j].line_number += 1;
                        self.frame_lines[j].y_offset += ts_line_h;
                    }
                    self.frame_lines.insert(idx + 1, LineRenderData {
                        line_number: new_line_number,
                        text: right_text,
                        tokens: new_tokens,
                        y_offset: new_y,
                    });
                    self.rust_cursor_line = new_line_number;
                    self.rust_col = 0;
                    self.max_line_number = self.frame_lines.last()
                        .map(|l| l.line_number).unwrap_or(self.max_line_number);
                    dirty = true;
                }
            }
            "deleteBackward:" => {
                if self.rust_sel_anchor.is_some() {
                    self.delete_selection_if_any();
                    dirty = true;
                } else if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col > 0 {
                        let col = self.rust_col - 1;
                        if col < self.frame_lines[idx].text.len() {
                            let ch_len = self.frame_lines[idx].text[col..].chars().next()
                                .map(|c| c.len_utf8()).unwrap_or(1);
                            self.frame_lines[idx].text.remove(col);
                            self.rust_col -= ch_len;
                            self.frame_lines[idx].tokens =
                                crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
                            dirty = true;
                        }
                    } else if idx > 0 {
                        // Backspace at start of line: join with previous line.
                        let ts_line_h = self.ts_line_height();
                        let current_text = self.frame_lines[idx].text.clone();
                        let prev_len = self.frame_lines[idx - 1].text.len();
                        self.frame_lines[idx - 1].text.push_str(&current_text);
                        self.frame_lines[idx - 1].tokens =
                            crate::tokenizer::tokenize_line(&self.frame_lines[idx - 1].text);
                        self.frame_lines.remove(idx);
                        for j in idx..self.frame_lines.len() {
                            self.frame_lines[j].line_number -= 1;
                            self.frame_lines[j].y_offset -= ts_line_h;
                        }
                        self.rust_cursor_line = self.frame_lines[idx - 1].line_number;
                        self.rust_col = prev_len;
                        dirty = true;
                    }
                }
            }

            // ── Plain movement (clears selection) ────────────────────────────
            "moveLeft:" => {
                self.clear_selection_keep_cursor_at_start();
                if self.rust_col > 0 {
                    if let Some(idx) = self.cursor_line_idx() {
                        let col = self.rust_col;
                        let ch_len = self.frame_lines[idx].text[..col]
                            .chars().next_back().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col -= ch_len;
                    }
                    dirty = true;
                } else if let Some(idx) = self.cursor_line_idx() {
                    if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = prev.text.len();
                        let new_y = prev.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
            }
            "moveRight:" => {
                self.clear_selection_keep_cursor_at_end();
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col < self.frame_lines[idx].text.len() {
                        let ch_len = self.frame_lines[idx].text[self.rust_col..]
                            .chars().next().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col += ch_len;
                        dirty = true;
                    } else if idx + 1 < self.frame_lines.len() {
                        let next = &self.frame_lines[idx + 1];
                        self.rust_cursor_line = next.line_number;
                        self.rust_col = 0;
                        let new_y = next.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
            }
            "moveUp:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                if let Some(idx) = self.cursor_line_idx() {
                    if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = self.rust_col.min(prev.text.len());
                        let new_y = prev.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
            }
            "moveDown:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                if let Some(idx) = self.cursor_line_idx() {
                    if idx + 1 < self.frame_lines.len() {
                        let next = &self.frame_lines[idx + 1];
                        self.rust_cursor_line = next.line_number;
                        self.rust_col = self.rust_col.min(next.text.len());
                        let new_y = next.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
            }
            "moveToBeginningOfLine:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                self.rust_col = 0;
                dirty = true;
            }
            "moveToEndOfLine:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                if let Some(idx) = self.cursor_line_idx() {
                    self.rust_col = self.frame_lines[idx].text.len();
                    dirty = true;
                }
            }

            // ── Selection-extending movement ─────────────────────────────────
            "moveLeftAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if self.rust_col > 0 {
                    if let Some(idx) = self.cursor_line_idx() {
                        let col = self.rust_col;
                        let ch_len = self.frame_lines[idx].text[..col]
                            .chars().next_back().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col -= ch_len;
                    }
                    dirty = true;
                } else if let Some(idx) = self.cursor_line_idx() {
                    if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = prev.text.len();
                        let new_y = prev.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
                if dirty { self.sync_selection_rects(); }
            }
            "moveRightAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col < self.frame_lines[idx].text.len() {
                        let ch_len = self.frame_lines[idx].text[self.rust_col..]
                            .chars().next().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col += ch_len;
                        dirty = true;
                    } else if idx + 1 < self.frame_lines.len() {
                        let next = &self.frame_lines[idx + 1];
                        self.rust_cursor_line = next.line_number;
                        self.rust_col = 0;
                        let new_y = next.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
                if dirty { self.sync_selection_rects(); }
            }
            "moveUpAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if let Some(idx) = self.cursor_line_idx() {
                    if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = self.rust_col.min(prev.text.len());
                        let new_y = prev.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
                if dirty { self.sync_selection_rects(); }
            }
            "moveDownAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if let Some(idx) = self.cursor_line_idx() {
                    if idx + 1 < self.frame_lines.len() {
                        let next = &self.frame_lines[idx + 1];
                        self.rust_cursor_line = next.line_number;
                        self.rust_col = self.rust_col.min(next.text.len());
                        let new_y = next.y_offset;
                        if let Some(ref mut c) = self.cursor { c.y = new_y; }
                        dirty = true;
                    }
                }
                if dirty { self.sync_selection_rects(); }
            }
            "moveToBeginningOfLineAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                self.rust_col = 0;
                self.sync_selection_rects();
                dirty = true;
            }
            "moveToEndOfLineAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if let Some(idx) = self.cursor_line_idx() {
                    self.rust_col = self.frame_lines[idx].text.len();
                    self.sync_selection_rects();
                    dirty = true;
                }
            }

            // ── Select all ──────────────────────────────────────────────────
            "selectAll:" => {
                if !self.frame_lines.is_empty() {
                    let first_line = self.frame_lines[0].line_number;
                    self.rust_sel_anchor = Some((first_line, 0));
                    let last = &self.frame_lines[self.frame_lines.len() - 1];
                    self.rust_cursor_line = last.line_number;
                    self.rust_col = last.text.len();
                    if let Some(ref mut c) = self.cursor { c.y = last.y_offset; }
                    self.sync_selection_rects();
                    dirty = true;
                }
            }

            // ── Clipboard ───────────────────────────────────────────────────
            "copy:" => {
                if self.rust_sel_anchor.is_some() {
                    let text = self.get_selected_text();
                    self.write_to_clipboard(&text);
                }
            }
            "cut:" => {
                if self.rust_sel_anchor.is_some() {
                    let text = self.get_selected_text();
                    self.write_to_clipboard(&text);
                    self.delete_selection_if_any();
                    dirty = true;
                }
            }
            "paste:" => {
                let text = self.read_from_clipboard();
                if !text.is_empty() {
                    self.delete_selection_if_any();
                    for ch in text.chars() {
                        if ch == '\n' {
                            if let Some(idx) = self.cursor_line_idx() {
                                let ts_line_h = self.ts_line_height();
                                let col = self.rust_col.min(self.frame_lines[idx].text.len());
                                let right_text = self.frame_lines[idx].text[col..].to_string();
                                self.frame_lines[idx].text.truncate(col);
                                self.frame_lines[idx].tokens =
                                    crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
                                let new_line_number = self.frame_lines[idx].line_number + 1;
                                let new_y = self.frame_lines[idx].y_offset + ts_line_h;
                                let new_tokens = crate::tokenizer::tokenize_line(&right_text);
                                for j in (idx + 1)..self.frame_lines.len() {
                                    self.frame_lines[j].line_number += 1;
                                    self.frame_lines[j].y_offset += ts_line_h;
                                }
                                self.frame_lines.insert(idx + 1, LineRenderData {
                                    line_number: new_line_number,
                                    text: right_text,
                                    tokens: new_tokens,
                                    y_offset: new_y,
                                });
                                self.rust_cursor_line = new_line_number;
                                self.rust_col = 0;
                            }
                        } else if ch == '\r' {
                            // skip \r (normalize \r\n to \n)
                        } else if let Some(idx) = self.cursor_line_idx() {
                            let col = self.rust_col.min(self.frame_lines[idx].text.len());
                            self.frame_lines[idx].text.insert(col, ch);
                            self.rust_col = col + ch.len_utf8();
                            self.frame_lines[idx].tokens =
                                crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
                        }
                    }
                    dirty = true;
                }
            }

            _ => {}
        }
        // Queue the action event for TypeScript's polling loop.
        let aid = selector_to_action_id(selector);
        if aid != 0 {
            self.pending_events.push(PendingEvent {
                event_type: event_type::ACTION,
                char_code: 0,
                action_id: aid,
                x: 0.0,
                y: 0.0,
            });
        }
        if dirty {
            self.sync_cursor_x();
            self.invalidate();
        }
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    /// Called from the widget's click handler.
    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
            return;
        }
        // Rust-side cursor positioning: find nearest line by y, compute col from x.
        if let Some(line) = self.frame_lines.iter().min_by(|a, b| {
            let da = (a.y_offset - y).abs();
            let db = (b.y_offset - y).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            let line_number = line.line_number;
            self.rust_cursor_line = line_number;
            self.user_has_clicked = true;
            let gutter_w = self.gutter_width();
            let text_x = (x - gutter_w).max(0.0);

            // Find the byte offset whose measured prefix width is closest to text_x.
            let mut best_byte_col = 0usize;
            let mut best_dist = f64::MAX;
            let mut byte_pos = 0usize;
            loop {
                let w = self.renderer.measure_text(&line.text[..byte_pos]);
                let dist = (w - text_x).abs();
                if dist < best_dist {
                    best_dist = dist;
                    best_byte_col = byte_pos;
                }
                if let Some(ch) = line.text[byte_pos..].chars().next() {
                    byte_pos += ch.len_utf8();
                } else {
                    break;
                }
            }
            self.rust_col = best_byte_col;
            // Set the anchor to the click position — drag will extend the selection from here.
            self.rust_sel_anchor = Some((line_number, best_byte_col));
            self.selections.clear();

            let text_before = &line.text[..self.rust_col];
            let cursor_x = gutter_w + self.renderer.measure_text(text_before);
            let cursor_y = line.y_offset;
            self.cursor = Some(CursorData { x: cursor_x, y: cursor_y, style: 0 });
            // Queue for TypeScript so it syncs its cursor position.
            self.pending_events.push(PendingEvent {
                event_type: event_type::MOUSE_DOWN,
                char_code: 0,
                action_id: 0,
                x,
                y,
            });
            self.invalidate();
        }
    }

    /// Called from the widget's drag handler. Updates cursor + selection while dragging.
    pub fn on_mouse_drag(&mut self, x: f64, y: f64) {
        if self.mouse_down_callback.is_some() {
            return;
        }
        if self.frame_lines.is_empty() {
            return;
        }
        // Find the nearest line by y.
        let (line_number, line_y_offset, text_clone) = {
            let line = self.frame_lines.iter().min_by(|a, b| {
                let da = (a.y_offset - y).abs();
                let db = (b.y_offset - y).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            }).unwrap();
            (line.line_number, line.y_offset, line.text.clone())
        };

        let gutter_w = self.gutter_width();
        let text_x = (x - gutter_w).max(0.0);

        // Find the byte offset closest to text_x.
        let mut best_byte_col = 0usize;
        let mut best_dist = f64::MAX;
        let mut byte_pos = 0usize;
        loop {
            let w = self.renderer.measure_text(&text_clone[..byte_pos]);
            let dist = (w - text_x).abs();
            if dist < best_dist {
                best_dist = dist;
                best_byte_col = byte_pos;
            }
            if let Some(ch) = text_clone[byte_pos..].chars().next() {
                byte_pos += ch.len_utf8();
            } else {
                break;
            }
        }

        self.rust_cursor_line = line_number;
        self.rust_col = best_byte_col;
        let cursor_x = gutter_w + self.renderer.measure_text(&text_clone[..best_byte_col]);
        self.cursor = Some(CursorData { x: cursor_x, y: line_y_offset, style: 0 });

        self.sync_selection_rects();
        self.invalidate();
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the widget's scroll handler.
    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
            return;
        }
        if self.frame_lines.is_empty() {
            return;
        }

        // Clamp the scroll delta so content never drifts outside its valid range.
        let ts_line_h = self.ts_line_height();
        let n = self.frame_lines.len() as f64;
        let total_content_h = n * ts_line_h;

        // GTK scroll: positive dy = scroll down = content moves up = y_offsets decrease.
        let actual_dy = if let Some(max_first_y) = self.initial_top_y {
            if total_content_h <= self.height {
                0.0
            } else {
                let min_first_y = max_first_y + self.height - total_content_h;
                let proposed = self.frame_lines[0].y_offset - dy;
                let clamped = proposed.clamp(min_first_y, max_first_y);
                clamped - self.frame_lines[0].y_offset
            }
        } else {
            -dy
        };

        if actual_dy.abs() < 0.1 {
            return;
        }

        for line in &mut self.frame_lines {
            line.y_offset += actual_dy;
        }
        if let Some(ref mut c) = self.cursor {
            c.y += actual_dy;
        }
        for sel in &mut self.selections {
            sel.y += actual_dy;
        }
        for decor in &mut self.decorations {
            decor.y += actual_dy;
        }
        self.invalidate();
    }

    pub fn add_context_menu_item(&mut self, title: &str, action_id: &str) {
        self.context_menu_items.push(ContextMenuItem {
            title: title.to_string(),
            action_id: action_id.to_string(),
        });
    }

    pub fn clear_context_menu_items(&mut self) {
        self.context_menu_items.clear();
    }

    pub fn context_menu_items(&self) -> &[ContextMenuItem] {
        &self.context_menu_items
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.renderer = FontSet::new(family, size);
        if !self.widget.is_null() {
            widget::invalidate_widget(self.widget);
        }
    }

    /// Set the editor background color (also sets gutter bg to match).
    pub fn set_bg_color(&mut self, r: f64, g: f64, b: f64) {
        self.background_color = (r, g, b);
        self.gutter_bg_color = (r, g, b);
        self.invalidate();
    }

    /// Set the default text foreground color.
    pub fn set_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.default_text_color = (r, g, b);
        self.invalidate();
    }

    /// Set the gutter (line number) foreground color.
    pub fn set_gutter_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.gutter_fg_color = (r, g, b);
        self.invalidate();
    }

    /// Set the selection highlight color (with alpha).
    pub fn set_selection_color(&mut self, r: f64, g: f64, b: f64, a: f64) {
        self.selection_color = (r, g, b, a);
        self.invalidate();
    }

    /// Set the cursor color.
    pub fn set_cursor_color(&mut self, r: f64, g: f64, b: f64) {
        self.cursor_color = (r, g, b);
        self.invalidate();
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        self.renderer.measure_text(text)
    }

    // ── Frame buffer API ─────────────────────────────────────────

    pub fn begin_frame(&mut self) {
        self.frame_lines.clear();
        // Only clear cursor if user hasn't manually positioned it via a click.
        if !self.user_has_clicked {
            self.cursor = None;
        }
        self.cursors.clear();
        self.selections.clear();
        self.decorations.clear();
        self.ghost_text = None;
        self.max_line_number = 0;
    }

    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        let mut tokens: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();
        // If TypeScript sent empty tokens (e.g. from _directRenderText), run
        // Rust-side tokenizer so syntax highlighting is visible immediately.
        if tokens.is_empty() && !text.is_empty() {
            tokens = crate::tokenizer::tokenize_line(text);
        }
        if line_number > self.max_line_number {
            self.max_line_number = line_number;
        }
        self.frame_lines.push(LineRenderData {
            line_number,
            text: text.to_string(),
            tokens,
            y_offset,
        });
    }

    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        if self.user_has_clicked {
            // User manually positioned cursor via click — don't let TypeScript override.
            // Update cursor visual position using the freshly rendered frame_lines so that
            // y_offset stays consistent with re-rendered content.
            if let Some(line) = self.frame_lines.iter()
                .find(|l| l.line_number == self.rust_cursor_line)
            {
                let cursor_x = self.gutter_width() + self.renderer.measure_text(
                    &line.text[..self.rust_col.min(line.text.len())]
                );
                self.cursor = Some(CursorData { x: cursor_x, y: line.y_offset, style: 0 });
            }
            return;
        }
        self.cursor = Some(CursorData { x, y, style });
        // Derive Rust cursor position from pixel coords so editing works correctly.
        let gutter_w = self.gutter_width();
        self.rust_col = ((x - gutter_w).max(0.0) / self.renderer.char_width).round() as usize;
        if let Some(line) = self.frame_lines.iter().min_by(|a, b| {
            let da = (a.y_offset - y).abs();
            let db = (b.y_offset - y).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            self.rust_cursor_line = line.line_number;
        }
    }

    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.cursors = serde_json::from_str(cursors_json).unwrap_or_default();
    }

    pub fn set_selection(&mut self, regions_json: &str) {
        self.selections = serde_json::from_str(regions_json).unwrap_or_default();
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset = offset_y;
    }

    pub fn render_decorations(&mut self, decorations_json: &str) {
        let mut decors: Vec<DecorationOverlay> =
            serde_json::from_str(decorations_json).unwrap_or_default();
        self.decorations.append(&mut decors);
    }

    pub fn render_ghost_text(&mut self, text: &str, x: f64, y: f64, color: &str) {
        self.ghost_text = Some(GhostTextData {
            text: text.to_string(),
            x,
            y,
            color: text_renderer::parse_hex_color(color),
        });
    }

    pub fn end_frame(&mut self) {
        // Record the TypeScript-assigned y_offset of the first line on the first render.
        // This becomes the upper scroll bound — content can never drift below this position.
        if self.initial_top_y.is_none() {
            if let Some(first) = self.frame_lines.first() {
                self.initial_top_y = Some(first.y_offset);
            }
        }
        if !self.widget.is_null() {
            widget::invalidate_widget(self.widget);
        }
    }

    pub fn invalidate(&mut self) {
        if !self.widget.is_null() {
            widget::invalidate_widget(self.widget);
        }
    }

    pub fn attach_to_parent(&mut self, parent: *mut std::ffi::c_void) {
        self.parent_view = parent;
    }

    // ── Rust-side editing helpers ─────────────────────────────────

    /// Index into frame_lines for the current cursor line, if any.
    pub fn cursor_line_idx(&self) -> Option<usize> {
        self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line)
    }

    /// Infer TypeScript's line height from the gap between the first two frame_lines.
    pub fn ts_line_height(&self) -> f64 {
        if self.frame_lines.len() >= 2 {
            (self.frame_lines[1].y_offset - self.frame_lines[0].y_offset).abs()
        } else {
            self.renderer.line_height
        }
    }

    /// Recompute the pixel X and Y of the cursor from rust_cursor_line / rust_col.
    pub fn sync_cursor_x(&mut self) {
        let gutter_w = self.gutter_width();
        if let Some(idx) = self.cursor_line_idx() {
            let text_len = self.frame_lines[idx].text.len();
            let col = self.rust_col.min(text_len);
            let x = gutter_w + self.renderer.measure_text(&self.frame_lines[idx].text[..col]);
            let y = self.frame_lines[idx].y_offset;
            if let Some(ref mut c) = self.cursor {
                c.x = x;
                c.y = y;
            } else {
                self.cursor = Some(CursorData { x, y, style: 0 });
            }
        } else {
            let x = gutter_w + self.rust_col as f64 * self.renderer.char_width;
            if let Some(ref mut c) = self.cursor {
                c.x = x;
            }
        }
    }

    /// If there is an active selection, delete its content and collapse the cursor
    /// to the start of the selection.
    pub fn delete_selection_if_any(&mut self) {
        let anchor = match self.rust_sel_anchor.take() {
            Some(a) => a,
            None => return,
        };
        self.selections.clear();

        let (anchor_line, anchor_col) = anchor;
        let cursor_line = self.rust_cursor_line;
        let cursor_col = self.rust_col;

        let anchor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == anchor_line)
        {
            Some(i) => i,
            None => return,
        };
        let cursor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == cursor_line)
        {
            Some(i) => i,
            None => return,
        };

        let (start_idx, start_col, end_idx, end_col) =
            if anchor_idx < cursor_idx || (anchor_idx == cursor_idx && anchor_col <= cursor_col) {
                (anchor_idx, anchor_col, cursor_idx, cursor_col)
            } else {
                (cursor_idx, cursor_col, anchor_idx, anchor_col)
            };

        if start_idx == end_idx {
            let lo = start_col.min(self.frame_lines[start_idx].text.len());
            let hi = end_col.min(self.frame_lines[start_idx].text.len());
            if lo < hi {
                self.frame_lines[start_idx].text.drain(lo..hi);
                let new_tokens = crate::tokenizer::tokenize_line(&self.frame_lines[start_idx].text);
                self.frame_lines[start_idx].tokens = new_tokens;
            }
        } else {
            let ts_line_h = self.ts_line_height();
            let start_text = {
                let lo = start_col.min(self.frame_lines[start_idx].text.len());
                self.frame_lines[start_idx].text[..lo].to_string()
            };
            let end_text = {
                let ec = end_col.min(self.frame_lines[end_idx].text.len());
                self.frame_lines[end_idx].text[ec..].to_string()
            };
            let merged = start_text + &end_text;
            let lines_removed = end_idx - start_idx;
            for _ in 0..lines_removed {
                self.frame_lines.remove(start_idx + 1);
            }
            let new_tokens = crate::tokenizer::tokenize_line(&merged);
            self.frame_lines[start_idx].tokens = new_tokens;
            self.frame_lines[start_idx].text = merged;
            for j in (start_idx + 1)..self.frame_lines.len() {
                self.frame_lines[j].line_number -= lines_removed as i32;
                self.frame_lines[j].y_offset -= lines_removed as f64 * ts_line_h;
            }
        }

        self.rust_cursor_line = self.frame_lines[start_idx].line_number;
        self.rust_col = start_col;
    }

    /// Collect the selected text as a String.
    fn get_selected_text(&self) -> String {
        let anchor = match self.rust_sel_anchor {
            Some(a) => a,
            None => return String::new(),
        };

        let (anchor_line, anchor_col) = anchor;
        let anchor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == anchor_line)
        {
            Some(i) => i,
            None => return String::new(),
        };
        let cursor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == self.rust_cursor_line)
        {
            Some(i) => i,
            None => return String::new(),
        };

        let (start_idx, start_col, end_idx, end_col) =
            if anchor_idx < cursor_idx || (anchor_idx == cursor_idx && anchor_col <= self.rust_col) {
                (anchor_idx, anchor_col, cursor_idx, self.rust_col)
            } else {
                (cursor_idx, self.rust_col, anchor_idx, anchor_col)
            };

        if start_idx == end_idx {
            let lo = start_col.min(self.frame_lines[start_idx].text.len());
            let hi = end_col.min(self.frame_lines[start_idx].text.len());
            self.frame_lines[start_idx].text[lo..hi].to_string()
        } else {
            let mut result = String::new();
            let first_lo = start_col.min(self.frame_lines[start_idx].text.len());
            result.push_str(&self.frame_lines[start_idx].text[first_lo..]);
            for i in (start_idx + 1)..end_idx {
                result.push('\n');
                result.push_str(&self.frame_lines[i].text);
            }
            result.push('\n');
            let last_hi = end_col.min(self.frame_lines[end_idx].text.len());
            result.push_str(&self.frame_lines[end_idx].text[..last_hi]);
            result
        }
    }

    /// Write text to the system clipboard using GTK4's clipboard API.
    pub fn write_to_clipboard(&mut self, text: &str) {
        // Cache locally to avoid Wayland deadlock on subsequent paste.
        self.clipboard_buf = text.to_string();
        if let Some(display) = gdk4::Display::default() {
            display.clipboard().set_text(text);
        }
    }

    /// Read plain text from the system clipboard synchronously.
    ///
    /// On Wayland, when our app owns the clipboard (is_local() == true), calling
    /// wl-paste as a subprocess deadlocks: wl-paste asks the compositor for data,
    /// the compositor asks us, but our event loop is blocked waiting for the subprocess.
    /// Fix: return our cached clipboard_buf when we are the owner.
    pub fn read_from_clipboard(&self) -> String {
        // If we own the clipboard, return internal buffer (no Wayland deadlock).
        if let Some(display) = gdk4::Display::default() {
            if display.clipboard().is_local() {
                return self.clipboard_buf.clone();
            }
        }
        // External clipboard owner: subprocess is safe (external process serves data).
        if let Ok(output) = std::process::Command::new("wl-paste")
            .arg("--no-newline")
            .output()
        {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n");
            }
        }
        if let Ok(output) = std::process::Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .output()
        {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n");
            }
        }
        if let Ok(output) = std::process::Command::new("xsel")
            .arg("--clipboard")
            .arg("--output")
            .output()
        {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n");
            }
        }
        String::new()
    }

    /// Rebuild `self.selections` from the current anchor + cursor positions.
    pub fn sync_selection_rects(&mut self) {
        self.selections.clear();
        let anchor = match self.rust_sel_anchor {
            Some(a) => a,
            None => return,
        };

        let (anchor_line, anchor_col) = anchor;
        let anchor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == anchor_line)
        {
            Some(i) => i,
            None => return,
        };
        let cursor_idx = match self.frame_lines.iter()
            .position(|l| l.line_number == self.rust_cursor_line)
        {
            Some(i) => i,
            None => return,
        };

        // If anchor == cursor, no selection to show.
        if anchor_idx == cursor_idx && anchor_col == self.rust_col {
            return;
        }

        let (start_idx, start_col, end_idx, end_col) =
            if anchor_idx < cursor_idx || (anchor_idx == cursor_idx && anchor_col <= self.rust_col) {
                (anchor_idx, anchor_col, cursor_idx, self.rust_col)
            } else {
                (cursor_idx, self.rust_col, anchor_idx, anchor_col)
            };

        let gutter_w = self.gutter_width();
        let line_h = self.ts_line_height();
        let char_w = self.renderer.char_width;

        let mut rects: Vec<SelectionRegion> = Vec::new();
        for i in start_idx..=end_idx {
            let y_off = self.frame_lines[i].y_offset;
            let text_len = self.frame_lines[i].text.len();
            let x1 = if i == start_idx {
                let col = start_col.min(text_len);
                gutter_w + self.renderer.measure_text(&self.frame_lines[i].text[..col])
            } else {
                gutter_w
            };
            let x2 = if i == end_idx {
                let col = end_col.min(text_len);
                gutter_w + self.renderer.measure_text(&self.frame_lines[i].text[..col])
            } else {
                gutter_w + self.renderer.measure_text(&self.frame_lines[i].text) + char_w
            };
            let w = (x2 - x1).max(char_w);
            rects.push(SelectionRegion { x: x1, y: y_off, w, h: line_h });
        }
        self.selections = rects;
    }

    /// Collapse the selection, placing the cursor at the start (lower) position.
    fn clear_selection_keep_cursor_at_start(&mut self) {
        let anchor_opt = self.rust_sel_anchor.take();
        if let Some((anchor_line, anchor_col)) = anchor_opt {
            let anchor_idx = self.frame_lines.iter()
                .position(|l| l.line_number == anchor_line);
            let cursor_idx = self.frame_lines.iter()
                .position(|l| l.line_number == self.rust_cursor_line);
            if let (Some(ai), Some(_ci)) = (anchor_idx, cursor_idx) {
                if ai < _ci || (ai == _ci && anchor_col < self.rust_col) {
                    let anchor_y = self.frame_lines[ai].y_offset;
                    self.rust_cursor_line = anchor_line;
                    self.rust_col = anchor_col;
                    if let Some(ref mut c) = self.cursor { c.y = anchor_y; }
                }
            }
        }
        self.selections.clear();
    }

    /// Collapse the selection, placing the cursor at the end (higher) position.
    fn clear_selection_keep_cursor_at_end(&mut self) {
        let anchor_opt = self.rust_sel_anchor.take();
        if let Some((anchor_line, anchor_col)) = anchor_opt {
            let anchor_idx = self.frame_lines.iter()
                .position(|l| l.line_number == anchor_line);
            let cursor_idx = self.frame_lines.iter()
                .position(|l| l.line_number == self.rust_cursor_line);
            if let (Some(ai), Some(_ci)) = (anchor_idx, cursor_idx) {
                if ai > _ci || (ai == _ci && anchor_col > self.rust_col) {
                    let anchor_y = self.frame_lines[ai].y_offset;
                    self.rust_cursor_line = anchor_line;
                    self.rust_col = anchor_col;
                    if let Some(ref mut c) = self.cursor { c.y = anchor_y; }
                }
            }
        }
        self.selections.clear();
    }

    // ── Drawing ──────────────────────────────────────────────────

    /// Compute gutter width matching the TS GutterRenderer formula:
    /// max(2, digits) * charWidth + 36  (16px fold + 16px padding + 4px diff)
    pub fn gutter_width(&self) -> f64 {
        let digits = if self.max_line_number <= 0 {
            2
        } else {
            let d = (self.max_line_number as f64).log10().floor() as i32 + 1;
            d.max(2)
        };
        digits as f64 * self.renderer.char_width + 36.0
    }

    /// Main draw method called from the GTK DrawingArea's draw function.
    pub fn draw(&self, cr: &cairo::Context, width: f64, height: f64) {
        // 1. Fill background
        cr.set_source_rgb(
            self.background_color.0,
            self.background_color.1,
            self.background_color.2,
        );
        cr.rectangle(0.0, 0.0, width, height);
        let _ = cr.fill();

        let gutter_w = self.gutter_width();

        // 2. Draw gutter background
        cr.set_source_rgb(
            self.gutter_bg_color.0,
            self.gutter_bg_color.1,
            self.gutter_bg_color.2,
        );
        cr.rectangle(0.0, 0.0, gutter_w, height);
        let _ = cr.fill();

        // 3. Draw each buffered line
        for line in &self.frame_lines {
            // Draw line number in gutter (right-aligned)
            let num_str = format!("{}", line.line_number);
            let num_width = self.renderer.char_width * num_str.len() as f64;
            // Right-align: gutter_w - 20px (fold+diff area) - num_width
            let num_x = gutter_w - 20.0 - num_width;

            text_renderer::draw_text(
                cr,
                &num_str,
                num_x,
                line.y_offset,
                &self.renderer.normal,
                &self.renderer.pango_context,
                self.gutter_fg_color,
            );

            // Draw text content with tokens starting at gutter_w
            text_renderer::draw_line(
                cr,
                &line.text,
                &line.tokens,
                gutter_w,
                line.y_offset,
                &self.renderer,
                self.default_text_color,
            );
        }

        // 4. Draw decorations (underlines, backgrounds)
        for decor in &self.decorations {
            let (r, g, b) = text_renderer::parse_hex_color(&decor.color);
            match decor.kind.as_str() {
                "background" => {
                    cr.set_source_rgba(r, g, b, 0.3);
                    cr.rectangle(decor.x, decor.y, decor.w, decor.h);
                    let _ = cr.fill();
                }
                "underline" => {
                    cr.set_source_rgb(r, g, b);
                    cr.set_line_width(1.0);
                    let y_bottom = decor.y + decor.h - 1.0;
                    cr.move_to(decor.x, y_bottom);
                    cr.line_to(decor.x + decor.w, y_bottom);
                    let _ = cr.stroke();
                }
                "underline-wavy" => {
                    cr.set_source_rgb(r, g, b);
                    cr.set_line_width(1.0);
                    let y_base = decor.y + decor.h - 1.0;
                    let wave_height = 2.0;
                    let wave_len = 4.0;
                    let mut x = decor.x;
                    cr.move_to(x, y_base);
                    let mut up = true;
                    while x < decor.x + decor.w {
                        let y_target = if up { y_base - wave_height } else { y_base };
                        x += wave_len;
                        cr.line_to(x, y_target);
                        up = !up;
                    }
                    let _ = cr.stroke();
                }
                _ => {}
            }
        }

        // 5. Draw selection rectangles
        for sel in &self.selections {
            cr.set_source_rgba(
                self.selection_color.0,
                self.selection_color.1,
                self.selection_color.2,
                self.selection_color.3,
            );
            cr.rectangle(sel.x, sel.y, sel.w, sel.h);
            let _ = cr.fill();
        }

        // 6. Draw ghost text
        if let Some(ref ghost) = self.ghost_text {
            text_renderer::draw_text(
                cr,
                &ghost.text,
                ghost.x,
                ghost.y,
                &self.renderer.normal,
                &self.renderer.pango_context,
                ghost.color,
            );
        }

        // 7. Draw cursors
        self.draw_cursors(cr);
    }

    fn draw_cursors(&self, cr: &cairo::Context) {
        let draw_one = |cursor: &CursorData| {
            let (w, h) = match cursor.style {
                0 => (2.0, self.renderer.line_height), // Line cursor
                1 => (self.renderer.char_width, self.renderer.line_height), // Block cursor
                2 => (self.renderer.char_width, 2.0),  // Underline cursor
                _ => (2.0, self.renderer.line_height),
            };
            let y = if cursor.style == 2 {
                cursor.y + self.renderer.line_height - 2.0
            } else {
                cursor.y
            };
            cr.set_source_rgb(
                self.cursor_color.0,
                self.cursor_color.1,
                self.cursor_color.2,
            );
            cr.rectangle(cursor.x, y, w, h);
            let _ = cr.fill();
        };

        // Primary cursor
        if let Some(ref c) = self.cursor {
            draw_one(c);
        }

        // Multi-cursors
        for c in &self.cursors {
            draw_one(c);
        }
    }
}
