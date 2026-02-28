//! GTK4 DrawingArea widget with event controllers for the Hone editor.
//!
//! Creates a DrawingArea that delegates drawing to EditorView::draw()
//! and routes keyboard, mouse, and scroll events through callbacks.

use gdk4::Key;
use gtk4::prelude::*;
use gtk4::{DrawingArea, EventControllerKey, EventControllerScroll, EventControllerScrollFlags, GestureClick};

use crate::editor_view::EditorView;

/// Create a GTK4 DrawingArea widget wired to the given EditorView.
///
/// Returns the widget as a raw `*mut c_void` pointer.
pub fn create_editor_widget(
    width: f64,
    height: f64,
    state: *mut EditorView,
) -> *mut std::ffi::c_void {
    let area = DrawingArea::new();
    area.set_content_width(width as i32);
    area.set_content_height(height as i32);
    area.set_focusable(true);
    area.set_can_focus(true);

    // Set I-beam cursor
    let cursor = gdk4::Cursor::from_name("text", None);
    area.set_cursor(cursor.as_ref());

    setup_draw_handler(&area, state);
    setup_key_handler(&area, state);
    setup_click_handler(&area, state);
    setup_scroll_handler(&area, state);

    // Convert to raw pointer — caller must ensure the widget stays alive
    let widget_obj = area.upcast::<gtk4::Widget>();
    let ptr = widget_obj.as_ptr() as *mut std::ffi::c_void;

    // Prevent GTK from dropping the widget by adding a reference
    unsafe {
        glib::gobject_ffi::g_object_ref(ptr as *mut _);
    }

    ptr
}

/// Set up the draw function that delegates to EditorView::draw().
fn setup_draw_handler(area: &DrawingArea, state: *mut EditorView) {
    let state_ptr = state as usize; // usize is Send + Copy
    area.set_draw_func(move |_area, cr, w, h| {
        let editor_view = unsafe { &*(state_ptr as *const EditorView) };
        editor_view.draw(cr, w as f64, h as f64);
    });
}

/// Set up keyboard event handling.
///
/// Maps GTK key events to macOS-style selector names for cross-platform parity.
fn setup_key_handler(area: &DrawingArea, state: *mut EditorView) {
    let controller = EventControllerKey::new();
    let state_ptr = state as usize;

    controller.connect_key_pressed(move |_controller, keyval, _keycode, modifier| {
        let editor_view = unsafe { &mut *(state_ptr as *mut EditorView) };
        let shift = modifier.contains(gdk4::ModifierType::SHIFT_MASK);
        let ctrl = modifier.contains(gdk4::ModifierType::CONTROL_MASK);

        // Ctrl+key shortcuts
        if ctrl {
            match keyval {
                Key::c => { editor_view.on_action("copy:"); return glib::Propagation::Stop; }
                Key::v => { editor_view.on_action("paste:"); return glib::Propagation::Stop; }
                Key::x => { editor_view.on_action("cut:"); return glib::Propagation::Stop; }
                Key::a => { editor_view.on_action("selectAll:"); return glib::Propagation::Stop; }
                Key::z => { editor_view.on_action("undo:"); return glib::Propagation::Stop; }
                Key::y => { editor_view.on_action("redo:"); return glib::Propagation::Stop; }
                _ => {}
            }
        }

        // Navigation and editing keys
        let selector = match keyval {
            Key::Left if shift => "moveLeftAndModifySelection:",
            Key::Right if shift => "moveRightAndModifySelection:",
            Key::Up if shift => "moveUpAndModifySelection:",
            Key::Down if shift => "moveDownAndModifySelection:",
            Key::Home if shift => "moveToBeginningOfLineAndModifySelection:",
            Key::End if shift => "moveToEndOfLineAndModifySelection:",
            Key::Left => "moveLeft:",
            Key::Right => "moveRight:",
            Key::Up => "moveUp:",
            Key::Down => "moveDown:",
            Key::Home => "moveToBeginningOfLine:",
            Key::End => "moveToEndOfLine:",
            Key::BackSpace => "deleteBackward:",
            Key::Delete => "deleteForward:",
            Key::Return | Key::KP_Enter => "insertNewline:",
            Key::Tab if shift => "insertBacktab:",
            Key::Tab => "insertTab:",
            Key::Escape => "cancelOperation:",
            _ => {
                // Try printable character input
                if !ctrl {
                    if let Some(ch) = keyval.to_unicode() {
                        if !ch.is_control() {
                            let mut buf = [0u8; 4];
                            let s = ch.encode_utf8(&mut buf);
                            editor_view.on_text_input(s);
                            return glib::Propagation::Stop;
                        }
                    }
                }
                return glib::Propagation::Proceed;
            }
        };

        editor_view.on_action(selector);
        glib::Propagation::Stop
    });

    area.add_controller(controller);
}

/// Set up mouse click handling.
fn setup_click_handler(area: &DrawingArea, state: *mut EditorView) {
    let gesture = GestureClick::new();
    gesture.set_button(1); // Left click only
    let state_ptr = state as usize;

    gesture.connect_pressed(move |gesture, _n_press, x, y| {
        let editor_view = unsafe { &mut *(state_ptr as *mut EditorView) };
        editor_view.on_mouse_down(x, y);
        // Grab focus on click
        let widget = gesture.widget();
        widget.grab_focus();
    });

    area.add_controller(gesture);
}

/// Set up scroll (mouse wheel / touchpad) handling.
fn setup_scroll_handler(area: &DrawingArea, state: *mut EditorView) {
    let controller = EventControllerScroll::new(
        EventControllerScrollFlags::VERTICAL | EventControllerScrollFlags::KINETIC,
    );
    let state_ptr = state as usize;

    controller.connect_scroll(move |_controller, dx, dy| {
        let editor_view = unsafe { &mut *(state_ptr as *mut EditorView) };
        // Multiply by ~40 for reasonable scroll speed (GTK reports in "steps")
        editor_view.on_scroll(dx * 40.0, dy * 40.0);
        glib::Propagation::Stop
    });

    area.add_controller(controller);
}

/// Invalidate the widget to trigger a redraw.
pub fn invalidate_widget(ptr: *mut std::ffi::c_void) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let widget: gtk4::Widget = glib::translate::from_glib_none(ptr as *mut _);
        widget.queue_draw();
    }
}
