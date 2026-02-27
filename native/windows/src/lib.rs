//! Windows native rendering for Hone Editor.
//!
//! Uses DirectWrite for text rendering and Direct2D for drawing.
//! DirectComposition provides smooth scrolling via composition surfaces.

use std::ffi::{c_char, CStr};

mod compositor;
mod editor_view;
mod input_handler;
mod text_renderer;

pub use editor_view::EditorView;
use editor_view::{ActionCallback, MouseDownCallback, ScrollCallback, TextInputCallback};

// === FFI Contract Implementation ===

/// Create a new editor view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    // Initialize COM for the current thread (needed for DirectWrite)
    unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_APARTMENTTHREADED,
        );
    }

    let mut ev = Box::new(EditorView::new(width, height));
    ev.init_hwnd();
    Box::into_raw(ev)
}

/// Attach the editor view to a parent HWND.
#[no_mangle]
pub extern "C" fn hone_editor_attach_to_view(view: *mut EditorView, parent_view: i64) {
    let view = unsafe { &mut *view };
    view.attach_to_parent(parent_view as *mut std::ffi::c_void);
}

/// Destroy an editor view and free all resources.
#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() {
        unsafe {
            drop(Box::from_raw(view));
        }
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
    let family_str = unsafe { CStr::from_ptr(family) }.to_str().unwrap_or("Consolas");
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

/// Set the callback for text input (printable characters).
#[no_mangle]
pub extern "C" fn hone_editor_set_text_input_callback(
    view: *mut EditorView,
    callback: TextInputCallback,
) {
    let view = unsafe { &mut *view };
    view.set_text_input_callback(callback);
}

/// Set the callback for action selectors (arrows, delete, enter, etc.).
#[no_mangle]
pub extern "C" fn hone_editor_set_action_callback(
    view: *mut EditorView,
    callback: ActionCallback,
) {
    let view = unsafe { &mut *view };
    view.set_action_callback(callback);
}

/// Set the callback for mouse-down events (click to position cursor).
#[no_mangle]
pub extern "C" fn hone_editor_set_mouse_down_callback(
    view: *mut EditorView,
    callback: MouseDownCallback,
) {
    let view = unsafe { &mut *view };
    view.set_mouse_down_callback(callback);
}

/// Set the callback for scroll wheel events.
#[no_mangle]
pub extern "C" fn hone_editor_set_scroll_callback(
    view: *mut EditorView,
    callback: ScrollCallback,
) {
    let view = unsafe { &mut *view };
    view.set_scroll_callback(callback);
}

/// Add a custom item to the editor's right-click context menu.
/// The `action_id` is dispatched through the action callback when the item is clicked.
#[no_mangle]
pub extern "C" fn hone_editor_add_context_menu_item(
    view: *mut EditorView,
    title: *const c_char,
    action_id: *const c_char,
) {
    let view = unsafe { &mut *view };
    let title_str = unsafe { CStr::from_ptr(title) }.to_str().unwrap_or("");
    let action_str = unsafe { CStr::from_ptr(action_id) }.to_str().unwrap_or("");
    view.add_context_menu_item(title_str, action_str);
}

/// Remove all custom context menu items.
#[no_mangle]
pub extern "C" fn hone_editor_clear_context_menu_items(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_context_menu_items();
}

/// Get the HWND handle for the editor view (as an isize, matching HWND representation).
#[no_mangle]
pub extern "C" fn hone_editor_hwnd(view: *mut EditorView) -> isize {
    let view = unsafe { &*view };
    view.hwnd().0
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
