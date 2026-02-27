//! Windows EditorView: DirectWrite text rendering + Direct2D drawing.
//!
//! Owns the FontSet, HWND, and frame buffer. Between beginFrame/endFrame
//! the TS coordinator pushes line data, cursor, and selection state. On
//! endFrame the HWND is invalidated, and WM_PAINT calls draw() which
//! paints everything via Direct2D / DirectWrite.

use serde::Deserialize;
use std::ffi::{c_char, CString};

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_COLOR_F, D2D_POINT_2F, D2D_RECT_F, D2D_SIZE_U,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, ID2D1HwndRenderTarget,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_HWND_RENDER_TARGET_PROPERTIES,
    D2D1_PRESENT_OPTIONS_NONE, D2D1_RENDER_TARGET_PROPERTIES,
};
use windows::Win32::Graphics::Gdi::InvalidateRect;

use crate::text_renderer::{self, FontSet, RenderToken};

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

    // Theme colors (VS Code dark defaults)
    background_color: D2D1_COLOR_F,
    gutter_bg_color: D2D1_COLOR_F,
    gutter_fg_color: D2D1_COLOR_F,
    default_text_color: D2D1_COLOR_F,
    selection_color: D2D1_COLOR_F,
    cursor_color: D2D1_COLOR_F,
}

fn is_null_hwnd(hwnd: HWND) -> bool {
    hwnd.0 == 0
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
            ghost_text: None,
            scroll_offset: 0.0,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            scroll_callback: None,
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

    /// No-op during construction. HWND is created in attach_to_parent()
    /// because Win32 child windows require a valid parent at creation time.
    pub fn init_hwnd(&mut self) {
        // HWND creation deferred to attach_to_parent
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
        }
    }

    /// Called from the WndProc's WM_KEYDOWN handler.
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

    /// Called from the WndProc's WM_LBUTTONDOWN handler.
    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
        }
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the WndProc's WM_MOUSEWHEEL handler.
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
        self.invalidate();
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

    pub fn render_line(
        &mut self,
        line_number: i32,
        text: &str,
        tokens_json: &str,
        y_offset: f64,
    ) {
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
        if let Some(ref rt) = self.render_target {
            let size = D2D_SIZE_U {
                width: width.max(1),
                height: height.max(1),
            };
            unsafe {
                let _ = rt.Resize(&size);
            }
        }
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
