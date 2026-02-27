//! Standalone demo: opens an NSWindow with syntax-highlighted TypeScript code.
//!
//! Run with: `cargo run --example demo_window` from `native/macos/`
//!
//! This proves the rendering pipeline works end-to-end without Perry.
//! It uses the FFI entry points directly (same functions Perry would call).

extern crate cocoa;
#[macro_use]
extern crate objc;

use std::ffi::CString;

use cocoa::appkit::{
    NSApp, NSApplication, NSApplicationActivationPolicyRegular, NSBackingStoreBuffered, NSWindow,
    NSWindowStyleMask,
};
use cocoa::base::{id, nil};
use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};

// Re-export the FFI functions by referencing them — this forces the linker to
// include them from the staticlib/rlib.
use hone_editor_macos::{
    hone_editor_create, hone_editor_set_font, hone_editor_begin_frame,
    hone_editor_render_line, hone_editor_set_cursor, hone_editor_set_selection,
    hone_editor_end_frame, hone_editor_attach_to_view, hone_editor_measure_text,
    hone_editor_destroy,
};

/// Sample TypeScript lines with token data (VS Code dark theme colors).
fn sample_lines() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "import { TextBuffer } from './buffer';",
            r##"[{"s":0,"e":6,"c":"#c586c0","st":"normal"},{"s":7,"e":8,"c":"#d4d4d4","st":"normal"},{"s":9,"e":19,"c":"#9cdcfe","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"},{"s":22,"e":26,"c":"#c586c0","st":"normal"},{"s":27,"e":37,"c":"#ce9178","st":"normal"},{"s":37,"e":38,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        ("", "[]"),
        (
            "export class Editor {",
            r##"[{"s":0,"e":6,"c":"#569cd6","st":"normal"},{"s":7,"e":12,"c":"#569cd6","st":"normal"},{"s":13,"e":19,"c":"#4ec9b0","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "  private buffer: TextBuffer;",
            r##"[{"s":2,"e":9,"c":"#569cd6","st":"normal"},{"s":10,"e":16,"c":"#9cdcfe","st":"normal"},{"s":16,"e":17,"c":"#d4d4d4","st":"normal"},{"s":18,"e":28,"c":"#4ec9b0","st":"normal"},{"s":28,"e":29,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "  private cursorLine: number = 0;",
            r##"[{"s":2,"e":9,"c":"#569cd6","st":"normal"},{"s":10,"e":20,"c":"#9cdcfe","st":"normal"},{"s":20,"e":21,"c":"#d4d4d4","st":"normal"},{"s":22,"e":28,"c":"#4ec9b0","st":"normal"},{"s":29,"e":30,"c":"#d4d4d4","st":"normal"},{"s":31,"e":32,"c":"#b5cea8","st":"normal"}]"##,
        ),
        ("", "[]"),
        (
            "  constructor(content: string) {",
            r##"[{"s":2,"e":13,"c":"#569cd6","st":"normal"},{"s":13,"e":14,"c":"#d4d4d4","st":"normal"},{"s":14,"e":21,"c":"#9cdcfe","st":"normal"},{"s":21,"e":22,"c":"#d4d4d4","st":"normal"},{"s":23,"e":29,"c":"#4ec9b0","st":"normal"},{"s":29,"e":30,"c":"#d4d4d4","st":"normal"},{"s":31,"e":32,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "    this.buffer = new TextBuffer(content);",
            r##"[{"s":4,"e":8,"c":"#569cd6","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":15,"c":"#9cdcfe","st":"normal"},{"s":16,"e":17,"c":"#d4d4d4","st":"normal"},{"s":18,"e":21,"c":"#569cd6","st":"normal"},{"s":22,"e":32,"c":"#4ec9b0","st":"normal"},{"s":32,"e":33,"c":"#d4d4d4","st":"normal"},{"s":33,"e":40,"c":"#9cdcfe","st":"normal"},{"s":40,"e":41,"c":"#d4d4d4","st":"normal"},{"s":41,"e":42,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "  }",
            r##"[{"s":2,"e":3,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        ("", "[]"),
        (
            "  // Insert text at the cursor position",
            r##"[{"s":2,"e":40,"c":"#6a9955","st":"italic"}]"##,
        ),
        (
            "  insert(text: string): void {",
            r##"[{"s":2,"e":8,"c":"#dcdcaa","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":13,"c":"#9cdcfe","st":"normal"},{"s":13,"e":14,"c":"#d4d4d4","st":"normal"},{"s":15,"e":21,"c":"#4ec9b0","st":"normal"},{"s":21,"e":22,"c":"#d4d4d4","st":"normal"},{"s":23,"e":27,"c":"#569cd6","st":"normal"},{"s":28,"e":29,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "    this.buffer.insert(this.cursorLine, text);",
            r##"[{"s":4,"e":8,"c":"#569cd6","st":"normal"},{"s":8,"e":9,"c":"#d4d4d4","st":"normal"},{"s":9,"e":15,"c":"#9cdcfe","st":"normal"},{"s":15,"e":16,"c":"#d4d4d4","st":"normal"},{"s":16,"e":22,"c":"#dcdcaa","st":"normal"},{"s":22,"e":23,"c":"#d4d4d4","st":"normal"},{"s":23,"e":27,"c":"#569cd6","st":"normal"},{"s":27,"e":28,"c":"#d4d4d4","st":"normal"},{"s":28,"e":38,"c":"#9cdcfe","st":"normal"},{"s":38,"e":39,"c":"#d4d4d4","st":"normal"},{"s":40,"e":44,"c":"#9cdcfe","st":"normal"},{"s":44,"e":45,"c":"#d4d4d4","st":"normal"},{"s":45,"e":46,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "  }",
            r##"[{"s":2,"e":3,"c":"#d4d4d4","st":"normal"}]"##,
        ),
        (
            "}",
            r##"[{"s":0,"e":1,"c":"#d4d4d4","st":"normal"}]"##,
        ),
    ]
}

fn main() {
    unsafe {
        let _pool = NSAutoreleasePool::new(nil);

        // Set up NSApplication
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular);

        // Create a window
        let window_rect = NSRect::new(NSPoint::new(200.0, 200.0), NSSize::new(800.0, 600.0));
        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask;

        let window = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            window_rect,
            style,
            NSBackingStoreBuffered,
            cocoa::base::NO,
        );
        let title = NSString::alloc(nil).init_str("Hone Editor \u{2014} macOS Rendering Demo");
        window.setTitle_(title);

        // Create the editor view via FFI
        let editor = hone_editor_create(800.0, 600.0);

        // Set font
        let font_family = CString::new("Menlo").unwrap();
        hone_editor_set_font(editor, font_family.as_ptr(), 14.0);

        // Attach to window's content view
        let content_view: id = msg_send![window, contentView];
        hone_editor_attach_to_view(editor, content_view as i64);

        // Measure char width for cursor positioning
        let m_char = CString::new("M").unwrap();
        let char_width = hone_editor_measure_text(editor, m_char.as_ptr());
        let line_height = 21.0;

        // Render sample code
        hone_editor_begin_frame(editor);

        let lines = sample_lines();
        for (i, (text, tokens)) in lines.iter().enumerate() {
            let line_number = (i + 1) as i32;
            let y_offset = i as f64 * line_height;
            let c_text = CString::new(*text).unwrap();
            let c_tokens = CString::new(*tokens).unwrap();
            hone_editor_render_line(
                editor,
                line_number,
                c_text.as_ptr(),
                c_tokens.as_ptr(),
                y_offset,
            );
        }

        // Place cursor at line 8, after "this."
        let cursor_text = CString::new("    this.").unwrap();
        let cursor_x = hone_editor_measure_text(editor, cursor_text.as_ptr());
        let gutter_width = 2.0 * char_width + 36.0;
        hone_editor_set_cursor(editor, cursor_x + gutter_width, 7.0 * line_height, 0);

        // Set a selection on line 4 "buffer" (columns 10..16)
        let sel_start_text = CString::new("  private ").unwrap();
        let sel_x = hone_editor_measure_text(editor, sel_start_text.as_ptr()) + gutter_width;
        let sel_word = CString::new("buffer").unwrap();
        let sel_w = hone_editor_measure_text(editor, sel_word.as_ptr());
        let sel_json = format!(
            r#"[{{"x":{},"y":{},"w":{},"h":{}}}]"#,
            sel_x,
            3.0 * line_height,
            sel_w,
            line_height,
        );
        let c_sel = CString::new(sel_json).unwrap();
        hone_editor_set_selection(editor, c_sel.as_ptr());

        hone_editor_end_frame(editor);

        // Show window and run
        window.makeKeyAndOrderFront_(nil);
        let _: () = msg_send![app, activateIgnoringOtherApps: cocoa::base::YES];
        app.run();

        // Cleanup (won't reach here until app quits)
        hone_editor_destroy(editor);
    }
}
