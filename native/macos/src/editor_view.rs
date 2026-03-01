//! EditorView: top-level state for a macOS editor instance.
//!
//! Owns the FontSet, NSView, and frame buffer. Between beginFrame/endFrame
//! the TS coordinator pushes line data, cursor, and selection state. On
//! endFrame the NSView is invalidated, and drawRect: calls draw() which
//! paints everything via Core Graphics / Core Text.

use cocoa::base::{id, nil};
use cocoa::foundation::NSRect;
use core_graphics::context::CGContext;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use serde::Deserialize;

use std::ffi::{c_char, CString};

use crate::text_renderer::{self, FontSet, RenderToken};
use crate::view;

// ── Callback types ──────────────────────────────────────────────

/// Called when the user types printable text. `text` is a null-terminated UTF-8 C string.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);

/// Called when a macOS action selector fires (arrow keys, delete, enter, etc.).
/// `selector` is the selector name as a null-terminated UTF-8 C string (e.g. "moveLeft:").
pub type ActionCallback = extern "C" fn(view: *mut EditorView, selector: *const c_char);

/// Called when the user clicks in the editor view. `x` and `y` are in view coordinates.
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user scrolls. `dx`/`dy` are pixel deltas (dy positive = scroll down).
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

// ── Event queue (for TypeScript polling) ────────────────────────

/// Event type constants (returned as f64 via FFI).
pub mod event_type {
    pub const TEXT: i32 = 1;
    pub const ACTION: i32 = 2;
    pub const SCROLL: i32 = 3;
    pub const MOUSE_DOWN: i32 = 4;
}

/// Action ID constants — map macOS selectors to integers the TS layer understands.
pub mod action_id {
    pub const MOVE_LEFT: i32 = 1;
    pub const MOVE_RIGHT: i32 = 2;
    pub const MOVE_UP: i32 = 3;
    pub const MOVE_DOWN: i32 = 4;
    pub const MOVE_BOL: i32 = 5;   // beginning of line
    pub const MOVE_EOL: i32 = 6;   // end of line
    pub const MOVE_BOD: i32 = 7;   // beginning of document
    pub const MOVE_EOD: i32 = 8;   // end of document
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

/// A buffered input event for TypeScript polling.
pub struct PendingEvent {
    pub event_type: i32,
    pub char_code: u32,  // Unicode codepoint for TEXT events
    pub action_id: i32,  // Action ID for ACTION events
    pub x: f64,          // view-x for MOUSE_DOWN, dx for SCROLL
    pub y: f64,          // view-y for MOUSE_DOWN, dy for SCROLL
}

/// Map a macOS action selector name to an action ID integer.
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
        _                                             => 0,  // unknown selector
    }
}

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

// ── EditorView ───────────────────────────────────────────────────

/// Top-level editor view state.
///
/// This is the object behind the opaque `*mut EditorView` pointer
/// returned by `hone_editor_create()`.
pub struct EditorView {
    pub renderer: FontSet,
    nsview: id,
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

    // Input callbacks (used by the standalone Rust demo)
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (used by the TypeScript polling API)
    pub pending_events: Vec<PendingEvent>,
    // Zero-argument callback Perry registers; called synchronously when an event is queued.
    pub event_callback: Option<extern "C" fn()>,

    // Rust-side interactive state.
    // Perry's AOT runtime doesn't fire setInterval/RAF before App() starts, so
    // TypeScript can't poll events. Instead, Rust handles scroll and editing directly
    // by modifying frame_lines in-place and calling setNeedsDisplay.
    rust_cursor_line: i32,   // 1-based line number of the cursor
    rust_col: usize,         // byte offset within that line's text
    // Once the user manually clicks, don't let TypeScript re-renders override the cursor.
    user_has_clicked: bool,
    // y_offset of frame_lines[0] as received from the first TypeScript frame.
    // Used as the upper scroll bound so content can't be dragged below its initial position.
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
            nsview: nil,
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
            user_has_clicked: false,
            initial_top_y: None,
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

    /// Called from lib.rs after the EditorView has a stable address.
    pub fn init_nsview(&mut self) {
        let self_ptr = self as *mut EditorView;
        self.nsview = view::create_editor_nsview(self.width, self.height, self_ptr);
    }

    /// Get the underlying NSView handle.
    pub fn nsview(&self) -> id {
        self.nsview
    }

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    /// Called from the NSView's insertText: handler.
    pub fn on_text_input(&mut self, text: &str) {
        eprintln!("[HONE] on_text_input: {:?}", text);
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
            return;
        }
        // Rust-side editing: insert into the cursor line in frame_lines directly.
        if let Some(idx) = self.cursor_line_idx() {
            for ch in text.chars() {
                let col = self.rust_col.min(self.frame_lines[idx].text.len());
                self.frame_lines[idx].text.insert(col, ch);
                self.rust_col = col + ch.len_utf8();
            }
            // Retokenize the whole line so keyword colors are immediately correct.
            self.frame_lines[idx].tokens = crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
            self.sync_cursor_x();
            view::invalidate_view(self.nsview);
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

    /// Called from the NSView's doCommandBySelector: handler.
    pub fn on_action(&mut self, selector: &str) {
        eprintln!("[HONE] on_action: {:?}", selector);
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
            "deleteBackward:" => {
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col > 0 {
                        let col = self.rust_col - 1;
                        if col < self.frame_lines[idx].text.len() {
                            let ch_len = self.frame_lines[idx].text[col..].chars().next()
                                .map(|c| c.len_utf8()).unwrap_or(1);
                            self.frame_lines[idx].text.remove(col);
                            self.rust_col -= ch_len;
                            // Retokenize so keyword colors are immediately correct.
                            self.frame_lines[idx].tokens = crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
                            dirty = true;
                        }
                    }
                }
            }
            "moveLeft:" => {
                if self.rust_col > 0 {
                    self.rust_col -= 1;
                    dirty = true;
                }
            }
            "moveRight:" => {
                if let Some(idx) = self.cursor_line_idx() {
                    if self.rust_col < self.frame_lines[idx].text.len() {
                        self.rust_col += 1;
                        dirty = true;
                    }
                }
            }
            "moveUp:" => {
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
            "moveToBeginningOfLine:" | "moveToLeftEndOfLine:" => {
                self.rust_col = 0;
                dirty = true;
            }
            "moveToEndOfLine:" | "moveToRightEndOfLine:" => {
                if let Some(idx) = self.cursor_line_idx() {
                    self.rust_col = self.frame_lines[idx].text.len();
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
            view::invalidate_view(self.nsview);
        }
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    /// Called from the NSView's mouseDown: handler.
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
            // Using measure_text (same as rendering) avoids char_width vs actual-advance
            // discrepancies that occur with proportional or scaled fonts.
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

            let text_before = &line.text[..self.rust_col];
            let cursor_x = gutter_w + self.renderer.measure_text(text_before);
            let cursor_y = line.y_offset;
            self.cursor = Some(CursorData { x: cursor_x, y: cursor_y, style: 0 });
            eprintln!("[HONE] click: raw_x={:.1} gutter={:.1} byte_col={} cursor_x={:.1} line={} y={:.1}",
                x, gutter_w, self.rust_col, cursor_x, line_number, cursor_y);
            // Queue for TypeScript so it syncs its cursor position before processing text events.
            // This ensures subsequent TEXT events are inserted at the clicked position in
            // TypeScript's buffer, keeping it in sync with the Rust-side frame_lines.
            self.pending_events.push(PendingEvent {
                event_type: event_type::MOUSE_DOWN,
                char_code: 0,
                action_id: 0,
                x,
                y,
            });
            view::invalidate_view(self.nsview);
        }
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the NSView's scrollWheel: handler.
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
        // Infer TypeScript's line height from the spacing between consecutive rendered lines.
        let ts_line_h = if self.frame_lines.len() >= 2 {
            (self.frame_lines[1].y_offset - self.frame_lines[0].y_offset).abs()
        } else {
            self.renderer.line_height
        };
        let n = self.frame_lines.len() as f64;
        let total_content_h = n * ts_line_h;

        // Compute how much we actually scroll after clamping.
        // max_first_y: first line can't go below its initial position (no black gap at top).
        // min_first_y: last line must remain visible at the bottom.
        let actual_dy = if let Some(max_first_y) = self.initial_top_y {
            if total_content_h <= self.height {
                // Content fits in the view — no scrolling needed at all.
                0.0
            } else {
                let min_first_y = max_first_y + self.height - total_content_h;
                let proposed = self.frame_lines[0].y_offset + dy;
                let clamped = proposed.clamp(min_first_y, max_first_y);
                clamped - self.frame_lines[0].y_offset
            }
        } else {
            // initial_top_y not yet recorded — allow unclamped scroll.
            dy
        };

        if actual_dy.abs() < 0.1 {
            return;
        }

        // Rust-side scroll: shift all stored y_offsets so draw() reflects the new position.
        // macOS natural scrolling: negative dy = finger swipes up = content moves up
        // = y_offsets decrease. So we add dy (which is negative) to shift content up.
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
        view::invalidate_view(self.nsview);
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
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        self.renderer.measure_text(text)
    }

    // ── Frame buffer API ─────────────────────────────────────────

    pub fn frame_lines_count(&self) -> usize {
        self.frame_lines.len()
    }

    pub fn begin_frame(&mut self) {
        self.frame_lines.clear();
        // Only clear cursor if user hasn't manually positioned it via a click.
        // TypeScript re-renders (from setCharWidth/onResize) don't know about user clicks.
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
            // User manually positioned cursor via click — don't let TypeScript override.
            // Update cursor visual position using the freshly rendered frame_lines so that
            // y_offset stays consistent with re-rendered content (e.g. after scroll reset).
            if let Some(line) = self.frame_lines.iter().find(|l| l.line_number == self.rust_cursor_line) {
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
        // Find the frame line whose y_offset is closest to y.
        if let Some(line) = self.frame_lines.iter().min_by(|a, b| {
            let da = (a.y_offset - y).abs();
            let db = (b.y_offset - y).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            self.rust_cursor_line = line.line_number;
        }
    }

    // ── Rust-side editing helpers ─────────────────────────────────

    /// Index into frame_lines for the current cursor line, if any.
    fn cursor_line_idx(&self) -> Option<usize> {
        self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line)
    }

    /// Recompute the pixel X of the cursor from rust_col using measure_text for precision.
    fn sync_cursor_x(&mut self) {
        let gutter_w = self.gutter_width();
        let x = if let Some(idx) = self.cursor_line_idx() {
            let text_len = self.frame_lines[idx].text.len();
            let col = self.rust_col.min(text_len);
            gutter_w + self.renderer.measure_text(&self.frame_lines[idx].text[..col])
        } else {
            gutter_w + self.rust_col as f64 * self.renderer.char_width
        };
        if let Some(ref mut c) = self.cursor {
            c.x = x;
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
        eprintln!("[HONE] end_frame: {} lines in frame", self.frame_lines.len());
        // Record the TypeScript-assigned y_offset of the first line on the first render.
        // This becomes the upper scroll bound — content can never drift below this position.
        if self.initial_top_y.is_none() {
            if let Some(first) = self.frame_lines.first() {
                self.initial_top_y = Some(first.y_offset);
            }
        }
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn invalidate(&mut self) {
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn attach_to_parent(&mut self, parent: *mut std::ffi::c_void) {
        self.parent_view = parent;
        if self.nsview != nil && !parent.is_null() {
            unsafe {
                let parent_view = parent as id;
                let _: () = msg_send![parent_view, addSubview: self.nsview];
                let bounds: NSRect = msg_send![parent_view, bounds];
                let _: () = msg_send![self.nsview, setFrame: bounds];
            }
        }
    }

    // ── Drawing ──────────────────────────────────────────────────

    /// Compute gutter width matching the TS GutterRenderer formula:
    /// max(2, digits) * charWidth + 36  (16px fold + 16px padding + 4px diff)
    fn gutter_width(&self) -> f64 {
        let digits = if self.max_line_number <= 0 {
            2
        } else {
            let d = (self.max_line_number as f64).log10().floor() as i32 + 1;
            d.max(2)
        };
        digits as f64 * self.renderer.char_width + 36.0
    }

    /// Convert raw CGContextRef from drawRect: to a safe wrapper and draw.
    ///
    /// # Safety
    /// Called from the NSView drawRect: handler with a valid CGContextRef.
    pub fn draw(&self, raw_ctx: core_graphics::sys::CGContextRef, dirty_rect: NSRect) {
        let ctx = unsafe { CGContext::from_existing_context_ptr(raw_ctx) };
        let actual_height = dirty_rect.size.height.max(self.height);
        self.draw_with_context(&ctx, actual_height);
    }

    fn draw_with_context(&self, ctx: &CGContext, actual_height: f64) {
        let bounds = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(self.width, actual_height),
        );

        // 1. Fill background
        ctx.set_rgb_fill_color(
            self.background_color.0,
            self.background_color.1,
            self.background_color.2,
            1.0,
        );
        ctx.fill_rect(bounds);

        let gutter_w = self.gutter_width();

        // 2. Draw gutter background
        ctx.set_rgb_fill_color(
            self.gutter_bg_color.0,
            self.gutter_bg_color.1,
            self.gutter_bg_color.2,
            1.0,
        );
        let gutter_rect = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(gutter_w, actual_height),
        );
        ctx.fill_rect(gutter_rect);

        // 3. Draw each buffered line
        for line in &self.frame_lines {
            // Draw line number in gutter (right-aligned)
            let num_str = format!("{}", line.line_number);
            let num_width = self.renderer.char_width * num_str.len() as f64;
            // Right-align: gutter_w - 20px (fold+diff area) - num_width
            let num_x = gutter_w - 20.0 - num_width;

            text_renderer::draw_text(
                ctx,
                &num_str,
                num_x,
                line.y_offset,
                &self.renderer.normal,
                self.renderer.ascent,
                self.gutter_fg_color,
            );

            // Draw text content with tokens starting at gutter_w
            text_renderer::draw_line(
                ctx,
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
                    ctx.set_rgb_fill_color(r, g, b, 0.3);
                    let rect = CGRect::new(
                        &CGPoint::new(decor.x, decor.y),
                        &CGSize::new(decor.w, decor.h),
                    );
                    ctx.fill_rect(rect);
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
                    let wave_height = 2.0;
                    let wave_len = 4.0;
                    let mut x = decor.x;
                    ctx.move_to_point(x, y_base);
                    let mut up = true;
                    while x < decor.x + decor.w {
                        let y_target = if up { y_base - wave_height } else { y_base };
                        x += wave_len;
                        ctx.add_line_to_point(x, y_target);
                        up = !up;
                    }
                    ctx.stroke_path();
                }
                _ => {}
            }
        }

        // 5. Draw selection rectangles
        for sel in &self.selections {
            ctx.set_rgb_fill_color(
                self.selection_color.0,
                self.selection_color.1,
                self.selection_color.2,
                self.selection_color.3,
            );
            let rect = CGRect::new(
                &CGPoint::new(sel.x, sel.y),
                &CGSize::new(sel.w, sel.h),
            );
            ctx.fill_rect(rect);
        }

        // 6. Draw ghost text
        if let Some(ref ghost) = self.ghost_text {
            text_renderer::draw_text(
                ctx,
                &ghost.text,
                ghost.x,
                ghost.y,
                &self.renderer.normal,
                self.renderer.ascent,
                ghost.color,
            );
        }

        // 7. Draw cursors
        self.draw_cursors(ctx);
    }

    fn draw_cursors(&self, ctx: &CGContext) {
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
            ctx.set_rgb_fill_color(
                self.cursor_color.0,
                self.cursor_color.1,
                self.cursor_color.2,
                1.0,
            );
            let rect = CGRect::new(
                &CGPoint::new(cursor.x, y),
                &CGSize::new(w, h),
            );
            ctx.fill_rect(rect);
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

impl Drop for EditorView {
    fn drop(&mut self) {
        if self.nsview != nil {
            unsafe {
                let _: () = msg_send![self.nsview, removeFromSuperview];
            }
        }
    }
}
