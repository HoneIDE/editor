//! Linux native rendering for Hone Editor.
//!
//! Uses GTK4 for windowing, Pango for text shaping/layout, and Cairo for rendering.
//! Works transparently on both X11 and Wayland via GTK4's abstraction layer.
//!
//! ## Perry ABI Notes
//!
//! Perry's Cranelift codegen passes parameters using the types declared in
//! `package.json` `perry.nativeLibrary.functions`. On x86-64 Linux (System V AMD64 ABI),
//! integer params go in RDI/RSI/RDX/RCX/R8/R9 and float params go in XMM0–XMM7.
//!
//! - `i64` params → integer registers (pointers, handles)
//! - `f64` params → XMM float registers (numbers, including line_number, style)
//!
//! Perry strings are NOT null-terminated C strings. They are length-prefixed:
//!   `[len: u32, capacity: u32, data: u8[len]]`
//! Use `perry_str()` to extract a `&str` from an i64 Perry string pointer.

use std::sync::Once;

mod text_renderer;
mod widget;
mod editor_view;
mod compositor;
mod tokenizer;

pub use editor_view::EditorView;
pub use editor_view::{ActionCallback, MouseDownCallback, ScrollCallback, TextInputCallback};

static GTK_INIT: Once = Once::new();

fn ensure_gtk_init() {
    GTK_INIT.call_once(|| {
        gtk4::init().expect("Failed to initialize GTK4");
    });
}

// ── Perry string helper ──────────────────────────────────────────────

/// Extract a Rust `&str` from a Perry string pointer.
///
/// Perry strings have layout: `[len: u32, capacity: u32, data: u8[len]]`.
/// The pointer passed via FFI points to the start of this struct.
/// Returns `""` if the pointer is null or invalid.
unsafe fn perry_str<'a>(ptr: i64) -> &'a str {
    let p = ptr as usize;
    if p < 0x10000 {
        return "";
    }
    let len = *(p as *const u32) as usize;
    if len == 0 {
        return "";
    }
    // Safety: data starts at offset 8 (after len + capacity u32s)
    let data = std::slice::from_raw_parts((p + 8) as *const u8, len);
    std::str::from_utf8_unchecked(data)
}

// === FFI Contract Implementation ===

/// Create a new editor view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    eprintln!("[hone] hone_editor_create({}, {})", width, height);
    ensure_gtk_init();
    let mut ev = Box::new(EditorView::new(width, height));
    ev.init_widget();
    let ptr = Box::into_raw(ev);
    eprintln!("[hone] hone_editor_create -> {:p}", ptr);
    ptr
}

/// Attach the editor view to a parent widget.
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
/// Perry params: ["i64", "i64", "f64"]
#[no_mangle]
pub extern "C" fn hone_editor_set_font(
    view: *mut EditorView,
    family: i64,
    size: f64,
) {
    let view = unsafe { &mut *view };
    let family_str = unsafe { perry_str(family) };
    let family_str = if family_str.is_empty() { "monospace" } else { family_str };
    view.set_font(family_str, size);
}

/// Render a single line of text with syntax coloring.
/// Perry params: ["i64", "f64", "i64", "i64", "f64"]
/// NOTE: line_number is f64 (not i32) because Perry sends it via XMM register.
#[no_mangle]
pub extern "C" fn hone_editor_render_line(
    view: *mut EditorView,
    line_number: f64,
    text: i64,
    tokens_json: i64,
    y_offset: f64,
) {
    let view = unsafe { &mut *view };
    let text_str = unsafe { perry_str(text) };
    let tokens_str = unsafe { perry_str(tokens_json) };
    let tokens_str = if tokens_str.is_empty() { "[]" } else { tokens_str };
    view.render_line(line_number as i32, text_str, tokens_str, y_offset);
}

/// Set the cursor position and style.
/// Perry params: ["i64", "f64", "f64", "f64"]
/// NOTE: style is f64 (not i32) to match Perry's Cranelift ABI.
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
/// Perry params: ["i64", "i64"]
#[no_mangle]
pub extern "C" fn hone_editor_set_selection(
    view: *mut EditorView,
    regions_json: i64,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { perry_str(regions_json) };
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
/// Perry params: ["i64", "i64"] returns "f64"
#[no_mangle]
pub extern "C" fn hone_editor_measure_text(
    view: *mut EditorView,
    text: i64,
) -> f64 {
    let view = unsafe { &*view };
    let text_str = unsafe { perry_str(text) };
    view.measure_text(text_str)
}

/// Invalidate the view, triggering a redraw on the next frame.
#[no_mangle]
pub extern "C" fn hone_editor_invalidate(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.invalidate();
}

// === Extended FFI ===

/// Render decorations (underlines, backgrounds) for a line.
/// Perry params: ["i64", "i64"]
#[no_mangle]
pub extern "C" fn hone_editor_render_decorations(
    view: *mut EditorView,
    decorations_json: i64,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { perry_str(decorations_json) };
    let json_str = if json_str.is_empty() { "[]" } else { json_str };
    view.render_decorations(json_str);
}

/// Render ghost text (semi-transparent inline completion).
/// Perry params: ["i64", "i64", "f64", "f64", "i64"]
#[no_mangle]
pub extern "C" fn hone_editor_render_ghost_text(
    view: *mut EditorView,
    text: i64,
    x: f64,
    y: f64,
    color: i64,
) {
    let view = unsafe { &mut *view };
    let text_str = unsafe { perry_str(text) };
    let color_str = unsafe { perry_str(color) };
    let color_str = if color_str.is_empty() { "#808080" } else { color_str };
    view.render_ghost_text(text_str, x, y, color_str);
}

/// Set multiple cursor positions.
/// Perry params: ["i64", "i64"]
#[no_mangle]
pub extern "C" fn hone_editor_set_cursors(
    view: *mut EditorView,
    cursors_json: i64,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { perry_str(cursors_json) };
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
    title: i64,
    action_id: i64,
) {
    let view = unsafe { &mut *view };
    let title_str = unsafe { perry_str(title) };
    let action_str = unsafe { perry_str(action_id) };
    view.add_context_menu_item(title_str, action_str);
}

/// Remove all custom context menu items.
#[no_mangle]
pub extern "C" fn hone_editor_clear_context_menu_items(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_context_menu_items();
}

/// Get the GtkWidget handle for the editor view (as a raw i64 pointer).
/// Perry uses this as the platform-agnostic "native view" handle.
#[no_mangle]
pub extern "C" fn hone_editor_widget(view: *mut EditorView) -> *mut std::ffi::c_void {
    let view = unsafe { &*view };
    view.widget_ptr()
}

/// Perry uses `hone_editor_nsview` as the platform-agnostic name for the native view handle.
/// On Linux this returns the GtkWidget pointer (same as `hone_editor_widget`).
#[no_mangle]
pub extern "C" fn hone_editor_nsview(view: *mut EditorView) -> i64 {
    let view = unsafe { &*view };
    let ptr = view.widget_ptr() as i64;
    eprintln!("[hone] hone_editor_nsview -> {:#x}", ptr);
    ptr
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

// === Perry Event Polling API ===
// Perry's AOT runtime polls these from a RAF loop instead of using callbacks.

/// Set the event callback (stored but not called in Perry mode).
#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(
    view: *mut EditorView,
    callback: extern "C" fn(),
) {
    let view = unsafe { &mut *view };
    view.event_callback = Some(callback);
}

/// Return the number of pending input events.
#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.pending_events.len() as f64
}

/// Get the event type at index (TEXT=1, ACTION=2, SCROLL=3, MOUSE_DOWN=4).
#[no_mangle]
pub extern "C" fn hone_editor_get_event_type(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() {
        view.pending_events[i].event_type as f64
    } else {
        0.0
    }
}

/// Get the character code for a TEXT event at index.
#[no_mangle]
pub extern "C" fn hone_editor_get_event_char(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() {
        view.pending_events[i].char_code as f64
    } else {
        0.0
    }
}

/// Get the action ID for an ACTION event at index.
#[no_mangle]
pub extern "C" fn hone_editor_get_event_action(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() {
        view.pending_events[i].action_id as f64
    } else {
        0.0
    }
}

/// Get the x coordinate for MOUSE_DOWN/SCROLL events at index.
#[no_mangle]
pub extern "C" fn hone_editor_get_event_x(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() {
        view.pending_events[i].x
    } else {
        0.0
    }
}

/// Get the y coordinate for MOUSE_DOWN/SCROLL events at index.
#[no_mangle]
pub extern "C" fn hone_editor_get_event_y(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() {
        view.pending_events[i].y
    } else {
        0.0
    }
}

/// Clear all pending events after processing.
#[no_mangle]
pub extern "C" fn hone_editor_clear_events(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.pending_events.clear();
}
