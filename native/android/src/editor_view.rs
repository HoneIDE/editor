//! Android EditorView: Canvas/Skia via JNI.
//!
//! Production implementation:
//! - JNI calls to android.graphics.Canvas and android.graphics.Paint
//! - Per-token color via Paint.setColor()
//! - Canvas.drawText() for each token span
//! - Pre-render lines to Bitmap objects for fast scrolling

use serde::Deserialize;
use std::ffi::{c_char, CString};

// ── Callback types ──────────────────────────────────────────────

/// Called when the user types printable text. `text` is a null-terminated UTF-8 C string.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);

/// Called when an action fires (arrow keys, delete, enter, etc.).
/// `action` is the action name as a null-terminated UTF-8 C string.
pub type ActionCallback = extern "C" fn(view: *mut EditorView, action: *const c_char);

/// Called when the user taps in the editor view. `x` and `y` are in view coordinates.
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user scrolls. `dx`/`dy` are pixel deltas.
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

/// A custom context menu item added by the host application.
pub struct ContextMenuItem {
    pub title: String,
    pub action_id: String,
}

// ── Data structures ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RenderToken {
    pub s: usize,
    pub e: usize,
    pub c: String,
    pub st: String,
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

pub struct LineRenderData {
    pub line_number: i32,
    pub text: String,
    pub tokens_json: String,
    pub y_offset: f64,
}

struct GhostTextData {
    text: String,
    x: f64,
    y: f64,
    color: String,
}

// ── EditorView ───────────────────────────────────────────────────

pub struct EditorView {
    font_family: String,
    font_size: f64,
    width: f64,
    height: f64,
    scroll_offset_y: f64,
    needs_display: bool,
    /// Pointer to the parent JNI jobject (Android View) that this editor is attached to.
    pub parent_view: *mut std::ffi::c_void,

    // Frame buffer (populated between begin_frame/end_frame)
    frame_lines: Vec<LineRenderData>,
    cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    ghost_text: Option<GhostTextData>,
    max_line_number: i32,

    // Input callbacks
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            font_family: "monospace".to_string(),
            font_size: 14.0,
            width,
            height,
            scroll_offset_y: 0.0,
            needs_display: true,
            parent_view: std::ptr::null_mut(),
            frame_lines: Vec::with_capacity(64),
            cursor: None,
            cursors: Vec::new(),
            selections: Vec::new(),
            decorations: Vec::new(),
            ghost_text: None,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            scroll_callback: None,
            context_menu_items: Vec::new(),
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.font_family = family.to_string();
        self.font_size = size;
        self.needs_display = true;
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        // Monospace approximation: each character is font_size * 0.6 wide
        text.len() as f64 * self.font_size * 0.6
    }

    // ── Frame buffer API ─────────────────────────────────────────

    pub fn begin_frame(&mut self) {
        self.frame_lines.clear();
        self.cursor = None;
        self.cursors.clear();
        self.selections.clear();
        self.decorations.clear();
        self.ghost_text = None;
        self.max_line_number = 0;
        self.needs_display = false;
    }

    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        if line_number > self.max_line_number {
            self.max_line_number = line_number;
        }
        self.frame_lines.push(LineRenderData {
            line_number,
            text: text.to_string(),
            tokens_json: tokens_json.to_string(),
            y_offset,
        });
    }

    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        self.cursor = Some(CursorData { x, y, style });
        self.needs_display = true;
    }

    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.cursors = serde_json::from_str(cursors_json).unwrap_or_default();
    }

    pub fn set_selection(&mut self, regions_json: &str) {
        self.selections = serde_json::from_str(regions_json).unwrap_or_default();
        self.needs_display = true;
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_display = true;
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
            color: color.to_string(),
        });
    }

    pub fn end_frame(&mut self) {
        self.needs_display = true;
    }

    pub fn invalidate(&mut self) {
        self.needs_display = true;
    }

    // ── Callbacks ────────────────────────────────────────────────

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the Android View's text input handler.
    pub fn on_text_input(&mut self, text: &str) {
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
        }
    }

    /// Called from the Android View's action handler.
    pub fn on_action(&mut self, action: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_action) = CString::new(action) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_action.as_ptr());
            }
        }
    }

    /// Called from the Android View's touch handler.
    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
        }
    }

    /// Called from the Android View's scroll handler.
    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
        }
    }

    // ── Context menu ─────────────────────────────────────────────

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

    // ── Accessors (for JNI bridge) ───────────────────────────────

    pub fn get_rendered_lines(&self) -> &[LineRenderData] {
        &self.frame_lines
    }

    pub fn get_cursor(&self) -> Option<&CursorData> {
        self.cursor.as_ref()
    }

    pub fn get_cursors(&self) -> &[CursorData] {
        &self.cursors
    }

    pub fn get_selections(&self) -> &[SelectionRegion] {
        &self.selections
    }

    pub fn get_scroll_y(&self) -> f64 {
        self.scroll_offset_y
    }

    pub fn get_font_size(&self) -> f64 {
        self.font_size
    }

    pub fn get_width(&self) -> f64 {
        self.width
    }

    pub fn get_height(&self) -> f64 {
        self.height
    }
}
