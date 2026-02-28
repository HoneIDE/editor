//! Pango-based text rendering for Linux.
//!
//! Provides FontSet (normal/bold/italic font descriptions) and functions
//! to measure and draw text with per-token syntax coloring via Pango layouts.

use pango::prelude::*;
use serde::Deserialize;

/// Token data from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct RenderToken {
    /// Start column (byte offset).
    pub s: usize,
    /// End column (byte offset).
    pub e: usize,
    /// Hex color string (e.g., "#569cd6").
    pub c: String,
    /// Font style: "normal", "italic", or "bold".
    pub st: String,
}

/// A set of font variants (normal, bold, italic) with cached metrics.
pub struct FontSet {
    pub normal: pango::FontDescription,
    pub bold: pango::FontDescription,
    pub italic: pango::FontDescription,
    pub pango_context: pango::Context,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub line_height: f64,
}

impl FontSet {
    /// Create a new FontSet from a font family name and size.
    pub fn new(family: &str, size: f64) -> Self {
        let mut normal = pango::FontDescription::new();
        normal.set_family(family);
        normal.set_size((size * pango::SCALE as f64) as i32);
        normal.set_weight(pango::Weight::Normal);
        normal.set_style(pango::Style::Normal);

        let mut bold = normal.clone();
        bold.set_weight(pango::Weight::Bold);

        let mut italic = normal.clone();
        italic.set_style(pango::Style::Italic);

        // Create a Pango context from the default font map
        let font_map = pangocairo::FontMap::default();
        let pango_context = font_map.create_context();

        // Extract font metrics
        let metrics = pango_context.metrics(Some(&normal), None);
        let ascent = metrics.ascent() as f64 / pango::SCALE as f64;
        let descent = metrics.descent() as f64 / pango::SCALE as f64;
        let line_height = (ascent + descent).ceil();

        // Measure 'M' for monospace character width
        let char_width = measure_text_width(&pango_context, &normal, "M");

        FontSet {
            normal,
            bold,
            italic,
            pango_context,
            char_width,
            ascent,
            descent,
            line_height,
        }
    }

    /// Measure the width of a text string.
    pub fn measure_text(&self, text: &str) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        measure_text_width(&self.pango_context, &self.normal, text)
    }

    /// Get the font description for a given style string.
    pub fn font_desc_for_style(&self, style: &str) -> &pango::FontDescription {
        match style {
            "bold" => &self.bold,
            "italic" => &self.italic,
            _ => &self.normal,
        }
    }
}

/// Measure text width using a Pango layout.
fn measure_text_width(ctx: &pango::Context, font_desc: &pango::FontDescription, text: &str) -> f64 {
    let layout = pango::Layout::new(ctx);
    layout.set_font_description(Some(font_desc));
    layout.set_text(text);
    let (width, _) = layout.pixel_size();
    width as f64
}

/// Parse a "#rrggbb" hex color string to (r, g, b) floats in [0, 1].
pub fn parse_hex_color(hex: &str) -> (f64, f64, f64) {
    let hex = hex.trim_start_matches('#');
    if hex.len() < 6 {
        return (1.0, 1.0, 1.0); // default white
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255) as f64 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255) as f64 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255) as f64 / 255.0;
    (r, g, b)
}

/// Parse a "#rrggbb" hex color to Pango's u16 color range (0-65535).
fn parse_hex_color_u16(hex: &str) -> (u16, u16, u16) {
    let hex = hex.trim_start_matches('#');
    if hex.len() < 6 {
        return (65535, 65535, 65535);
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255) as u16 * 257;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255) as u16 * 257;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255) as u16 * 257;
    (r, g, b)
}

/// Draw a line of text with per-token syntax coloring into a Cairo context.
///
/// Each token in `tokens` specifies a byte range, color, and font style.
/// Regions not covered by tokens are drawn in `default_color`.
pub fn draw_line(
    cr: &cairo::Context,
    text: &str,
    tokens: &[RenderToken],
    x: f64,
    y: f64,
    font_set: &FontSet,
    default_color: (f64, f64, f64),
) {
    if text.is_empty() {
        return;
    }

    let layout = pango::Layout::new(&font_set.pango_context);
    layout.set_font_description(Some(&font_set.normal));
    layout.set_text(text);

    let attr_list = pango::AttrList::new();
    let text_len = text.len() as u32;

    // Set default color for the whole string
    let (dr, dg, db) = (
        (default_color.0 * 65535.0) as u16,
        (default_color.1 * 65535.0) as u16,
        (default_color.2 * 65535.0) as u16,
    );
    let mut def_color_attr = pango::AttrColor::new_foreground(dr, dg, db);
    def_color_attr.set_start_index(0);
    def_color_attr.set_end_index(text_len);
    attr_list.insert(def_color_attr);

    // Apply per-token colors and font styles
    for token in tokens {
        let start = token.s.min(text_len as usize) as u32;
        let end = token.e.min(text_len as usize) as u32;
        if start >= end {
            continue;
        }

        // Set color
        let (r, g, b) = parse_hex_color_u16(&token.c);
        let mut color_attr = pango::AttrColor::new_foreground(r, g, b);
        color_attr.set_start_index(start);
        color_attr.set_end_index(end);
        attr_list.insert(color_attr);

        // Set font style if not normal
        match token.st.as_str() {
            "bold" => {
                let mut weight_attr = pango::AttrInt::new_weight(pango::Weight::Bold);
                weight_attr.set_start_index(start);
                weight_attr.set_end_index(end);
                attr_list.insert(weight_attr);
            }
            "italic" => {
                let mut style_attr = pango::AttrInt::new_style(pango::Style::Italic);
                style_attr.set_start_index(start);
                style_attr.set_end_index(end);
                attr_list.insert(style_attr);
            }
            _ => {}
        }
    }

    layout.set_attributes(Some(&attr_list));

    cr.move_to(x, y);
    pangocairo::functions::show_layout(cr, &layout);
}

/// Draw simple single-color text (used for line numbers in the gutter).
pub fn draw_text(
    cr: &cairo::Context,
    text: &str,
    x: f64,
    y: f64,
    font_desc: &pango::FontDescription,
    pango_ctx: &pango::Context,
    color: (f64, f64, f64),
) {
    if text.is_empty() {
        return;
    }

    let layout = pango::Layout::new(pango_ctx);
    layout.set_font_description(Some(font_desc));
    layout.set_text(text);

    let attr_list = pango::AttrList::new();
    let (r, g, b) = (
        (color.0 * 65535.0) as u16,
        (color.1 * 65535.0) as u16,
        (color.2 * 65535.0) as u16,
    );
    let mut color_attr = pango::AttrColor::new_foreground(r, g, b);
    color_attr.set_start_index(0);
    color_attr.set_end_index(text.len() as u32);
    attr_list.insert(color_attr);
    layout.set_attributes(Some(&attr_list));

    cr.move_to(x, y);
    pangocairo::functions::show_layout(cr, &layout);
}
