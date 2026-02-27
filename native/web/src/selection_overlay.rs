//! CSS-based selection highlighting and cursor rendering for the web.
//!
//! Production implementation:
//! - Uses ::selection pseudo-element for single selections where possible
//! - Falls back to manual <div> overlays for multi-cursor selections
//! - Cursor <div> with CSS @keyframes blink animation
//! - Selection color matches the browser's theme or custom CSS variable

use serde::Deserialize;

/// Selection region from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct SelectionRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Cursor position and style from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct CursorPosition {
    pub x: f64,
    pub y: f64,
    pub style: i32, // 0=line, 1=block, 2=underline
}

/// Generates CSS for selection overlays.
pub fn selection_css(class_prefix: &str, selection_color: &str) -> String {
    format!(
        r#"
.{prefix}-selection {{
    position: absolute;
    background-color: {color};
    opacity: 0.3;
    pointer-events: none;
    z-index: 1;
}}
.{prefix}-cursor-line {{
    position: absolute;
    width: 2px;
    pointer-events: none;
    z-index: 2;
    animation: {prefix}-blink 1s step-end infinite;
}}
.{prefix}-cursor-block {{
    position: absolute;
    pointer-events: none;
    z-index: 2;
    opacity: 0.5;
    animation: {prefix}-blink 1s step-end infinite;
}}
.{prefix}-cursor-underline {{
    position: absolute;
    height: 2px;
    pointer-events: none;
    z-index: 2;
    animation: {prefix}-blink 1s step-end infinite;
}}
@keyframes {prefix}-blink {{
    0%, 100% {{ opacity: 1; }}
    50% {{ opacity: 0; }}
}}
"#,
        prefix = class_prefix,
        color = selection_color,
    )
}

/// Get the CSS class for a cursor style.
pub fn cursor_class(class_prefix: &str, style: i32) -> String {
    match style {
        0 => format!("{}-cursor-line", class_prefix),
        1 => format!("{}-cursor-block", class_prefix),
        2 => format!("{}-cursor-underline", class_prefix),
        _ => format!("{}-cursor-line", class_prefix),
    }
}
