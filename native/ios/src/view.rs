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
pub const NIL: Id = null_mut();

static REGISTER_CLASS: Once = Once::new();

/// Ivar name for the pointer back to the Rust EditorView.
const EDITOR_STATE_IVAR: &str = "honeEditorState";

/// Ivar name for initial tap point (anchor for drag-select delta).
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
            // Trigger initial redraw when the view enters a window hierarchy.
            // invalidate_view() during init is ignored because the view has no window yet.
            decl.add_method(
                objc::sel!(didMoveToWindow),
                did_move_to_window as extern "C" fn(&Object, Sel),
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

            // -- External keyboard action selectors (iPadOS) --
            decl.add_method(
                objc::sel!(doCommandBySelector:),
                do_command_by_selector as extern "C" fn(&Object, Sel, Sel),
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

            // -- Tap gesture action (bypasses UIScrollView touch delay) --
            decl.add_method(
                objc::sel!(handleTap:),
                handle_tap as extern "C" fn(&Object, Sel, Id),
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
            eprintln!("[hone-ios] draw_rect: state_ptr is null!");
            return;
        }
        let editor_view = &*(state_ptr as *const EditorView);

        // UIGraphicsGetCurrentContext() is a C function that returns the
        // CGContext set up by UIKit for the current drawRect: call.
        let cg_ctx = UIGraphicsGetCurrentContext();
        if cg_ctx.is_null() {
            eprintln!("[hone-ios] draw_rect: cg_ctx is null!");
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

            // Become first responder to show the iOS software keyboard.
            let _: BOOL = msg_send![this_mut, becomeFirstResponder];
        }
    }
}

extern "C" fn touches_moved(this: &Object, _sel: Sel, touches: Id, event: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        // Count all active touches to decide: 1-finger = drag-select, 2-finger = scroll.
        let all_touches: Id = if event != NIL {
            msg_send![event, allTouches]
        } else {
            touches
        };
        let touch_count: usize = if all_touches != NIL {
            msg_send![all_touches, count]
        } else {
            1
        };

        if let Some((x, y)) = first_touch_point(this, touches) {
            let prev_x: f64 = *this.get_ivar(PREV_TOUCH_X_IVAR);
            let prev_y: f64 = *this.get_ivar(PREV_TOUCH_Y_IVAR);

            let this_mut = this as *const Object as *mut Object;
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_X_IVAR, x);
            (*this_mut).set_ivar::<f64>(PREV_TOUCH_Y_IVAR, y);

            if touch_count >= 2 {
                // Two-finger drag: scroll. Negate dy so finger-down = content-up.
                let dx = x - prev_x;
                let dy = y - prev_y;
                editor_view.on_scroll(-dx, -dy);
            } else {
                // Single-finger drag: extend text selection.
                editor_view.on_mouse_drag(x, y);
            }
        }
    }
}

extern "C" fn touches_ended(_this: &Object, _sel: Sel, _touches: Id, _event: Id) {
    // No cleanup needed; previous touch position is reset on next touchesBegan.
}

extern "C" fn touches_cancelled(_this: &Object, _sel: Sel, _touches: Id, _event: Id) {
    // No cleanup needed.
}

// -- External keyboard (iPadOS) action selectors -----------------------------

/// Routes iPadOS hardware keyboard selectors (arrows, Home/End, Shift+arrows)
/// to EditorView::on_action, mirroring macOS doCommandBySelector: behaviour.
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
/// Called when the view enters a window hierarchy. Starts the CADisplayLink
/// render loop so the editor repaints every frame when dirty.
extern "C" fn did_move_to_window(this: &Object, _sel: Sel) {
    unsafe {
        let window: Id = msg_send![this, window];
        if window != NIL {
            let this_id = this as *const Object as Id;
            display_link_ensure_started(this_id);
            mark_dirty(this_id);
        }
    }
}

/// Tap gesture action: positions cursor and shows keyboard.
/// UITapGestureRecognizer bypasses UIScrollView's touch delay (`delaysContentTouches`),
/// ensuring the editor reliably receives taps even when embedded inside a scroll view.
extern "C" fn handle_tap(this: &Object, _sel: Sel, gesture: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() { return; }
        let editor_view = &mut *(state_ptr as *mut EditorView);

        // Get tap location within this view
        let point: ObjCPoint = msg_send![gesture, locationInView: this as *const Object as Id];
        editor_view.on_mouse_down(point.x, point.y);

        // Show the iOS software keyboard
        let this_mut = this as *const Object as *mut Object;
        let _: BOOL = msg_send![this_mut, becomeFirstResponder];
    }
}

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

        // Add a UITapGestureRecognizer to reliably receive taps inside a UIScrollView.
        // UIScrollView's delaysContentTouches prevents touchesBegan: from firing on
        // embedded views, but gesture recognizers bypass this delay mechanism.
        let tap_cls = Class::get("UITapGestureRecognizer").unwrap();
        let tap: Id = msg_send![tap_cls, alloc];
        let action = objc::sel!(handleTap:);
        let tap: Id = msg_send![tap, initWithTarget:view action:action];
        let _: () = msg_send![view, addGestureRecognizer: tap];

        view
    }
}

// =============================================================================
// CADisplayLink-driven rendering
// =============================================================================
// setNeedsDisplay from Perry's NSTimer does NOT produce visible screen updates
// on iOS. The only reliable approach: use a CADisplayLink (synced with the
// display refresh) that checks a dirty flag and calls setNeedsDisplay in the
// correct frame context.

use std::sync::Mutex;

/// Set of UIView pointers that need a redraw on the next display frame.
static DIRTY_VIEWS: Mutex<Vec<usize>> = Mutex::new(Vec::new());

/// Whether the shared CADisplayLink has been started.
static DISPLAY_LINK_STARTED: Once = Once::new();

/// Mark a view as needing redraw. The CADisplayLink callback will call
/// setNeedsDisplay on it at the next display refresh.
fn mark_dirty(uiview: Id) {
    if uiview != NIL {
        let ptr = uiview as usize;
        let mut dirty = DIRTY_VIEWS.lock().unwrap();
        // Avoid duplicates
        for existing in dirty.iter() {
            if *existing == ptr { return; }
        }
        dirty.push(ptr);
    }
}

/// CADisplayLink callback: called every frame (~60/120Hz).
/// Drains the dirty list and calls setNeedsDisplay on each view.
extern "C" fn display_link_tick(_target: &Object, _sel: Sel, _display_link: Id) {
    let views: Vec<usize> = {
        let mut dirty = DIRTY_VIEWS.lock().unwrap();
        let v = dirty.clone();
        dirty.clear();
        v
    };
    for ptr in views {
        unsafe {
            let view = ptr as Id;
            let _: () = msg_send![view, setNeedsDisplay];
        }
    }
}

/// Register the CADisplayLink target class (once).
static REGISTER_DL_TARGET: Once = Once::new();

fn ensure_dl_target_registered() {
    REGISTER_DL_TARGET.call_once(|| {
        let superclass = Class::get("NSObject").expect("NSObject");
        let mut decl = ClassDecl::new("HoneDisplayLinkTarget", superclass)
            .expect("Failed to create HoneDisplayLinkTarget");
        unsafe {
            decl.add_method(
                objc::sel!(tick:),
                display_link_tick as extern "C" fn(&Object, Sel, Id),
            );
        }
        decl.register();
    });
}

/// Start the shared CADisplayLink if not already running.
fn display_link_ensure_started(uiview: Id) {
    DISPLAY_LINK_STARTED.call_once(|| {
        ensure_dl_target_registered();
        unsafe {
            let target_cls = Class::get("HoneDisplayLinkTarget").unwrap();
            let target: Id = msg_send![target_cls, new];
            let dl_cls = Class::get("CADisplayLink").unwrap();
            let dl: Id = msg_send![dl_cls, displayLinkWithTarget:target selector:objc::sel!(tick:)];
            // Add to NSRunLoopCommonModes so it fires during scrolling too.
            let run_loop_cls = Class::get("NSRunLoop").unwrap();
            let main_loop: Id = msg_send![run_loop_cls, mainRunLoop];
            let common_modes: Id = msg_send![
                Class::get("NSString").unwrap(),
                stringWithUTF8String: b"kCFRunLoopCommonModes\0".as_ptr()
            ];
            let _: () = msg_send![dl, addToRunLoop:main_loop forMode:common_modes];
            // Keep target alive
            std::mem::forget(target);
        }
    });
}

/// Public API: mark a view for redraw on the next display frame.
/// This replaces setNeedsDisplay calls — the CADisplayLink callback
/// handles the actual setNeedsDisplay in the correct frame context.
pub fn invalidate_view(uiview: Id) {
    if uiview != NIL {
        mark_dirty(uiview);
    }
}

/// Set the UIView's backgroundColor property (so undrawn areas aren't black).
pub fn set_view_background_color(uiview: Id, r: f64, g: f64, b: f64) {
    if uiview != NIL {
        unsafe {
            let color_cls = Class::get("UIColor").unwrap();
            let color: Id = msg_send![color_cls, colorWithRed:r green:g blue:b alpha:1.0f64];
            let _: () = msg_send![uiview, setBackgroundColor: color];
        }
    }
}

extern "C" {
    // dispatch_get_main_queue() is an inline function / macro in <dispatch/queue.h>,
    // not an exported symbol. Use the underlying global variable directly.
    static _dispatch_main_q: c_void;
    fn dispatch_async_f(queue: *mut c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
}

#[inline(always)]
unsafe fn dispatch_get_main_queue() -> *mut c_void {
    &raw const _dispatch_main_q as *mut c_void
}

/// Update the ivar pointer (used if EditorView is moved/recreated).
pub fn set_editor_state(uiview: Id, state: *mut EditorView) {
    if uiview != NIL {
        unsafe {
            (*(uiview as *mut Object)).set_ivar(EDITOR_STATE_IVAR, state as *mut c_void);
        }
    }
}
