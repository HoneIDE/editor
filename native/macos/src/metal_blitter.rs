//! Metal GPU-accelerated text atlas blitting for macOS.
//!
//! For high-performance scenarios (fast scrolling, large files):
//! - Pre-render lines into a Metal texture atlas
//! - On scroll, blit the visible portion of the atlas to the screen
//! - On edit, invalidate just the affected line's texture and re-render
//!
//! This module is optional — the editor works with CALayer compositing alone.
//! Metal blitting is an optimization for sustained 120fps scrolling.

/// Configuration for the Metal texture atlas.
pub struct AtlasConfig {
    /// Maximum number of lines cached in the atlas.
    pub max_cached_lines: usize,
    /// Texture width in pixels.
    pub texture_width: u32,
    /// Line height in pixels (for atlas row allocation).
    pub line_height: u32,
}

impl Default for AtlasConfig {
    fn default() -> Self {
        Self {
            max_cached_lines: 1000,
            texture_width: 4096,
            line_height: 21, // 14pt * 1.5 line height
        }
    }
}

/// Metal texture atlas for pre-rendered text lines.
///
/// Production implementation:
/// - MTLDevice for GPU resource creation
/// - MTLTexture atlas (4096 x line_height * max_lines)
/// - MTLRenderPipelineState for atlas blitting
/// - MTLCommandQueue for frame submission
pub struct MetalBlitter {
    config: AtlasConfig,
    // In production: Metal device, command queue, pipeline state, textures
    dirty_lines: Vec<usize>,
}

impl MetalBlitter {
    pub fn new(config: AtlasConfig) -> Self {
        Self {
            config,
            dirty_lines: Vec::new(),
        }
    }

    /// Mark a line as needing re-render in the atlas.
    pub fn invalidate_line(&mut self, line_number: usize) {
        if !self.dirty_lines.contains(&line_number) {
            self.dirty_lines.push(line_number);
        }
    }

    /// Mark all lines as dirty (e.g., on font change).
    pub fn invalidate_all(&mut self) {
        self.dirty_lines.clear();
        // Production: mark entire atlas as stale
    }

    /// Render dirty lines into the atlas texture.
    ///
    /// Production:
    /// 1. Create MTLRenderCommandEncoder
    /// 2. For each dirty line, render text into the atlas row
    /// 3. Commit the command buffer
    pub fn update_atlas(&mut self) {
        self.dirty_lines.clear();
    }

    /// Blit the visible portion of the atlas to the screen.
    ///
    /// Production:
    /// 1. Calculate visible atlas rows from scroll offset
    /// 2. Create blit command encoder
    /// 3. Copy visible region from atlas texture to drawable
    /// 4. Present
    pub fn blit_visible(&self, _scroll_offset_y: f64, _viewport_height: f64) {
        // Production: Metal blit operation
    }
}
