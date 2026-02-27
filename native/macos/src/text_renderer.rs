//! Core Text based text rendering for macOS.
//!
//! Creates attributed strings with per-token colors and renders
//! them using CTLine into a Core Graphics context.

use serde::Deserialize;

/// Token data from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct RenderToken {
    /// Start column.
    pub s: usize,
    /// End column.
    pub e: usize,
    /// Hex color string (e.g., "#569cd6").
    pub c: String,
    /// Font style: "normal", "italic", or "bold".
    pub st: String,
}

/// Font configuration.
pub struct FontConfig {
    pub family: String,
    pub size: f64,
    // In production: CTFont handle, ascent/descent metrics
}

impl FontConfig {
    pub fn new(family: &str, size: f64) -> Self {
        Self {
            family: family.to_string(),
            size,
        }
    }

    /// Measure the width of text in the current font.
    ///
    /// In production, this uses CTLineGetTypographicBounds or
    /// CTFontGetAdvancesForGlyphs for accurate measurement.
    /// For scaffolding, approximates based on font size.
    pub fn measure_text(&self, text: &str) -> f64 {
        // Approximate: 0.6 * font_size per character for monospace
        // Production: use Core Text CTLine measurement
        text.len() as f64 * self.size * 0.6
    }
}

/// Text renderer using Core Text.
pub struct TextRenderer {
    pub font: FontConfig,
}

impl TextRenderer {
    pub fn new() -> Self {
        Self {
            font: FontConfig::new("Menlo", 14.0),
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.font = FontConfig::new(family, size);
    }

    /// Render a line of text with syntax tokens.
    ///
    /// In production:
    /// 1. Create NSMutableAttributedString from text
    /// 2. For each token, apply color + font style attributes
    /// 3. Create CTLine from attributed string
    /// 4. Position context at (gutter_width, y_offset + ascent)
    /// 5. CTLineDraw into the CG context
    pub fn render_line(
        &self,
        _line_number: i32,
        text: &str,
        tokens_json: &str,
        _y_offset: f64,
    ) {
        // Parse tokens
        let _tokens: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();

        // Production implementation:
        // - Create CTFont from self.font
        // - Build attributed string with per-token colors
        // - Create CTLine and draw at y_offset
        let _ = text;
    }

    /// Render ghost text (semi-transparent).
    pub fn render_ghost_text(
        &self,
        _text: &str,
        _x: f64,
        _y: f64,
        _color: &str,
    ) {
        // Production: render with alpha = 0.4
    }

    /// Render decorations (underlines, backgrounds).
    pub fn render_decorations(&self, _decorations_json: &str) {
        // Production: draw underlines (wavy for errors) and
        // background highlights using CG paths
    }
}
