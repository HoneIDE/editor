//! Android EditorView: Canvas/Skia via JNI.
//!
//! Production implementation:
//! - JNI calls to android.graphics.Canvas and android.graphics.Paint
//! - Per-token color via Paint.setColor()
//! - Canvas.drawText() for each token span
//! - Pre-render lines to Bitmap objects for fast scrolling

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RenderToken {
    pub s: usize,
    pub e: usize,
    pub c: String,
    pub st: String,
}

pub struct EditorView {
    font_family: String,
    font_size: f64,
    width: f64,
    height: f64,
    scroll_offset_y: f64,
    needs_display: bool,
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
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.font_family = family.to_string();
        self.font_size = size;
        self.needs_display = true;
    }

    pub fn render_line(&mut self, _line_number: i32, _text: &str, _tokens_json: &str, _y_offset: f64) {
        // Production: JNI Canvas.drawText() with per-token Paint colors
    }

    pub fn set_cursor(&mut self, _x: f64, _y: f64, _style: i32) {
        self.needs_display = true;
    }

    pub fn set_selection(&mut self, _regions_json: &str) {
        self.needs_display = true;
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_display = true;
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        text.len() as f64 * self.font_size * 0.6
    }

    pub fn invalidate(&mut self) {
        self.needs_display = true;
    }

    pub fn begin_frame(&mut self) {
        self.needs_display = false;
    }

    pub fn end_frame(&mut self) {}
}
