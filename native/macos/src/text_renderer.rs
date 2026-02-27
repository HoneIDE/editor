//! Core Text based text rendering for macOS.
//!
//! Provides FontSet (normal/bold/italic CTFont variants) and functions
//! to measure and draw text with per-token syntax coloring via CTLine.

use core_foundation::attributed_string::CFMutableAttributedString;
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_graphics::color::CGColor;
use core_graphics::context::CGContext;
use core_graphics::geometry::CGAffineTransform;
use core_text::font::{self as ct_font, CTFont};
use core_text::line::CTLine;
use serde::Deserialize;

// Core Text symbolic traits for creating bold/italic variants
const K_CT_FONT_BOLD_TRAIT: u32 = 1 << 1;
const K_CT_FONT_ITALIC_TRAIT: u32 = 1 << 0;

extern "C" {
    fn CTFontCreateCopyWithSymbolicTraits(
        font: core_text::font::CTFontRef,
        size: f64,
        matrix: *const core_graphics::base::CGFloat,
        sym_trait_value: u32,
        sym_trait_mask: u32,
    ) -> core_text::font::CTFontRef;
}

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

/// A set of font variants (normal, bold, italic) with cached metrics.
pub struct FontSet {
    pub normal: CTFont,
    pub bold: CTFont,
    pub italic: CTFont,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub leading: f64,
    pub line_height: f64,
}

impl FontSet {
    /// Create a new FontSet from a font family name and size.
    pub fn new(family: &str, size: f64) -> Self {
        let normal = ct_font::new_from_name(family, size)
            .or(ct_font::new_from_name("Menlo", size))
            .or(ct_font::new_from_name("Monaco", size))
            .expect("No monospace font available");

        let bold = create_variant(&normal, size, K_CT_FONT_BOLD_TRAIT);
        let italic = create_variant(&normal, size, K_CT_FONT_ITALIC_TRAIT);

        let ascent = normal.ascent();
        let descent = normal.descent();
        let leading = normal.leading();
        let line_height = (ascent + descent + leading).ceil();

        // Measure the advance width of 'M' for monospace char width
        let char_width = measure_string_width(&normal, "M");

        FontSet {
            normal,
            bold,
            italic,
            char_width,
            ascent,
            descent,
            leading,
            line_height,
        }
    }

    /// Measure the width of a text string using CTLine.
    pub fn measure_text(&self, text: &str) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        measure_string_width(&self.normal, text)
    }

    /// Get the font variant for a given style string.
    pub fn font_for_style(&self, style: &str) -> &CTFont {
        match style {
            "bold" => &self.bold,
            "italic" => &self.italic,
            _ => &self.normal,
        }
    }
}

/// Create a bold or italic variant of a font. Falls back to the original if
/// the variant doesn't exist.
fn create_variant(base: &CTFont, size: f64, trait_mask: u32) -> CTFont {
    unsafe {
        let raw = CTFontCreateCopyWithSymbolicTraits(
            base.as_concrete_TypeRef(),
            size,
            std::ptr::null(),
            trait_mask,
            trait_mask,
        );
        if raw.is_null() {
            // Font doesn't have this variant — fall back to base
            base.clone()
        } else {
            CTFont::wrap_under_create_rule(raw)
        }
    }
}

/// Measure the width of a string using CTLine's typographic bounds.
fn measure_string_width(font: &CTFont, text: &str) -> f64 {
    let cf_str = CFString::new(text);
    let mut attr_str = CFMutableAttributedString::new();
    let range = core_foundation::base::CFRange::init(0, 0);
    attr_str.replace_str(&cf_str, range);

    let full_range = core_foundation::base::CFRange::init(0, cf_str.char_len());

    // Set font attribute
    unsafe {
        attr_str.set_attribute(
            full_range,
            core_text::string_attributes::kCTFontAttributeName,
            font,
        );
    }

    let line = CTLine::new_with_attributed_string(attr_str.as_concrete_TypeRef() as *const _);
    let bounds = line.get_typographic_bounds();
    bounds.width
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

/// Text matrix for a flipped NSView.
///
/// When isFlipped returns YES, the CGContext's CTM has a negative y scale.
/// Core Text glyphs are drawn in text-matrix space and then transformed by
/// the CTM. Setting d = -1.0 here flips the glyphs in text space so that
/// the CTM's flip results in correctly-oriented text.
const FLIPPED_TEXT_MATRIX: CGAffineTransform = CGAffineTransform {
    a: 1.0, b: 0.0,
    c: 0.0, d: -1.0,
    tx: 0.0, ty: 0.0,
};

/// Draw a line of text with per-token syntax coloring into a CGContext.
///
/// Each token in `tokens` specifies a column range, color, and font style.
/// Regions not covered by tokens are drawn in `default_color`.
pub fn draw_line(
    ctx: &CGContext,
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

    let cf_str = CFString::new(text);
    let mut attr_str = CFMutableAttributedString::new();
    let range = core_foundation::base::CFRange::init(0, 0);
    attr_str.replace_str(&cf_str, range);

    let str_len = cf_str.char_len();
    let full_range = core_foundation::base::CFRange::init(0, str_len);

    // Set default font + color for the whole string
    unsafe {
        attr_str.set_attribute(
            full_range,
            core_text::string_attributes::kCTFontAttributeName,
            &font_set.normal,
        );
    }
    set_foreground_color(&mut attr_str, full_range, default_color);

    // Apply per-token colors and font styles
    for token in tokens {
        let start = token.s.min(str_len as usize);
        let end = token.e.min(str_len as usize);
        if start >= end {
            continue;
        }
        let token_range = core_foundation::base::CFRange::init(start as isize, (end - start) as isize);

        // Set color
        let color = parse_hex_color(&token.c);
        set_foreground_color(&mut attr_str, token_range, color);

        // Set font style if not normal
        if token.st != "normal" {
            let font = font_set.font_for_style(&token.st);
            unsafe {
                attr_str.set_attribute(
                    token_range,
                    core_text::string_attributes::kCTFontAttributeName,
                    font,
                );
            }
        }
    }

    // Create CTLine and draw
    let line = CTLine::new_with_attributed_string(attr_str.as_concrete_TypeRef() as *const _);

    // Set identity text matrix (Core Text expects this)
    ctx.set_text_matrix(&FLIPPED_TEXT_MATRIX);
    // In a flipped coordinate system, y is the top of the line.
    // Core Text draws from the baseline, so offset by ascent.
    ctx.set_text_position(x, y + font_set.ascent);
    line.draw(ctx);
}

/// Draw simple single-color text (used for line numbers in the gutter).
pub fn draw_text(
    ctx: &CGContext,
    text: &str,
    x: f64,
    y: f64,
    font: &CTFont,
    ascent: f64,
    color: (f64, f64, f64),
) {
    if text.is_empty() {
        return;
    }

    let cf_str = CFString::new(text);
    let mut attr_str = CFMutableAttributedString::new();
    let range = core_foundation::base::CFRange::init(0, 0);
    attr_str.replace_str(&cf_str, range);

    let full_range = core_foundation::base::CFRange::init(0, cf_str.char_len());

    unsafe {
        attr_str.set_attribute(
            full_range,
            core_text::string_attributes::kCTFontAttributeName,
            font,
        );
    }
    set_foreground_color(&mut attr_str, full_range, color);

    let line = CTLine::new_with_attributed_string(attr_str.as_concrete_TypeRef() as *const _);

    ctx.set_text_matrix(&FLIPPED_TEXT_MATRIX);
    ctx.set_text_position(x, y + ascent);
    line.draw(ctx);
}

/// Set the foreground color attribute on a range of an attributed string.
fn set_foreground_color(
    attr_str: &mut CFMutableAttributedString,
    range: core_foundation::base::CFRange,
    color: (f64, f64, f64),
) {
    let cg_color = CGColor::rgb(color.0, color.1, color.2, 1.0);
    unsafe {
        attr_str.set_attribute(
            range,
            core_text::string_attributes::kCTForegroundColorAttributeName,
            &cg_color,
        );
    }
}
