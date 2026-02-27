//! iOS touch event handling.
//!
//! Converts UIKit touch events to editor cursor/selection actions.
//! - UITapGestureRecognizer → move cursor / select word / select line
//! - UILongPressGestureRecognizer → enter selection mode
//! - UIPanGestureRecognizer → scroll
//! - UIPinchGestureRecognizer → zoom (font size)
//!
//! The actual gesture recognizer setup happens in the Perry UIKit integration.
//! This module provides the logic for converting touch coordinates to editor actions.

/// Touch action result to send back to TypeScript.
pub enum TouchAction {
    MoveCursor { line: i32, column: i32 },
    SelectWord { line: i32, column: i32 },
    SelectLine { line: i32 },
    ExtendSelection { line: i32, column: i32 },
    Scroll { delta_x: f64, delta_y: f64 },
    Zoom { scale: f64 },
}

/// Process a tap gesture.
pub fn process_tap(x: f64, y: f64, tap_count: i32) -> TouchAction {
    match tap_count {
        2 => TouchAction::SelectWord { line: 0, column: 0 },
        3 => TouchAction::SelectLine { line: 0 },
        _ => TouchAction::MoveCursor { line: 0, column: 0 },
    }
}
