//! Web EditorView: DOM-based rendering.
//!
//! Production implementation:
//! - Each visible line is a <div> with position:absolute and top set by y_offset
//! - Each token is a <span> with color set to the token color
//! - Cursor is a <div> with CSS animation for blinking
//! - Selection is rendered via <div> overlays with semi-transparent background

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
    // In production: references to DOM container element, line pool, etc.
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
        // Production: update CSS font-family and font-size on container
    }

    pub fn render_line(&mut self, _line_number: i32, _text: &str, _tokens_json: &str, _y_offset: f64) {
        // Production:
        // 1. Get or create a <div> for this line from the pool
        // 2. Clear existing <span> children
        // 3. For each token, create <span> with style="color: {token.c}"
        // 4. Set div.style.top = y_offset + "px"
    }

    pub fn set_cursor(&mut self, _x: f64, _y: f64, _style: i32) {
        self.needs_display = true;
        // Production: position cursor <div> at (x, y), set width/height based on style
    }

    pub fn set_selection(&mut self, _regions_json: &str) {
        self.needs_display = true;
        // Production: create/update selection overlay <div> elements
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_display = true;
        // Production: set container.scrollTop or transform: translateY
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        // Production: use a hidden <canvas> with ctx.measureText()
        // or a hidden <span> with getBoundingClientRect()
        text.len() as f64 * self.font_size * 0.6
    }

    pub fn invalidate(&mut self) {
        self.needs_display = true;
        // Production: requestAnimationFrame for next repaint
    }

    pub fn begin_frame(&mut self) {
        self.needs_display = false;
        // Production: batch DOM mutations
    }

    pub fn end_frame(&mut self) {
        // Production: flush batched DOM mutations
    }
}
