//! EditorView: top-level state for an iOS/iPadOS editor instance.
//!
//! Owns the FontSet, UIView, and frame buffer. Between beginFrame/endFrame
//! the TS coordinator pushes line data, cursor, and selection state. On
//! endFrame the UIView is invalidated, and drawRect: calls draw() which
//! paints everything via Core Graphics / Core Text.
//!
//! In Perry AOT mode, TypeScript's RAF loop never fires after startup.
//! All interactive editing (typing, newline, backspace, selection, scroll,
//! clipboard) is handled Rust-side by mutating frame_lines in place.

use core_graphics::context::CGContext;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use objc::runtime::Object;
use serde::Deserialize;

use std::ffi::{c_char, CString};
use std::ptr::null_mut;

use crate::text_renderer::{self, FontSet, RenderToken};
use crate::view;

/// Alias for Objective-C object pointer (replaces cocoa::base::id on iOS).
type Id = *mut Object;

/// Null Objective-C pointer.
const NIL: Id = null_mut();

// ── Callback types ──────────────────────────────────────────────────────────

/// Called when the user types printable text.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);

/// Called when an action selector fires (delete, enter, arrows, etc.).
pub type ActionCallback = extern "C" fn(view: *mut EditorView, selector: *const c_char);

/// Called when the user taps in the editor view.
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user pans (scroll gesture).
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

// ── Event queue (for TypeScript polling) ────────────────────────────────────

pub mod event_type {
    pub const TEXT: i32 = 1;
    pub const ACTION: i32 = 2;
    pub const SCROLL: i32 = 3;
    pub const MOUSE_DOWN: i32 = 4;
}

pub mod action_id {
    pub const MOVE_LEFT: i32 = 1;
    pub const MOVE_RIGHT: i32 = 2;
    pub const MOVE_UP: i32 = 3;
    pub const MOVE_DOWN: i32 = 4;
    pub const MOVE_BOL: i32 = 5;
    pub const MOVE_EOL: i32 = 6;
    pub const MOVE_BOD: i32 = 7;
    pub const MOVE_EOD: i32 = 8;
    pub const INSERT_NEWLINE: i32 = 9;
    pub const DELETE_BACKWARD: i32 = 10;
    pub const DELETE_FORWARD: i32 = 11;
    pub const INSERT_TAB: i32 = 12;
    pub const MOVE_WORD_LEFT: i32 = 13;
    pub const MOVE_WORD_RIGHT: i32 = 14;
    pub const MOVE_LEFT_SEL: i32 = 15;
    pub const MOVE_RIGHT_SEL: i32 = 16;
    pub const MOVE_UP_SEL: i32 = 17;
    pub const MOVE_DOWN_SEL: i32 = 18;
    pub const MOVE_BOL_SEL: i32 = 19;
    pub const MOVE_EOL_SEL: i32 = 20;
    pub const SELECT_ALL: i32 = 21;
    pub const CUT: i32 = 22;
    pub const COPY: i32 = 23;
    pub const PASTE: i32 = 24;
    pub const UNDO: i32 = 25;
    pub const REDO: i32 = 26;
    pub const DELETE_WORD_BACKWARD: i32 = 27;
    pub const PAGE_UP: i32 = 28;
    pub const PAGE_DOWN: i32 = 29;
}

pub struct PendingEvent {
    pub event_type: i32,
    pub char_code: u32,
    pub action_id: i32,
    pub x: f64,
    pub y: f64,
}

fn selector_to_action_id(sel: &str) -> i32 {
    match sel {
        "moveLeft:"                                   => action_id::MOVE_LEFT,
        "moveRight:"                                  => action_id::MOVE_RIGHT,
        "moveUp:"                                     => action_id::MOVE_UP,
        "moveDown:"                                   => action_id::MOVE_DOWN,
        "moveToBeginningOfLine:"
        | "moveToLeftEndOfLine:"                      => action_id::MOVE_BOL,
        "moveToEndOfLine:"
        | "moveToRightEndOfLine:"                     => action_id::MOVE_EOL,
        "moveToBeginningOfDocument:"                  => action_id::MOVE_BOD,
        "moveToEndOfDocument:"                        => action_id::MOVE_EOD,
        "insertNewline:"                              => action_id::INSERT_NEWLINE,
        "deleteBackward:"                             => action_id::DELETE_BACKWARD,
        "deleteForward:"                              => action_id::DELETE_FORWARD,
        "insertTab:"                                  => action_id::INSERT_TAB,
        "moveWordLeft:" | "moveWordBackward:"         => action_id::MOVE_WORD_LEFT,
        "moveWordRight:" | "moveWordForward:"         => action_id::MOVE_WORD_RIGHT,
        "moveLeftAndModifySelection:"                 => action_id::MOVE_LEFT_SEL,
        "moveRightAndModifySelection:"                => action_id::MOVE_RIGHT_SEL,
        "moveUpAndModifySelection:"                   => action_id::MOVE_UP_SEL,
        "moveDownAndModifySelection:"                 => action_id::MOVE_DOWN_SEL,
        "moveToBeginningOfLineAndModifySelection:"    => action_id::MOVE_BOL_SEL,
        "moveToEndOfLineAndModifySelection:"          => action_id::MOVE_EOL_SEL,
        "selectAll:"                                  => action_id::SELECT_ALL,
        "cut:"                                        => action_id::CUT,
        "copy:"                                       => action_id::COPY,
        "paste:"                                      => action_id::PASTE,
        "undo:"                                       => action_id::UNDO,
        "redo:"                                       => action_id::REDO,
        "deleteWordBackward:"                         => action_id::DELETE_WORD_BACKWARD,
        "pageUp:" | "scrollPageUp:"                   => action_id::PAGE_UP,
        "pageDown:" | "scrollPageDown:"               => action_id::PAGE_DOWN,
        _                                             => 0,
    }
}

// ── Data structures ─────────────────────────────────────────────────────────

pub struct ContextMenuItem {
    pub title: String,
    pub action_id: String,
}

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

struct LineRenderData {
    line_number: i32,
    text: String,
    tokens: Vec<RenderToken>,
    y_offset: f64,
}

struct GhostTextData {
    text: String,
    x: f64,
    y: f64,
    color: (f64, f64, f64),
}

// ── EditorView ──────────────────────────────────────────────────────────────

pub struct EditorView {
    pub renderer: FontSet,
    uiview: Id,
    pub parent_view: *mut std::ffi::c_void,
    width: f64,
    height: f64,

    // Frame buffer (populated between beginFrame/endFrame)
    frame_lines: Vec<LineRenderData>,
    cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    ghost_text: Option<GhostTextData>,
    scroll_offset: f64,
    max_line_number: i32,

    // Input callbacks (used by standalone demo / non-Perry mode)
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (for TypeScript polling in Perry mode)
    pub pending_events: Vec<PendingEvent>,
    pub event_callback: Option<extern "C" fn()>,

    // Rust-side interactive state (Perry AOT mode — RAF never fires)
    rust_cursor_line: i32,
    rust_col: usize,
    rust_sel_anchor: Option<(i32, usize)>,  // (line_number, byte_col)
    user_has_clicked: bool,
    initial_top_y: Option<f64>,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,

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
        let renderer = FontSet::new("Menlo", 14.0);

        EditorView {
            renderer,
            uiview: NIL,
            parent_view: null_mut(),
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
            context_menu_items: Vec::new(),
            background_color: (0.118, 0.118, 0.118),
            gutter_bg_color:  (0.118, 0.118, 0.118),
            gutter_fg_color:  (0.525, 0.525, 0.525),
            default_text_color: (0.843, 0.843, 0.843),
            selection_color: (0.153, 0.306, 0.482, 0.4),
            cursor_color: (0.918, 0.918, 0.918),
        }
    }

    pub fn init_uiview(&mut self) {
        let self_ptr = self as *mut EditorView;
        self.uiview = view::create_editor_uiview(self.width, self.height, self_ptr);
    }

    pub fn uiview(&self) -> Id { self.uiview }

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    /// Called from UIKeyInput insertText: (normal characters) or from doCommandBySelector:.
    pub fn on_text_input(&mut self, text: &str) {
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
            return;
        }
        // Rust-side editing in Perry mode.
        if let Some(idx) = self.cursor_line_idx() {
            for ch in text.chars() {
                let col = self.rust_col.min(self.frame_lines[idx].text.len());
                self.frame_lines[idx].text.insert(col, ch);
                self.rust_col = col + ch.len_utf8();
            }
            self.frame_lines[idx].tokens =
                crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
            self.sync_cursor_x();
            view::invalidate_view(self.uiview);
        }
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

    /// Called from UIKeyInput deleteBackward, doCommandBySelector:, etc.
    pub fn on_action(&mut self, selector: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_sel) = CString::new(selector) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_sel.as_ptr());
            }
            return;
        }

        let mut dirty = false;
        match selector {
            // ── Editing ──────────────────────────────────────────────────────
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

            // ── Plain movement (clears selection) ─────────────────────────────
            "moveLeft:" => {
                self.clear_selection_keep_cursor_at_start();
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col > 0 {
                        let col = self.rust_col;
                        let ch_len = self.frame_lines[idx].text[..col]
                            .chars().next_back().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col -= ch_len;
                        dirty = true;
                    } else if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = prev.text.len();
                        if let Some(ref mut c) = self.cursor { c.y = prev.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = next.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = prev.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = next.y_offset; }
                        dirty = true;
                    }
                }
            }
            "moveToBeginningOfLine:" | "moveToLeftEndOfLine:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                self.rust_col = 0;
                dirty = true;
            }
            "moveToEndOfLine:" | "moveToRightEndOfLine:" => {
                self.rust_sel_anchor = None;
                self.selections.clear();
                if let Some(idx) = self.cursor_line_idx() {
                    self.rust_col = self.frame_lines[idx].text.len();
                    dirty = true;
                }
            }

            // ── Selection-extending movement ───────────────────────────────────
            "moveLeftAndModifySelection:" => {
                if self.rust_sel_anchor.is_none() {
                    self.rust_sel_anchor = Some((self.rust_cursor_line, self.rust_col));
                }
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col > 0 {
                        let ch_len = self.frame_lines[idx].text[..self.rust_col]
                            .chars().next_back().map(|c| c.len_utf8()).unwrap_or(1);
                        self.rust_col -= ch_len;
                        dirty = true;
                    } else if idx > 0 {
                        let prev = &self.frame_lines[idx - 1];
                        self.rust_cursor_line = prev.line_number;
                        self.rust_col = prev.text.len();
                        if let Some(ref mut c) = self.cursor { c.y = prev.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = next.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = prev.y_offset; }
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
                        if let Some(ref mut c) = self.cursor { c.y = next.y_offset; }
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

            // ── Select all ────────────────────────────────────────────────────
            "selectAll:" => {
                if !self.frame_lines.is_empty() {
                    let first_ln = self.frame_lines[0].line_number;
                    self.rust_sel_anchor = Some((first_ln, 0));
                    let last = &self.frame_lines[self.frame_lines.len() - 1];
                    self.rust_cursor_line = last.line_number;
                    self.rust_col = last.text.len();
                    if let Some(ref mut c) = self.cursor { c.y = last.y_offset; }
                    self.sync_selection_rects();
                    dirty = true;
                }
            }

            // ── Clipboard ─────────────────────────────────────────────────────
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
                                let new_ln = self.frame_lines[idx].line_number + 1;
                                let new_y  = self.frame_lines[idx].y_offset + ts_line_h;
                                let new_tokens = crate::tokenizer::tokenize_line(&right_text);
                                for j in (idx + 1)..self.frame_lines.len() {
                                    self.frame_lines[j].line_number += 1;
                                    self.frame_lines[j].y_offset += ts_line_h;
                                }
                                self.frame_lines.insert(idx + 1, LineRenderData {
                                    line_number: new_ln,
                                    text: right_text,
                                    tokens: new_tokens,
                                    y_offset: new_y,
                                });
                                self.rust_cursor_line = new_ln;
                                self.rust_col = 0;
                            }
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
            view::invalidate_view(self.uiview);
        }
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    /// Called from UIView touchesBegan: — tap to position cursor.
    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
            return;
        }
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
            // Set anchor so a subsequent drag extends the selection from here.
            self.rust_sel_anchor = Some((line_number, best_byte_col));
            self.selections.clear();

            let cursor_x = gutter_w + self.renderer.measure_text(&line.text[..self.rust_col]);
            let cursor_y = line.y_offset;
            self.cursor = Some(CursorData { x: cursor_x, y: cursor_y, style: 0 });

            self.pending_events.push(PendingEvent {
                event_type: event_type::MOUSE_DOWN,
                char_code: 0,
                action_id: 0,
                x,
                y,
            });
            view::invalidate_view(self.uiview);
        }
    }

    /// Called from UIView touchesMoved: (single-finger drag) — extends selection.
    pub fn on_mouse_drag(&mut self, x: f64, y: f64) {
        if self.mouse_down_callback.is_some() {
            return;
        }
        if self.frame_lines.is_empty() {
            return;
        }
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
        view::invalidate_view(self.uiview);
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from UIView two-finger pan (scroll).
    /// dy convention: negative = finger moved up = content scrolls up.
    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
            return;
        }
        if self.frame_lines.is_empty() {
            return;
        }

        let ts_line_h = self.ts_line_height();
        let n = self.frame_lines.len() as f64;
        let total_content_h = n * ts_line_h;

        let actual_dy = if let Some(max_first_y) = self.initial_top_y {
            if total_content_h <= self.height {
                0.0
            } else {
                let min_first_y = max_first_y + self.height - total_content_h;
                let proposed = self.frame_lines[0].y_offset + dy;
                let clamped = proposed.clamp(min_first_y, max_first_y);
                clamped - self.frame_lines[0].y_offset
            }
        } else {
            dy
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
        view::invalidate_view(self.uiview);
    }

    pub fn add_context_menu_item(&mut self, title: &str, action_id: &str) {
        self.context_menu_items.push(ContextMenuItem {
            title: title.to_string(),
            action_id: action_id.to_string(),
        });
    }

    pub fn clear_context_menu_items(&mut self) { self.context_menu_items.clear(); }
    pub fn context_menu_items(&self) -> &[ContextMenuItem] { &self.context_menu_items }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.renderer = FontSet::new(family, size);
        if self.uiview != NIL {
            view::invalidate_view(self.uiview);
        }
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        self.renderer.measure_text(text)
    }

    // ── Frame buffer API ─────────────────────────────────────────────────────

    pub fn begin_frame(&mut self) {
        self.frame_lines.clear();
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
        let tokens: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();
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
            if let Some(line) = self.frame_lines.iter().find(|l| l.line_number == self.rust_cursor_line) {
                let cursor_x = self.gutter_width() + self.renderer.measure_text(
                    &line.text[..self.rust_col.min(line.text.len())]
                );
                self.cursor = Some(CursorData { x: cursor_x, y: line.y_offset, style: 0 });
            }
            return;
        }
        self.cursor = Some(CursorData { x, y, style });
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

    pub fn scroll(&mut self, offset_y: f64) { self.scroll_offset = offset_y; }

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
        if self.initial_top_y.is_none() {
            if let Some(first) = self.frame_lines.first() {
                self.initial_top_y = Some(first.y_offset);
            }
        }
        if self.uiview != NIL {
            view::invalidate_view(self.uiview);
        }
    }

    pub fn invalidate(&mut self) {
        if self.uiview != NIL {
            view::invalidate_view(self.uiview);
        }
    }

    pub fn attach_to_parent(&mut self, parent: *mut std::ffi::c_void) {
        self.parent_view = parent;
        if self.uiview != NIL && !parent.is_null() {
            unsafe {
                let parent_view = parent as Id;
                let _: () = msg_send![parent_view, addSubview: self.uiview];
                let bounds: CGRect = msg_send![parent_view, bounds];
                let _: () = msg_send![self.uiview, setFrame: bounds];
            }
        }
    }

    // ── Rust-side editing helpers ────────────────────────────────────────────

    fn cursor_line_idx(&self) -> Option<usize> {
        self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line)
    }

    fn sync_cursor_x(&mut self) {
        let gutter_w = self.gutter_width();
        if let Some(idx) = self.cursor_line_idx() {
            let text_len = self.frame_lines[idx].text.len();
            let col = self.rust_col.min(text_len);
            let x = gutter_w + self.renderer.measure_text(&self.frame_lines[idx].text[..col]);
            let y = self.frame_lines[idx].y_offset;
            if let Some(ref mut c) = self.cursor {
                c.x = x;
                c.y = y;
            }
        } else {
            let x = gutter_w + self.rust_col as f64 * self.renderer.char_width;
            if let Some(ref mut c) = self.cursor {
                c.x = x;
            }
        }
    }

    fn ts_line_height(&self) -> f64 {
        if self.frame_lines.len() >= 2 {
            (self.frame_lines[1].y_offset - self.frame_lines[0].y_offset).abs()
        } else {
            self.renderer.line_height
        }
    }

    fn delete_selection_if_any(&mut self) {
        let anchor = match self.rust_sel_anchor.take() {
            Some(a) => a,
            None => return,
        };
        self.selections.clear();

        let (anchor_line, anchor_col) = anchor;
        let cursor_line = self.rust_cursor_line;
        let cursor_col = self.rust_col;

        let anchor_idx = match self.frame_lines.iter().position(|l| l.line_number == anchor_line) {
            Some(i) => i,
            None => return,
        };
        let cursor_idx = match self.frame_lines.iter().position(|l| l.line_number == cursor_line) {
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

    fn get_selected_text(&self) -> String {
        let anchor = match self.rust_sel_anchor {
            Some(a) => a,
            None => return String::new(),
        };

        let (anchor_line, anchor_col) = anchor;
        let anchor_idx = match self.frame_lines.iter().position(|l| l.line_number == anchor_line) {
            Some(i) => i,
            None => return String::new(),
        };
        let cursor_idx = match self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line) {
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

    /// Write text to UIPasteboard (iOS/iPadOS system clipboard).
    fn write_to_clipboard(&self, text: &str) {
        if let Ok(cstr) = CString::new(text) {
            unsafe {
                let ns_str_cls = objc::runtime::Class::get("NSString").unwrap();
                let ns_str: Id = msg_send![ns_str_cls, alloc];
                let ns_str: Id = msg_send![ns_str, initWithUTF8String: cstr.as_ptr()];
                let pb_cls = objc::runtime::Class::get("UIPasteboard").unwrap();
                let pb: Id = msg_send![pb_cls, generalPasteboard];
                let _: () = msg_send![pb, setString: ns_str];
            }
        }
    }

    /// Read plain text from UIPasteboard.
    fn read_from_clipboard(&self) -> String {
        unsafe {
            let pb_cls = objc::runtime::Class::get("UIPasteboard").unwrap();
            let pb: Id = msg_send![pb_cls, generalPasteboard];
            let ns_str: Id = msg_send![pb, string];
            if ns_str == NIL {
                return String::new();
            }
            let ptr: *const c_char = msg_send![ns_str, UTF8String];
            if ptr.is_null() {
                return String::new();
            }
            std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }

    fn sync_selection_rects(&mut self) {
        self.selections.clear();
        let anchor = match self.rust_sel_anchor {
            Some(a) => a,
            None => return,
        };

        let (anchor_line, anchor_col) = anchor;
        let anchor_idx = match self.frame_lines.iter().position(|l| l.line_number == anchor_line) {
            Some(i) => i,
            None => return,
        };
        let cursor_idx = match self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line) {
            Some(i) => i,
            None => return,
        };

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

    fn clear_selection_keep_cursor_at_start(&mut self) {
        let anchor_opt = self.rust_sel_anchor.take();
        if let Some((anchor_line, anchor_col)) = anchor_opt {
            let anchor_idx = self.frame_lines.iter().position(|l| l.line_number == anchor_line);
            let cursor_idx = self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line);
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

    fn clear_selection_keep_cursor_at_end(&mut self) {
        let anchor_opt = self.rust_sel_anchor.take();
        if let Some((anchor_line, anchor_col)) = anchor_opt {
            let anchor_idx = self.frame_lines.iter().position(|l| l.line_number == anchor_line);
            let cursor_idx = self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line);
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

    // ── Drawing ──────────────────────────────────────────────────────────────

    fn gutter_width(&self) -> f64 {
        let digits = if self.max_line_number <= 0 {
            2
        } else {
            let d = (self.max_line_number as f64).log10().floor() as i32 + 1;
            d.max(2)
        };
        digits as f64 * self.renderer.char_width + 36.0
    }

    pub fn draw(&self, raw_ctx: core_graphics::sys::CGContextRef, _dirty_rect: CGRect) {
        let ctx = unsafe { CGContext::from_existing_context_ptr(raw_ctx) };
        self.draw_with_context(&ctx);
    }

    fn draw_with_context(&self, ctx: &CGContext) {
        let bounds = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(self.width, self.height),
        );

        ctx.set_rgb_fill_color(
            self.background_color.0, self.background_color.1, self.background_color.2, 1.0,
        );
        ctx.fill_rect(bounds);

        let gutter_w = self.gutter_width();
        ctx.set_rgb_fill_color(
            self.gutter_bg_color.0, self.gutter_bg_color.1, self.gutter_bg_color.2, 1.0,
        );
        ctx.fill_rect(CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(gutter_w, self.height)));

        for line in &self.frame_lines {
            let num_str = format!("{}", line.line_number);
            let num_width = self.renderer.char_width * num_str.len() as f64;
            let num_x = gutter_w - 20.0 - num_width;
            text_renderer::draw_text(
                ctx, &num_str, num_x, line.y_offset,
                &self.renderer.normal, self.renderer.ascent, self.gutter_fg_color,
            );
            text_renderer::draw_line(
                ctx, &line.text, &line.tokens, gutter_w, line.y_offset,
                &self.renderer, self.default_text_color,
            );
        }

        for decor in &self.decorations {
            let (r, g, b) = text_renderer::parse_hex_color(&decor.color);
            match decor.kind.as_str() {
                "background" => {
                    ctx.set_rgb_fill_color(r, g, b, 0.3);
                    ctx.fill_rect(CGRect::new(
                        &CGPoint::new(decor.x, decor.y),
                        &CGSize::new(decor.w, decor.h),
                    ));
                }
                "underline" => {
                    ctx.set_rgb_stroke_color(r, g, b, 1.0);
                    ctx.set_line_width(1.0);
                    let y_bottom = decor.y + decor.h - 1.0;
                    ctx.move_to_point(decor.x, y_bottom);
                    ctx.add_line_to_point(decor.x + decor.w, y_bottom);
                    ctx.stroke_path();
                }
                "underline-wavy" => {
                    ctx.set_rgb_stroke_color(r, g, b, 1.0);
                    ctx.set_line_width(1.0);
                    let y_base = decor.y + decor.h - 1.0;
                    let mut x = decor.x;
                    ctx.move_to_point(x, y_base);
                    let mut up = true;
                    while x < decor.x + decor.w {
                        let y_target = if up { y_base - 2.0 } else { y_base };
                        x += 4.0;
                        ctx.add_line_to_point(x, y_target);
                        up = !up;
                    }
                    ctx.stroke_path();
                }
                _ => {}
            }
        }

        for sel in &self.selections {
            ctx.set_rgb_fill_color(
                self.selection_color.0, self.selection_color.1,
                self.selection_color.2, self.selection_color.3,
            );
            ctx.fill_rect(CGRect::new(
                &CGPoint::new(sel.x, sel.y), &CGSize::new(sel.w, sel.h),
            ));
        }

        if let Some(ref ghost) = self.ghost_text {
            text_renderer::draw_text(
                ctx, &ghost.text, ghost.x, ghost.y,
                &self.renderer.normal, self.renderer.ascent, ghost.color,
            );
        }

        self.draw_cursors(ctx);
    }

    fn draw_cursors(&self, ctx: &CGContext) {
        let draw_one = |cursor: &CursorData| {
            let (w, h) = match cursor.style {
                0 => (2.0, self.renderer.line_height),
                1 => (self.renderer.char_width, self.renderer.line_height),
                2 => (self.renderer.char_width, 2.0),
                _ => (2.0, self.renderer.line_height),
            };
            let y = if cursor.style == 2 {
                cursor.y + self.renderer.line_height - 2.0
            } else {
                cursor.y
            };
            ctx.set_rgb_fill_color(
                self.cursor_color.0, self.cursor_color.1, self.cursor_color.2, 1.0,
            );
            ctx.fill_rect(CGRect::new(&CGPoint::new(cursor.x, y), &CGSize::new(w, h)));
        };

        if let Some(ref c) = self.cursor { draw_one(c); }
        for c in &self.cursors { draw_one(c); }
    }
}

impl Drop for EditorView {
    fn drop(&mut self) {
        if self.uiview != NIL {
            unsafe { let _: () = msg_send![self.uiview, removeFromSuperview]; }
        }
    }
}
