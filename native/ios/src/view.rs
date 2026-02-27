//! UIView subclass for the Hone editor on iOS.
//!
//! Registers `HoneEditorView` as a subclass of UIView via the objc runtime.
//! UIView already uses a top-left origin, so no isFlipped is needed.
//! Keyboard input uses UIKeyInput protocol (insertText:, deleteBackward).
//! Touch events replace mouse events for cursor positioning and scrolling.

use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel, BOOL, YES};
use objc::Encode;
use objc::Encoding;
use std::ffi::{c_void, CStr};
use std::ptr::null_mut;
use std::sync::Once;

use crate::editor_view::EditorView;

/// Alias for Objective-C object pointer.
type Id = *mut Object;

/// Null Objective-C pointer.
const NIL: Id = null_mut();

static REGISTER_CLASS: Once = Once::new();

/// Ivar name for the pointer back to the Rust EditorView.
const EDITOR_STATE_IVAR: &str = "honeEditorState";

/// Ivar name for previous touch point (used for pan delta computation).
const PREV_TOUCH_X_IVAR: &str = "honePrevTouchX";
const PREV_TOUCH_Y_IVAR: &str = "honePrevTouchY";

// -- ObjC-compatible rect type -----------------------------------------------
// core_graphics::CGRect doesn't implement objc::Encode, so we define a
// layout-compatible #[repr(C)] wrapper that does.

#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct ObjCPoint {
    x: f64,
    y: f64,
}

unsafe impl Encode for ObjCPoint {
    fn encode() -> Encoding {
        unsafe { Encoding::from_str("{CGPoint=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct ObjCSize {
    width: f64,
    height: f64,
}

unsafe impl Encode for ObjCSize {
    fn encode() -> Encoding {
        unsafe { Encoding::from_str("{CGSize=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct ObjCRect {
    origin: ObjCPoint,
    size: ObjCSize,
}

unsafe impl Encode for ObjCRect {
    fn encode() -> Encoding {
        unsafe { Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
    }
}

impl ObjCRect {
    fn to_cg_rect(self) -> CGRect {
        CGRect::new(
            &CGPoint::new(self.origin.x, self.origin.y),
            &CGSize::new(self.size.width, self.size.height),
        )
    }
}

/// Register the HoneEditorView class (idempotent).
fn ensure_class_registered() {
    REGISTER_CLASS.call_once(|| {
        let superclass = Class::get("UIView").expect("UIView class not found");
        let mut decl = ClassDecl::new("HoneEditorView", superclass)
            .expect("Failed to create HoneEditorView class");

        // Add ivars
        decl.add_ivar::<*mut c_void>(EDITOR_STATE_IVAR);
        decl.add_ivar::<f64>(PREV_TOUCH_X_IVAR);
        decl.add_ivar::<f64>(PREV_TOUCH_Y_IVAR);

        unsafe {
            // -- Drawing --
            decl.add_method(
                objc::sel!(drawRect:),
                draw_rect as extern "C" fn(&Object, Sel, ObjCRect),
            );

            // -- First responder (needed for keyboard input) --
            decl.add_method(
                objc::sel!(canBecomeFirstResponder),
                can_become_first_responder as extern "C" fn(&Object, Sel) -> BOOL,
            );

            // -- Touch handling --
            decl.add_method(
                objc::sel!(touchesBegan:withEvent:),
                touches_began as extern "C" fn(&Object, Sel, Id, Id),
            );
            decl.add_method(
                objc::sel!(touchesMoved:withEvent:),
                touches_moved as extern "C" fn(&Object, Sel, Id, Id),
            );
            decl.add_method(
                objc::sel!(touchesEnded:withEvent:),
                touches_ended as extern "C" fn(&Object, Sel, Id, Id),
            );
            decl.add_method(
                objc::sel!(touchesCancelled:withEvent:),
                touches_cancelled as extern "C" fn(&Object, Sel, Id, Id),
            );

            // -- UIKeyInput protocol --
            decl.add_method(
                objc::sel!(hasText),
                has_text as extern "C" fn(&Object, Sel) -> BOOL,
            );
            decl.add_method(
                objc::sel!(insertText:),
                insert_text as extern "C" fn(&Object, Sel, Id),
            );
            decl.add_method(
                objc::sel!(deleteBackward),
                delete_backward as extern "C" fn(&Object, Sel),
            );

            // -- UITextInputTraits --
            decl.add_method(
                objc::sel!(keyboardType),
                keyboard_type as extern "C" fn(&Object, Sel) -> i64,
            );
            decl.add_method(
                objc::sel!(autocorrectionType),
                autocorrection_type as extern "C" fn(&Object, Sel) -> i64,
            );
            decl.add_method(
                objc::sel!(autocapitalizationType),
                autocapitalization_type as extern "C" fn(&Object, Sel) -> i64,
            );

            // -- Tell UIKit this responder needs the keyboard --
            decl.add_method(
                objc::sel!(_requiresKeyboardWhenFirstResponder),
                requires_keyboard_when_first_responder
                    as extern "C" fn(&Object, Sel) -> BOOL,
            );
            decl.add_method(
                objc::sel!(_requiresKeyboardResetOnReload),
                requires_keyboard_reset_on_reload
                    as extern "C" fn(&Object, Sel) -> BOOL,
            );
        }

        decl.register();
    });
}

// -- Drawing -----------------------------------------------------------------

extern "C" fn draw_rect(this: &Object, _sel: Sel, dirty_rect: ObjCRect) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &*(state_ptr as *const EditorView);

        // UIGraphicsGetCurrentContext() is a C function that returns the
        // CGContext set up by UIKit for the current drawRect: call.
        let cg_ctx = UIGraphicsGetCurrentContext();
        if cg_ctx.is_null() {
            return;
        }

        editor_view.draw(cg_ctx, dirty_rect.to_cg_rect());
    }
}

extern "C" {
    fn UIGraphicsGetCurrentContext() -> core_graphics::sys::CGContextRef;
}

// -- First responder ---------------------------------------------------------

extern "C" fn can_become_first_responder(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

// -- Touch handling ----------------------------------------------------------

/// Extract the first touch point from an NSSet of UITouches, in view coordinates.
unsafe fn first_touch_point(this: &Object, touches: Id) -> Option<(f64, f64)> {
    if touches == NIL {
        return None;
    }
    let touch: Id = msg_send![touches, anyObject];
    if touch == NIL {
        return None;
    }
    let point: ObjCPoint = msg_send![touch, locationInView: this as *const Object as Id];
    Some((point.x, point.y))
}

extern "C" fn touches_began(this: &Object, _sel: Sel, touches: Id, _event: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        if let Some((x, y)) = first_touch_point(this, touches) {
            // Store for delta computation in touchesMoved:
            let this_mut = this as *const Object as *mut Object;
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_X_IVAR, x);
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_Y_IVAR, y);

            // Report as mouse down (tap to position cursor)
            editor_view.on_mouse_down(x, y);
        }
    }
}

extern "C" fn touches_moved(this: &Object, _sel: Sel, touches: Id, _event: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        if let Some((x, y)) = first_touch_point(this, touches) {
            let prev_x: f64 = *this.get_ivar(PREV_TOUCH_X_IVAR);
            let prev_y: f64 = *this.get_ivar(PREV_TOUCH_Y_IVAR);
            let dx = x - prev_x;
            let dy = y - prev_y;

            // Update previous touch position
            let this_mut = this as *const Object as *mut Object;
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_X_IVAR, x);
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_Y_IVAR, y);

            // Report as scroll (pan to scroll, negate dy so dragging up scrolls down)
            editor_view.on_scroll(-dx, -dy);
        }
    }
}

extern "C" fn touches_ended(_this: &Object, _sel: Sel, _touches: Id, _event: Id) {
    // No cleanup needed; previous touch position is reset on next touchesBegan.
}

extern "C" fn touches_cancelled(_this: &Object, _sel: Sel, _touches: Id, _event: Id) {
    // No cleanup needed.
}

// -- UIKeyInput protocol -----------------------------------------------------

extern "C" fn has_text(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

extern "C" fn insert_text(this: &Object, _sel: Sel, string: Id) {
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

        // Newline characters route through action callback
        if text == "\n" || text == "\r" {
            editor_view.on_action("insertNewline:");
        } else if !text.is_empty() {
            editor_view.on_text_input(text);
        }
    }
}

extern "C" fn delete_backward(this: &Object, _sel: Sel) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);
        editor_view.on_action("deleteBackward:");
    }
}

// -- UITextInputTraits -------------------------------------------------------

/// UIKeyboardTypeDefault = 0
extern "C" fn keyboard_type(_this: &Object, _sel: Sel) -> i64 {
    0
}

/// UITextAutocorrectionTypeNo = 1
extern "C" fn autocorrection_type(_this: &Object, _sel: Sel) -> i64 {
    1
}

/// UITextAutocapitalizationTypeNone = 0
extern "C" fn autocapitalization_type(_this: &Object, _sel: Sel) -> i64 {
    0
}

// -- Keyboard activation -----------------------------------------------------

/// Override to tell UIKit this first responder needs the system keyboard.
extern "C" fn requires_keyboard_when_first_responder(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

/// Override to force keyboard reload when the responder reloads input views.
extern "C" fn requires_keyboard_reset_on_reload(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

// -- Public functions --------------------------------------------------------

/// Create a new HoneEditorView UIView instance.
///
/// The view has its `honeEditorState` ivar set to point at the given EditorView.
/// Touch events and drawing are routed to the EditorView.
pub fn create_editor_uiview(width: f64, height: f64, state: *mut EditorView) -> Id {
    ensure_class_registered();

    unsafe {
        let cls = Class::get("HoneEditorView").expect("HoneEditorView class not registered");
        let view: Id = msg_send![cls, alloc];
        let frame = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(width, height),
        );
        let view: Id = msg_send![view, initWithFrame: frame];

        // Set the editor state ivar
        (*(view as *mut Object)).set_ivar(EDITOR_STATE_IVAR, state as *mut c_void);

        // Initialize touch tracking ivars
        (*(view as *mut Object)).set_ivar::<f64>(PREV_TOUCH_X_IVAR, 0.0);
        (*(view as *mut Object)).set_ivar::<f64>(PREV_TOUCH_Y_IVAR, 0.0);

        // Enable user interaction (UIView default is YES, but be explicit)
        let _: () = msg_send![view, setUserInteractionEnabled: YES];

        // Set opaque for performance
        let _: () = msg_send![view, setOpaque: YES];

        view
    }
}

/// Trigger a redraw on the next display cycle.
pub fn invalidate_view(uiview: Id) {
    if uiview != NIL {
        unsafe {
            // UIView setNeedsDisplay takes no argument (unlike NSView which takes BOOL)
            let _: () = msg_send![uiview, setNeedsDisplay];
        }
    }
}

/// Update the ivar pointer (used if EditorView is moved/recreated).
pub fn set_editor_state(uiview: Id, state: *mut EditorView) {
    if uiview != NIL {
        unsafe {
            (*(uiview as *mut Object)).set_ivar(EDITOR_STATE_IVAR, state as *mut c_void);
        }
    }
}
