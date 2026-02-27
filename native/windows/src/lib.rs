//! Windows native rendering for Hone Editor.
//!
//! Uses DirectWrite for text rendering and Direct2D for drawing.
//! DirectComposition provides smooth scrolling via composition surfaces.

use std::ffi::{c_char, CStr};

mod editor_view;

use editor_view::EditorView;

#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    Box::into_raw(Box::new(EditorView::new(width, height)))
}

#[no_mangle]
pub extern "C" fn hone_editor_attach_to_view(view: *mut EditorView, parent_view: i64) {
    let view = unsafe { &mut *view };
    view.parent_view = parent_view as *mut std::ffi::c_void;
}

#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() { unsafe { drop(Box::from_raw(view)); } }
}

#[no_mangle]
pub extern "C" fn hone_editor_set_font(view: *mut EditorView, family: *const c_char, size: f64) {
    let view = unsafe { &mut *view };
    let family_str = unsafe { CStr::from_ptr(family) }.to_str().unwrap_or("Consolas");
    view.set_font(family_str, size);
}

#[no_mangle]
pub extern "C" fn hone_editor_render_line(view: *mut EditorView, line_number: i32, text: *const c_char, tokens_json: *const c_char, y_offset: f64) {
    let view = unsafe { &mut *view };
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    let tokens_str = unsafe { CStr::from_ptr(tokens_json) }.to_str().unwrap_or("[]");
    view.render_line(line_number, text_str, tokens_str, y_offset);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(view: *mut EditorView, x: f64, y: f64, style: i32) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_selection(view: *mut EditorView, regions_json: *const c_char) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(regions_json) }.to_str().unwrap_or("[]");
    view.set_selection(json_str);
}

#[no_mangle]
pub extern "C" fn hone_editor_scroll(view: *mut EditorView, offset_y: f64) {
    let view = unsafe { &mut *view };
    view.scroll(offset_y);
}

#[no_mangle]
pub extern "C" fn hone_editor_measure_text(view: *mut EditorView, text: *const c_char) -> f64 {
    let view = unsafe { &*view };
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    view.measure_text(text_str)
}

#[no_mangle]
pub extern "C" fn hone_editor_invalidate(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.invalidate();
}

#[no_mangle]
pub extern "C" fn hone_editor_begin_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.begin_frame();
}

#[no_mangle]
pub extern "C" fn hone_editor_end_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.end_frame();
}
