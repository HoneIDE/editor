//! X11/Wayland compositor for Linux.
//!
//! Handles surface management and damage tracking for efficient redraws.
//!
//! X11 backend:
//! - XRender for compositing
//! - Double-buffer via pixmap
//! - XDamage for partial redraws
//!
//! Wayland backend:
//! - wl_surface with damage tracking
//! - wl_subsurface for gutter and content separation
//! - Shared memory buffers via wl_shm

/// Display server backend.
pub enum Backend {
    X11,
    Wayland,
}

/// Linux compositor state.
pub struct Compositor {
    backend: Backend,
    scroll_offset_y: f64,
    needs_redraw: bool,
    // In production: X11 Display/Pixmap or Wayland wl_display/wl_surface
}

impl Compositor {
    pub fn new(backend: Backend) -> Self {
        Self {
            backend,
            scroll_offset_y: 0.0,
            needs_redraw: false,
        }
    }

    /// Set the scroll offset.
    pub fn set_scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_redraw = true;
    }

    /// Mark a region as damaged (needs redraw).
    pub fn damage(&mut self, _x: i32, _y: i32, _width: i32, _height: i32) {
        self.needs_redraw = true;
        // Production:
        // X11: XDamageAdd
        // Wayland: wl_surface_damage_buffer
    }

    /// Commit the frame.
    pub fn commit(&mut self) {
        if !self.needs_redraw {
            return;
        }

        match self.backend {
            Backend::X11 => {
                // Production:
                // 1. XCopyArea from back buffer to front buffer
                // 2. XFlush
            }
            Backend::Wayland => {
                // Production:
                // 1. wl_surface_commit
                // 2. Wait for frame callback
            }
        }

        self.needs_redraw = false;
    }
}
