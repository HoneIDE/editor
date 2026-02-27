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

    // Input callbacks
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

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
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
        }
    }

    /// Called from the NSView's doCommandBySelector: handler.
    pub fn on_action(&mut self, selector: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_sel) = CString::new(selector) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_sel.as_ptr());
            }
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
        }
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

    pub fn begin_frame(&mut self) {
        self.frame_lines.clear();
        self.cursor = None;
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
        self.cursor = Some(CursorData { x, y, style });
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
    pub fn draw(&self, raw_ctx: core_graphics::sys::CGContextRef, _dirty_rect: NSRect) {
        let ctx = unsafe { CGContext::from_existing_context_ptr(raw_ctx) };
        self.draw_with_context(&ctx);
    }

    fn draw_with_context(&self, ctx: &CGContext) {
        let bounds = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(self.width, self.height),
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
            &CGSize::new(gutter_w, self.height),
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
