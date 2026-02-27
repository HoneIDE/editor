# hone-editor-macos

macOS native rendering crate for the Hone editor. Uses Core Text for text rendering and a custom `HoneEditorView` (NSView subclass) for compositing.

## Architecture

```
src/
  lib.rs            FFI contract — extern "C" functions callable from Perry/Swift/etc.
  editor_view.rs    EditorView struct — owns NSView, font set, frame buffer, callbacks
  text_renderer.rs  Core Text rendering — FontSet, draw_line (syntax tokens), draw_text
  view.rs           NSView subclass — input handling (keyboard, mouse, scroll, context menu)
  metal_blitter.rs  Metal-backed buffer blitting (future optimization)
examples/
  demo_editor.rs    Interactive demo — fully editable code editor in an NSWindow
  demo_window.rs    Static rendering demo — displays hardcoded text
```

## Building

```bash
cargo build
```

## Running the Interactive Demo

```bash
cargo run --example demo_editor
```

This opens a 900x650 window with an editable TypeScript file. Supports:

- Typing, backspace, delete, enter, tab
- Arrow key navigation (+ Shift for selection)
- Home/End line navigation
- Cmd+C/V/X (copy/paste/cut via NSPasteboard)
- Cmd+A (select all)
- Cmd+Q (quit)
- Mouse click to position cursor
- Scroll wheel / trackpad scrolling
- Right-click context menu (Cut, Copy, Paste, Select All + custom items)
- Syntax-colored text via per-token rendering

## FFI Contract

The crate exposes `extern "C"` functions for use from the TypeScript layer (via Perry) or any C-compatible caller:

| Function | Purpose |
|---|---|
| `hone_editor_create` | Create editor view with dimensions |
| `hone_editor_destroy` | Free editor view |
| `hone_editor_attach_to_view` | Attach to parent NSView |
| `hone_editor_set_font` | Set font family and size |
| `hone_editor_begin_frame` / `end_frame` | Frame batching |
| `hone_editor_render_line` | Render a line with syntax tokens |
| `hone_editor_set_cursor` / `set_cursors` | Cursor position and style |
| `hone_editor_set_selection` | Selection highlight regions |
| `hone_editor_scroll` | Vertical scroll offset |
| `hone_editor_measure_text` | Measure text width in current font |
| `hone_editor_invalidate` | Trigger redraw |
| `hone_editor_render_decorations` | Underlines, backgrounds |
| `hone_editor_render_ghost_text` | Inline completion ghost text |
| `hone_editor_set_text_input_callback` | Callback for typed characters |
| `hone_editor_set_action_callback` | Callback for key actions (arrows, delete, etc.) |
| `hone_editor_set_mouse_down_callback` | Callback for mouse clicks |
| `hone_editor_set_scroll_callback` | Callback for scroll events |
| `hone_editor_add_context_menu_item` | Add custom right-click menu item |
| `hone_editor_clear_context_menu_items` | Remove custom menu items |
| `hone_editor_nsview` | Get raw NSView pointer |

## Input Handling

The `HoneEditorView` NSView subclass handles:

- **Keyboard**: `keyDown:` routes through `interpretKeyEvents:` for standard macOS key interpretation. Cmd+key shortcuts are intercepted directly (no menu bar required).
- **Text input**: `insertText:` receives printable characters, dispatched via callback.
- **Actions**: `doCommandBySelector:` receives selectors like `moveLeft:`, `deleteBackward:`, `insertNewline:`, dispatched via callback.
- **Mouse**: `mouseDown:` converts window coordinates to view coordinates, dispatched via callback.
- **Scroll**: `scrollWheel:` handles both trackpad (precise) and mouse wheel deltas.
- **Context menu**: `menuForEvent:` builds an NSMenu with default + custom items.
- **Cursor**: `resetCursorRects` sets the I-beam cursor for the view.

## Text Rendering

Uses Core Text with a flipped coordinate system (top-left origin). The text matrix uses `d: -1.0` to counteract the NSView's flipped CTM, producing correctly-oriented glyphs. Supports normal, bold, and italic font variants with per-token syntax coloring.
