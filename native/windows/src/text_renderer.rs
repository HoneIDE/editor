//! DirectWrite text rendering for Windows.
//!
//! Provides FontSet (normal/bold/italic IDWriteTextFormat variants) and functions
//! to measure and draw text with per-token syntax coloring via IDWriteTextLayout.

use serde::Deserialize;
use windows::core::HSTRING;
use windows::Win32::Foundation::BOOL;
use windows::Win32::Graphics::Direct2D::Common::{D2D1_COLOR_F, D2D_RECT_F};
use windows::Win32::Graphics::Direct2D::{
    ID2D1HwndRenderTarget, D2D1_DRAW_TEXT_OPTIONS_NONE,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection, IDWriteTextFormat,
    DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_METRICS, DWRITE_FONT_STRETCH_NORMAL,
    DWRITE_FONT_STYLE_ITALIC, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_BOLD,
    DWRITE_FONT_WEIGHT_REGULAR, DWRITE_MEASURING_MODE_NATURAL, DWRITE_TEXT_METRICS,
};

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
    pub factory: IDWriteFactory,
    pub normal: IDWriteTextFormat,
    pub bold: IDWriteTextFormat,
    pub italic: IDWriteTextFormat,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub line_height: f64,
    pub font_size: f32,
}

impl FontSet {
    /// Create a new FontSet from a font family name and size.
    pub fn new(family: &str, size: f64) -> Self {
        let size_f32 = size as f32;

        let factory: IDWriteFactory = unsafe {
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .expect("Failed to create DWrite factory")
        };

        let family_h = HSTRING::from(family);
        let locale_h = HSTRING::from("en-us");

        let normal = unsafe {
            factory
                .CreateTextFormat(
                    &family_h,
                    None,
                    DWRITE_FONT_WEIGHT_REGULAR,
                    DWRITE_FONT_STYLE_NORMAL,
                    DWRITE_FONT_STRETCH_NORMAL,
                    size_f32,
                    &locale_h,
                )
                .expect("Failed to create normal text format")
        };

        let bold = unsafe {
            factory
                .CreateTextFormat(
                    &family_h,
                    None,
                    DWRITE_FONT_WEIGHT_BOLD,
                    DWRITE_FONT_STYLE_NORMAL,
                    DWRITE_FONT_STRETCH_NORMAL,
                    size_f32,
                    &locale_h,
                )
                .expect("Failed to create bold text format")
        };

        let italic = unsafe {
            factory
                .CreateTextFormat(
                    &family_h,
                    None,
                    DWRITE_FONT_WEIGHT_REGULAR,
                    DWRITE_FONT_STYLE_ITALIC,
                    DWRITE_FONT_STRETCH_NORMAL,
                    size_f32,
                    &locale_h,
                )
                .expect("Failed to create italic text format")
        };

        // Extract font metrics
        let (ascent, descent, line_height) = Self::extract_metrics(&factory, &family_h, size_f32);

        // Measure "M" width for monospace char width
        let char_width = Self::measure_text_internal(&factory, &normal, "M");

        FontSet {
            factory,
            normal,
            bold,
            italic,
            char_width: char_width as f64,
            ascent,
            descent,
            line_height,
            font_size: size_f32,
        }
    }

    /// Extract font metrics using the system font collection.
    fn extract_metrics(factory: &IDWriteFactory, family: &HSTRING, size: f32) -> (f64, f64, f64) {
        unsafe {
            let mut collection: Option<IDWriteFontCollection> = None;
            if factory
                .GetSystemFontCollection(&mut collection, false)
                .is_ok()
            {
                if let Some(collection) = collection {
                    let mut index = 0u32;
                    let mut exists = BOOL(0);
                    if collection
                        .FindFamilyName(family, &mut index, &mut exists)
                        .is_ok()
                        && exists.as_bool()
                    {
                        if let Ok(font_family) = collection.GetFontFamily(index) {
                            if let Ok(font) = font_family.GetFirstMatchingFont(
                                DWRITE_FONT_WEIGHT_REGULAR,
                                DWRITE_FONT_STRETCH_NORMAL,
                                DWRITE_FONT_STYLE_NORMAL,
                            ) {
                                if let Ok(face) = font.CreateFontFace() {
                                    let mut metrics = DWRITE_FONT_METRICS::default();
                                    face.GetMetrics(&mut metrics);

                                    let design_units = metrics.designUnitsPerEm as f64;
                                    let scale = size as f64 / design_units;
                                    let ascent = metrics.ascent as f64 * scale;
                                    let descent = metrics.descent as f64 * scale;
                                    let line_gap = metrics.lineGap as f64 * scale;
                                    let line_height = (ascent + descent + line_gap).ceil();
                                    return (ascent, descent, line_height);
                                }
                            }
                        }
                    }
                }
            }
        }
        // Fallback metrics
        let line_height = (size as f64 * 1.5).ceil();
        let ascent = size as f64 * 0.8;
        let descent = size as f64 * 0.2;
        (ascent, descent, line_height)
    }

    pub fn measure_text_internal(
        factory: &IDWriteFactory,
        format: &IDWriteTextFormat,
        text: &str,
    ) -> f32 {
        if text.is_empty() {
            return 0.0;
        }
        let wide: Vec<u16> = text.encode_utf16().collect();
        unsafe {
            if let Ok(layout) = factory.CreateTextLayout(&wide, format, 10000.0, 10000.0) {
                let mut metrics = DWRITE_TEXT_METRICS::default();
                if layout.GetMetrics(&mut metrics).is_ok() {
                    return metrics.widthIncludingTrailingWhitespace;
                }
            }
        }
        0.0
    }

    /// Measure the width of a text string.
    pub fn measure_text(&self, text: &str) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        Self::measure_text_internal(&self.factory, &self.normal, text) as f64
    }

    /// Get the text format for a given style string.
    pub fn format_for_style(&self, style: &str) -> &IDWriteTextFormat {
        match style {
            "bold" => &self.bold,
            "italic" => &self.italic,
            _ => &self.normal,
        }
    }
}

/// Parse a "#rrggbb" hex color string to D2D1_COLOR_F.
pub fn parse_hex_color(hex: &str) -> D2D1_COLOR_F {
    let hex = hex.trim_start_matches('#');
    if hex.len() < 6 {
        return D2D1_COLOR_F {
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        };
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255) as f32 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255) as f32 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255) as f32 / 255.0;
    D2D1_COLOR_F { r, g, b, a: 1.0 }
}

/// Draw a line of text with per-token syntax coloring.
///
/// Each token specifies a byte range, color, and font style. Text segments
/// are drawn individually at computed x offsets so UTF-8/UTF-16 column
/// index issues are avoided.
pub fn draw_line(
    rt: &ID2D1HwndRenderTarget,
    text: &str,
    tokens: &[RenderToken],
    x: f64,
    y: f64,
    font_set: &FontSet,
    default_color: D2D1_COLOR_F,
) {
    if text.is_empty() {
        return;
    }

    if tokens.is_empty() {
        draw_text(rt, text, x, y, &font_set.normal, default_color);
        return;
    }

    let text_len = text.len();
    let mut current_x = x;
    let mut last_end = 0usize;

    for token in tokens {
        let start = token.s.min(text_len);
        let end = token.e.min(text_len);
        if start >= end {
            continue;
        }

        // Draw any gap before this token in default color
        if last_end < start {
            let gap_text = &text[last_end..start];
            draw_text(rt, gap_text, current_x, y, &font_set.normal, default_color);
            current_x += FontSet::measure_text_internal(
                &font_set.factory,
                &font_set.normal,
                gap_text,
            ) as f64;
        }

        // Draw the token segment
        let segment = &text[start..end];
        let color = parse_hex_color(&token.c);
        let format = font_set.format_for_style(&token.st);
        draw_text(rt, segment, current_x, y, format, color);
        current_x +=
            FontSet::measure_text_internal(&font_set.factory, format, segment) as f64;

        last_end = end;
    }

    // Draw any trailing text after the last token
    if last_end < text_len {
        let tail = &text[last_end..];
        draw_text(rt, tail, current_x, y, &font_set.normal, default_color);
    }
}

/// Draw simple single-color text (used for gutter line numbers, ghost text, etc.).
pub fn draw_text(
    rt: &ID2D1HwndRenderTarget,
    text: &str,
    x: f64,
    y: f64,
    format: &IDWriteTextFormat,
    color: D2D1_COLOR_F,
) {
    if text.is_empty() {
        return;
    }

    let wide: Vec<u16> = text.encode_utf16().collect();

    unsafe {
        let brush = rt
            .CreateSolidColorBrush(&color, None)
            .expect("Failed to create brush");

        let rect = D2D_RECT_F {
            left: x as f32,
            top: y as f32,
            right: x as f32 + 10000.0,
            bottom: y as f32 + 10000.0,
        };

        rt.DrawText(
            &wide,
            format,
            &rect,
            &brush,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
    }
}
