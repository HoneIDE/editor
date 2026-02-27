//! NSView subclass for the Hone editor.
//!
//! Registers `HoneEditorView` as a subclass of NSView via the objc runtime.
//! The view is flipped (top-left origin) and delegates drawRect: to the
//! Rust EditorView's draw() method.

use cocoa::base::{id, nil, YES};
use cocoa::foundation::{NSRect, NSString};
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel, BOOL};
use std::ffi::{c_void, CStr, CString};
use std::sync::Once;

use crate::editor_view::EditorView;

static REGISTER_CLASS: Once = Once::new();

/// Ivar name for the pointer back to the Rust EditorView.
const EDITOR_STATE_IVAR: &str = "honeEditorState";

/// NSEventModifierFlagCommand
const NS_COMMAND_KEY_MASK: u64 = 1 << 20;

/// Register the HoneEditorView class (idempotent).
fn ensure_class_registered() {
    REGISTER_CLASS.call_once(|| {
        let superclass = Class::get("NSView").expect("NSView class not found");
        let mut decl = ClassDecl::new("HoneEditorView", superclass)
            .expect("Failed to create HoneEditorView class");

        // Add ivar to store pointer to EditorView
        decl.add_ivar::<*mut c_void>(EDITOR_STATE_IVAR);

        unsafe {
            decl.add_method(
                objc::sel!(isFlipped),
                is_flipped as extern "C" fn(&Object, Sel) -> BOOL,
            );
            decl.add_method(
                objc::sel!(acceptsFirstResponder),
                accepts_first_responder as extern "C" fn(&Object, Sel) -> BOOL,
            );
            decl.add_method(
                objc::sel!(drawRect:),
                draw_rect as extern "C" fn(&Object, Sel, NSRect),
            );
            decl.add_method(
                objc::sel!(keyDown:),
                key_down as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(insertText:),
                insert_text as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(doCommandBySelector:),
                do_command_by_selector as extern "C" fn(&Object, Sel, Sel),
            );
            decl.add_method(
                objc::sel!(mouseDown:),
                mouse_down as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(resetCursorRects),
                reset_cursor_rects as extern "C" fn(&Object, Sel),
            );
            // Responder-chain actions (also used by context menu)
            decl.add_method(
                objc::sel!(copy:),
                action_forwarder as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(paste:),
                action_forwarder as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(cut:),
                action_forwarder as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(selectAll:),
                action_forwarder as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(scrollWheel:),
                scroll_wheel as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                objc::sel!(menuForEvent:),
                menu_for_event as extern "C" fn(&Object, Sel, id) -> id,
            );
            decl.add_method(
                objc::sel!(contextMenuItemClicked:),
                context_menu_item_clicked as extern "C" fn(&Object, Sel, id),
            );
        }

        decl.register();
    });
}

extern "C" fn is_flipped(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

extern "C" fn accepts_first_responder(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

extern "C" fn draw_rect(this: &Object, _sel: Sel, dirty_rect: NSRect) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &*(state_ptr as *const EditorView);

        let gfx_ctx: id = msg_send![class!(NSGraphicsContext), currentContext];
        if gfx_ctx == nil {
            return;
        }
        let cg_ctx: core_graphics::sys::CGContextRef = msg_send![gfx_ctx, CGContext];
        if cg_ctx.is_null() {
            return;
        }

        editor_view.draw(cg_ctx, dirty_rect);
    }
}

extern "C" fn key_down(this: &Object, _sel: Sel, event: id) {
    unsafe {
        let flags: u64 = msg_send![event, modifierFlags];

        // Intercept Cmd+key shortcuts (without a menu bar these don't route
        // through the responder chain automatically)
        if flags & NS_COMMAND_KEY_MASK != 0 {
            let chars: id = msg_send![event, charactersIgnoringModifiers];
            if chars != nil {
                let utf8: *const i8 = msg_send![chars, UTF8String];
                if !utf8.is_null() {
                    let ch = CStr::from_ptr(utf8).to_str().unwrap_or("");
                    let self_id = this as *const Object as id;
                    match ch {
                        "c" => { let _: () = msg_send![this, copy: self_id]; return; }
                        "v" => { let _: () = msg_send![this, paste: self_id]; return; }
                        "x" => { let _: () = msg_send![this, cut: self_id]; return; }
                        "a" => { let _: () = msg_send![this, selectAll: self_id]; return; }
                        "q" => {
                            let app: id = msg_send![class!(NSApplication), sharedApplication];
                            let _: () = msg_send![app, terminate: nil];
                            return;
                        }
                        _ => {}
                    }
                }
            }
        }

        let events: id = msg_send![class!(NSArray), arrayWithObject: event];
        let _: () = msg_send![this, interpretKeyEvents: events];
    }
}

extern "C" fn insert_text(this: &Object, _sel: Sel, string: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        let utf8: *const i8 = msg_send![string, UTF8String];
        if utf8.is_null() {
            return;
        }
        let text = CStr::from_ptr(utf8).to_str().unwrap_or("");
        if !text.is_empty() {
            editor_view.on_text_input(text);
        }
    }
}

extern "C" fn do_command_by_selector(this: &Object, _sel: Sel, action: Sel) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        let sel_name = action.name();
        editor_view.on_action(sel_name);
    }
}

extern "C" fn mouse_down(this: &Object, _sel: Sel, event: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        let window_point: cocoa::foundation::NSPoint = msg_send![event, locationInWindow];
        let view_point: cocoa::foundation::NSPoint =
            msg_send![this, convertPoint: window_point fromView: nil];

        editor_view.on_mouse_down(view_point.x, view_point.y);
    }
}

/// Set the I-beam cursor for the entire view.
extern "C" fn reset_cursor_rects(this: &Object, _sel: Sel) {
    unsafe {
        let bounds: NSRect = msg_send![this, bounds];
        let ibeam: id = msg_send![class!(NSCursor), IBeamCursor];
        let _: () = msg_send![this, addCursorRect: bounds cursor: ibeam];
    }
}

/// Generic forwarder for responder-chain actions (copy:, paste:, cut:, selectAll:).
extern "C" fn action_forwarder(this: &Object, sel: Sel, _sender: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);
        let sel_name = sel.name();
        editor_view.on_action(sel_name);
    }
}

extern "C" fn scroll_wheel(this: &Object, _sel: Sel, event: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        let dx: f64 = msg_send![event, scrollingDeltaX];
        let dy: f64 = msg_send![event, scrollingDeltaY];
        let precise: BOOL = msg_send![event, hasPreciseScrollingDeltas];
        let (dx, dy) = if precise == YES {
            (dx, dy)
        } else {
            (dx * 10.0, dy * 10.0)
        };

        editor_view.on_scroll(dx, dy);
    }
}

/// Build a context menu on right-click.
///
/// Includes default items (Cut, Copy, Paste, Select All) plus any custom
/// items added via `hone_editor_add_context_menu_item`.
extern "C" fn menu_for_event(this: &Object, _sel: Sel, _event: id) -> id {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return nil;
        }
        let editor_view = &*(state_ptr as *const EditorView);

        let menu: id = msg_send![class!(NSMenu), alloc];
        let menu: id = msg_send![menu, init];

        // Default items: Cut, Copy, Paste, separator, Select All
        let items: &[(&str, &str)] = &[
            ("Cut", "cut:"),
            ("Copy", "copy:"),
            ("Paste", "paste:"),
        ];
        for &(title, action) in items {
            let ns_title = NSString::alloc(nil).init_str(title);
            let ns_key = NSString::alloc(nil).init_str("");
            let sel = objc::runtime::Sel::register(action);
            let item: id = msg_send![class!(NSMenuItem), alloc];
            let item: id = msg_send![item,
                initWithTitle: ns_title
                action: sel
                keyEquivalent: ns_key
            ];
            let _: () = msg_send![item, setTarget: this as *const Object as id];
            let _: () = msg_send![menu, addItem: item];
        }

        // Separator
        let sep: id = msg_send![class!(NSMenuItem), separatorItem];
        let _: () = msg_send![menu, addItem: sep];

        // Select All
        {
            let ns_title = NSString::alloc(nil).init_str("Select All");
            let ns_key = NSString::alloc(nil).init_str("");
            let sel = objc::runtime::Sel::register("selectAll:");
            let item: id = msg_send![class!(NSMenuItem), alloc];
            let item: id = msg_send![item,
                initWithTitle: ns_title
                action: sel
                keyEquivalent: ns_key
            ];
            let _: () = msg_send![item, setTarget: this as *const Object as id];
            let _: () = msg_send![menu, addItem: item];
        }

        // Custom items from the host
        let custom_items = editor_view.context_menu_items();
        if !custom_items.is_empty() {
            let sep: id = msg_send![class!(NSMenuItem), separatorItem];
            let _: () = msg_send![menu, addItem: sep];

            let ctx_sel = objc::runtime::Sel::register("contextMenuItemClicked:");
            for ci in custom_items {
                let ns_title = NSString::alloc(nil).init_str(&ci.title);
                let ns_key = NSString::alloc(nil).init_str("");
                let item: id = msg_send![class!(NSMenuItem), alloc];
                let item: id = msg_send![item,
                    initWithTitle: ns_title
                    action: ctx_sel
                    keyEquivalent: ns_key
                ];
                let _: () = msg_send![item, setTarget: this as *const Object as id];
                // Store the action_id as representedObject (NSString)
                let ns_action_id = NSString::alloc(nil).init_str(&ci.action_id);
                let _: () = msg_send![item, setRepresentedObject: ns_action_id];
                let _: () = msg_send![menu, addItem: item];
            }
        }

        menu
    }
}

/// Handler for custom context menu items. Extracts the action_id from the
/// menu item's representedObject and routes through on_action.
extern "C" fn context_menu_item_clicked(this: &Object, _sel: Sel, sender: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        let represented: id = msg_send![sender, representedObject];
        if represented == nil {
            return;
        }
        let utf8: *const i8 = msg_send![represented, UTF8String];
        if utf8.is_null() {
            return;
        }
        let action_id = CStr::from_ptr(utf8).to_str().unwrap_or("");
        if !action_id.is_empty() {
            editor_view.on_action(action_id);
        }
    }
}

/// Create a new HoneEditorView NSView instance.
///
/// The view is backed by a CALayer (`setWantsLayer:YES`) and has its
/// `honeEditorState` ivar set to point at the given EditorView.
pub fn create_editor_nsview(width: f64, height: f64, state: *mut EditorView) -> id {
    ensure_class_registered();

    unsafe {
        let cls = Class::get("HoneEditorView").expect("HoneEditorView class not registered");
        let view: id = msg_send![cls, alloc];
        let frame = NSRect::new(
            cocoa::foundation::NSPoint::new(0.0, 0.0),
            cocoa::foundation::NSSize::new(width, height),
        );
        let view: id = msg_send![view, initWithFrame: frame];
        let _: () = msg_send![view, setWantsLayer: YES];

        (*(view as *mut Object)).set_ivar(EDITOR_STATE_IVAR, state as *mut c_void);

        view
    }
}

/// Trigger a redraw on the next display cycle.
pub fn invalidate_view(nsview: id) {
    if nsview != nil {
        unsafe {
            let _: () = msg_send![nsview, setNeedsDisplay: YES];
        }
    }
}

/// Update the ivar pointer (used if EditorView is moved/recreated).
pub fn set_editor_state(nsview: id, state: *mut EditorView) {
    if nsview != nil {
        unsafe {
            (*(nsview as *mut Object)).set_ivar(EDITOR_STATE_IVAR, state as *mut c_void);
        }
    }
}
