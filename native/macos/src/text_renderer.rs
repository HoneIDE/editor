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
#[derive(Debug, Clone, Deserialize)]
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

/// A set of font variants (normal, bold, italic, heading sizes) with cached metrics.
pub struct FontSet {
    pub normal: CTFont,
    pub bold: CTFont,
    pub italic: CTFont,
    /// Bold font at ~1.4x size for h1/h2 headings.
    pub heading_large: CTFont,
    /// Bold font at ~1.15x size for h3+ headings.
    pub heading_medium: CTFont,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub leading: f64,
    pub line_height: f64,
    /// Line height for h1/h2 heading font.
    pub heading_large_line_height: f64,
    /// Line height for h3+ heading font.
    pub heading_medium_line_height: f64,
    /// How much the heading-lg text extends above the normal baseline origin.
    /// = heading_large_ascent - normal_ascent
    pub heading_large_y_shift: f64,
    /// Same for heading-md.
    pub heading_medium_y_shift: f64,
    /// Character width for heading-lg font (monospace advance of 'M').
    pub heading_large_char_width: f64,
    /// Character width for heading-md font.
    pub heading_medium_char_width: f64,
}

impl FontSet {
    /// Create a new FontSet from a font family name and size.
    pub fn new(family: &str, size: f64) -> Self {
        let mut normal = ct_font::new_from_name(family, size)
            .or(ct_font::new_from_name("Menlo", size))
            .or(ct_font::new_from_name("Monaco", size))
            .expect("No monospace font available");

        // Verify font is monospace: 'M' and 'i' must have equal width.
        // CTFontCreateWithName silently falls back to a proportional font
        // when the requested name doesn't exist.
        let w_m = measure_string_width(&normal, "M");
        let w_i = measure_string_width(&normal, "i");
        if (w_m - w_i).abs() > 0.5 {
            // Proportional fallback detected — use Menlo instead.
            normal = ct_font::new_from_name("Menlo", size)
                .or(ct_font::new_from_name("Monaco", size))
                .expect("No monospace font available");
        }

        let bold = create_variant(&normal, size, K_CT_FONT_BOLD_TRAIT);
        let italic = create_variant(&normal, size, K_CT_FONT_ITALIC_TRAIT);

        // Heading fonts: larger bold variants for markdown headings
        let heading_large_size = (size * 1.4).round();
        let heading_large_base = ct_font::new_from_name(family, heading_large_size)
            .or(ct_font::new_from_name("Menlo", heading_large_size))
            .unwrap_or_else(|_| normal.clone());
        let heading_large = create_variant(&heading_large_base, heading_large_size, K_CT_FONT_BOLD_TRAIT);

        let heading_medium_size = (size * 1.15).round();
        let heading_medium_base = ct_font::new_from_name(family, heading_medium_size)
            .or(ct_font::new_from_name("Menlo", heading_medium_size))
            .unwrap_or_else(|_| normal.clone());
        let heading_medium = create_variant(&heading_medium_base, heading_medium_size, K_CT_FONT_BOLD_TRAIT);

        let ascent = normal.ascent();
        let descent = normal.descent();
        let leading = normal.leading();
        let line_height = (ascent + descent + leading).ceil();

        // Compute heading line heights from their actual font metrics
        let hl_ascent = heading_large.ascent();
        let hl_descent = heading_large.descent();
        let hl_leading = heading_large.leading();
        let heading_large_line_height = (hl_ascent + hl_descent + hl_leading).ceil();
        // How much the heading text extends above where normal text would start.
        // draw_line sets baseline at y + normal_ascent, so heading glyphs extend
        // from (y + ascent - hl_ascent) upward. The shift is hl_ascent - ascent.
        let heading_large_y_shift = hl_ascent - ascent;

        let hm_ascent = heading_medium.ascent();
        let hm_descent = heading_medium.descent();
        let hm_leading = heading_medium.leading();
        let heading_medium_line_height = (hm_ascent + hm_descent + hm_leading).ceil();
        let heading_medium_y_shift = hm_ascent - ascent;

        // Measure the advance width of 'M' for monospace char width
        let char_width = measure_string_width(&normal, "M");
        let heading_large_char_width = measure_string_width(&heading_large, "M");
        let heading_medium_char_width = measure_string_width(&heading_medium, "M");

        FontSet {
            normal,
            bold,
            italic,
            heading_large,
            heading_medium,
            char_width,
            ascent,
            descent,
            leading,
            line_height,
            heading_large_line_height,
            heading_medium_line_height,
            heading_large_y_shift,
            heading_medium_y_shift,
            heading_large_char_width,
            heading_medium_char_width,
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
            "heading-lg" => &self.heading_large,
            "heading-md" => &self.heading_medium,
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
    if text.is_empty() {
        return 0.0;
    }
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
        return (0.2, 0.2, 0.2); // default dark grey (visible on both light and dark bg)
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

/// Result of parsing packed tokens: tokens + optional per-line background color.
pub struct ParsedTokens {
    pub tokens: Vec<RenderToken>,
    /// Optional line background color (from BG: prefix).
    pub line_bg: Option<(f64, f64, f64)>,
}

/// Parse packed token format: "start,end,hexColor,styleInt|start,end,hexColor,styleInt|..."
/// styleInt: 0=normal, 1=italic, 2=bold, 3=heading-lg, 4=heading-md.
/// Optional prefix: "BG:rrggbb|" sets a line background color.
/// Replaces JSON token parsing for the new TS-authoritative render protocol.
pub fn parse_packed_tokens(packed: &str) -> ParsedTokens {
    if packed.is_empty() {
        return ParsedTokens { tokens: Vec::new(), line_bg: None };
    }
    let mut tokens = Vec::new();
    let mut line_bg: Option<(f64, f64, f64)> = None;
    for segment in packed.split('|') {
        if segment.is_empty() {
            continue;
        }
        // Check for BG: prefix (line background color)
        if segment.len() >= 5 && &segment[..3] == "BG:" {
            line_bg = Some(parse_hex_color(&segment[3..]));
            continue;
        }
        let mut parts = segment.splitn(4, ',');
        let s = match parts.next() {
            Some(v) => v.parse::<usize>().unwrap_or(0),
            None => continue,
        };
        let e = match parts.next() {
            Some(v) => v.parse::<usize>().unwrap_or(0),
            None => continue,
        };
        let c = match parts.next() {
            Some(v) => {
                let mut hex = String::with_capacity(7);
                hex.push('#');
                hex.push_str(v);
                hex
            }
            None => continue,
        };
        let st = match parts.next() {
            Some("1") => "italic".to_string(),
            Some("2") => "bold".to_string(),
            Some("3") => "heading-lg".to_string(),
            Some("4") => "heading-md".to_string(),
            _ => "normal".to_string(),
        };
        tokens.push(RenderToken { s, e, c, st });
    }
    ParsedTokens { tokens, line_bg }
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
