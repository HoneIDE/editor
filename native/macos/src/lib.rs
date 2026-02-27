//! macOS native rendering for Hone Editor.
//!
//! Implements the FFI contract using Core Text for text rendering,
//! Core Animation (CALayer) for compositing, and optionally Metal
//! for high-performance texture atlas rendering.

mod text_renderer;
mod layer_manager;
mod editor_view;

use editor_view::EditorView;
use std::ffi::{c_char, CStr};

// === FFI Contract Implementation ===

/// Create a new editor view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    let view = Box::new(EditorView::new(width, height));
    Box::into_raw(view)
}

/// Destroy an editor view and free all resources.
#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() {
        unsafe { drop(Box::from_raw(view)); }
    }
}

/// Set the editor font family and size.
#[no_mangle]
pub extern "C" fn hone_editor_set_font(
    view: *mut EditorView,
    family: *const c_char,
    size: f64,
) {
    let view = unsafe { &mut *view };
    let family_str = unsafe { CStr::from_ptr(family) }.to_str().unwrap_or("Menlo");
    view.set_font(family_str, size);
}

/// Render a single line of text with syntax coloring.
#[no_mangle]
pub extern "C" fn hone_editor_render_line(
    view: *mut EditorView,
    line_number: i32,
    text: *const c_char,
    tokens_json: *const c_char,
    y_offset: f64,
) {
    let view = unsafe { &mut *view };
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    let tokens_str = unsafe { CStr::from_ptr(tokens_json) }.to_str().unwrap_or("[]");
    view.render_line(line_number, text_str, tokens_str, y_offset);
}

/// Set the cursor position and style.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(
    view: *mut EditorView,
    x: f64,
    y: f64,
    style: i32,
) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style);
}

/// Set selection highlight regions.
#[no_mangle]
pub extern "C" fn hone_editor_set_selection(
    view: *mut EditorView,
    regions_json: *const c_char,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(regions_json) }.to_str().unwrap_or("[]");
    view.set_selection(json_str);
}

/// Set the vertical scroll offset.
#[no_mangle]
pub extern "C" fn hone_editor_scroll(view: *mut EditorView, offset_y: f64) {
    let view = unsafe { &mut *view };
    view.scroll(offset_y);
}

/// Measure the width of a text string in the current font.
#[no_mangle]
pub extern "C" fn hone_editor_measure_text(
    view: *mut EditorView,
    text: *const c_char,
) -> f64 {
    let view = unsafe { &*view };
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    view.measure_text(text_str)
}

/// Invalidate the view, triggering a redraw on the next frame.
#[no_mangle]
pub extern "C" fn hone_editor_invalidate(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.invalidate();
}

// === Optional Extended FFI ===

/// Render decorations (underlines, backgrounds) for a line.
#[no_mangle]
pub extern "C" fn hone_editor_render_decorations(
    view: *mut EditorView,
    decorations_json: *const c_char,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(decorations_json) }.to_str().unwrap_or("[]");
    view.render_decorations(json_str);
}

/// Render ghost text (semi-transparent inline completion).
#[no_mangle]
pub extern "C" fn hone_editor_render_ghost_text(
    view: *mut EditorView,
    text: *const c_char,
    x: f64,
    y: f64,
    color: *const c_char,
) {
    let view = unsafe { &mut *view };
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    let color_str = unsafe { CStr::from_ptr(color) }.to_str().unwrap_or("#808080");
    view.render_ghost_text(text_str, x, y, color_str);
}

/// Set multiple cursor positions.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursors(
    view: *mut EditorView,
    cursors_json: *const c_char,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(cursors_json) }.to_str().unwrap_or("[]");
    view.set_cursors(json_str);
}

/// Begin a frame batch.
#[no_mangle]
pub extern "C" fn hone_editor_begin_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.begin_frame();
}

/// End a frame batch.
#[no_mangle]
pub extern "C" fn hone_editor_end_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.end_frame();
}
