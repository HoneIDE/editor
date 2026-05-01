//! HarmonyOS native rendering for Hone Editor.
//!
//! Currently a no-op stub: every FFI symbol Hone's TypeScript core expects is
//! defined and link-resolves cleanly, but the editor doesn't render anything.
//! The Hone widget will appear blank on HarmonyOS until the ArkTS-side renderer
//! is wired up (canvas + text via `@ohos.graphics.drawing` or NAPI bridge to
//! ArkUI Text components).
//!
//! Why a stub: Mango (and any other Perry app embedding `@honeide/editor`)
//! emits 50+ undefined `hone_editor_*` symbols into its `libentry.so`. Without
//! a HarmonyOS-side library exporting them, the dynamic loader rejects the
//! bundle at app launch with `symbol not found`. This crate makes the .so
//! load successfully so the rest of the app can run.
//!
//! What works in stub mode:
//! - Editor construction / destruction (returns a real heap pointer so
//!   subsequent FFI calls don't UB).
//! - Event-polling protocol returns "no events", so TypeScript's idle loop
//!   is happy.
//! - Color / font / viewport setters silently accept input.
//!
//! What doesn't work:
//! - No rendering, no text, no cursor visible.
//! - No keyboard / touch input plumbed through.
//! - `hone_editor_nsview` returns null (there is no NSView on HarmonyOS).

use std::ffi::c_char;

// Callback type aliases — must match macOS / iOS / Android shapes byte-for-byte
// so Perry's codegen-emitted closure thunks have the right ABI even though we
// never call them.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);
pub type ActionCallback = extern "C" fn(view: *mut EditorView, selector: *const c_char);
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

/// Opaque view handle. The fields exist so the standard mutators succeed
/// without UB; nothing reads them on HarmonyOS yet.
#[repr(C)]
pub struct EditorView {
    width: f64,
    height: f64,
    scroll_x: f64,
    scroll_y: f64,
    scroll_delta: f64,
    scroll_delta_x: f64,
    needs_lines: bool,
    read_only: bool,
    ts_handles_events: bool,
    ts_gutter_width: Option<f64>,
}

impl EditorView {
    fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            scroll_x: 0.0,
            scroll_y: 0.0,
            scroll_delta: 0.0,
            scroll_delta_x: 0.0,
            needs_lines: false,
            read_only: false,
            ts_handles_events: false,
            ts_gutter_width: None,
        }
    }
}

// === Core lifecycle ===

#[no_mangle]
pub extern "C" fn hone_editor_is_ios() -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    Box::into_raw(Box::new(EditorView::new(width, height)))
}

#[no_mangle]
pub extern "C" fn hone_editor_attach_to_view(_view: *mut EditorView, _parent_view: i64) {}

#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() {
        unsafe {
            drop(Box::from_raw(view));
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_invalidate(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_begin_frame(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_end_frame(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_nsview(_view: *mut EditorView) -> *mut std::ffi::c_void {
    std::ptr::null_mut()
}

// === Geometry ===

#[no_mangle]
pub extern "C" fn hone_editor_get_view_width(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    unsafe { (*view).width }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_view_height(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    unsafe { (*view).height }
}

// === Setters that accept input but draw nothing ===

#[no_mangle]
pub extern "C" fn hone_editor_set_font(_view: *mut EditorView, _family: *const u8, _size: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_render_line(
    _view: *mut EditorView,
    _line_number: f64,
    _text: *const u8,
    _tokens_json: *const u8,
    _y_offset: f64,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(_view: *mut EditorView, _x: f64, _y: f64, _style: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_selection(_view: *mut EditorView, _regions_json: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursors(_view: *mut EditorView, _cursors_json: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_scroll(view: *mut EditorView, offset_y: f64) {
    if !view.is_null() {
        unsafe {
            (*view).scroll_y = offset_y;
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_measure_text(_view: *mut EditorView, _text: *const u8) -> f64 {
    // Caller falls back to its own width estimate if this returns 0.
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_render_decorations(
    _view: *mut EditorView,
    _decorations_json: *const u8,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_find_highlights(_view: *mut EditorView, _json: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_clear_find_highlights(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_render_ghost_text(
    _view: *mut EditorView,
    _text: *const u8,
    _x: f64,
    _y: f64,
    _color: *const u8,
) {
}

// === Callback registration — accept and discard ===

#[no_mangle]
pub extern "C" fn hone_editor_set_text_input_callback(
    _view: *mut EditorView,
    _callback: TextInputCallback,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_action_callback(
    _view: *mut EditorView,
    _callback: ActionCallback,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_mouse_down_callback(
    _view: *mut EditorView,
    _callback: MouseDownCallback,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_scroll_callback(
    _view: *mut EditorView,
    _callback: ScrollCallback,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(
    _view: *mut EditorView,
    _callback: extern "C" fn(),
) {
}

// === Context menu ===

#[no_mangle]
pub extern "C" fn hone_editor_add_context_menu_item(
    _view: *mut EditorView,
    _title: *const u8,
    _action_id: *const u8,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_context_menu_items(_view: *mut EditorView) {}

// === Event polling — always return "no events" ===

#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(_view: *mut EditorView) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_type(_view: *mut EditorView, _index: f64) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_char(_view: *mut EditorView, _index: f64) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_action(_view: *mut EditorView, _index: f64) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_x(_view: *mut EditorView, _index: f64) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_y(_view: *mut EditorView, _index: f64) -> f64 {
    0.0
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_events(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_ts_mode(view: *mut EditorView, mode: f64) {
    if !view.is_null() {
        unsafe {
            (*view).ts_handles_events = mode > 0.5;
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_width(view: *mut EditorView, width: f64) {
    if !view.is_null() {
        unsafe {
            (*view).ts_gutter_width = Some(width);
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_set_read_only(view: *mut EditorView, mode: f64) {
    if !view.is_null() {
        unsafe {
            (*view).read_only = mode > 0.5;
        }
    }
}

// === Per-line decoration storage — accept and discard ===

#[no_mangle]
pub extern "C" fn hone_editor_set_line_background(
    _view: *mut EditorView,
    _line: f64,
    _r: f64,
    _g: f64,
    _b: f64,
    _a: f64,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_line_backgrounds(_view: *mut EditorView) {}

// === Scroll delta protocol ===

#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    unsafe { (*view).scroll_delta }
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta(view: *mut EditorView) {
    if !view.is_null() {
        unsafe {
            (*view).scroll_delta = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta_x(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    unsafe { (*view).scroll_delta_x }
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta_x(view: *mut EditorView) {
    if !view.is_null() {
        unsafe {
            (*view).scroll_delta_x = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_x(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    unsafe { (*view).scroll_x }
}

#[no_mangle]
pub extern "C" fn hone_editor_needs_lines(view: *mut EditorView) -> f64 {
    if view.is_null() {
        return 0.0;
    }
    if unsafe { (*view).needs_lines } {
        1.0
    } else {
        0.0
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_line_cache(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_cache_line(
    _view: *mut EditorView,
    _line_number: f64,
    _text: *const u8,
    _packed_tokens: *const u8,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_invalidate_line(_view: *mut EditorView, _line_number: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_viewport(
    _view: *mut EditorView,
    _start_line: f64,
    _end_line: f64,
    _scroll_top: f64,
    _total_lines: f64,
    _line_height: f64,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_begin_selections(_view: *mut EditorView, _count: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_add_selection_rect(
    _view: *mut EditorView,
    _x: f64,
    _y: f64,
    _w: f64,
    _h: f64,
) {
}

// === Theme color setters — accept and discard ===

#[no_mangle]
pub extern "C" fn hone_editor_set_bg_color(_view: *mut EditorView, _r: f64, _g: f64, _b: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_fg_color(_view: *mut EditorView, _r: f64, _g: f64, _b: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_fg_color(
    _view: *mut EditorView,
    _r: f64,
    _g: f64,
    _b: f64,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_selection_color(
    _view: *mut EditorView,
    _r: f64,
    _g: f64,
    _b: f64,
    _a: f64,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor_color(_view: *mut EditorView, _r: f64, _g: f64, _b: f64) {}

// === Clipboard — no-op until we wire @ohos.pasteboard ===

#[no_mangle]
pub extern "C" fn hone_editor_copy_to_clipboard(_view: *mut EditorView, _text_ptr: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_paste_from_clipboard(_view: *mut EditorView) {}

// === Diagnostics / breakpoints / folds — store-and-discard ===

#[no_mangle]
pub extern "C" fn hone_editor_set_line_diagnostics(
    _view: *mut EditorView,
    _packed_data: *const u8,
) {
}

#[no_mangle]
pub extern "C" fn hone_editor_set_breakpoints(_view: *mut EditorView, _packed_lines: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_fold_ranges(_view: *mut EditorView, _packed_data: *const u8) {}

#[no_mangle]
pub extern "C" fn hone_editor_clear_diagnostics(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_poll_touch(_view: *mut EditorView) -> f64 {
    0.0
}
