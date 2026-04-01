//! Windows EditorView: DirectWrite text rendering + Direct2D drawing.
//!
//! Owns the FontSet, HWND, and frame buffer. Between beginFrame/endFrame
//! the TS coordinator pushes line data, cursor, and selection state. On
//! endFrame the HWND is invalidated, and WM_PAINT calls draw() which
//! paints everything via Direct2D / DirectWrite.

use serde::Deserialize;
use std::ffi::{c_char, CString};
use std::sync::OnceLock;

use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_COLOR_F, D2D_POINT_2F, D2D_RECT_F, D2D_SIZE_U,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, ID2D1HwndRenderTarget,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_HWND_RENDER_TARGET_PROPERTIES,
    D2D1_PRESENT_OPTIONS_NONE, D2D1_RENDER_TARGET_PROPERTIES,
};
use windows::Win32::Graphics::Gdi::InvalidateRect;
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;

use crate::text_renderer::{self, FontSet, RenderToken};

// ── Event queue (for Perry polling) ──────────────────────────────

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

/// Map a macOS-style selector string to an action ID constant.
pub fn selector_to_action_id(selector: &str) -> i32 {
    match selector {
        "moveLeft:" => action_id::MOVE_LEFT,
        "moveRight:" => action_id::MOVE_RIGHT,
        "moveUp:" => action_id::MOVE_UP,
        "moveDown:" => action_id::MOVE_DOWN,
        "moveToBeginningOfLine:" => action_id::MOVE_BOL,
        "moveToEndOfLine:" => action_id::MOVE_EOL,
        "moveToBeginningOfDocument:" => action_id::MOVE_BOD,
        "moveToEndOfDocument:" => action_id::MOVE_EOD,
        "insertNewline:" => action_id::INSERT_NEWLINE,
        "deleteBackward:" => action_id::DELETE_BACKWARD,
        "deleteForward:" => action_id::DELETE_FORWARD,
        "insertTab:" => action_id::INSERT_TAB,
        "moveWordLeft:" => action_id::MOVE_WORD_LEFT,
        "moveWordRight:" => action_id::MOVE_WORD_RIGHT,
        "moveLeftAndModifySelection:" => action_id::MOVE_LEFT_SEL,
        "moveRightAndModifySelection:" => action_id::MOVE_RIGHT_SEL,
        "moveUpAndModifySelection:" => action_id::MOVE_UP_SEL,
        "moveDownAndModifySelection:" => action_id::MOVE_DOWN_SEL,
        "moveToBeginningOfLineAndModifySelection:" => action_id::MOVE_BOL_SEL,
        "moveToEndOfLineAndModifySelection:" => action_id::MOVE_EOL_SEL,
        "selectAll:" => action_id::SELECT_ALL,
        "cut:" => action_id::CUT,
        "copy:" => action_id::COPY,
        "paste:" => action_id::PASTE,
        "undo:" => action_id::UNDO,
        "redo:" => action_id::REDO,
        "deleteWordBackward:" => action_id::DELETE_WORD_BACKWARD,
        "pageUp:" => action_id::PAGE_UP,
        "pageDown:" => action_id::PAGE_DOWN,
        _ => 0,
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

/// Called when the user drags the mouse (left button held). `x` and `y` are in view coordinates.
pub type MouseDragCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user double-clicks in the editor view. `x` and `y` are in view coordinates.
pub type MouseDoubleClickCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

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

/// Find highlight stored as line/col/len — pixel positions computed at draw time
/// from frame_lines y_offsets, so scrolling stays correct.
#[derive(Debug, Deserialize)]
pub struct FindHighlight {
    pub line: i32,      // 0-based line number
    pub col: i32,       // 0-based column
    pub len: i32,       // match length in characters
    pub current: i32,   // 1 = current match, 0 = other
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
    color: D2D1_COLOR_F,
}

// ── EditorView ───────────────────────────────────────────────────

/// Top-level editor view state.
///
/// This is the object behind the opaque `*mut EditorView` pointer
/// returned by `hone_editor_create()`.
pub struct EditorView {
    pub renderer: FontSet,
    hwnd: HWND,
    d2d_factory: ID2D1Factory,
    render_target: Option<ID2D1HwndRenderTarget>,
    pub parent_view: *mut std::ffi::c_void,
    width: f64,
    height: f64,

    // Frame buffer (populated between beginFrame/endFrame)
    frame_lines: Vec<LineRenderData>,
    cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    /// Find highlights — NOT cleared by begin_frame. Stored as line/col/len,
    /// pixel positions computed at draw time from frame_lines y_offsets.
    find_highlights: Vec<FindHighlight>,
    ghost_text: Option<GhostTextData>,
    scroll_offset: f64,
    /// Accumulated scroll delta for TS polling (positive = scroll down).
    pub scroll_delta_accum: f64,
    max_line_number: i32,

    // Input callbacks
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    mouse_drag_callback: Option<MouseDragCallback>,
    mouse_double_click_callback: Option<MouseDoubleClickCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (for Perry polling)
    pub pending_events: Vec<PendingEvent>,
    pub event_callback: Option<extern "C" fn()>,

    // Rust-side interactive state.
    // Perry's AOT runtime doesn't fire setInterval/RAF after startup, so
    // TypeScript can't poll events. Instead, Rust handles scroll and editing directly
    // by modifying frame_lines in-place and calling invalidate().
    rust_cursor_line: i32,   // 1-based line number of the cursor
    rust_col: usize,         // byte offset within that line's text
    // Selection anchor; None = no active selection.
    rust_sel_anchor: Option<(i32, usize)>,  // (line_number, byte_col)
    // Once the user manually clicks, don't let TypeScript re-renders override the cursor.
    user_has_clicked: bool,
    // y_offset of frame_lines[0] as received from the first TypeScript frame.
    // Used as the upper scroll bound so content can't be dragged below its initial position.
    initial_top_y: Option<f64>,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,

    // Theme colors (VS Code dark defaults)
    background_color: D2D1_COLOR_F,
    gutter_bg_color: D2D1_COLOR_F,
    gutter_fg_color: D2D1_COLOR_F,
    default_text_color: D2D1_COLOR_F,
    selection_color: D2D1_COLOR_F,
    cursor_color: D2D1_COLOR_F,
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_null_hwnd(hwnd: HWND) -> bool {
    hwnd.0 == 0
}

static PARKING_HWND: OnceLock<isize> = OnceLock::new();

/// Get or create a message-only parking window for temporary HWND parentage.
/// Uses OnceLock<isize> for thread-safe, Send-safe storage.
fn get_or_create_parking_hwnd() -> HWND {
    let raw = PARKING_HWND.get_or_init(|| unsafe {
        let hinstance =
            windows::Win32::System::LibraryLoader::GetModuleHandleW(None).unwrap_or_default();
        let class: Vec<u16> = "STATIC".encode_utf16().chain(std::iter::once(0)).collect();
        let hwnd = windows::Win32::UI::WindowsAndMessaging::CreateWindowExW(
            windows::Win32::UI::WindowsAndMessaging::WINDOW_EX_STYLE::default(),
            windows::core::PCWSTR(class.as_ptr()),
            windows::core::PCWSTR(std::ptr::null()),
            windows::Win32::UI::WindowsAndMessaging::WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            HWND(-3), // HWND_MESSAGE
            None,
            hinstance,
            None,
        );
        hwnd.0
    });
    HWND(*raw)
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        let renderer = FontSet::new("Consolas", 14.0);

        let d2d_factory: ID2D1Factory = unsafe {
            D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)
                .expect("Failed to create D2D1 factory")
        };

        EditorView {
            renderer,
            hwnd: HWND(0),
            d2d_factory,
            render_target: None,
            parent_view: std::ptr::null_mut(),
            width,
            height,
            frame_lines: Vec::with_capacity(64),
            cursor: None,
            cursors: Vec::new(),
            selections: Vec::new(),
            decorations: Vec::new(),
            find_highlights: Vec::new(),
            ghost_text: None,
            scroll_offset: 0.0,
            scroll_delta_accum: 0.0,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            mouse_drag_callback: None,
            mouse_double_click_callback: None,
            scroll_callback: None,
            pending_events: Vec::new(),
            event_callback: None,
            rust_cursor_line: 1,
            rust_col: 0,
            rust_sel_anchor: None,
            user_has_clicked: false,
            initial_top_y: None,
            context_menu_items: Vec::new(),
            // VS Code dark theme defaults
            background_color: D2D1_COLOR_F {
                r: 0.118,
                g: 0.118,
                b: 0.118,
                a: 1.0,
            },
            gutter_bg_color: D2D1_COLOR_F {
                r: 0.118,
                g: 0.118,
                b: 0.118,
                a: 1.0,
            },
            gutter_fg_color: D2D1_COLOR_F {
                r: 0.525,
                g: 0.525,
                b: 0.525,
                a: 1.0,
            },
            default_text_color: D2D1_COLOR_F {
                r: 0.843,
                g: 0.843,
                b: 0.843,
                a: 1.0,
            },
            selection_color: D2D1_COLOR_F {
                r: 0.153,
                g: 0.306,
                b: 0.482,
                a: 0.4,
            },
            cursor_color: D2D1_COLOR_F {
                r: 0.918,
                g: 0.918,
                b: 0.918,
                a: 1.0,
            },
        }
    }

    /// Create the editor HWND using a message-only parking window as temporary parent.
    /// When `attach_to_parent()` is later called, the HWND is reparented to the real parent.
    pub fn init_hwnd(&mut self) {
        let parking = get_or_create_parking_hwnd();
        let self_ptr = self as *mut EditorView;
        self.hwnd = crate::input_handler::create_editor_hwnd(
            parking,
            self.width as i32,
            self.height as i32,
            self_ptr,
        );
    }

    /// Get the underlying HWND handle.
    pub fn hwnd(&self) -> HWND {
        self.hwnd
    }

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    /// Called from the WndProc's WM_CHAR handler.
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
                self.frame_lines[idx].tokens = crate::tokenizer::tokenize_line(&self.frame_lines[idx].text);
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

    /// Called from the WndProc's WM_KEYDOWN handler.
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
                    let first = &self.frame_lines[0];
                    self.rust_sel_anchor = Some((first.line_number, 0));
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

    pub fn set_mouse_drag_callback(&mut self, cb: MouseDragCallback) {
        self.mouse_drag_callback = Some(cb);
    }

    pub fn set_mouse_double_click_callback(&mut self, cb: MouseDoubleClickCallback) {
        self.mouse_double_click_callback = Some(cb);
    }

    /// Called from the WndProc's WM_LBUTTONDOWN handler.
    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        // Convert from physical pixels to DIPs for DPI-aware Perry mode.
        let scale = self.dpi_scale();
        let x = x / scale;
        let y = y / scale;
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x * scale, y * scale); // pass physical pixels to callback
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

    /// Called from the WndProc's WM_MOUSEMOVE handler during drag.
    /// Updates the cursor to the drag position and recomputes selection highlights.
    pub fn on_mouse_drag(&mut self, x: f64, y: f64) {
        // Convert from physical pixels to DIPs.
        let scale = self.dpi_scale();
        let x = x / scale;
        let y = y / scale;
        if let Some(cb) = self.mouse_drag_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x * scale, y * scale);
            return;
        }
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

    /// Called from the WndProc's WM_LBUTTONDBLCLK handler.
    pub fn on_mouse_double_click(&mut self, x: f64, y: f64) {
        let scale = self.dpi_scale();
        let x = x / scale;
        let y = y / scale;
        if let Some(cb) = self.mouse_double_click_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x * scale, y * scale);
            return;
        }
        // Rust-side: find the word under click and select it.
        if let Some(line) = self.frame_lines.iter().min_by(|a, b| {
            let da = (a.y_offset - y).abs();
            let db = (b.y_offset - y).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            let line_number = line.line_number;
            let text = line.text.clone();
            self.user_has_clicked = true;
            let gutter_w = self.gutter_width();
            let text_x = (x - gutter_w).max(0.0);

            // Find byte offset at click
            let mut best_byte_col = 0usize;
            let mut best_dist = f64::MAX;
            let mut byte_pos = 0usize;
            loop {
                let w = self.renderer.measure_text(&text[..byte_pos]);
                let dist = (w - text_x).abs();
                if dist < best_dist {
                    best_dist = dist;
                    best_byte_col = byte_pos;
                }
                if let Some(ch) = text[byte_pos..].chars().next() {
                    byte_pos += ch.len_utf8();
                } else {
                    break;
                }
            }

            // Expand to word boundaries
            let bytes = text.as_bytes();
            let mut word_start = best_byte_col;
            let mut word_end = best_byte_col;
            while word_start > 0 && is_word_byte(bytes[word_start - 1]) {
                word_start -= 1;
            }
            while word_end < bytes.len() && is_word_byte(bytes[word_end]) {
                word_end += 1;
            }

            self.rust_cursor_line = line_number;
            self.rust_col = word_end;
            self.rust_sel_anchor = Some((line_number, word_start));

            let cursor_x = gutter_w + self.renderer.measure_text(&text[..word_end]);
            let cursor_y = line.y_offset;
            self.cursor = Some(CursorData { x: cursor_x, y: cursor_y, style: 0 });

            self.sync_selection_rects();
            self.invalidate();
        }
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the WndProc's WM_MOUSEWHEEL handler.
    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        // Accumulate delta for TS polling via hone_editor_get_scroll_delta
        self.scroll_delta_accum += dy;

        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
            return;
        }
        // Scale scroll delta from physical pixels to DIPs.
        let scale = self.dpi_scale();
        let dy = dy / scale;
        if self.frame_lines.is_empty() {
            return;
        }

        // Clamp the scroll delta so content never drifts outside its valid range.
        let ts_line_h = self.ts_line_height();
        let n = self.frame_lines.len() as f64;
        let total_content_h = n * ts_line_h;
        let view_height = self.height / scale; // convert physical height to DIPs

        // Windows scroll: positive dy = scroll down = content moves up = y_offsets decrease.
        // So we subtract dy from y_offsets.
        let actual_dy = if let Some(max_first_y) = self.initial_top_y {
            if total_content_h <= view_height {
                0.0
            } else {
                let min_first_y = max_first_y + view_height - total_content_h;
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
        self.invalidate();
    }

    /// Set the editor background color (also sets gutter bg to match).
    pub fn set_bg_color(&mut self, r: f64, g: f64, b: f64) {
        self.background_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: 1.0 };
        self.gutter_bg_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: 1.0 };
        self.invalidate();
    }

    /// Set the default text foreground color.
    pub fn set_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.default_text_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: 1.0 };
        self.invalidate();
    }

    /// Set the gutter (line number) foreground color.
    pub fn set_gutter_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.gutter_fg_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: 1.0 };
        self.invalidate();
    }

    /// Set the selection highlight color (with alpha).
    pub fn set_selection_color(&mut self, r: f64, g: f64, b: f64, a: f64) {
        self.selection_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: a as f32 };
        self.invalidate();
    }

    /// Set the cursor color.
    pub fn set_cursor_color(&mut self, r: f64, g: f64, b: f64) {
        self.cursor_color = D2D1_COLOR_F { r: r as f32, g: g as f32, b: b as f32, a: 1.0 };
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

    pub fn render_line(
        &mut self,
        line_number: i32,
        text: &str,
        tokens_json: &str,
        y_offset: f64,
    ) {
        let mut tokens: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();
        // Fallback: if TS sent empty tokens (AOT mode may fail to generate them),
        // use the Rust-side tokenizer for basic syntax coloring.
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

    /// Set persistent find highlights as line/col/len/current entries.
    /// NOT cleared by begin_frame — persists until explicitly changed.
    pub fn set_find_highlights(&mut self, json: &str) {
        self.find_highlights = serde_json::from_str(json).unwrap_or_default();
    }

    /// Clear find highlights.
    pub fn clear_find_highlights(&mut self) {
        self.find_highlights.clear();
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
        self.invalidate();
    }

    pub fn invalidate(&self) {
        if !is_null_hwnd(self.hwnd) {
            unsafe {
                let _ = InvalidateRect(self.hwnd, None, false);
            }
        }
    }

    pub fn attach_to_parent(&mut self, parent: *mut std::ffi::c_void) {
        self.parent_view = parent;
        if parent.is_null() {
            return;
        }
        let parent_hwnd = HWND(parent as isize);

        unsafe {
            // Get parent client area for sizing
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(
                parent_hwnd,
                &mut rect,
            );
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;

            if is_null_hwnd(self.hwnd) {
                // Create the child HWND now that we have a valid parent
                let self_ptr = self as *mut EditorView;
                self.hwnd =
                    crate::input_handler::create_editor_hwnd(parent_hwnd, w, h, self_ptr);
            } else {
                // Re-parent an existing HWND
                let _ = windows::Win32::UI::WindowsAndMessaging::SetParent(
                    self.hwnd,
                    parent_hwnd,
                );
                let _ = windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
                    self.hwnd,
                    None,
                    0,
                    0,
                    w,
                    h,
                    windows::Win32::UI::WindowsAndMessaging::SWP_NOZORDER,
                );
            }
        }
    }

    /// Ensure the render target exists for the current HWND.
    fn ensure_render_target(&mut self) {
        if self.render_target.is_some() {
            return;
        }
        if is_null_hwnd(self.hwnd) {
            return;
        }

        unsafe {
            let mut rc = windows::Win32::Foundation::RECT::default();
            let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(self.hwnd, &mut rc);

            let size = D2D_SIZE_U {
                width: (rc.right - rc.left).max(1) as u32,
                height: (rc.bottom - rc.top).max(1) as u32,
            };

            let rt_props = D2D1_RENDER_TARGET_PROPERTIES::default();
            let hwnd_props = D2D1_HWND_RENDER_TARGET_PROPERTIES {
                hwnd: self.hwnd,
                pixelSize: size,
                presentOptions: D2D1_PRESENT_OPTIONS_NONE,
            };

            match self.d2d_factory.CreateHwndRenderTarget(&rt_props, &hwnd_props) {
                Ok(rt) => {
                    self.render_target = Some(rt);
                }
                Err(e) => {
                    eprintln!("Failed to create render target: {:?}", e);
                }
            }
        }
    }

    /// Resize the render target when the window size changes.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width as f64;
        self.height = height as f64;
        // Drop and recreate the render target on next paint to ensure
        // it matches the new HWND size (Resize() alone may not update the clip).
        self.render_target = None;
    }

    /// Called from WM_PAINT — paint the frame buffer using Direct2D.
    pub fn paint(&mut self) {
        self.ensure_render_target();

        let rt = match self.render_target.as_ref() {
            Some(rt) => rt.clone(),
            None => return,
        };

        unsafe {
            rt.BeginDraw();
        }

        self.draw(&rt);

        unsafe {
            let hr = rt.EndDraw(None, None);
            if hr.is_err() {
                // D2DERR_RECREATE_TARGET — discard and recreate on next paint
                self.render_target = None;
            }
        }
    }

    // ── Rust-side editing helpers ─────────────────────────────────

    /// Get DPI scale factor for this window.
    /// With PER_MONITOR_AWARE_V2, mouse coords are in physical pixels but
    /// Direct2D renders in DIPs. This returns physical_pixels / DIPs.
    fn dpi_scale(&self) -> f64 {
        if is_null_hwnd(self.hwnd) {
            return 1.0;
        }
        let dpi = unsafe {
            windows::Win32::UI::HiDpi::GetDpiForWindow(self.hwnd)
        };
        if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 }
    }

    /// Index into frame_lines for the current cursor line, if any.
    fn cursor_line_idx(&self) -> Option<usize> {
        self.frame_lines.iter().position(|l| l.line_number == self.rust_cursor_line)
    }

    /// Recompute the pixel X and Y of the cursor from rust_cursor_line / rust_col.
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

    /// Infer TypeScript's line height from the gap between the first two frame_lines.
    fn ts_line_height(&self) -> f64 {
        if self.frame_lines.len() >= 2 {
            (self.frame_lines[1].y_offset - self.frame_lines[0].y_offset).abs()
        } else {
            self.renderer.line_height
        }
    }

    /// If there is an active selection, delete its content and collapse the cursor
    /// to the start of the selection.
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

    /// Collect the selected text as a String.
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

    /// Write `text` to the Windows clipboard using Win32 API.
    fn write_to_clipboard(&self, text: &str) {
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

    /// Read plain text from the Windows clipboard using Win32 API.
    fn read_from_clipboard(&self) -> String {
        unsafe {
            if OpenClipboard(HWND::default()).is_err() {
                return String::new();
            }
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32);
            let result = if let Ok(handle) = handle {
                let hglobal = HGLOBAL(handle.0 as *mut std::ffi::c_void);
                let ptr = GlobalLock(hglobal) as *const u16;
                if ptr.is_null() {
                    String::new()
                } else {
                    let mut len = 0;
                    while *ptr.add(len) != 0 {
                        len += 1;
                    }
                    let slice = std::slice::from_raw_parts(ptr, len);
                    let s = String::from_utf16_lossy(slice);
                    let _ = GlobalUnlock(hglobal);
                    s.replace("\r\n", "\n")
                }
            } else {
                String::new()
            };
            let _ = CloseClipboard();
            result
        }
    }

    /// Rebuild `self.selections` from the current anchor + cursor positions.
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

    /// Collapse the selection, placing the cursor at the start (lower) position.
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

    /// Collapse the selection, placing the cursor at the end (higher) position.
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

    fn draw(&self, rt: &ID2D1HwndRenderTarget) {
        // 1. Fill background
        unsafe {
            rt.Clear(Some(&self.background_color));
        }

        let gutter_w = self.gutter_width();

        // 2. Draw gutter background
        unsafe {
            let brush = rt
                .CreateSolidColorBrush(&self.gutter_bg_color, None)
                .unwrap();
            let gutter_rect = D2D_RECT_F {
                left: 0.0,
                top: 0.0,
                right: gutter_w as f32,
                bottom: self.height as f32,
            };
            rt.FillRectangle(&gutter_rect, &brush);
        }

        // 3. Draw each buffered line
        let ts_line_h = self.ts_line_height();

        for line in &self.frame_lines {
            // Draw line number in gutter (right-aligned)
            let num_str = format!("{}", line.line_number);
            let num_width = self.renderer.char_width * num_str.len() as f64;
            let num_x = gutter_w - 20.0 - num_width;

            text_renderer::draw_text(
                rt,
                &num_str,
                num_x,
                line.y_offset,
                &self.renderer.normal,
                self.gutter_fg_color,
            );

            // Draw find highlights for this line (BEFORE text, so text renders on top)
            for fh in &self.find_highlights {
                if fh.line + 1 == line.line_number {
                    let char_w = self.renderer.char_width;
                    let byte_col = fh.col as usize;
                    let char_col = if byte_col <= line.text.len() {
                        line.text[..byte_col].chars().count()
                    } else {
                        byte_col
                    };
                    let byte_end = (fh.col + fh.len) as usize;
                    let char_len = if byte_end <= line.text.len() {
                        line.text[byte_col..byte_end].chars().count()
                    } else {
                        fh.len as usize
                    };
                    let hx = gutter_w + char_col as f64 * char_w;
                    let hw = char_len as f64 * char_w;
                    unsafe {
                        let color = if fh.current > 0 {
                            D2D1_COLOR_F { r: 0.91, g: 0.67, b: 0.33, a: 0.35 }
                        } else {
                            D2D1_COLOR_F { r: 0.89, g: 0.76, b: 0.33, a: 0.20 }
                        };
                        let brush = rt.CreateSolidColorBrush(&color, None).unwrap();
                        let rect = D2D_RECT_F {
                            left: hx as f32,
                            top: line.y_offset as f32,
                            right: (hx + hw) as f32,
                            bottom: (line.y_offset + ts_line_h) as f32,
                        };
                        rt.FillRectangle(&rect, &brush);
                    }
                }
            }

            // Draw text content with tokens starting at gutter_w
            text_renderer::draw_line(
                rt,
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
            let color = text_renderer::parse_hex_color(&decor.color);
            unsafe {
                match decor.kind.as_str() {
                    "background" => {
                        let mut bg_color = color;
                        bg_color.a = 0.3;
                        let brush = rt.CreateSolidColorBrush(&bg_color, None).unwrap();
                        let rect = D2D_RECT_F {
                            left: decor.x as f32,
                            top: decor.y as f32,
                            right: (decor.x + decor.w) as f32,
                            bottom: (decor.y + decor.h) as f32,
                        };
                        rt.FillRectangle(&rect, &brush);
                    }
                    "underline" => {
                        let brush = rt.CreateSolidColorBrush(&color, None).unwrap();
                        let y_bottom = (decor.y + decor.h - 1.0) as f32;
                        rt.DrawLine(
                            D2D_POINT_2F {
                                x: decor.x as f32,
                                y: y_bottom,
                            },
                            D2D_POINT_2F {
                                x: (decor.x + decor.w) as f32,
                                y: y_bottom,
                            },
                            &brush,
                            1.0,
                            None,
                        );
                    }
                    "underline-wavy" => {
                        let brush = rt.CreateSolidColorBrush(&color, None).unwrap();
                        let y_base = (decor.y + decor.h - 1.0) as f32;
                        let wave_height: f32 = 2.0;
                        let wave_len: f32 = 4.0;
                        let mut x = decor.x as f32;
                        let x_end = (decor.x + decor.w) as f32;
                        let mut up = true;
                        let mut prev = D2D_POINT_2F { x, y: y_base };
                        while x < x_end {
                            let y_target = if up {
                                y_base - wave_height
                            } else {
                                y_base
                            };
                            x += wave_len;
                            let next = D2D_POINT_2F { x, y: y_target };
                            rt.DrawLine(prev, next, &brush, 1.0, None);
                            prev = next;
                            up = !up;
                        }
                    }
                    _ => {}
                }
            }
        }

        // 5. Draw selection rectangles
        for sel in &self.selections {
            unsafe {
                let brush = rt
                    .CreateSolidColorBrush(&self.selection_color, None)
                    .unwrap();
                let rect = D2D_RECT_F {
                    left: sel.x as f32,
                    top: sel.y as f32,
                    right: (sel.x + sel.w) as f32,
                    bottom: (sel.y + sel.h) as f32,
                };
                rt.FillRectangle(&rect, &brush);
            }
        }

        // 6. Draw ghost text
        if let Some(ref ghost) = self.ghost_text {
            text_renderer::draw_text(
                rt,
                &ghost.text,
                ghost.x,
                ghost.y,
                &self.renderer.normal,
                ghost.color,
            );
        }

        // 7. Draw cursors
        self.draw_cursors(rt);
    }

    fn draw_cursors(&self, rt: &ID2D1HwndRenderTarget) {
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
            unsafe {
                let brush = rt
                    .CreateSolidColorBrush(&self.cursor_color, None)
                    .unwrap();
                let rect = D2D_RECT_F {
                    left: cursor.x as f32,
                    top: y as f32,
                    right: (cursor.x + w) as f32,
                    bottom: (y + h) as f32,
                };
                rt.FillRectangle(&rect, &brush);
            }
        };

        if let Some(ref c) = self.cursor {
            draw_one(c);
        }

        for c in &self.cursors {
            draw_one(c);
        }
    }
}

impl Drop for EditorView {
    fn drop(&mut self) {
        if !is_null_hwnd(self.hwnd) {
            unsafe {
                let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.hwnd);
            }
        }
    }
}
