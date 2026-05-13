//! macOS native rendering for Hone Editor.
//!
//! Implements the FFI contract using Core Text for text rendering
//! and a drawRect:-based NSView for compositing.

#[macro_use]
extern crate objc;

mod text_renderer;
mod view;
mod editor_view;
mod metal_blitter;
pub mod tokenizer;
pub mod string_header;
pub mod tree_sitter_bridge;

pub use editor_view::EditorView;

use editor_view::{ActionCallback, MouseDownCallback, ScrollCallback, TextInputCallback};
use string_header::str_from_header;

use cocoa::base::id;
use std::sync::Once;

static INSTALL_SIGNAL_HANDLER: Once = Once::new();

/// Install signal handlers for SIGSEGV, SIGABRT, SIGBUS to log crash info before dying.
fn install_crash_handler() {
    INSTALL_SIGNAL_HANDLER.call_once(|| {
        unsafe {
            libc::signal(libc::SIGSEGV, crash_signal_handler as libc::sighandler_t);
            libc::signal(libc::SIGABRT, crash_signal_handler as libc::sighandler_t);
            libc::signal(libc::SIGBUS, crash_signal_handler as libc::sighandler_t);
        }
    });
}

extern "C" fn crash_signal_handler(sig: libc::c_int) {
    let sig_name = match sig {
        libc::SIGSEGV => "SIGSEGV (segfault)",
        libc::SIGABRT => "SIGABRT (abort)",
        libc::SIGBUS => "SIGBUS (bus error)",
        _ => "unknown signal",
    };
    // Use write() directly — eprintln! allocates and is not signal-safe
    let msg = format!("\n[HONE CRASH] Fatal signal: {} ({})\n", sig_name, sig);
    unsafe {
        libc::write(2, msg.as_ptr() as *const libc::c_void, msg.len());
    }
    // Re-raise to get the default crash behavior (core dump etc.)
    unsafe {
        libc::signal(sig, libc::SIG_DFL);
        libc::raise(sig);
    }
}

// === FFI Contract Implementation ===

/// Platform detection: returns 0.0 on macOS (iOS returns 1.0).
#[no_mangle]
pub extern "C" fn hone_editor_is_ios() -> f64 {
    0.0
}

/// Create a new editor view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    install_crash_handler();
    let mut ev = Box::new(EditorView::new(width, height));
    ev.init_nsview();
    Box::into_raw(ev)
}

/// Attach the editor view to a parent NSView.
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

/// Set persistent find highlights (NOT cleared by begin_frame).
#[no_mangle]
pub extern "C" fn hone_editor_set_find_highlights(
    view: *mut EditorView,
    json: *const u8,
) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(json);
    if json_str.is_empty() || json_str == "[]" {
        view.clear_find_highlights();
    } else {
        view.set_find_highlights(json_str);
    }
}

/// Clear find highlights.
#[no_mangle]
pub extern "C" fn hone_editor_clear_find_highlights(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_find_highlights();
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

/// Register a zero-argument callback that Rust calls synchronously when it
/// queues a new input event.  Perry compiles the TypeScript closure to a
/// C-callable function pointer, which satisfies `extern "C" fn()`.
#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(
    view: *mut EditorView,
    callback: extern "C" fn(),
) {
    let view = unsafe { &mut *view };
    view.event_callback = Some(callback);
}

// === TypeScript event polling API ===
// Exposes the pending_events queue via simple numeric FFI.
// TypeScript calls hone_editor_pending_event_count(), iterates, reads fields,
// then calls hone_editor_clear_events(). All values are f64 for Perry compat.

/// Returns the number of pending input events.
#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.pending_events.len() as f64
}

/// Returns the event_type for the event at `index` (1=text, 2=action, 3=scroll, 4=mouse_down).
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

/// Returns the Unicode codepoint for TEXT events.
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

/// Returns the action ID for ACTION events.
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

/// Returns the x field (view-x for MOUSE_DOWN, dx for SCROLL).
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

/// Returns the y field (view-y for MOUSE_DOWN, dy for SCROLL).
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

/// Enable TypeScript mode: event handlers only queue events, TypeScript handles all state.
/// Call with mode=1.0 to enable, mode=0.0 to disable.
#[no_mangle]
pub extern "C" fn hone_editor_set_ts_mode(view: *mut EditorView, mode: f64) {
    let view = unsafe { &mut *view };
    view.ts_handles_events = mode > 0.5;
}

/// Set gutter width from TypeScript (ensures pixel-perfect cursor/text alignment).
#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_width(view: *mut EditorView, width: f64) {
    let view = unsafe { &mut *view };
    view.ts_gutter_width = Some(width);
}

/// Get the NSView handle for the editor view (as a raw pointer).
#[no_mangle]
pub extern "C" fn hone_editor_nsview(view: *mut EditorView) -> *mut std::ffi::c_void {
    let view = unsafe { &*view };
    view.nsview() as *mut std::ffi::c_void
}

/// Get the actual NSView width (from auto layout).
#[no_mangle]
pub extern "C" fn hone_editor_get_view_width(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.width()
}

/// Get the actual NSView height (from auto layout).
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

/// Set a background color for a specific line (1-based). Used for diff highlighting.
#[no_mangle]
pub extern "C" fn hone_editor_set_line_background(
    view: *mut EditorView,
    line: f64,
    r: f64,
    g: f64,
    b: f64,
    a: f64,
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

// === Scroll delta + line cache FFI ===

/// Get the accumulated scroll delta (in pixels) since the last clear.
/// TypeScript reads this to sync its viewport state before content changes.
#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.rust_scroll_delta
}

/// Clear the accumulated scroll delta after TypeScript has synced.
#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.rust_scroll_delta = 0.0;
}

/// Get the accumulated horizontal scroll delta (in pixels) since the last clear.
#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta_x(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.rust_scroll_delta_x
}

/// Clear the accumulated horizontal scroll delta after TypeScript has synced.
#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta_x(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.rust_scroll_delta_x = 0.0;
}

/// Get the current horizontal scroll position (pixels).
#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_x(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.scroll_x
}

/// Returns 1.0 if Rust needs TypeScript to provide lines (cache miss during scroll),
/// 0.0 otherwise.
#[no_mangle]
pub extern "C" fn hone_editor_needs_lines(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    if view.needs_lines { 1.0 } else { 0.0 }
}

/// Clear the line cache. Call when switching files or when document content changes
/// significantly (the cached lines would be stale).
#[no_mangle]
pub extern "C" fn hone_editor_clear_line_cache(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_line_cache();
}

// === New TS-authoritative render protocol ===

/// Cache a line's text and tokens (packed format: "start,end,hexColor,styleInt|...").
/// Does NOT add to frame_lines — call set_viewport after caching all dirty lines.
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
    view.cache_line_packed(line_number as i32, text_str, tokens_str);
}

/// Invalidate a single cached line (remove from cache).
#[no_mangle]
pub extern "C" fn hone_editor_invalidate_line(
    view: *mut EditorView,
    line_number: f64,
) {
    let view = unsafe { &mut *view };
    view.invalidate_cache_line(line_number as i32);
}

/// Build frame_lines from the cache for the visible range [start_line, end_line] (1-based).
/// Computes y_offsets from line numbers, line_height, and scroll_top.
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
    view.set_viewport_range(
        start_line as i32,
        end_line as i32,
        scroll_top,
        total_lines as i32,
        line_height,
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

/// Copy text to the macOS system clipboard (NSPasteboard).
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
        let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
        let _: () = msg_send![pb, clearContents];
        let ns_string: id = msg_send![class!(NSString), alloc];
        let ns_string: id = msg_send![ns_string, initWithBytes: text.as_ptr()
                                                       length: text.len()
                                                     encoding: 4u64]; // NSUTF8StringEncoding
        let _: cocoa::base::BOOL = msg_send![pb, setString: ns_string forType: cocoa::appkit::NSPasteboardTypeString];
        let _: () = msg_send![ns_string, release];
    }
}

/// Read text from macOS system clipboard and push it as text events.
/// Each character becomes a TEXT event so TypeScript can process it normally.
#[no_mangle]
pub extern "C" fn hone_editor_paste_from_clipboard(
    view: *mut EditorView,
) {
    let view = unsafe { &mut *view };
    unsafe {
        let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
        let ns_string: id = msg_send![pb, stringForType: cocoa::appkit::NSPasteboardTypeString];
        if ns_string.is_null() {
            return;
        }
        let cstr: *const std::os::raw::c_char = msg_send![ns_string, UTF8String];
        if cstr.is_null() {
            return;
        }
        let rust_str = std::ffi::CStr::from_ptr(cstr).to_str().unwrap_or("");
        // Push each char as a TEXT event
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

/// Add a selection highlight rectangle.
#[no_mangle]
pub extern "C" fn hone_editor_add_selection_rect(
    view: *mut EditorView,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) {
    let view = unsafe { &mut *view };
    view.add_selection_rect_entry(x, y, w, h);
}

/// Set line diagnostics for Error Lens rendering.
/// `packed_data` is a Perry StringHeader: "line:severity:color:message\n..." (1-based lines).
/// severity: 1=error, 2=warning, 3=info, 4=hint
#[no_mangle]
pub extern "C" fn hone_editor_set_line_diagnostics(
    view: *mut EditorView,
    packed_data: *const u8,
) {
    let view = unsafe { &mut *view };
    let data = str_from_header(packed_data);

    view.line_diagnostics.clear();
    view.gutter_diagnostics.clear();

    if data.is_empty() { return; }

    for line_str in data.split('\n') {
        if line_str.is_empty() { continue; }
        // Format: line:severity:color:message
        let mut parts = line_str.splitn(4, ':');
        let line_num: i32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let severity: i32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(3);
        let color: &str = parts.next().unwrap_or("#888888");
        let message: &str = parts.next().unwrap_or("");

        if line_num > 0 && !message.is_empty() {
            view.line_diagnostics.insert(line_num, (severity, message.to_string(), color.to_string()));
            // Also set gutter diagnostic (take the highest severity per line)
            let existing = view.gutter_diagnostics.get(&line_num).copied().unwrap_or(99);
            if severity < existing {
                view.gutter_diagnostics.insert(line_num, severity);
            }
        }
    }

    view.invalidate();
}

/// Set breakpoint lines. Packed as "line1\nline2\n..." (1-based).
#[no_mangle]
pub extern "C" fn hone_editor_set_breakpoints(
    view: *mut EditorView,
    packed_lines: *const u8,
) {
    let view = unsafe { &mut *view };
    let data = str_from_header(packed_lines);
    view.breakpoint_lines.clear();
    if !data.is_empty() {
        for line_str in data.split('\n') {
            if let Ok(n) = line_str.parse::<i32>() {
                if n > 0 {
                    view.breakpoint_lines.insert(n);
                }
            }
        }
    }
    view.invalidate();
}

/// Set fold indicators. Packed as "line:0\nline:1\n..." (1-based, 0=expanded, 1=collapsed).
#[no_mangle]
pub extern "C" fn hone_editor_set_fold_ranges(
    view: *mut EditorView,
    packed_data: *const u8,
) {
    let view = unsafe { &mut *view };
    let data = str_from_header(packed_data);
    view.fold_indicators.clear();
    if !data.is_empty() {
        for line_str in data.split('\n') {
            if line_str.is_empty() { continue; }
            let mut parts = line_str.splitn(2, ':');
            let line_num: i32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let collapsed: bool = parts.next().map(|s| s == "1").unwrap_or(false);
            if line_num > 0 {
                view.fold_indicators.insert(line_num, collapsed);
            }
        }
    }
    view.invalidate();
}

/// Clear all line diagnostics.
#[no_mangle]
pub extern "C" fn hone_editor_clear_diagnostics(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.line_diagnostics.clear();
    view.gutter_diagnostics.clear();
    view.invalidate();
}

/// Poll touch events (iOS only — no-op on macOS).
#[no_mangle]
pub extern "C" fn hone_editor_poll_touch(_view: *mut EditorView) -> f64 {
    0.0
}
