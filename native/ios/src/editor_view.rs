//! iOS EditorView: wraps text renderer with UIKit integration.

use crate::text_renderer::TextRenderer;

pub struct EditorView {
    text_renderer: TextRenderer,
    width: f64,
    height: f64,
    scroll_offset_y: f64,
    needs_display: bool,
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            text_renderer: TextRenderer::new(),
            width,
            height,
            scroll_offset_y: 0.0,
            needs_display: true,
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.text_renderer.set_font(family, size);
        self.needs_display = true;
    }

    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        self.text_renderer.render_line(line_number, text, tokens_json, y_offset);
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
        self.text_renderer.measure_text(text)
    }

    pub fn invalidate(&mut self) {
        self.needs_display = true;
    }

    pub fn begin_frame(&mut self) {
        self.needs_display = false;
    }

    pub fn end_frame(&mut self) {}
}
