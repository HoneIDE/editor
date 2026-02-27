//! Web native rendering for Hone Editor.
//!
//! Compiled to WASM via wasm-bindgen. Renders using DOM elements:
//! - Each visible line is a <div> with position:absolute
//! - Each token is a <span> with inline color
//! - Cursor is a <div> with CSS blink animation
//! - Selections are semi-transparent <div> overlays

use wasm_bindgen::prelude::*;

mod editor_view;
mod dom_renderer;

use editor_view::EditorView;
use std::ffi::{c_char, CStr};

// Note: For WASM, we use wasm_bindgen exports instead of extern "C".
// Perry's web target handles the bridging between C FFI and WASM exports.

/// Create a new editor view.
#[wasm_bindgen]
pub fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    Box::into_raw(Box::new(EditorView::new(width, height)))
}

/// Destroy an editor view.
#[wasm_bindgen]
pub fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() {
        unsafe { drop(Box::from_raw(view)); }
    }
}

/// Set font (WASM-friendly string version).
#[wasm_bindgen]
pub fn hone_editor_set_font_str(view: *mut EditorView, family: &str, size: f64) {
    let view = unsafe { &mut *view };
    view.set_font(family, size);
}

/// Render a line (WASM-friendly string version).
#[wasm_bindgen]
pub fn hone_editor_render_line_str(
    view: *mut EditorView,
    line_number: i32,
    text: &str,
    tokens_json: &str,
    y_offset: f64,
) {
    let view = unsafe { &mut *view };
    view.render_line(line_number, text, tokens_json, y_offset);
}

/// Set cursor.
#[wasm_bindgen]
pub fn hone_editor_set_cursor(view: *mut EditorView, x: f64, y: f64, style: i32) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style);
}

/// Set selection.
#[wasm_bindgen]
pub fn hone_editor_set_selection_str(view: *mut EditorView, regions_json: &str) {
    let view = unsafe { &mut *view };
    view.set_selection(regions_json);
}

/// Scroll.
#[wasm_bindgen]
pub fn hone_editor_scroll(view: *mut EditorView, offset_y: f64) {
    let view = unsafe { &mut *view };
    view.scroll(offset_y);
}

/// Measure text.
#[wasm_bindgen]
pub fn hone_editor_measure_text_str(view: *mut EditorView, text: &str) -> f64 {
    let view = unsafe { &*view };
    view.measure_text(text)
}

/// Invalidate.
#[wasm_bindgen]
pub fn hone_editor_invalidate(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.invalidate();
}

/// Begin frame.
#[wasm_bindgen]
pub fn hone_editor_begin_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.begin_frame();
}

/// End frame.
#[wasm_bindgen]
pub fn hone_editor_end_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.end_frame();
}
