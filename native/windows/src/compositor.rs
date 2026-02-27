//! DirectComposition compositor for smooth scrolling on Windows.
//!
//! Uses IDCompositionDevice and composition surfaces to achieve
//! hardware-accelerated, tear-free scrolling.
//!
//! Production implementation:
//! - IDCompositionDevice::CreateTargetForHwnd for the editor window
//! - IDCompositionVisual for the content layer
//! - On scroll: update visual offset (no re-render needed)
//! - On edit: update the composition surface for affected lines

/// DirectComposition compositor state.
pub struct Compositor {
    // In production: IDCompositionDevice, IDCompositionTarget, IDCompositionVisual
    scroll_offset_y: f64,
    needs_commit: bool,
}

impl Compositor {
    pub fn new() -> Self {
        Self {
            scroll_offset_y: 0.0,
            needs_commit: false,
        }
    }

    /// Set the scroll offset. Updates the visual transform.
    pub fn set_scroll(&mut self, offset_y: f64) {
        self.scroll_offset_y = offset_y;
        self.needs_commit = true;
        // Production: visual.SetOffsetY(-offset_y)
    }

    /// Commit pending composition changes.
    pub fn commit(&mut self) {
        if self.needs_commit {
            // Production: device.Commit()
            self.needs_commit = false;
        }
    }
}
