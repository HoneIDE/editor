//! DOM rendering utilities for the web platform.
//!
//! Provides helpers for creating and managing DOM elements
//! for the editor's line, token, cursor, and selection rendering.

use serde::Deserialize;

/// Configuration for the DOM renderer.
pub struct DomRendererConfig {
    /// CSS class prefix for all editor elements.
    pub class_prefix: String,
    /// Whether to use CSS containment for performance.
    pub use_containment: bool,
    /// Whether to use content-visibility for off-screen lines.
    pub use_content_visibility: bool,
}

impl Default for DomRendererConfig {
    fn default() -> Self {
        Self {
            class_prefix: "hone-editor".to_string(),
            use_containment: true,
            use_content_visibility: true,
        }
    }
}

/// Generates CSS for the editor container.
///
/// Production: injected as a <style> element on initialization.
pub fn generate_editor_css(config: &DomRendererConfig) -> String {
    let prefix = &config.class_prefix;
    let containment = if config.use_containment {
        "contain: strict;"
    } else {
        ""
    };

    format!(
        r#"
.{prefix} {{
    position: relative;
    overflow: hidden;
    {containment}
    font-variant-ligatures: contextual;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}}
.{prefix}-line {{
    position: absolute;
    left: 0;
    right: 0;
    white-space: pre;
    pointer-events: none;
}}
.{prefix}-cursor {{
    position: absolute;
    pointer-events: none;
    animation: {prefix}-blink 1s step-end infinite;
}}
@keyframes {prefix}-blink {{
    0%, 100% {{ opacity: 1; }}
    50% {{ opacity: 0; }}
}}
.{prefix}-selection {{
    position: absolute;
    pointer-events: none;
    opacity: 0.3;
}}
"#
    )
}
