//! EditorView: top-level state for a macOS editor instance.
//!
//! TypeScript is the single source of truth for all editing state (text, cursor,
//! selections). Rust is a rendering cache: TypeScript pushes line data via
//! cache_line(), sets the visible range via set_viewport(), and Rust draws
//! the cached content. On scroll, Rust shifts cached y_offsets for instant
//! visual feedback, accumulating a delta that TypeScript reads to sync.

use cocoa::base::{id, nil};
use cocoa::foundation::NSRect;
use core_graphics::context::CGContext;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use serde::Deserialize;

use std::collections::{HashMap, HashSet};
use std::ffi::{c_char, CString};

use crate::text_renderer::{self, FontSet, RenderToken};
use crate::view;

extern "C" {
    fn CGContextSetShouldSmoothFonts(c: *mut std::ffi::c_void, smooth: bool);
    fn CGContextSetAllowsFontSmoothing(c: *mut std::ffi::c_void, allow: bool);
    fn CGContextSetShouldAntialias(c: *mut std::ffi::c_void, antialias: bool);
}

// ── Callback types ──────────────────────────────────────────────

/// Called when the user types printable text. `text` is a null-terminated UTF-8 C string.
pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);

/// Called when a macOS action selector fires (arrow keys, delete, enter, etc.).
/// `selector` is the selector name as a null-terminated UTF-8 C string (e.g. "moveLeft:").
pub type ActionCallback = extern "C" fn(view: *mut EditorView, selector: *const c_char);

/// Called when the user clicks in the editor view. `x` and `y` are in view coordinates.
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);

/// Called when the user scrolls. `dx`/`dy` are pixel deltas (dy positive = scroll down).
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

// ── Event queue (for TypeScript polling) ────────────────────────

/// Event type constants (returned as f64 via FFI).
pub mod event_type {
    pub const TEXT: i32 = 1;
    pub const ACTION: i32 = 2;
    pub const SCROLL: i32 = 3;
    pub const MOUSE_DOWN: i32 = 4;
    pub const MOUSE_DRAG: i32 = 5;
}

/// Action ID constants matching TypeScript's ACTION_* values.
pub mod action_id {
    pub const MOVE_LEFT: i32 = 1;
    pub const MOVE_RIGHT: i32 = 2;
    pub const MOVE_UP: i32 = 3;
    pub const MOVE_DOWN: i32 = 4;
    pub const MOVE_BOL: i32 = 5;   // beginning of line
    pub const MOVE_EOL: i32 = 6;   // end of line
    pub const MOVE_BOD: i32 = 7;   // beginning of document
    pub const MOVE_EOD: i32 = 8;   // end of document
    pub const INSERT_NEWLINE: i32 = 9;
    pub const DELETE_BACKWARD: i32 = 10;
    pub const DELETE_FORWARD: i32 = 11;
    pub const INSERT_TAB: i32 = 12;
    pub const MOVE_WORD_LEFT: i32 = 13;
    pub const MOVE_WORD_RIGHT: i32 = 14;
    pub const MOVE_LEFT_SEL: i32 = 15;
    pub const MOVE_RIGHT_SEL: i32 = 16;
    pub const MOVE_UP_SEL: i32 = 17;
    pub const MOVE_DOWN_SEL: i32 = 18;
    pub const MOVE_BOL_SEL: i32 = 19;
    pub const MOVE_EOL_SEL: i32 = 20;
    pub const SELECT_ALL: i32 = 21;
    pub const CUT: i32 = 22;
    pub const COPY: i32 = 23;
    pub const PASTE: i32 = 24;
    pub const UNDO: i32 = 25;
    pub const REDO: i32 = 26;
    pub const DELETE_WORD_BACKWARD: i32 = 27;
    pub const PAGE_UP: i32 = 28;
    pub const PAGE_DOWN: i32 = 29;
}

/// A buffered input event for TypeScript polling.
pub struct PendingEvent {
    pub event_type: i32,
    pub char_code: u32,  // Unicode codepoint for TEXT events
    pub action_id: i32,  // Action ID for ACTION events
    pub x: f64,          // view-x for MOUSE_DOWN/DRAG, dx for SCROLL
    pub y: f64,          // view-y for MOUSE_DOWN/DRAG, dy for SCROLL
}

/// Map a macOS action selector name to an action ID integer.
fn selector_to_action_id(sel: &str) -> i32 {
    match sel {
        "moveLeft:"                                   => action_id::MOVE_LEFT,
        "moveRight:"                                  => action_id::MOVE_RIGHT,
        "moveUp:"                                     => action_id::MOVE_UP,
        "moveDown:"                                   => action_id::MOVE_DOWN,
        "moveToBeginningOfLine:"
        | "moveToLeftEndOfLine:"                      => action_id::MOVE_BOL,
        "moveToEndOfLine:"
        | "moveToRightEndOfLine:"                     => action_id::MOVE_EOL,
        "moveToBeginningOfDocument:"                  => action_id::MOVE_BOD,
        "moveToEndOfDocument:"                        => action_id::MOVE_EOD,
        "insertNewline:"                              => action_id::INSERT_NEWLINE,
        "deleteBackward:"                             => action_id::DELETE_BACKWARD,
        "deleteForward:"                              => action_id::DELETE_FORWARD,
        "insertTab:"                                  => action_id::INSERT_TAB,
        "moveWordLeft:" | "moveWordBackward:"         => action_id::MOVE_WORD_LEFT,
        "moveWordRight:" | "moveWordForward:"         => action_id::MOVE_WORD_RIGHT,
        "moveLeftAndModifySelection:"                 => action_id::MOVE_LEFT_SEL,
        "moveRightAndModifySelection:"                => action_id::MOVE_RIGHT_SEL,
        "moveUpAndModifySelection:"                   => action_id::MOVE_UP_SEL,
        "moveDownAndModifySelection:"                 => action_id::MOVE_DOWN_SEL,
        "moveToBeginningOfLineAndModifySelection:"    => action_id::MOVE_BOL_SEL,
        "moveToEndOfLineAndModifySelection:"          => action_id::MOVE_EOL_SEL,
        "selectAll:"                                  => action_id::SELECT_ALL,
        "cut:"                                        => action_id::CUT,
        "copy:"                                       => action_id::COPY,
        "paste:"                                      => action_id::PASTE,
        "undo:"                                       => action_id::UNDO,
        "redo:"                                       => action_id::REDO,
        "deleteWordBackward:"                         => action_id::DELETE_WORD_BACKWARD,
        "pageUp:" | "scrollPageUp:"                   => action_id::PAGE_UP,
        "pageDown:" | "scrollPageDown:"               => action_id::PAGE_DOWN,
        _                                             => 0,  // unknown selector
    }
}

/// A custom context menu item added by the host application.
pub struct ContextMenuItem {
    pub title: String,
    pub action_id: String,
}

// ── Data structures ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SelectionRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Deserialize)]
pub struct CursorData {
    pub x: f64,
    pub y: f64,
    pub style: i32,
}

#[derive(Debug, Deserialize)]
pub struct DecorationOverlay {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub color: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// Find highlight stored as line/col/len — pixel positions computed at draw time
/// from frame_lines y_offsets, so scrolling stays correct.
#[derive(Debug, Deserialize)]
pub struct FindHighlight {
    pub line: i32,      // 0-based line number
    pub col: i32,       // 0-based column
    pub len: i32,       // match length in characters
    pub current: i32,   // 1 = current match, 0 = other
}

struct LineRenderData {
    line_number: i32,
    text: String,
    tokens: Vec<RenderToken>,
    y_offset: f64,
    /// Optional line background color (for code blocks, etc.)
    line_bg: Option<(f64, f64, f64)>,
}

/// Cached line data for scroll reuse. Stores text + tokens without y_offset
/// (y_offset is computed from line_number and scroll position).
struct CachedLine {
    text: String,
    tokens: Vec<RenderToken>,
    /// Optional line background color (for code blocks, etc.)
    line_bg: Option<(f64, f64, f64)>,
}

struct GhostTextData {
    text: String,
    x: f64,
    y: f64,
    color: (f64, f64, f64),
}

// ── EditorView ───────────────────────────────────────────────────

/// Top-level editor view state.
///
/// This is the object behind the opaque `*mut EditorView` pointer
/// returned by `hone_editor_create()`.
pub struct EditorView {
    pub renderer: FontSet,
    nsview: id,
    pub parent_view: *mut std::ffi::c_void,
    width: f64,
    height: f64,

    // Frame buffer (populated by set_viewport or legacy render_line)
    frame_lines: Vec<LineRenderData>,
    cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    /// Find highlights — NOT cleared by begin_frame. Stored as line/col/len,
    /// pixel positions computed at draw time from frame_lines y_offsets.
    find_highlights: Vec<FindHighlight>,
    ghost_text: Option<GhostTextData>,
    scroll_offset: f64,
    max_line_number: i32,

    // Input callbacks (used by the standalone Rust demo)
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (used by the TypeScript polling API)
    pub pending_events: Vec<PendingEvent>,
    // Zero-argument callback Perry registers; called synchronously when an event is queued.
    pub event_callback: Option<extern "C" fn()>,

    // When true, event handlers only queue events — TypeScript handles all state changes.
    // Set via hone_editor_set_ts_mode(handle, 1) from TypeScript once the poll loop is active.
    pub ts_handles_events: bool,
    // Gutter width set by TypeScript (overrides computed gutter_width when Some).
    pub ts_gutter_width: Option<f64>,
    // Line height from TypeScript (set via set_viewport's line_height param).
    ts_line_height_px: Option<f64>,
    // y_offset of the first line as received from the first frame.
    // Used as the upper scroll bound so content can't be dragged below its initial position.
    initial_top_y: Option<f64>,

    // Read-only mode: when true, text input and edit actions are blocked.
    pub read_only: bool,

    // Per-line background colors for diff highlighting.
    // Key = 1-based line number, Value = (r, g, b, a) in 0.0–1.0 range.
    pub line_backgrounds: HashMap<i32, (f64, f64, f64, f64)>,

    // Line cache: stores all lines ever sent by TypeScript, keyed by 1-based line number.
    // Used to fill in lines that scroll into view without requiring a TypeScript re-render.
    line_cache: HashMap<i32, CachedLine>,
    // Accumulated scroll delta (in pixels) that TypeScript can read to sync its viewport state.
    // Positive = content moved down, negative = content moved up.
    pub rust_scroll_delta: f64,
    // Accumulated horizontal scroll delta for TypeScript sync.
    pub rust_scroll_delta_x: f64,
    // Current horizontal scroll offset (pixels). 0 = no horizontal scroll.
    // Increases as content scrolls to the right (leftmost content hidden).
    pub scroll_x: f64,
    // Set true when scroll reveals lines not present in the cache — TypeScript should provide them.
    pub needs_lines: bool,

    // Line diagnostics for Error Lens-style inline messages.
    // Key = 1-based line number, Value = (severity 1-4, message, color hex).
    pub line_diagnostics: HashMap<i32, (i32, String, String)>,
    // Gutter diagnostics: Key = 1-based line number, Value = severity (1=error, 2=warning, 3=info).
    pub gutter_diagnostics: HashMap<i32, i32>,
    // Breakpoint lines (1-based). Red circles in gutter.
    pub breakpoint_lines: HashSet<i32>,
    // Fold ranges: start line (1-based) → collapsed (true/false).
    pub fold_indicators: HashMap<i32, bool>,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,

    // Theme colors
    background_color: (f64, f64, f64),
    gutter_bg_color: (f64, f64, f64),
    gutter_fg_color: (f64, f64, f64),
    default_text_color: (f64, f64, f64),
    selection_color: (f64, f64, f64, f64),
    cursor_color: (f64, f64, f64),
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        let renderer = FontSet::new("Menlo", 14.0);

        EditorView {
            renderer,
            nsview: nil,
            parent_view: std::ptr::null_mut(),
            width,
            height,
            frame_lines: Vec::with_capacity(64),
            cursor: None,
            cursors: Vec::new(),
            selections: Vec::new(),
            decorations: Vec::new(),
            find_highlights: Vec::new(),
            ghost_text: None,
            scroll_offset: 0.0,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            scroll_callback: None,
            pending_events: Vec::new(),
            event_callback: None,
            ts_handles_events: false,
            ts_gutter_width: None,
            ts_line_height_px: None,
            initial_top_y: None,
            read_only: false,
            line_backgrounds: HashMap::new(),
            line_cache: HashMap::new(),
            rust_scroll_delta: 0.0,
            rust_scroll_delta_x: 0.0,
            scroll_x: 0.0,
            needs_lines: false,
            line_diagnostics: HashMap::new(),
            gutter_diagnostics: HashMap::new(),
            breakpoint_lines: HashSet::new(),
            fold_indicators: HashMap::new(),
            context_menu_items: Vec::new(),
            // VS Code dark theme defaults
            background_color: (0.118, 0.118, 0.118),     // #1e1e1e
            gutter_bg_color: (0.118, 0.118, 0.118),      // same as bg
            gutter_fg_color: (0.525, 0.525, 0.525),      // #858585
            default_text_color: (0.843, 0.843, 0.843),   // #d7d7d7
            selection_color: (0.153, 0.306, 0.482, 0.4), // #264f7a @ 40%
            cursor_color: (0.918, 0.918, 0.918),          // #eaeaea
        }
    }

    pub fn width(&self) -> f64 { self.width }
    pub fn height(&self) -> f64 { self.height }

    /// Set the editor background color.
    pub fn set_bg_color(&mut self, r: f64, g: f64, b: f64) {
        self.background_color = (r, g, b);
        self.gutter_bg_color = (r, g, b); // gutter matches editor bg
        self.invalidate();
    }

    /// Set the default text color.
    pub fn set_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.default_text_color = (r, g, b);
        self.invalidate();
    }

    /// Set the gutter (line number) foreground color.
    pub fn set_gutter_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.gutter_fg_color = (r, g, b);
        self.invalidate();
    }

    /// Set the selection highlight color (with alpha).
    pub fn set_selection_color(&mut self, r: f64, g: f64, b: f64, a: f64) {
        self.selection_color = (r, g, b, a);
        self.invalidate();
    }

    /// Set the cursor color.
    pub fn set_cursor_color(&mut self, r: f64, g: f64, b: f64) {
        self.cursor_color = (r, g, b);
        self.invalidate();
    }

    /// Called from lib.rs after the EditorView has a stable address.
    pub fn init_nsview(&mut self) {
        let self_ptr = self as *mut EditorView;
        self.nsview = view::create_editor_nsview(self.width, self.height, self_ptr);
    }

    /// Get the underlying NSView handle.
    pub fn nsview(&self) -> id {
        self.nsview
    }

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    /// Called from the NSView's insertText: handler.
    /// Queues events for TypeScript polling. TypeScript handles all editing.
    pub fn on_text_input(&mut self, text: &str) {
        if self.read_only { return; }
        if let Some(cb) = self.text_input_callback {
            if let Ok(c_text) = CString::new(text) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_text.as_ptr());
            }
            return;
        }
        // Queue events for TypeScript's polling loop.
        for ch in text.chars() {
            self.pending_events.push(PendingEvent {
                event_type: event_type::TEXT,
                char_code: ch as u32,
                action_id: 0,
                x: 0.0,
                y: 0.0,
            });
        }
    }

    /// Called from the NSView's doCommandBySelector: handler.
    /// Queues events for TypeScript polling. TypeScript handles all actions.
    pub fn on_action(&mut self, selector: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_sel) = CString::new(selector) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_sel.as_ptr());
            }
            return;
        }

        // In read-only mode, block edit actions but allow navigation/copy/select-all.
        if self.read_only {
            match selector {
                "insertNewline:" | "deleteBackward:" | "deleteForward:" | "insertTab:"
                | "cut:" | "paste:" | "undo:" | "redo:" | "deleteWordBackward:" => return,
                _ => {}
            }
        }

        // Queue the action event for TypeScript's polling loop.
        let aid = selector_to_action_id(selector);
        if aid != 0 {
            self.pending_events.push(PendingEvent {
                event_type: event_type::ACTION,
                char_code: 0,
                action_id: aid,
                x: 0.0,
                y: 0.0,
            });
        }
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    /// Called from the NSView's mouseDown: handler.
    /// Queues event for TypeScript. TypeScript handles cursor positioning.
    /// click_count: 1=single, 2=double (word select), 3=triple (line select)
    pub fn on_mouse_down(&mut self, x: f64, y: f64, click_count: i32) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
            return;
        }
        // Adjust x for heading lines (wider chars) so TypeScript computes correct column.
        let adj_x = self.adjust_click_x_for_heading(x, y);
        self.pending_events.push(PendingEvent {
            event_type: event_type::MOUSE_DOWN,
            char_code: 0,
            action_id: click_count,
            x: adj_x,
            y,
        });
    }

    /// Called from the NSView's mouseDragged: handler.
    /// Queues event for TypeScript. TypeScript handles selection extension.
    pub fn on_mouse_drag(&mut self, x: f64, y: f64) {
        if self.mouse_down_callback.is_some() {
            return;
        }
        let adj_x = self.adjust_click_x_for_heading(x, y);
        self.pending_events.push(PendingEvent {
            event_type: event_type::MOUSE_DRAG,
            char_code: 0,
            action_id: 0,
            x: adj_x,
            y,
        });
    }

    /// Adjust a screen click x-coordinate for heading lines.
    /// Heading fonts have wider characters than the normal font. TypeScript uses
    /// normal charWidth in pixelToPosition(), so we convert from heading-space to
    /// normal-space so TypeScript computes the correct column.
    fn adjust_click_x_for_heading(&self, screen_x: f64, y: f64) -> f64 {
        let gw = self.gutter_width();
        if screen_x <= gw { return screen_x; }

        let ts_lh = self.ts_line_height();
        for line in &self.frame_lines {
            let ly = line.y_offset.round();
            if y >= ly && y < ly + ts_lh {
                // Check if this line has heading tokens
                let mut heading_cw = 0.0;
                for token in &line.tokens {
                    if token.st == "heading-lg" {
                        heading_cw = self.renderer.heading_large_char_width;
                        break;
                    }
                    if token.st == "heading-md" {
                        heading_cw = self.renderer.heading_medium_char_width;
                        break;
                    }
                }
                if heading_cw <= 0.0 { return screen_x; } // not a heading

                let normal_cw = self.renderer.char_width;
                // Document-space x from gutter (accounting for scroll)
                let doc_x = screen_x + self.scroll_x - gw;
                // Column in heading text
                let col = doc_x / heading_cw;
                // Convert back to what TypeScript expects:
                // TS computes: col = (event_x + scrollLeft - gw) / normal_cw
                // scrollLeft ≈ scroll_x, so: event_x = col * normal_cw - scroll_x + gw
                return col * normal_cw - self.scroll_x + gw;
            }
        }
        screen_x
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    /// Called from the NSView's scrollWheel: handler.
    /// Handles visual scroll directly (shifting cached y_offsets) for 0ms response.
    /// Accumulates delta for TypeScript to sync.
    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
            return;
        }

        // In ts_mode, do NOT queue scroll events for TypeScript — Rust handles scroll
        // directly for visual responsiveness. TypeScript can read rust_scroll_delta to
        // sync its viewport state when needed (e.g., before content edits).
        if !self.ts_handles_events {
            self.pending_events.push(PendingEvent {
                event_type: event_type::SCROLL,
                char_code: 0,
                action_id: 0,
                x: dx,
                y: dy,
            });
        }

        if self.frame_lines.is_empty() {
            return;
        }

        let mut needs_redraw = false;

        // ── Vertical scroll ─────────────────────────────────────────
        if dy.abs() > 0.1 {
            let ts_line_h = self.ts_line_height();
            let total_lines = if self.max_line_number > 0 {
                self.max_line_number as f64
            } else {
                self.frame_lines.len() as f64
            };
            let total_content_h = total_lines * ts_line_h;

            let first_line_num = self.frame_lines[0].line_number;
            let first_y = self.frame_lines[0].y_offset;
            let effective_scroll_top = (first_line_num as f64 - 1.0) * ts_line_h - first_y;

            let actual_dy = if total_content_h <= self.height {
                0.0
            } else {
                let max_scroll = total_content_h - self.height;
                let new_scroll_top = (effective_scroll_top - dy).clamp(0.0, max_scroll);
                effective_scroll_top - new_scroll_top
            };

            if actual_dy.abs() >= 0.1 {
                self.rust_scroll_delta += actual_dy;

                // Round y_offsets to integer points after shifting.
                // Fractional positions cause Core Text to use different anti-aliasing
                // (grayscale vs subpixel) on layer-backed views, producing blurry text
                // that persists until the next full re-render from TypeScript.
                for line in &mut self.frame_lines {
                    line.y_offset = (line.y_offset + actual_dy).round();
                }
                if let Some(ref mut c) = self.cursor {
                    c.y = (c.y + actual_dy).round();
                }
                for sel in &mut self.selections {
                    sel.y = (sel.y + actual_dy).round();
                }
                for decor in &mut self.decorations {
                    decor.y = (decor.y + actual_dy).round();
                }

                // Fill gaps from line cache
                if ts_line_h > 1.0 {
                    let view_h = self.height;
                    self.frame_lines.retain(|l| {
                        l.y_offset + ts_line_h > -ts_line_h && l.y_offset < view_h + ts_line_h
                    });

                    let max_fill = (view_h / ts_line_h) as usize + 2;
                    let mut filled = 0usize;
                    loop {
                        if filled >= max_fill { break; }
                        let first_line_num = match self.frame_lines.first() {
                            Some(l) => l.line_number,
                            None => break,
                        };
                        let first_y = self.frame_lines[0].y_offset;
                        if first_y > 0.0 && first_line_num > 1 {
                            let needed_line = first_line_num - 1;
                            if let Some(cached) = self.line_cache.get(&needed_line) {
                                self.frame_lines.insert(0, LineRenderData {
                                    line_number: needed_line,
                                    text: cached.text.clone(),
                                    tokens: cached.tokens.clone(),
                                    y_offset: first_y - ts_line_h,
                                    line_bg: cached.line_bg,
                                });
                                filled += 1;
                            } else {
                                self.needs_lines = true;
                                break;
                            }
                        } else {
                            break;
                        }
                    }

                    filled = 0;
                    loop {
                        if filled >= max_fill { break; }
                        let last_line_num = match self.frame_lines.last() {
                            Some(l) => l.line_number,
                            None => break,
                        };
                        let last_y = self.frame_lines.last().unwrap().y_offset;
                        if last_y + ts_line_h < view_h && last_line_num < self.max_line_number {
                            let needed_line = last_line_num + 1;
                            if let Some(cached) = self.line_cache.get(&needed_line) {
                                self.frame_lines.push(LineRenderData {
                                    line_number: needed_line,
                                    text: cached.text.clone(),
                                    tokens: cached.tokens.clone(),
                                    y_offset: last_y + ts_line_h,
                                    line_bg: cached.line_bg,
                                });
                                filled += 1;
                            } else {
                                self.needs_lines = true;
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                }

                needs_redraw = true;
            }
        }

        // ── Horizontal scroll ───────────────────────────────────────
        if dx.abs() > 0.1 {
            let gutter_w = self.gutter_width();
            let max_text_width = self.frame_lines.iter()
                .map(|l| l.text.len() as f64 * self.renderer.char_width)
                .fold(0.0f64, f64::max);
            let content_width = max_text_width + 40.0; // right padding
            let view_content_width = self.width - gutter_w;
            let max_scroll_x = (content_width - view_content_width).max(0.0);
            // Positive dx = swipe right = see content more to the left = scroll_x decreases
            let new_scroll_x = (self.scroll_x - dx).clamp(0.0, max_scroll_x);
            let delta_x = new_scroll_x - self.scroll_x;
            let rounded_x = new_scroll_x.round();
            let actual_delta = rounded_x - self.scroll_x;
            if actual_delta.abs() > 0.01 {
                self.scroll_x = rounded_x;
                self.rust_scroll_delta_x += actual_delta;
                needs_redraw = true;
            }
        }

        if needs_redraw {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn add_context_menu_item(&mut self, title: &str, action_id: &str) {
        self.context_menu_items.push(ContextMenuItem {
            title: title.to_string(),
            action_id: action_id.to_string(),
        });
    }

    pub fn clear_context_menu_items(&mut self) {
        self.context_menu_items.clear();
    }

    pub fn context_menu_items(&self) -> &[ContextMenuItem] {
        &self.context_menu_items
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.renderer = FontSet::new(family, size);
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        self.renderer.measure_text(text)
    }

    // ── Frame buffer API ─────────────────────────────────────────

    pub fn frame_lines_count(&self) -> usize {
        self.frame_lines.len()
    }

    /// Begin a frame batch. Clears per-frame state (cursor, decorations, ghost text)
    /// and frame_lines (they'll be rebuilt by render_line or set_viewport_range).
    pub fn begin_frame(&mut self) {
        self.cursor = None;
        self.cursors.clear();
        self.decorations.clear();
        self.ghost_text = None;
        self.frame_lines.clear();
        self.needs_lines = false;
    }

    /// Legacy: push a line with JSON tokens directly into frame buffer + cache.
    /// Kept for backward compatibility. New code uses cache_line + set_viewport.
    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        let mut tokens: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();
        // Auto-tokenize if TypeScript sent empty tokens (e.g. initial _directRenderText).
        if tokens.is_empty() && !text.is_empty() {
            tokens = crate::tokenizer::tokenize_line(text);
        }
        if line_number > self.max_line_number {
            self.max_line_number = line_number;
        }
        // Cache for scroll reuse — keyed by 1-based line number.
        self.line_cache.insert(line_number, CachedLine {
            text: text.to_string(),
            tokens: tokens.clone(),
            line_bg: None,
        });
        self.frame_lines.push(LineRenderData {
            line_number,
            text: text.to_string(),
            tokens,
            y_offset,
            line_bg: None,
        });
        // TypeScript just provided lines — clear the needs flag.
        self.needs_lines = false;
    }

    /// Set the primary cursor position. TypeScript is authoritative.
    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        self.cursor = Some(CursorData { x, y, style });
    }

    // ── New TS-authoritative API ──────────────────────────────────

    /// Cache a line's text and tokens (packed format). Does NOT add to frame_lines.
    /// TypeScript calls this for dirty lines, then set_viewport to display them.
    pub fn cache_line_packed(&mut self, line_number: i32, text: &str, packed_tokens: &str) {
        let parsed = text_renderer::parse_packed_tokens(packed_tokens);
        self.line_cache.insert(line_number, CachedLine {
            text: text.to_string(),
            tokens: parsed.tokens,
            line_bg: parsed.line_bg,
        });
    }

    /// Invalidate a single cached line (e.g., after an edit on that line).
    pub fn invalidate_cache_line(&mut self, line_number: i32) {
        self.line_cache.remove(&line_number);
    }

    /// Build frame_lines from the cache for the visible range [start_line, end_line] (1-based).
    /// Computes y_offsets from line numbers, line_height, and scroll_top.
    pub fn set_viewport_range(
        &mut self,
        start_line: i32,
        end_line: i32,
        scroll_top: f64,
        total_lines: i32,
        line_height: f64,
    ) {
        self.frame_lines.clear();
        self.max_line_number = total_lines;
        self.scroll_offset = scroll_top;
        self.ts_line_height_px = Some(line_height);

        for line_num in start_line..=end_line {
            if let Some(cached) = self.line_cache.get(&line_num) {
                let y_offset = (line_num as f64 - 1.0) * line_height - scroll_top;
                self.frame_lines.push(LineRenderData {
                    line_number: line_num,
                    text: cached.text.clone(),
                    tokens: cached.tokens.clone(),
                    y_offset,
                    line_bg: cached.line_bg,
                });
            }
        }

        // Record initial_top_y for scroll clamping on first viewport set.
        if self.initial_top_y.is_none() {
            if let Some(first) = self.frame_lines.first() {
                self.initial_top_y = Some(first.y_offset);
            }
        }
    }

    /// Clear selections and pre-allocate for `count` new rects.
    pub fn begin_selections_new(&mut self, count: usize) {
        self.selections.clear();
        self.selections.reserve(count);
    }

    /// Add a selection highlight rectangle.
    pub fn add_selection_rect_entry(&mut self, x: f64, y: f64, w: f64, h: f64) {
        self.selections.push(SelectionRegion { x, y, w, h });
    }

    // ── Legacy APIs (kept for backward compat) ────────────────────

    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.cursors = serde_json::from_str(cursors_json).unwrap_or_default();
    }

    pub fn set_selection(&mut self, regions_json: &str) {
        self.selections = serde_json::from_str(regions_json).unwrap_or_default();
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset = offset_y;
    }

    pub fn render_decorations(&mut self, decorations_json: &str) {
        let mut decors: Vec<DecorationOverlay> =
            serde_json::from_str(decorations_json).unwrap_or_default();
        self.decorations.append(&mut decors);
    }

    /// Set persistent find highlights as line/col/len/current entries.
    /// NOT cleared by begin_frame — persists until explicitly changed.
    pub fn set_find_highlights(&mut self, json: &str) {
        self.find_highlights = serde_json::from_str(json).unwrap_or_default();
    }

    /// Clear find highlights.
    pub fn clear_find_highlights(&mut self) {
        self.find_highlights.clear();
    }

    pub fn render_ghost_text(&mut self, text: &str, x: f64, y: f64, color: &str) {
        self.ghost_text = Some(GhostTextData {
            text: text.to_string(),
            x,
            y,
            color: text_renderer::parse_hex_color(color),
        });
    }

    pub fn end_frame(&mut self) {
        // Record initial_top_y if not yet set (for legacy render_line path).
        if self.initial_top_y.is_none() {
            if let Some(first) = self.frame_lines.first() {
                self.initial_top_y = Some(first.y_offset);
            }
        }
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    pub fn invalidate(&mut self) {
        if self.nsview != nil {
            view::invalidate_view(self.nsview);
        }
    }

    /// Clear the line cache. Called when switching files or when document content changes
    /// significantly (the cached lines would be stale).
    pub fn clear_line_cache(&mut self) {
        self.line_cache.clear();
    }

    pub fn attach_to_parent(&mut self, parent: *mut std::ffi::c_void) {
        self.parent_view = parent;
        if self.nsview != nil && !parent.is_null() {
            unsafe {
                let parent_view = parent as id;
                let _: () = msg_send![parent_view, addSubview: self.nsview];
                let bounds: NSRect = msg_send![parent_view, bounds];
                let _: () = msg_send![self.nsview, setFrame: bounds];
            }
        }
    }

    // ── Drawing ──────────────────────────────────────────────────

    /// Compute gutter width matching the TS GutterRenderer formula:
    /// max(2, digits) * charWidth + 36  (16px fold + 16px padding + 4px diff)
    fn gutter_width(&self) -> f64 {
        // In ts_mode, use TypeScript's gutter width for pixel-perfect alignment.
        if let Some(w) = self.ts_gutter_width {
            return w;
        }
        let digits = if self.max_line_number <= 0 {
            2
        } else {
            let d = (self.max_line_number as f64).log10().floor() as i32 + 1;
            d.max(2)
        };
        digits as f64 * self.renderer.char_width + 36.0
    }

    /// Update width/height from actual NSView bounds (called from draw_rect).
    pub fn sync_view_size(&mut self) {
        if self.nsview != nil {
            let bounds: NSRect = unsafe { msg_send![self.nsview, bounds] };
            let w = bounds.size.width;
            let h = bounds.size.height;
            if w > 1.0 && h > 1.0 && ((w - self.width).abs() > 1.0 || (h - self.height).abs() > 1.0) {
                self.width = w;
                self.height = h;
            }
        }
    }

    /// Convert raw CGContextRef from drawRect: to a safe wrapper and draw.
    ///
    /// # Safety
    /// Called from the NSView drawRect: handler with a valid CGContextRef.
    pub fn draw(&self, raw_ctx: core_graphics::sys::CGContextRef, dirty_rect: NSRect) {
        let ctx = unsafe { CGContext::from_existing_context_ptr(raw_ctx) };
        // Force consistent font rendering regardless of event context.
        // macOS may disable font smoothing during scroll events, causing
        // text to appear lighter/thinner until the next non-scroll redraw.
        unsafe {
            CGContextSetShouldSmoothFonts(raw_ctx as *mut _, true);
            CGContextSetAllowsFontSmoothing(raw_ctx as *mut _, true);
            CGContextSetShouldAntialias(raw_ctx as *mut _, true);
        }
        let actual_height = dirty_rect.size.height.max(self.height);
        self.draw_with_context(&ctx, actual_height);
    }

    fn draw_with_context(&self, ctx: &CGContext, actual_height: f64) {
        let bounds = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(self.width, actual_height),
        );

        // 1. Fill background
        ctx.set_rgb_fill_color(
            self.background_color.0,
            self.background_color.1,
            self.background_color.2,
            1.0,
        );
        ctx.fill_rect(bounds);

        let gutter_w = self.gutter_width();
        // Round scroll_x to integer points for crisp rendering on all displays.
        // Rust-side scroll accumulates fractional deltas; sub-point positions
        // cause blurry Core Text output (different anti-aliasing pattern).
        let sx = self.scroll_x.round();

        // 2. Draw each buffered line — content area (scrollable)
        let ts_line_h = self.ts_line_height_px.unwrap_or(self.renderer.line_height);
        let text_x = gutter_w - sx; // pre-compute, already integer
        for line in &self.frame_lines {
            // Round y to integer points once — use for ALL elements on this line.
            let ly = line.y_offset.round();

            // Draw per-line background color (for diff highlighting) — full width, no scroll
            if let Some(&(r, g, b, a)) = self.line_backgrounds.get(&line.line_number) {
                ctx.set_rgb_fill_color(r, g, b, a);
                let line_rect = CGRect::new(
                    &CGPoint::new(0.0, ly),
                    &CGSize::new(self.width, ts_line_h),
                );
                ctx.fill_rect(line_rect);
            }

            // Draw code block / token-specified line background — no scroll
            if let Some((r, g, b)) = line.line_bg {
                ctx.set_rgb_fill_color(r, g, b, 1.0);
                let line_rect = CGRect::new(
                    &CGPoint::new(gutter_w, ly),
                    &CGSize::new(self.width - gutter_w, ts_line_h),
                );
                ctx.fill_rect(line_rect);
            }

            // Draw find highlights for this line (BEFORE text, so text renders on top)
            for fh in &self.find_highlights {
                if fh.line + 1 == line.line_number {
                    let char_w = self.renderer.char_width;
                    let byte_col = fh.col as usize;
                    let char_col = if byte_col <= line.text.len() {
                        line.text[..byte_col].chars().count()
                    } else {
                        byte_col
                    };
                    let byte_end = (fh.col + fh.len) as usize;
                    let char_len = if byte_end <= line.text.len() {
                        line.text[byte_col..byte_end].chars().count()
                    } else {
                        fh.len as usize
                    };
                    let hx = (gutter_w + char_col as f64 * char_w - sx).round();
                    let hw = (char_len as f64 * char_w).round();
                    if fh.current > 0 {
                        ctx.set_rgb_fill_color(0.91, 0.67, 0.33, 0.35);
                    } else {
                        ctx.set_rgb_fill_color(0.89, 0.76, 0.33, 0.20);
                    }
                    let hr = CGRect::new(
                        &CGPoint::new(hx, ly),
                        &CGSize::new(hw, ts_line_h),
                    );
                    ctx.fill_rect(hr);
                }
            }

            // Draw text content with tokens
            text_renderer::draw_line(
                ctx,
                &line.text,
                &line.tokens,
                text_x,
                ly,
                &self.renderer,
                self.default_text_color,
            );

            // Draw Error Lens-style inline diagnostic message after the line text
            if let Some((_severity, ref message, ref color_hex)) = self.line_diagnostics.get(&line.line_number) {
                let text_end_x = (gutter_w + self.renderer.char_width * line.text.len() as f64 + 16.0 - sx).round();
                let (mr, mg, mb) = text_renderer::parse_hex_color(color_hex);
                text_renderer::draw_text(
                    ctx,
                    message,
                    text_end_x,
                    ly,
                    &self.renderer.normal,
                    self.renderer.ascent,
                    (mr, mg, mb),
                );
            }
        }

        // 3. Draw decorations (underlines, backgrounds) — offset by scroll_x
        for decor in &self.decorations {
            let (r, g, b) = text_renderer::parse_hex_color(&decor.color);
            let dx = decor.x - sx;
            match decor.kind.as_str() {
                "background" => {
                    ctx.set_rgb_fill_color(r, g, b, 0.3);
                    let rect = CGRect::new(
                        &CGPoint::new(dx, decor.y),
                        &CGSize::new(decor.w, decor.h),
                    );
                    ctx.fill_rect(rect);
                }
                "underline" => {
                    ctx.set_rgb_stroke_color(r, g, b, 1.0);
                    ctx.set_line_width(1.0);
                    let y_bottom = decor.y + decor.h - 1.0;
                    ctx.move_to_point(dx, y_bottom);
                    ctx.add_line_to_point(dx + decor.w, y_bottom);
                    ctx.stroke_path();
                }
                "underline-wavy" => {
                    ctx.set_rgb_stroke_color(r, g, b, 1.0);
                    ctx.set_line_width(1.0);
                    let y_base = decor.y + decor.h - 1.0;
                    let wave_height = 2.0;
                    let wave_len = 4.0;
                    let mut x = dx;
                    ctx.move_to_point(x, y_base);
                    let mut up = true;
                    while x < dx + decor.w {
                        let y_target = if up { y_base - wave_height } else { y_base };
                        x += wave_len;
                        ctx.add_line_to_point(x, y_target);
                        up = !up;
                    }
                    ctx.stroke_path();
                }
                _ => {}
            }
        }

        // 4. Draw selection rectangles — offset by scroll_x, heading-aware height+position+width
        let gw = gutter_w;
        for sel in &self.selections {
            ctx.set_rgb_fill_color(
                self.selection_color.0,
                self.selection_color.1,
                self.selection_color.2,
                self.selection_color.3,
            );
            let (h, y_shift, cw_ratio) = self.line_metrics_at_y(sel.y);
            // Scale selection x and width for heading char width.
            // sel.x = startCol * normal_cw + gutterWidth, so content part = sel.x - gw
            let adj_x = if cw_ratio != 1.0 {
                (sel.x - gw) * cw_ratio + gw
            } else {
                sel.x
            };
            let adj_w = sel.w * cw_ratio;
            let rect = CGRect::new(
                &CGPoint::new((adj_x - sx).round(), (sel.y - y_shift).round()),
                &CGSize::new(adj_w.round(), h),
            );
            ctx.fill_rect(rect);
        }

        // 5. Draw ghost text — offset by scroll_x
        if let Some(ref ghost) = self.ghost_text {
            text_renderer::draw_text(
                ctx,
                &ghost.text,
                ghost.x - sx,
                ghost.y,
                &self.renderer.normal,
                self.renderer.ascent,
                ghost.color,
            );
        }

        // 6. Draw cursors — offset by scroll_x, heading-aware height
        self.draw_cursors(ctx, sx);

        // 7. Re-draw gutter on top (covers any content that scrolled under it)
        ctx.set_rgb_fill_color(
            self.gutter_bg_color.0,
            self.gutter_bg_color.1,
            self.gutter_bg_color.2,
            1.0,
        );
        let gutter_rect = CGRect::new(
            &CGPoint::new(0.0, 0.0),
            &CGSize::new(gutter_w, actual_height),
        );
        ctx.fill_rect(gutter_rect);

        // 8. Draw gutter items on top of gutter background
        for line in &self.frame_lines {
            let ly = line.y_offset.round(); // consistent rounded y

            // Breakpoint indicator
            if self.breakpoint_lines.contains(&line.line_number) {
                ctx.set_rgb_fill_color(0.9, 0.2, 0.2, 1.0);
                let bp_size = 10.0;
                let bp_x = 2.0;
                let bp_y = ly + (ts_line_h - bp_size) / 2.0;
                let bp_rect = CGRect::new(
                    &CGPoint::new(bp_x, bp_y),
                    &CGSize::new(bp_size, bp_size),
                );
                ctx.fill_ellipse_in_rect(bp_rect);
            }

            // Fold indicator
            if let Some(&collapsed) = self.fold_indicators.get(&line.line_number) {
                let tri_size = 8.0;
                let tri_x = gutter_w - 16.0;
                let tri_y = ly + (ts_line_h - tri_size) / 2.0;
                ctx.set_rgb_fill_color(0.5, 0.5, 0.5, 0.8);
                ctx.begin_path();
                if collapsed {
                    ctx.move_to_point(tri_x, tri_y);
                    ctx.add_line_to_point(tri_x + tri_size, tri_y + tri_size / 2.0);
                    ctx.add_line_to_point(tri_x, tri_y + tri_size);
                } else {
                    ctx.move_to_point(tri_x, tri_y);
                    ctx.add_line_to_point(tri_x + tri_size, tri_y);
                    ctx.add_line_to_point(tri_x + tri_size / 2.0, tri_y + tri_size);
                }
                ctx.close_path();
                ctx.fill_path();
            }

            // Gutter diagnostic icon
            if let Some(&severity) = self.gutter_diagnostics.get(&line.line_number) {
                let (dr, dg, db) = match severity {
                    1 => (0.957, 0.278, 0.278),
                    2 => (0.800, 0.655, 0.0),
                    3 => (0.310, 0.757, 1.0),
                    _ => (0.5, 0.5, 0.5),
                };
                ctx.set_rgb_fill_color(dr, dg, db, 1.0);
                let icon_size = 8.0;
                let icon_x = 4.0;
                let icon_y = ly + (ts_line_h - icon_size) / 2.0;
                let icon_rect = CGRect::new(
                    &CGPoint::new(icon_x, icon_y),
                    &CGSize::new(icon_size, icon_size),
                );
                ctx.fill_ellipse_in_rect(icon_rect);
            }

            // Line number
            let num_str = format!("{}", line.line_number);
            let num_width = self.renderer.char_width * num_str.len() as f64;
            let num_x = gutter_w - 20.0 - num_width;
            text_renderer::draw_text(
                ctx,
                &num_str,
                num_x,
                ly,
                &self.renderer.normal,
                self.renderer.ascent,
                self.gutter_fg_color,
            );
        }
    }

    fn draw_cursors(&self, ctx: &CGContext, scroll_x: f64) {
        let gw = self.gutter_width();
        let draw_one = |cursor: &CursorData| {
            let (lh, y_shift, cw_ratio) = self.line_metrics_at_y(cursor.y);
            let (w, h) = match cursor.style {
                0 => (2.0, lh),                         // Line cursor
                1 => (self.renderer.char_width * cw_ratio, lh), // Block cursor
                2 => (self.renderer.char_width * cw_ratio, 2.0), // Underline cursor
                _ => (2.0, lh),
            };
            let y = if cursor.style == 2 {
                cursor.y + lh - y_shift - 2.0
            } else {
                cursor.y - y_shift
            };
            // Scale cursor x for heading char width
            let cx = if cw_ratio != 1.0 {
                (cursor.x - gw) * cw_ratio + gw
            } else {
                cursor.x
            };
            ctx.set_rgb_fill_color(
                self.cursor_color.0,
                self.cursor_color.1,
                self.cursor_color.2,
                1.0,
            );
            let rect = CGRect::new(
                &CGPoint::new((cx - scroll_x).round(), y.round()),
                &CGSize::new(w, h),
            );
            ctx.fill_rect(rect);
        };

        if let Some(ref c) = self.cursor {
            draw_one(c);
        }
        for c in &self.cursors {
            draw_one(c);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────

    /// Get the effective line height, y-shift, and char width ratio for a line.
    /// Returns (height, y_shift, cw_ratio) where:
    /// - height: scaled TS line height for headings, normal for other lines
    /// - y_shift: pixels to move cursor/selection UP to align with heading text
    /// - cw_ratio: heading_char_width / normal_char_width (1.0 for non-headings)
    fn line_metrics_at_y(&self, y: f64) -> (f64, f64, f64) {
        let ts_lh = self.ts_line_height();
        let normal_cw = self.renderer.char_width;
        for line in &self.frame_lines {
            if (line.y_offset - y).abs() < 2.0 {
                for token in &line.tokens {
                    if token.st == "heading-lg" {
                        let ratio = self.renderer.heading_large_char_width / normal_cw;
                        return ((ts_lh * 1.4).ceil(), self.renderer.heading_large_y_shift, ratio);
                    }
                    if token.st == "heading-md" {
                        let ratio = self.renderer.heading_medium_char_width / normal_cw;
                        return ((ts_lh * 1.15).ceil(), self.renderer.heading_medium_y_shift, ratio);
                    }
                }
                return (ts_lh, 0.0, 1.0);
            }
        }
        (ts_lh, 0.0, 1.0)
    }

    /// Get the TypeScript line height. Prefers the value set by set_viewport,
    /// falls back to inferring from frame_lines spacing, then font metrics.
    fn ts_line_height(&self) -> f64 {
        if let Some(h) = self.ts_line_height_px {
            return h;
        }
        if self.frame_lines.len() >= 2 {
            (self.frame_lines[1].y_offset - self.frame_lines[0].y_offset).abs()
        } else {
            self.renderer.line_height
        }
    }
}

impl Drop for EditorView {
    fn drop(&mut self) {
        if self.nsview != nil {
            unsafe {
                let _: () = msg_send![self.nsview, removeFromSuperview];
            }
        }
    }
}
