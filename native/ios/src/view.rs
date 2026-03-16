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
pub struct ObjCPoint {
    pub x: f64,
    pub y: f64,
}

unsafe impl Encode for ObjCPoint {
    fn encode() -> Encoding {
        unsafe { Encoding::from_str("{CGPoint=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct ObjCSize {
    pub width: f64,
    pub height: f64,
}

unsafe impl Encode for ObjCSize {
    fn encode() -> Encoding {
        unsafe { Encoding::from_str("{CGSize=dd}") }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct ObjCRect {
    pub origin: ObjCPoint,
    pub size: ObjCSize,
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

            // -- Intrinsic content size (needed for Auto Layout in Perry's UIStackView) --
            decl.add_method(
                objc::sel!(intrinsicContentSize),
                intrinsic_content_size as extern "C" fn(&Object, Sel) -> ObjCPoint,
            );

            // -- First responder (needed for keyboard input) --
            decl.add_method(
                objc::sel!(canBecomeFirstResponder),
                can_become_first_responder as extern "C" fn(&Object, Sel) -> BOOL,
            );

            // -- Hit testing (debug: ensure view participates in touch routing) --
            decl.add_method(
                objc::sel!(hitTest:withEvent:),
                hit_test as extern "C" fn(&Object, Sel, ObjCPoint, Id) -> Id,
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

            // -- Physical key handling (iPadOS external keyboard) --
            decl.add_method(
                objc::sel!(pressesBegan:withEvent:),
                presses_began as extern "C" fn(&Object, Sel, Id, Id),
            );
            decl.add_method(
                objc::sel!(pressesEnded:withEvent:),
                presses_ended as extern "C" fn(&Object, Sel, Id, Id),
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

// Return intrinsic content size as two f64 values packed in ObjCPoint
// (CGSize and ObjCPoint have the same layout: two f64s).
extern "C" fn intrinsic_content_size(_this: &Object, _sel: Sel) -> ObjCPoint {
    // Return UIViewNoIntrinsicMetric (-1, -1) so UIStackView fills remaining space.
    ObjCPoint { x: -1.0, y: -1.0 }
}

extern "C" fn draw_rect(this: &Object, _sel: Sel, dirty_rect: ObjCRect) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            eprintln!("[hone-ios] draw_rect: state_ptr is null!");
            return;
        }
        let editor_view = &mut *(state_ptr as *mut EditorView);

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

extern "C" fn hit_test(this: &Object, _sel: Sel, point: ObjCPoint, event: Id) -> Id {
    unsafe {
        // Call super's hitTest:withEvent: to get the default result
        let superclass = class!(UIView);
        let result: Id = msg_send![super(this, superclass), hitTest: point withEvent: event];
        let bounds: ObjCRect = msg_send![this, bounds];
        let ui_enabled: BOOL = msg_send![this, isUserInteractionEnabled];
        let _ = (bounds, ui_enabled);
        // If super returned nil but point is inside bounds, force return self
        if result.is_null() {
            let in_bounds = point.x >= 0.0 && point.y >= 0.0
                && point.x <= bounds.size.width && point.y <= bounds.size.height;
            if in_bounds {
                // Force self when super returns nil but point is in bounds
                return this as *const Object as Id;
            }
        }
        result
    }
}

extern "C" fn touches_began(this: &Object, _sel: Sel, touches: Id, _event: Id) {
    // touches_began
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if state_ptr.is_null() {
            // state_ptr null
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

            // On phone: 1-finger drag = scroll, 2-finger drag = also scroll.
            // Selection is done via Shift+arrow keys or long-press (TODO).
            let dx = x - prev_x;
            let dy = y - prev_y;
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

// -- keyCommands for iPadOS external keyboard --------------------------------

/// Handle physical key presses (iPadOS external keyboard).
/// Arrow keys and Tab don't go through UIKeyInput — must intercept here.
/// Always call super so Enter and text keys still reach insertText:.
extern "C" fn presses_began(this: &Object, _sel: Sel, presses: Id, event: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if !state_ptr.is_null() {
            let editor_view = &mut *(state_ptr as *mut EditorView);
            let enumerator: Id = msg_send![presses, objectEnumerator];
            loop {
                let press: Id = msg_send![enumerator, nextObject];
                if press == NIL { break; }
                let key: Id = msg_send![press, key];
                if key == NIL { continue; }
                let code: i64 = msg_send![key, keyCode];
                let modifiers: u64 = msg_send![key, modifierFlags];
                let shift = (modifiers & (1 << 17)) != 0; // UIKeyModifierShift
                let cmd = (modifiers & (1 << 20)) != 0;   // UIKeyModifierCommand

                if cmd {
                    // Cmd+key shortcuts
                    match code {
                        6 => { editor_view.on_action("copy:"); }     // Cmd+C
                        25 => { editor_view.on_action("paste:"); }   // Cmd+V
                        27 => { editor_view.on_action("cut:"); }     // Cmd+X
                        29 => { if shift { editor_view.on_action("redo:"); } // Cmd+Shift+Z
                                else { editor_view.on_action("undo:"); } }   // Cmd+Z
                        4 => { editor_view.on_action("selectAll:"); } // Cmd+A
                        _ => {}
                    }
                    // Enable repeat for Cmd+V and Cmd+Z
                    if code == 25 || code == 29 {
                        editor_view.held_key_code = code;
                        editor_view.held_key_shift = shift;
                        editor_view.held_key_cmd = true;
                        editor_view.key_repeat_counter = 0;
                    }
                } else {
                    // Track held key for repeat
                    match code {
                        79 | 80 | 81 | 82 | 40 | 43 | 88 => {
                            editor_view.held_key_code = code;
                            editor_view.held_key_shift = shift;
                            editor_view.held_key_cmd = false;
                            editor_view.key_repeat_counter = 0;
                        }
                        _ => {}
                    }
                    dispatch_key_action(editor_view, code, shift);
                }
            }
        }
        // Always call super so Enter/text keys reach insertText:
        let superclass = class!(UIView);
        let _: () = msg_send![super(this, superclass), pressesBegan:presses withEvent:event];
    }
}

extern "C" fn presses_ended(this: &Object, _sel: Sel, presses: Id, event: Id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
        if !state_ptr.is_null() {
            let editor_view = &mut *(state_ptr as *mut EditorView);
            editor_view.held_key_code = -1;
        }
        let superclass = class!(UIView);
        let _: () = msg_send![super(this, superclass), pressesEnded:presses withEvent:event];
    }
}

pub fn dispatch_key_action(ev: &mut EditorView, code: i64, shift: bool) {
    match code {
        82 => { if shift { ev.on_action("moveUpAndModifySelection:"); }
                else { ev.on_action("moveUp:"); } }
        81 => { if shift { ev.on_action("moveDownAndModifySelection:"); }
                else { ev.on_action("moveDown:"); } }
        80 => { if shift { ev.on_action("moveLeftAndModifySelection:"); }
                else { ev.on_action("moveLeft:"); } }
        79 => { if shift { ev.on_action("moveRightAndModifySelection:"); }
                else { ev.on_action("moveRight:"); } }
        43 => { ev.on_action("insertTab:"); }
        40 | 88 => { ev.on_action("insertNewline:"); }
        _ => {}
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
        let raw_text = CStr::from_ptr(utf8).to_str().unwrap_or("");

        // Replace iOS smart quotes with ASCII equivalents for code editing
        let text = raw_text
            .replace('\u{201C}', "\"") // left double quote → "
            .replace('\u{201D}', "\"") // right double quote → "
            .replace('\u{2018}', "'")  // left single quote → '
            .replace('\u{2019}', "'")  // right single quote → '
            .replace('\u{2013}', "-")  // en dash → -
            .replace('\u{2014}', "-"); // em dash → -

        // Newline characters route through action callback
        if text == "\n" || text == "\r" {
            editor_view.on_action("insertNewline:");
        } else if !text.is_empty() {
            editor_view.on_text_input(&text);
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

            // Register for continuous parent-frame fixing on display link tick.
            let ptr = this_id as usize;
            let mut editors = EDITOR_VIEWS.lock().unwrap();
            let mut found = false;
            for e in editors.iter() { if *e == ptr { found = true; break; } }
            if !found { editors.push(ptr); }

            // Perry's UIStackView has 0x0 frame which blocks ALL hit-testing.
            // Fix: add a transparent overlay UIView to the window that captures
            // touches and forwards them to the editor.
            ensure_overlay_class_registered();
            let state_ptr: *mut c_void = *this.get_ivar(EDITOR_STATE_IVAR);
            GLOBAL_EDITOR_VIEW.store(state_ptr as usize, std::sync::atomic::Ordering::Relaxed);
            GLOBAL_EDITOR_UIVIEW.store(this_id as usize, std::sync::atomic::Ordering::Relaxed);
            let window_id: Id = msg_send![this, window];
            if window_id != NIL {
                let window_bounds: ObjCRect = msg_send![window_id, bounds];
                let overlay_cls = Class::get("HoneTouchOverlay").unwrap();
                let overlay: Id = msg_send![overlay_cls, alloc];
                let overlay: Id = msg_send![overlay, initWithFrame: window_bounds];
                let clear: Id = msg_send![class!(UIColor), clearColor];
                let _: () = msg_send![overlay, setBackgroundColor: clear];
                let _: () = msg_send![overlay, setUserInteractionEnabled: YES];
                // Pan gesture for scrolling
                let pan_cls = Class::get("UIPanGestureRecognizer").unwrap();
                let pan: Id = msg_send![pan_cls, alloc];
                let pan_action = objc::sel!(overlayPanned:);
                let pan: Id = msg_send![pan, initWithTarget: overlay action: pan_action];
                let _: () = msg_send![overlay, addGestureRecognizer: pan];

                // Tap gesture for cursor positioning
                let tap_cls = Class::get("UITapGestureRecognizer").unwrap();
                let tap: Id = msg_send![tap_cls, alloc];
                let action = objc::sel!(overlayTapped:);
                let tap: Id = msg_send![tap, initWithTarget: overlay action: action];
                // Tap waits for pan to fail (so drag doesn't trigger tap)
                let _: () = msg_send![tap, requireGestureRecognizerToFail: pan];
                let _: () = msg_send![overlay, addGestureRecognizer: tap];

                let _: () = msg_send![window_id, addSubview: overlay];
            }
        }
    }
}

/// Tap gesture action: positions cursor and shows keyboard.
/// UITapGestureRecognizer bypasses UIScrollView's touch delay (`delaysContentTouches`),
/// ensuring the editor reliably receives taps even when embedded inside a scroll view.
extern "C" fn handle_tap(this: &Object, _sel: Sel, gesture: Id) {
    // handle_tap
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

        // Store global pointers for the touch overlay (display_link_tick will create it)
        GLOBAL_EDITOR_VIEW.store(state as usize, std::sync::atomic::Ordering::Relaxed);
        GLOBAL_EDITOR_UIVIEW.store(view as usize, std::sync::atomic::Ordering::Relaxed);

        // Initialize touch tracking ivars
        (*(view as *mut Object)).set_ivar::<f64>(PREV_TOUCH_X_IVAR, 0.0);
        (*(view as *mut Object)).set_ivar::<f64>(PREV_TOUCH_Y_IVAR, 0.0);

        // Enable user interaction (UIView default is YES, but be explicit)
        let _: () = msg_send![view, setUserInteractionEnabled: YES];

        // Set opaque for performance
        let _: () = msg_send![view, setOpaque: YES];

        // Low content hugging/compression resistance so UIStackView fills this view.
        let _: () = msg_send![view, setContentHuggingPriority: 1.0f64 forAxis: 0i64];
        let _: () = msg_send![view, setContentHuggingPriority: 1.0f64 forAxis: 1i64];
        let _: () = msg_send![view, setContentCompressionResistancePriority: 1.0f64 forAxis: 1i64];

        // Add a UITapGestureRecognizer to reliably receive taps inside a UIScrollView.
        let tap_cls = Class::get("UITapGestureRecognizer").unwrap();
        let tap: Id = msg_send![tap_cls, alloc];
        let action = objc::sel!(handleTap:);
        let tap: Id = msg_send![tap, initWithTarget:view action:action];
        let _: () = msg_send![view, addGestureRecognizer: tap];

        // Start the CADisplayLink render loop.
        display_link_ensure_started(view);
        mark_dirty(view);

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

/// Editor views that need parent frame fixing (Perry's UIStackView has 0x0 frame).
static EDITOR_VIEWS: Mutex<Vec<usize>> = Mutex::new(Vec::new());

/// Global editor view pointer for the touch overlay to forward touches to.
static GLOBAL_EDITOR_VIEW: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// Global HoneEditorView UIView pointer for coordinate conversion.
static GLOBAL_EDITOR_UIVIEW: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

static REGISTER_OVERLAY: Once = Once::new();

fn ensure_overlay_class_registered() {
    REGISTER_OVERLAY.call_once(|| {
        let superclass = Class::get("UIView").expect("UIView");
        let mut decl = ClassDecl::new("HoneTouchOverlay", superclass)
            .expect("Failed to create HoneTouchOverlay");
        unsafe {
            decl.add_method(
                objc::sel!(overlayTapped:),
                overlay_tapped as extern "C" fn(&Object, Sel, Id),
            );
            decl.add_method(
                objc::sel!(overlayPanned:),
                overlay_panned as extern "C" fn(&Object, Sel, Id),
            );
            decl.add_method(
                objc::sel!(pointInside:withEvent:),
                overlay_point_inside as extern "C" fn(&Object, Sel, ObjCPoint, Id) -> BOOL,
            );
        }
        decl.register();
    });
}

/// Only claim touches that are within the editor view's visible area.
/// This lets Perry toolbar/status bar buttons receive their touches.
extern "C" fn overlay_point_inside(_this: &Object, _sel: Sel, point: ObjCPoint, _event: Id) -> BOOL {
    unsafe {
        let uiview_ptr = GLOBAL_EDITOR_UIVIEW.load(std::sync::atomic::Ordering::Relaxed);
        if uiview_ptr == 0 { return false; }
        let uiview = uiview_ptr as Id;
        // Convert point from overlay (window) coords to editor view coords
        let editor_frame: ObjCRect = msg_send![uiview, frame];
        // The overlay covers the whole window. Only claim if point is inside editor frame.
        // Convert from window to superview coords (editor's frame is in its superview's coords)
        let sv: Id = msg_send![uiview, superview];
        if sv == NIL { return false; }
        let sv_frame: ObjCRect = msg_send![sv, frame];
        // Editor's absolute position in window = superview.origin + editor.origin
        let editor_y = sv_frame.origin.y + editor_frame.origin.y;
        let editor_x = sv_frame.origin.x + editor_frame.origin.x;
        if point.x >= editor_x && point.x <= editor_x + editor_frame.size.width
            && point.y >= editor_y && point.y <= editor_y + editor_frame.size.height {
            YES
        } else {
            false
        }
    }
}

extern "C" fn overlay_panned(_this: &Object, _sel: Sel, gesture: Id) {
    unsafe {
        let ev_ptr = GLOBAL_EDITOR_VIEW.load(std::sync::atomic::Ordering::Relaxed);
        let uiview_ptr = GLOBAL_EDITOR_UIVIEW.load(std::sync::atomic::Ordering::Relaxed);
        if ev_ptr == 0 || uiview_ptr == 0 { return; }
        let editor_view = &mut *(ev_ptr as *mut EditorView);
        let uiview = uiview_ptr as Id;

        // Use translationInView for delta, reset after each call
        let translation: ObjCPoint = msg_send![gesture, translationInView: uiview];
        let zero = ObjCPoint { x: 0.0, y: 0.0 };
        let _: () = msg_send![gesture, setTranslation: zero inView: uiview];

        if translation.y.abs() > 0.5 {
            editor_view.on_scroll(0.0, translation.y);
        }
        mark_dirty(uiview);
    }
}

// Swizzle UIWindow.sendEvent: to intercept ALL touches at the lowest level.
static mut ORIGINAL_SEND_EVENT: Option<extern "C" fn(&Object, Sel, Id)> = None;

unsafe fn swizzle_send_event() {
    let cls = Class::get("UIWindow").expect("UIWindow");
    let sel = objc::sel!(sendEvent:);
    let method = class_getInstanceMethod(cls as *const _ as *mut _, sel);
    if method.is_null() { return; }
    let orig_imp = method_getImplementation(method);
    ORIGINAL_SEND_EVENT = Some(std::mem::transmute(orig_imp));
    let new_imp: extern "C" fn(&Object, Sel, Id) = hooked_send_event;
    method_setImplementation(method, new_imp as *mut _);
}

extern "C" {
    fn class_getInstanceMethod(cls: *mut std::ffi::c_void, sel: Sel) -> *mut std::ffi::c_void;
    fn method_getImplementation(method: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn method_setImplementation(method: *mut std::ffi::c_void, imp: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

extern "C" fn hooked_send_event(this: &Object, sel: Sel, event: Id) {
    unsafe {
        // Forward to original first
        if let Some(orig) = ORIGINAL_SEND_EVENT {
            orig(this, sel, event);
        }
        // Check if this is a touch event
        let event_type: i64 = msg_send![event, type];
        if event_type == 0 { // UIEventTypeTouches
            let all_touches: Id = msg_send![event, allTouches];
            if all_touches != NIL {
                let count: usize = msg_send![all_touches, count];
                if count > 0 {
                    let enumerator: Id = msg_send![all_touches, objectEnumerator];
                    let touch: Id = msg_send![enumerator, nextObject];
                    if touch != NIL {
                        let phase: i64 = msg_send![touch, phase];
                        if phase == 0 { // UITouchPhaseBegan
                            let ev_ptr = GLOBAL_EDITOR_VIEW.load(std::sync::atomic::Ordering::Relaxed);
                            if ev_ptr != 0 {
                                // Get touch location in window coordinates
                                let window_point: ObjCPoint = msg_send![touch, locationInView: NIL];
                                let editor_view = &mut *(ev_ptr as *mut EditorView);
                                // Convert: subtract editor view's origin in window
                                // For now use raw window coordinates (editor is full-width)
                                editor_view.on_mouse_down(window_point.x, window_point.y);
                                let uiview_ptr = GLOBAL_EDITOR_UIVIEW.load(std::sync::atomic::Ordering::Relaxed);
                                if uiview_ptr != 0 {
                                    mark_dirty(uiview_ptr as Id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

extern "C" fn overlay_tapped(_this: &Object, _sel: Sel, gesture: Id) {
    unsafe {
        let ev_ptr = GLOBAL_EDITOR_VIEW.load(std::sync::atomic::Ordering::Relaxed);
        let uiview_ptr = GLOBAL_EDITOR_UIVIEW.load(std::sync::atomic::Ordering::Relaxed);
        if ev_ptr == 0 || uiview_ptr == 0 { return; }
        let editor_view = &mut *(ev_ptr as *mut EditorView);
        let uiview = uiview_ptr as Id;
        // Get tap location relative to the editor view
        let point: ObjCPoint = msg_send![gesture, locationInView: uiview];
        editor_view.on_mouse_down(point.x, point.y);
        // Show keyboard
        let _: BOOL = msg_send![uiview, becomeFirstResponder];
        mark_dirty(uiview);
    }
}

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

    // Swizzle UIWindow.sendEvent: to intercept all touches (once).
    static SWIZZLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if !SWIZZLED.load(std::sync::atomic::Ordering::Relaxed) {
        if GLOBAL_EDITOR_VIEW.load(std::sync::atomic::Ordering::Relaxed) != 0 {
            unsafe { swizzle_send_event(); }
            SWIZZLED.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    // Fix zero-sized parent frames so hit-testing works.
    // Perry's UIStackView container gets 0x0 frame from Auto Layout,
    // blocking all touch delivery. Propagate editor frame to ancestors.
    let editors: Vec<usize> = {
        let e = EDITOR_VIEWS.lock().unwrap();
        e.clone()
    };
    for ptr in editors {
        unsafe {
            let view = ptr as Id;
            let editor_frame: ObjCRect = msg_send![view, frame];
            if editor_frame.size.width < 1.0 { continue; }
            let mut parent: Id = msg_send![view, superview];
            while parent != NIL {
                let pframe: ObjCRect = msg_send![parent, frame];
                if pframe.size.width < 1.0 || pframe.size.height < 1.0 {
                    let fixed = ObjCRect {
                        origin: pframe.origin,
                        size: editor_frame.size,
                    };
                    let _: () = msg_send![parent, setFrame: fixed];
                }
                parent = msg_send![parent, superview];
            }
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

/// Public API: directly call setNeedsDisplay on the view.
/// Previously routed through CADisplayLink, but Perry's embedding
/// doesn't give the view a window, so the display link never fires.
pub fn invalidate_view(uiview: Id) {
    if uiview != NIL {
        unsafe {
            let _: () = msg_send![uiview, setNeedsDisplay];
        }
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
