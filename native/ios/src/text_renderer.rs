//! Core Text rendering for iOS (shared logic with macOS).
//!
//! Uses the same CTFont / CTLine / CTLineDraw pipeline as macOS.
//! The main difference is the UIKit view layer integration.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RenderToken {
    pub s: usize,
    pub e: usize,
    pub c: String,
    pub st: String,
}

pub struct TextRenderer {
    font_family: String,
    font_size: f64,
}

impl TextRenderer {
    pub fn new() -> Self {
        Self {
            font_family: "Menlo".to_string(),
            font_size: 14.0,
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.font_family = family.to_string();
        self.font_size = size;
    }

    pub fn render_line(&self, _line_number: i32, _text: &str, _tokens_json: &str, _y_offset: f64) {
        // Production: identical CTLine rendering to macOS
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        text.len() as f64 * self.font_size * 0.6
    }
}
