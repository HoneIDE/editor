//! Android EditorView: Canvas/Skia via JNI.
//!
//! Production implementation:
//! - JNI calls to android.graphics.Canvas and android.graphics.Paint
//! - Per-token color via Paint.setColor()
//! - Canvas.drawText() for each token span
//! - TS-authoritative cache-line protocol: TS caches lines, Rust renders
//!
//! In Perry AOT mode, TypeScript's RAF loop never fires after startup.
//! Input events are queued in pending_events and polled by TypeScript's
//! setInterval loop via the event polling FFI.

use std::collections::HashMap;
use std::ffi::{c_char, CString};
use serde::Deserialize;

// ── Callback types ──────────────────────────────────────────────

pub type TextInputCallback = extern "C" fn(view: *mut EditorView, text: *const c_char);
pub type ActionCallback = extern "C" fn(view: *mut EditorView, action: *const c_char);
pub type MouseDownCallback = extern "C" fn(view: *mut EditorView, x: f64, y: f64);
pub type ScrollCallback = extern "C" fn(view: *mut EditorView, dx: f64, dy: f64);

// ── Event queue (for TypeScript polling) ────────────────────────

pub mod event_type {
    pub const TEXT: i32 = 1;
    pub const ACTION: i32 = 2;
    pub const SCROLL: i32 = 3;
    pub const MOUSE_DOWN: i32 = 4;
    pub const MOUSE_DRAG: i32 = 5;
}

pub mod action_id {
    pub const MOVE_LEFT: i32 = 1;
    pub const MOVE_RIGHT: i32 = 2;
    pub const MOVE_UP: i32 = 3;
    pub const MOVE_DOWN: i32 = 4;
    pub const MOVE_BOL: i32 = 5;
    pub const MOVE_EOL: i32 = 6;
    pub const MOVE_BOD: i32 = 7;
    pub const MOVE_EOD: i32 = 8;
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

pub struct PendingEvent {
    pub event_type: i32,
    pub char_code: u32,
    pub action_id: i32,
    pub x: f64,
    pub y: f64,
}

/// Map an action string to an action ID.
/// Accepts both iOS-style ObjC selectors and Android-style action names.
fn action_string_to_id(action: &str) -> i32 {
    match action {
        "moveLeft:" | "moveLeft"                             => action_id::MOVE_LEFT,
        "moveRight:" | "moveRight"                           => action_id::MOVE_RIGHT,
        "moveUp:" | "moveUp"                                 => action_id::MOVE_UP,
        "moveDown:" | "moveDown"                             => action_id::MOVE_DOWN,
        "moveToBeginningOfLine:" | "moveToLeftEndOfLine:"
        | "moveToBeginningOfLine" | "home"                   => action_id::MOVE_BOL,
        "moveToEndOfLine:" | "moveToRightEndOfLine:"
        | "moveToEndOfLine" | "end"                          => action_id::MOVE_EOL,
        "moveToBeginningOfDocument:" | "moveToBeginningOfDocument" => action_id::MOVE_BOD,
        "moveToEndOfDocument:" | "moveToEndOfDocument"       => action_id::MOVE_EOD,
        "insertNewline:" | "insertNewline" | "enter"         => action_id::INSERT_NEWLINE,
        "deleteBackward:" | "deleteBackward" | "backspace"   => action_id::DELETE_BACKWARD,
        "deleteForward:" | "deleteForward" | "delete"        => action_id::DELETE_FORWARD,
        "insertTab:" | "insertTab" | "tab"                   => action_id::INSERT_TAB,
        "moveWordLeft:" | "moveWordBackward:"
        | "moveWordLeft" | "moveWordBackward"                => action_id::MOVE_WORD_LEFT,
        "moveWordRight:" | "moveWordForward:"
        | "moveWordRight" | "moveWordForward"                => action_id::MOVE_WORD_RIGHT,
        "moveLeftAndModifySelection:" | "moveLeftAndModifySelection" => action_id::MOVE_LEFT_SEL,
        "moveRightAndModifySelection:" | "moveRightAndModifySelection" => action_id::MOVE_RIGHT_SEL,
        "moveUpAndModifySelection:" | "moveUpAndModifySelection" => action_id::MOVE_UP_SEL,
        "moveDownAndModifySelection:" | "moveDownAndModifySelection" => action_id::MOVE_DOWN_SEL,
        "moveToBeginningOfLineAndModifySelection:" | "moveToBeginningOfLineAndModifySelection" => action_id::MOVE_BOL_SEL,
        "moveToEndOfLineAndModifySelection:" | "moveToEndOfLineAndModifySelection" => action_id::MOVE_EOL_SEL,
        "selectAll:" | "selectAll"                           => action_id::SELECT_ALL,
        "cut:" | "cut"                                       => action_id::CUT,
        "copy:" | "copy"                                     => action_id::COPY,
        "paste:" | "paste"                                   => action_id::PASTE,
        "undo:" | "undo"                                     => action_id::UNDO,
        "redo:" | "redo"                                     => action_id::REDO,
        "deleteWordBackward:" | "deleteWordBackward"         => action_id::DELETE_WORD_BACKWARD,
        "pageUp:" | "scrollPageUp:" | "pageUp"               => action_id::PAGE_UP,
        "pageDown:" | "scrollPageDown:" | "pageDown"         => action_id::PAGE_DOWN,
        _                                                    => 0,
    }
}

// ── Data structures ──────────────────────────────────────────────

pub struct ContextMenuItem {
    pub title: String,
    pub action_id: String,
}

/// A parsed token span for rendering.
#[derive(Debug, Clone)]
pub struct ParsedToken {
    pub start: usize,
    pub end: usize,
    pub color: u32, // ARGB
    pub style: u8,  // 0=normal, 1=italic, 2=bold, 3=heading-lg, 4=heading-md
}

/// A cached line with text and parsed tokens.
#[derive(Debug, Clone)]
pub struct CachedLine {
    pub text: String,
    pub tokens: Vec<ParsedToken>,
    pub line_bg: Option<u32>, // Optional line background color (ARGB)
}

#[derive(Debug, Deserialize)]
pub struct RenderToken {
    pub s: usize,
    pub e: usize,
    pub c: String,
    pub st: String,
}

#[derive(Debug, Deserialize)]
pub struct SelectionRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Deserialize, Clone)]
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

/// A line ready for rendering (built from cache + viewport).
pub struct FrameLine {
    pub line_number: i32,
    pub text: String,
    pub tokens: Vec<ParsedToken>,
    pub line_bg: Option<u32>,
    pub y_offset: f64, // in dp
}

struct GhostTextData {
    text: String,
    x: f64,
    y: f64,
    color: String,
}

// ── Legacy LineRenderData for render_line() ──────────────────────

pub struct LineRenderData {
    pub line_number: i32,
    pub text: String,
    pub tokens_json: String,
    pub y_offset: f64,
}

// ── EditorView ───────────────────────────────────────────────────

pub struct EditorView {
    font_family: String,
    font_size: f64,
    pub width: f64,
    pub height: f64,
    scroll_offset_y: f64,
    needs_display: bool,
    /// Pointer to the parent JNI jobject (Android View).
    pub parent_view: *mut std::ffi::c_void,
    /// Android GlobalRef to HoneEditorView for JNI callbacks.
    pub android_view_ref: Option<jni::objects::GlobalRef>,

    // TS-mode line cache (persistent across frames)
    line_cache: HashMap<i32, CachedLine>,
    // Frame buffer (rebuilt each frame from cache + viewport)
    frame_lines: Vec<FrameLine>,
    // Viewport state
    viewport_start: i32,
    viewport_end: i32,
    scroll_top: f64,
    total_lines: i32,
    line_height: f64,

    cursor: Option<CursorData>,
    cursors: Vec<CursorData>,
    selections: Vec<SelectionRegion>,
    decorations: Vec<DecorationOverlay>,
    ghost_text: Option<GhostTextData>,
    max_line_number: i32,

    // Input callbacks (used by standalone demo / non-Perry mode)
    text_input_callback: Option<TextInputCallback>,
    action_callback: Option<ActionCallback>,
    mouse_down_callback: Option<MouseDownCallback>,
    scroll_callback: Option<ScrollCallback>,

    // Event queue (for TypeScript polling in Perry mode)
    pub pending_events: Vec<PendingEvent>,
    pub event_callback: Option<extern "C" fn()>,

    // When true, event handlers only queue events — TypeScript handles all state changes.
    pub ts_handles_events: bool,
    // Gutter width set by TypeScript (overrides computed gutter_width when Some).
    pub ts_gutter_width: Option<f64>,

    // Read-only mode
    pub read_only: bool,

    // Per-line background colors for diff highlighting (1-based line number → RGBA)
    pub line_backgrounds: HashMap<i32, (f64, f64, f64, f64)>,

    // Accumulated scroll delta (in pixels) that TypeScript can read.
    pub rust_scroll_delta: f64,
    // Set true when scroll reveals lines not present in the cache.
    pub needs_lines: bool,

    // Context menu
    context_menu_items: Vec<ContextMenuItem>,

    // Theme colors (ARGB u32 for direct use in Paint.setColor)
    pub background_color: u32,
    pub gutter_bg_color: u32,
    pub gutter_fg_color: u32,
    pub default_text_color: u32,
    pub selection_color: u32,
    pub cursor_color: u32,
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            font_family: "monospace".to_string(),
            font_size: 14.0,
            width,
            height,
            scroll_offset_y: 0.0,
            needs_display: true,
            parent_view: std::ptr::null_mut(),
            android_view_ref: None,
            line_cache: HashMap::new(),
            frame_lines: Vec::with_capacity(64),
            viewport_start: 0,
            viewport_end: 0,
            scroll_top: 0.0,
            total_lines: 0,
            line_height: 21.0,
            cursor: None,
            cursors: Vec::new(),
            selections: Vec::new(),
            decorations: Vec::new(),
            ghost_text: None,
            max_line_number: 0,
            text_input_callback: None,
            action_callback: None,
            mouse_down_callback: None,
            scroll_callback: None,
            pending_events: Vec::new(),
            event_callback: None,
            ts_handles_events: false,
            ts_gutter_width: None,
            read_only: false,
            line_backgrounds: HashMap::new(),
            rust_scroll_delta: 0.0,
            needs_lines: false,
            context_menu_items: Vec::new(),
            // VS Code dark theme defaults
            background_color: 0xFF1E1E1E,
            gutter_bg_color: 0xFF252526,
            gutter_fg_color: 0xFF858585,
            default_text_color: 0xFFD4D4D4,
            selection_color: 0x40264F78,
            cursor_color: 0xFFFFFFFF,
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.font_family = family.to_string();
        self.font_size = size;
        self.line_height = size * 1.5;
        self.needs_display = true;
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        text.len() as f64 * self.font_size * 0.6
    }

    // ── TS-mode cache protocol ──────────────────────────────────

    /// Cache a line with packed tokens.
    /// Format: "start,end,hexColor,styleInt|..." optionally prefixed with "BG:hexColor|"
    /// Skips the update if the line already has the same text (avoids allocations on
    /// redundant re-renders, which cause OOM on memory-constrained devices like Android).
    pub fn cache_line_packed(&mut self, line_number: i32, text: &str, packed: &str) {
        // Skip if line already cached with identical text
        if let Some(existing) = self.line_cache.get(&line_number) {
            if existing.text == text {
                return;
            }
        }

        let mut line_bg = None;
        let mut token_str = packed;

        // Check for BG: prefix
        if packed.starts_with("BG:") {
            if let Some(pipe_pos) = packed[3..].find('|') {
                let bg_hex = &packed[3..3 + pipe_pos];
                line_bg = Some(parse_hex_to_argb(bg_hex));
                token_str = &packed[3 + pipe_pos + 1..];
            }
        }

        let tokens = parse_packed_tokens(token_str);
        self.line_cache.insert(line_number, CachedLine {
            text: text.to_string(),
            tokens,
            line_bg,
        });
    }

    /// Build frame_lines from cache for the visible viewport range.
    /// Args from TS: startLine (1-based), endLine (1-based), scrollTop (dp), totalLines, lineHeight (dp)
    pub fn set_viewport_range(
        &mut self,
        start_line: i32,
        end_line: i32,
        scroll_top: f64,
        total_lines: i32,
        line_height: f64,
    ) {
        self.viewport_start = start_line;
        self.viewport_end = end_line;
        self.scroll_top = scroll_top;
        self.total_lines = total_lines;
        if line_height > 0.0 {
            self.line_height = line_height;
        }

        // Rebuild frame_lines from cache
        self.frame_lines.clear();
        for line_num in start_line..=end_line {
            if let Some(cached) = self.line_cache.get(&line_num) {
                let y_offset = ((line_num - 1) as f64) * self.line_height - scroll_top;
                self.frame_lines.push(FrameLine {
                    line_number: line_num,
                    text: cached.text.clone(),
                    tokens: cached.tokens.clone(),
                    line_bg: cached.line_bg,
                    y_offset,
                });
                if line_num > self.max_line_number {
                    self.max_line_number = line_num;
                }
            }
        }
    }

    pub fn invalidate_cache_line(&mut self, line_number: i32) {
        self.line_cache.remove(&line_number);
    }

    pub fn clear_line_cache(&mut self) {
        self.line_cache.clear();
    }

    // ── Frame buffer API ─────────────────────────────────────────

    pub fn begin_frame(&mut self) {
        // Don't clear line_cache — it persists across frames
        self.frame_lines.clear();
        self.cursor = None;
        self.cursors.clear();
        self.selections.clear();
        self.decorations.clear();
        self.ghost_text = None;
        self.max_line_number = 0;
        self.needs_display = false;
    }

    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        if line_number > self.max_line_number {
            self.max_line_number = line_number;
        }
        // Parse JSON tokens into ParsedTokens
        let mut parsed: Vec<RenderToken> = serde_json::from_str(tokens_json).unwrap_or_default();
        // Auto-tokenize if TypeScript sent empty tokens (initial _directRenderText)
        if parsed.is_empty() && !text.is_empty() {
            let auto_tokens = crate::tokenizer::tokenize_line(text);
            for i in 0..auto_tokens.len() {
                let t = &auto_tokens[i];
                let rt = RenderToken { s: t.start, e: t.end, c: t.color.clone(), st: t.style.clone() };
                parsed.push(rt);
            }
        }
        let tokens: Vec<ParsedToken> = parsed.iter().map(|t| ParsedToken {
            start: t.s,
            end: t.e,
            color: parse_hex_to_argb(&t.c.trim_start_matches('#')),
            style: match t.st.as_str() {
                "italic" => 1,
                "bold" => 2,
                _ => 0,
            },
        }).collect();
        self.frame_lines.push(FrameLine {
            line_number,
            text: text.to_string(),
            tokens,
            line_bg: None,
            y_offset,
        });
    }

    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        self.cursor = Some(CursorData { x, y, style });
        self.needs_display = true;
    }

    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.cursors = serde_json::from_str(cursors_json).unwrap_or_default();
    }

    pub fn set_selection(&mut self, regions_json: &str) {
        self.selections = serde_json::from_str(regions_json).unwrap_or_default();
        self.needs_display = true;
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_display = true;
    }

    pub fn render_decorations(&mut self, decorations_json: &str) {
        let mut decors: Vec<DecorationOverlay> =
            serde_json::from_str(decorations_json).unwrap_or_default();
        self.decorations.append(&mut decors);
    }

    pub fn render_ghost_text(&mut self, text: &str, x: f64, y: f64, color: &str) {
        self.ghost_text = Some(GhostTextData {
            text: text.to_string(),
            x,
            y,
            color: color.to_string(),
        });
    }

    pub fn end_frame(&mut self) {
        self.needs_display = true;
    }

    pub fn invalidate(&mut self) {
        self.needs_display = true;
    }

    /// Clear selections and pre-allocate for new rects.
    pub fn begin_selections_new(&mut self, count: usize) {
        self.selections.clear();
        self.selections.reserve(count);
    }

    /// Add a selection highlight rectangle.
    pub fn add_selection_rect_new(&mut self, x: f64, y: f64, w: f64, h: f64) {
        self.selections.push(SelectionRegion { x, y, w, h });
    }

    // ── Callbacks ────────────────────────────────────────────────

    pub fn set_text_input_callback(&mut self, cb: TextInputCallback) {
        self.text_input_callback = Some(cb);
    }

    pub fn set_action_callback(&mut self, cb: ActionCallback) {
        self.action_callback = Some(cb);
    }

    pub fn set_mouse_down_callback(&mut self, cb: MouseDownCallback) {
        self.mouse_down_callback = Some(cb);
    }

    pub fn set_scroll_callback(&mut self, cb: ScrollCallback) {
        self.scroll_callback = Some(cb);
    }

    // ── Event handlers ──────────────────────────────────────────

    pub fn on_text_input(&mut self, text: &str) {
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
        // In ts_mode, TypeScript handles the edit and re-renders via FFI.
    }

    pub fn on_action(&mut self, action: &str) {
        if let Some(cb) = self.action_callback {
            if let Ok(c_action) = CString::new(action) {
                let self_ptr = self as *mut EditorView;
                cb(self_ptr, c_action.as_ptr());
            }
            return;
        }
        // Queue the action event for TypeScript's polling loop.
        let aid = action_string_to_id(action);
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

    pub fn on_mouse_down(&mut self, x: f64, y: f64) {
        if let Some(cb) = self.mouse_down_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, x, y);
            return;
        }
        // Queue for TypeScript's polling loop.
        self.pending_events.push(PendingEvent {
            event_type: event_type::MOUSE_DOWN,
            char_code: 0,
            action_id: 0,
            x,
            y,
        });
    }

    pub fn on_mouse_drag(&mut self, x: f64, y: f64) {
        self.pending_events.push(PendingEvent {
            event_type: event_type::MOUSE_DRAG,
            char_code: 0,
            action_id: 0,
            x,
            y,
        });
    }

    pub fn on_scroll(&mut self, dx: f64, dy: f64) {
        if let Some(cb) = self.scroll_callback {
            let self_ptr = self as *mut EditorView;
            cb(self_ptr, dx, dy);
            return;
        }
        // Queue for TypeScript's polling loop.
        self.pending_events.push(PendingEvent {
            event_type: event_type::SCROLL,
            char_code: 0,
            action_id: 0,
            x: dx,
            y: dy,
        });
        // Accumulate scroll delta for TypeScript viewport sync.
        self.rust_scroll_delta += dy;
    }

    // ── Context menu ─────────────────────────────────────────────

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

    // ── Accessors (for JNI drawing) ─────────────────────────────

    pub fn get_frame_lines(&self) -> &[FrameLine] {
        &self.frame_lines
    }

    pub fn get_cursor(&self) -> Option<&CursorData> {
        self.cursor.as_ref()
    }

    pub fn get_cursors(&self) -> &[CursorData] {
        &self.cursors
    }

    pub fn get_selections(&self) -> &[SelectionRegion] {
        &self.selections
    }

    pub fn get_scroll_y(&self) -> f64 {
        self.scroll_offset_y
    }

    pub fn get_font_size(&self) -> f64 {
        self.font_size
    }

    pub fn get_line_height(&self) -> f64 {
        self.line_height
    }

    pub fn get_width(&self) -> f64 {
        self.width
    }

    pub fn get_height(&self) -> f64 {
        self.height
    }

    pub fn get_max_line_number(&self) -> i32 {
        self.max_line_number
    }

    // ── Color setters ───────────────────────────────────────────

    /// Convert 0.0–1.0 RGB to ARGB u32 (full opacity).
    fn rgb_to_argb(r: f64, g: f64, b: f64) -> u32 {
        let ri = (r * 255.0) as u32;
        let gi = (g * 255.0) as u32;
        let bi = (b * 255.0) as u32;
        0xFF000000 | (ri << 16) | (gi << 8) | bi
    }

    /// Convert 0.0–1.0 RGBA to ARGB u32.
    fn rgba_to_argb(r: f64, g: f64, b: f64, a: f64) -> u32 {
        let ai = (a * 255.0) as u32;
        let ri = (r * 255.0) as u32;
        let gi = (g * 255.0) as u32;
        let bi = (b * 255.0) as u32;
        (ai << 24) | (ri << 16) | (gi << 8) | bi
    }

    pub fn set_bg_color(&mut self, r: f64, g: f64, b: f64) {
        self.background_color = Self::rgb_to_argb(r, g, b);
        self.gutter_bg_color = self.background_color;
        self.invalidate();
    }

    pub fn set_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.default_text_color = Self::rgb_to_argb(r, g, b);
        self.invalidate();
    }

    pub fn set_gutter_fg_color(&mut self, r: f64, g: f64, b: f64) {
        self.gutter_fg_color = Self::rgb_to_argb(r, g, b);
        self.invalidate();
    }

    pub fn set_selection_color(&mut self, r: f64, g: f64, b: f64, a: f64) {
        self.selection_color = Self::rgba_to_argb(r, g, b, a);
        self.invalidate();
    }

    pub fn set_cursor_color(&mut self, r: f64, g: f64, b: f64) {
        self.cursor_color = Self::rgb_to_argb(r, g, b);
        self.invalidate();
    }
}

// ── Token parsing ────────────────────────────────────────────────

/// Parse packed token format: "start,end,hexColor,styleInt|..."
fn parse_packed_tokens(packed: &str) -> Vec<ParsedToken> {
    let mut tokens = Vec::new();
    for segment in packed.split('|') {
        if segment.is_empty() { continue; }
        let mut parts = segment.splitn(4, ',');
        let s = match parts.next().and_then(|s| s.parse::<usize>().ok()) {
            Some(v) => v,
            None => continue,
        };
        let e = match parts.next().and_then(|s| s.parse::<usize>().ok()) {
            Some(v) => v,
            None => continue,
        };
        let hex = parts.next().unwrap_or("D4D4D4");
        let style = parts.next().and_then(|s| s.parse::<u8>().ok()).unwrap_or(0);
        tokens.push(ParsedToken {
            start: s,
            end: e,
            color: parse_hex_to_argb(hex),
            style,
        });
    }
    tokens
}

/// Parse hex color (no '#') to ARGB u32. E.g., "569CD6" → 0xFF569CD6
fn parse_hex_to_argb(hex: &str) -> u32 {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(212);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(212);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(212);
        0xFF000000 | (r as u32) << 16 | (g as u32) << 8 | (b as u32)
    } else {
        0xFFD4D4D4
    }
}
