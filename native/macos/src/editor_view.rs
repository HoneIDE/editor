//! EditorView: top-level state for a macOS editor instance.
//!
//! Owns the text renderer and layer manager, and delegates
//! FFI calls to the appropriate subsystem.

use crate::text_renderer::TextRenderer;
use crate::layer_manager::LayerManager;

/// Top-level editor view state.
///
/// This is the object behind the opaque *mut EditorView pointer
/// returned by hone_editor_create().
pub struct EditorView {
    text_renderer: TextRenderer,
    layer_manager: LayerManager,
}

impl EditorView {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            text_renderer: TextRenderer::new(),
            layer_manager: LayerManager::new(width, height),
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.text_renderer.set_font(family, size);
        self.layer_manager.invalidate();
    }

    pub fn render_line(&mut self, line_number: i32, text: &str, tokens_json: &str, y_offset: f64) {
        self.text_renderer.render_line(line_number, text, tokens_json, y_offset);
    }

    pub fn set_cursor(&mut self, x: f64, y: f64, style: i32) {
        self.layer_manager.set_cursor(x, y, style);
    }

    pub fn set_selection(&mut self, regions_json: &str) {
        self.layer_manager.set_selection(regions_json);
    }

    pub fn scroll(&mut self, offset_y: f64) {
        self.layer_manager.scroll(offset_y);
    }

    pub fn measure_text(&self, text: &str) -> f64 {
        self.text_renderer.font.measure_text(text)
    }

    pub fn invalidate(&mut self) {
        self.layer_manager.invalidate();
    }

    pub fn render_decorations(&mut self, decorations_json: &str) {
        self.text_renderer.render_decorations(decorations_json);
    }

    pub fn render_ghost_text(&mut self, text: &str, x: f64, y: f64, color: &str) {
        self.text_renderer.render_ghost_text(text, x, y, color);
    }

    pub fn set_cursors(&mut self, cursors_json: &str) {
        self.layer_manager.set_cursors(cursors_json);
    }

    pub fn begin_frame(&mut self) {
        self.layer_manager.begin_frame();
    }

    pub fn end_frame(&mut self) {
        self.layer_manager.end_frame();
    }
}
