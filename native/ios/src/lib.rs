//! iOS native rendering for Hone Editor.
//!
//! Implements the FFI contract using Core Text for text rendering
//! and a drawRect:-based UIView for compositing. Shares the Core Text
//! rendering pipeline with the macOS crate.
//!
//! IMPORTANT: All numeric parameters that Perry passes as TypeScript `number`
//! must be `f64` here (Perry's AOT codegen puts TS numbers in ARM64 float
//! registers v0, v1, v2...). Using `i32` causes an ABI mismatch where Rust
//! reads from the wrong register. Similarly, string parameters must use
//! `*const u8` + `str_from_header` (Perry's StringHeader format), not CStr.

#[macro_use]
extern crate objc;

mod text_renderer;
mod view;
mod editor_view;
pub mod tokenizer;
pub mod string_header;

pub use editor_view::EditorView;

use editor_view::{ActionCallback, MouseDownCallback, ScrollCallback, TextInputCallback};
use string_header::str_from_header;

// === FFI Contract Implementation ===

/// Platform detection: returns 1.0 on iOS, 0.0 (stub) on macOS.
#[no_mangle]
pub extern "C" fn hone_editor_is_ios() -> f64 {
    1.0
}

/// Create a new editor view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    let mut ev = Box::new(EditorView::new(width, height));
    ev.init_uiview();
    Box::into_raw(ev)
}

/// Attach the editor view to a parent UIView.
#[no_mangle]
pub extern "C" fn hone_editor_attach_to_view(view: *mut EditorView, parent_view: i64) {
    let view = unsafe { &mut *view };
    view.attach_to_parent(parent_view as *mut std::ffi::c_void);
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
    family: *const u8,
    size: f64,
) {
    let view = unsafe { &mut *view };
    let family_str = str_from_header(family);
    if family_str.is_empty() { return; }
    view.set_font(family_str, size);
}

/// Render a single line of text with syntax coloring.
///
/// `line_number` is f64 because Perry passes TypeScript numbers in ARM64 float
/// registers (v0, v1…). Using i32 would cause Rust to read from the wrong
/// register and receive a garbage value.
#[no_mangle]
pub extern "C" fn hone_editor_render_line(
    view: *mut EditorView,
    line_number: f64,
    text: *const u8,
    tokens_json: *const u8,
    y_offset: f64,
) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(tokens_json);
    let tokens_str = if tokens_str.is_empty() { "[]" } else { tokens_str };
    view.render_line(line_number as i32, text_str, tokens_str, y_offset);
}

/// Set the cursor position and style.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(
    view: *mut EditorView,
    x: f64,
    y: f64,
    style: f64,
) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style as i32);
}

/// Set selection highlight regions.
#[no_mangle]
pub extern "C" fn hone_editor_set_selection(
    view: *mut EditorView,
    regions_json: *const u8,
) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(regions_json);
    let json_str = if json_str.is_empty() { "[]" } else { json_str };
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
    text: *const u8,
) -> f64 {
    let view = unsafe { &*view };
    let text_str = str_from_header(text);
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
    decorations_json: *const u8,
) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(decorations_json);
    let json_str = if json_str.is_empty() { "[]" } else { json_str };
    view.render_decorations(json_str);
}

/// Render ghost text (semi-transparent inline completion).
#[no_mangle]
pub extern "C" fn hone_editor_render_ghost_text(
    view: *mut EditorView,
    text: *const u8,
    x: f64,
    y: f64,
    color: *const u8,
) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let color_str = str_from_header(color);
    let color_str = if color_str.is_empty() { "#808080" } else { color_str };
    view.render_ghost_text(text_str, x, y, color_str);
}

/// Set multiple cursor positions.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursors(
    view: *mut EditorView,
    cursors_json: *const u8,
) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(cursors_json);
    let json_str = if json_str.is_empty() { "[]" } else { json_str };
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

/// Set the callback for touch-down events (tap to position cursor).
#[no_mangle]
pub extern "C" fn hone_editor_set_mouse_down_callback(
    view: *mut EditorView,
    callback: MouseDownCallback,
) {
    let view = unsafe { &mut *view };
    view.set_mouse_down_callback(callback);
}

/// Set the callback for scroll events (pan gesture).
#[no_mangle]
pub extern "C" fn hone_editor_set_scroll_callback(
    view: *mut EditorView,
    callback: ScrollCallback,
) {
    let view = unsafe { &mut *view };
    view.set_scroll_callback(callback);
}

/// Add a custom item to the editor's context menu.
/// The `action_id` is dispatched through the action callback when the item is clicked.
#[no_mangle]
pub extern "C" fn hone_editor_add_context_menu_item(
    view: *mut EditorView,
    title: *const u8,
    action_id: *const u8,
) {
    let view = unsafe { &mut *view };
    let title_str = str_from_header(title);
    let action_str = str_from_header(action_id);
    view.add_context_menu_item(title_str, action_str);
}

/// Remove all custom context menu items.
#[no_mangle]
pub extern "C" fn hone_editor_clear_context_menu_items(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_context_menu_items();
}

/// Get the UIView handle for the editor view (as a raw pointer).
#[no_mangle]
pub extern "C" fn hone_editor_uiview(view: *mut EditorView) -> *mut std::ffi::c_void {
    let view = unsafe { &*view };
    view.uiview() as *mut std::ffi::c_void
}

/// Alias so the cross-platform TypeScript (which calls hone_editor_nsview on all targets)
/// resolves correctly on iOS without needing a platform branch in TS code.
#[no_mangle]
pub extern "C" fn hone_editor_nsview(view: *mut EditorView) -> *mut std::ffi::c_void {
    let view = unsafe { &*view };
    view.uiview() as *mut std::ffi::c_void
}

// === Editor Color Settings ===

/// Set the editor background color (also sets gutter bg to match).
#[no_mangle]
pub extern "C" fn hone_editor_set_bg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_bg_color(r, g, b);
}

/// Set the default text foreground color.
#[no_mangle]
pub extern "C" fn hone_editor_set_fg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_fg_color(r, g, b);
}

/// Set the gutter (line number) foreground color.
#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_fg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_gutter_fg_color(r, g, b);
}

/// Set the selection highlight color (with alpha).
#[no_mangle]
pub extern "C" fn hone_editor_set_selection_color(view: *mut EditorView, r: f64, g: f64, b: f64, a: f64) {
    let view = unsafe { &mut *view };
    view.set_selection_color(r, g, b, a);
}

/// Set the cursor color.
#[no_mangle]
pub extern "C" fn hone_editor_set_cursor_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_cursor_color(r, g, b);
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

// === TypeScript mode control ===

#[no_mangle]
pub extern "C" fn hone_editor_set_ts_mode(view: *mut EditorView, mode: f64) {
    let view = unsafe { &mut *view };
    view.ts_handles_events = mode > 0.5;
}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_width(view: *mut EditorView, width: f64) {
    let view = unsafe { &mut *view };
    view.ts_gutter_width = Some(width);
}

// === TypeScript event polling API (Perry mode) ===
// All values are f64 for Perry ABI compatibility.

#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(
    view: *mut EditorView,
    callback: extern "C" fn(),
) {
    let view = unsafe { &mut *view };
    view.event_callback = Some(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    let count = view.pending_events.len();
    count as f64
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_type(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].event_type as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_char(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].char_code as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_action(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].action_id as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_x(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].x } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_y(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].y } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_events(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.pending_events.clear();
}

// === TS-authoritative render protocol (cache_line + set_viewport) ===

/// Get the actual UIView width.
#[no_mangle]
pub extern "C" fn hone_editor_get_view_width(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.width()
}

/// Get the actual UIView height.
#[no_mangle]
pub extern "C" fn hone_editor_get_view_height(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.height()
}

/// Set read-only mode. mode > 0.5 = read-only, mode <= 0.5 = editable.
#[no_mangle]
pub extern "C" fn hone_editor_set_read_only(view: *mut EditorView, mode: f64) {
    let view = unsafe { &mut *view };
    view.read_only = mode > 0.5;
}

/// Set a background color for a specific line (1-based).
#[no_mangle]
pub extern "C" fn hone_editor_set_line_background(
    view: *mut EditorView,
    line: f64,
    r: f64, g: f64, b: f64, a: f64,
) {
    let view = unsafe { &mut *view };
    view.line_backgrounds.insert(line as i32, (r, g, b, a));
}

/// Clear all per-line background colors.
#[no_mangle]
pub extern "C" fn hone_editor_clear_line_backgrounds(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.line_backgrounds.clear();
}

/// Get the accumulated scroll delta (in pixels) since the last clear.
#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.rust_scroll_delta
}

/// Clear the accumulated scroll delta.
#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.rust_scroll_delta = 0.0;
}

/// Returns 1.0 if Rust needs TypeScript to provide lines, 0.0 otherwise.
#[no_mangle]
pub extern "C" fn hone_editor_needs_lines(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    if view.needs_lines { 1.0 } else { 0.0 }
}

/// Clear the line cache.
#[no_mangle]
pub extern "C" fn hone_editor_clear_line_cache(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_line_cache();
}

/// Cache a line's text and tokens (packed format).
#[no_mangle]
pub extern "C" fn hone_editor_cache_line(
    view: *mut EditorView,
    line_number: f64,
    text: *const u8,
    packed_tokens: *const u8,
) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(packed_tokens);
    view.cache_line(line_number as i32, text_str, tokens_str);
}

/// Build frame_lines from the cache for the visible range.
#[no_mangle]
pub extern "C" fn hone_editor_set_viewport(
    view: *mut EditorView,
    start_line: f64,
    end_line: f64,
    scroll_top: f64,
    total_lines: f64,
    line_height: f64,
) {
    let view = unsafe { &mut *view };
    view.set_viewport_from_cache(
        start_line as i32, end_line as i32,
        scroll_top, total_lines as i32, line_height,
    );
}

/// Clear selections and pre-allocate for `count` new rects.
#[no_mangle]
pub extern "C" fn hone_editor_begin_selections(
    view: *mut EditorView,
    count: f64,
) {
    let view = unsafe { &mut *view };
    view.begin_selections_new(count as usize);
}

/// Add a selection highlight rectangle.
#[no_mangle]
pub extern "C" fn hone_editor_add_selection_rect(
    view: *mut EditorView,
    x: f64, y: f64, w: f64, h: f64,
) {
    let view = unsafe { &mut *view };
    view.add_selection_rect_new(x, y, w, h);
}

/// Copy text to the iOS system clipboard (UIPasteboard).
#[no_mangle]
pub extern "C" fn hone_editor_copy_to_clipboard(
    _view: *mut EditorView,
    text_ptr: *const u8,
) {
    let text = str_from_header(text_ptr);
    if text.is_empty() {
        return;
    }
    unsafe {
        let pb: *mut objc::runtime::Object = msg_send![class!(UIPasteboard), generalPasteboard];
        let ns_string: *mut objc::runtime::Object = msg_send![class!(NSString), alloc];
        let ns_string: *mut objc::runtime::Object = msg_send![ns_string, initWithBytes: text.as_ptr()
                                                               length: text.len()
                                                             encoding: 4u64]; // NSUTF8StringEncoding
        let _: () = msg_send![pb, setString: ns_string];
        let _: () = msg_send![ns_string, release];
    }
}

/// Read text from iOS system clipboard and push it as text events.
#[no_mangle]
pub extern "C" fn hone_editor_paste_from_clipboard(
    view: *mut EditorView,
) {
    let view = unsafe { &mut *view };
    unsafe {
        let pb: *mut objc::runtime::Object = msg_send![class!(UIPasteboard), generalPasteboard];
        let ns_string: *mut objc::runtime::Object = msg_send![pb, string];
        if ns_string.is_null() {
            return;
        }
        let cstr: *const std::os::raw::c_char = msg_send![ns_string, UTF8String];
        if cstr.is_null() {
            return;
        }
        let rust_str = std::ffi::CStr::from_ptr(cstr).to_str().unwrap_or("");
        for ch in rust_str.chars() {
            view.pending_events.push(editor_view::PendingEvent {
                event_type: 1, // TEXT
                char_code: ch as u32,
                action_id: 0,
                x: 0.0,
                y: 0.0,
            });
        }
    }
}
