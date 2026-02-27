//! CALayer-based compositing for macOS.
//!
//! Each visible line gets its own CALayer for efficient compositing.
//! On scroll, layers are repositioned without re-rendering.
//! Off-screen layers are recycled via a layer pool.

use serde::Deserialize;

/// Selection region from the TypeScript layer.
#[derive(Debug, Deserialize)]
pub struct SelectionRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Cursor data for multi-cursor rendering.
#[derive(Debug, Deserialize)]
pub struct CursorData {
    pub x: f64,
    pub y: f64,
    pub style: i32,
}

/// Manages CALayers for editor rendering.
pub struct LayerManager {
    width: f64,
    height: f64,
    scroll_offset_y: f64,
    needs_display: bool,

    // Cursor state
    cursor_x: f64,
    cursor_y: f64,
    cursor_style: i32,
    cursors: Vec<CursorData>,

    // Selection state
    selections: Vec<SelectionRegion>,
}

impl LayerManager {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            scroll_offset_y: 0.0,
            needs_display: true,
            cursor_x: 0.0,
            cursor_y: 0.0,
            cursor_style: 0,
            cursors: Vec::new(),
            selections: Vec::new(),
        }
    }

    /// Set the primary cursor position and style.
    ///
    /// Production: updates the cursor CALayer position and
    /// triggers a cursor blink animation restart.
    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        self.cursor_x = x;
        self.cursor_y = y;
        self.cursor_style = style;
        self.needs_display = true;
    }

    /// Set multiple cursor positions.
    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.cursors = serde_json::from_str(cursors_json).unwrap_or_default();
        self.needs_display = true;
    }

    /// Set selection highlight regions.
    ///
    /// Production: creates/updates semi-transparent CALayers
    /// with the selection color for each region.
    pub fn set_selection(&mut self, regions_json: &str) {
        self.selections = serde_json::from_str(regions_json).unwrap_or_default();
        self.needs_display = true;
    }

    /// Set the scroll offset.
    ///
    /// Production: adjusts the content layer's position property.
    /// CALayers for visible lines are repositioned; off-screen
    /// layers are returned to the pool.
    pub fn scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_display = true;
    }

    /// Mark the view as needing a full redraw.
    pub fn invalidate(&mut self) {
        self.needs_display = true;
    }

    /// Begin a frame batch.
    ///
    /// Production: calls CATransaction.begin() to batch
    /// all layer updates into a single compositing pass.
    pub fn begin_frame(&mut self) {
        // CATransaction::begin()
        self.needs_display = false;
    }

    /// End a frame batch.
    ///
    /// Production: calls CATransaction.commit() to flush
    /// all pending layer updates.
    pub fn end_frame(&mut self) {
        // CATransaction::commit()
    }
}
