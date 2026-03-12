//! Android native rendering for Hone Editor.
//!
//! Uses JNI to call android.graphics.Canvas and android.graphics.Paint
//! for text rendering. Integrates with InputMethodManager for soft keyboard.

use std::ffi::c_char;
use jni::objects::{JObject, JValue};

mod editor_view;
mod input_handler;
mod demo_jni;

pub use editor_view::EditorView;

use editor_view::{ActionCallback, MouseDownCallback, ScrollCallback, TextInputCallback};

// === Perry StringHeader decoding ===
// Perry passes strings as NaN-boxed pointers to StringHeader { length: u32, capacity: u32 }
// followed by UTF-8 data bytes. We must NOT use CStr::from_ptr — Perry strings aren't null-terminated.

#[repr(C)]
struct StringHeader {
    length: u32,
    capacity: u32,
}

fn str_from_header(ptr: *const u8) -> &'static str {
    if ptr.is_null() {
        return "";
    }
    unsafe {
        let header = ptr as *const StringHeader;
        let len = (*header).length as usize;
        let data = ptr.add(std::mem::size_of::<StringHeader>());
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(data, len))
    }
}

// === JNI Initialization ===

static JAVA_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

#[no_mangle]
pub extern "C" fn JNI_OnLoad(vm: jni::JavaVM, _reserved: *mut std::ffi::c_void) -> jni::sys::jint {
    let _ = JAVA_VM.set(vm);
    jni::sys::JNI_VERSION_1_6
}

/// Create a HoneEditorView (custom Android View) for the editor surface.
/// Returns (GlobalRef, raw_ptr) or None if JNI is unavailable.
fn create_editor_android_view(_width: f64, _height: f64) -> Option<(jni::objects::GlobalRef, *mut std::ffi::c_void)> {
    let vm = JAVA_VM.get()?;
    let mut env = vm.attach_current_thread().ok()?;
    let _ = env.push_local_frame(16);

    let result = (|| -> Option<(jni::objects::GlobalRef, *mut std::ffi::c_void)> {
        let app = env.call_static_method(
            "android/app/ActivityThread",
            "currentApplication",
            "()Landroid/app/Application;",
            &[],
        ).ok()?.l().ok()?;
        if app.is_null() { return None; }

        // Create HoneEditorView (custom View with onDraw JNI callback)
        let editor_view = env.new_object(
            "com/perry/app/HoneEditorView",
            "(Landroid/content/Context;)V",
            &[JValue::Object(&app)],
        ).ok()?;

        // Set dark editor background (#1E1E1E)
        let bg_color: i32 = 0xFF1E1E1E_u32 as i32;
        let _ = env.call_method(&editor_view, "setBackgroundColor", "(I)V", &[JValue::Int(bg_color)]);

        let global = env.new_global_ref(&editor_view).ok()?;
        let raw = global.as_obj().as_raw() as *mut std::ffi::c_void;
        Some((global, raw))
    })();

    unsafe { env.pop_local_frame(&JObject::null()); }
    result
}

/// Set the nativeHandle field on the HoneEditorView so onDraw can call back to Rust.
fn set_editor_native_handle(view_ref: &jni::objects::GlobalRef, handle: i64) {
    let vm = match JAVA_VM.get() {
        Some(vm) => vm,
        None => return,
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(_) => return,
    };
    let _ = env.set_field(view_ref.as_obj(), "nativeHandle", "J", JValue::Long(handle));
}

/// Trigger a redraw on the HoneEditorView (thread-safe).
fn post_invalidate(view_ref: &jni::objects::GlobalRef) {
    let vm = match JAVA_VM.get() {
        Some(vm) => vm,
        None => return,
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(_) => return,
    };
    let _ = env.call_method(view_ref.as_obj(), "postInvalidate", "()V", &[]);
}

// === JNI Draw Callback ===

/// Called from HoneEditorView.onDraw(canvas) via JNI.
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeDrawEditor(
    mut env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    canvas: JObject,
) {
    if handle == 0 { return; }
    let view = unsafe { &*(handle as *const EditorView) };
    draw_editor(&mut env, &canvas, view);
}

/// Called from HoneEditorView.onSizeChanged via JNI.
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnSizeChanged(
    _env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    width_px: jni::sys::jfloat,
    height_px: jni::sys::jfloat,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let density = get_density_cached();
    view.width = (width_px as f64) / density;
    view.height = (height_px as f64) / density;
}

// === Drawing Implementation ===

/// Cached screen density (set once on first query).
static CACHED_DENSITY: std::sync::OnceLock<f64> = std::sync::OnceLock::new();

fn get_density_cached() -> f64 {
    *CACHED_DENSITY.get_or_init(|| {
        let vm = match JAVA_VM.get() {
            Some(vm) => vm,
            None => return 2.625,
        };
        let mut env = match vm.attach_current_thread() {
            Ok(env) => env,
            Err(_) => return 2.625,
        };
        get_density(&mut env)
    })
}

fn get_density(env: &mut jni::JNIEnv) -> f64 {
    let result = (|| -> Option<f64> {
        let app = env.call_static_method(
            "android/app/ActivityThread",
            "currentApplication",
            "()Landroid/app/Application;",
            &[],
        ).ok()?.l().ok()?;
        if app.is_null() { return None; }
        let res = env.call_method(&app, "getResources",
            "()Landroid/content/res/Resources;", &[]).ok()?.l().ok()?;
        let dm = env.call_method(&res, "getDisplayMetrics",
            "()Landroid/util/DisplayMetrics;", &[]).ok()?.l().ok()?;
        let density = env.get_field(&dm, "density", "F").ok()?.f().ok()? as f64;
        Some(density)
    })();
    result.unwrap_or(2.625)
}

fn draw_editor(env: &mut jni::JNIEnv, canvas: &JObject, view: &EditorView) {
    let _ = env.push_local_frame(256);

    // Create Paint with anti-alias
    let paint = match env.new_object("android/graphics/Paint", "(I)V", &[JValue::Int(1)]) {
        Ok(p) => p,
        Err(_) => { unsafe { env.pop_local_frame(&JObject::null()); } return; }
    };

    // Set monospace typeface
    let family_jstr = match env.new_string("monospace") {
        Ok(s) => s,
        Err(_) => { unsafe { env.pop_local_frame(&JObject::null()); } return; }
    };
    if let Ok(tf_val) = env.call_static_method(
        "android/graphics/Typeface", "create",
        "(Ljava/lang/String;I)Landroid/graphics/Typeface;",
        &[JValue::Object(&family_jstr), JValue::Int(0)],
    ) {
        if let Ok(tf_obj) = tf_val.l() {
            let _ = env.call_method(&paint, "setTypeface",
                "(Landroid/graphics/Typeface;)Landroid/graphics/Typeface;",
                &[JValue::Object(&tf_obj)]);
        }
    }

    let density = get_density(env);
    let text_size_px = (view.get_font_size() * density) as f32;
    let _ = env.call_method(&paint, "setTextSize", "(F)V", &[JValue::Float(text_size_px)]);

    // Get font ascent (Paint.ascent() returns negative value)
    let ascent = env.call_method(&paint, "ascent", "()F", &[])
        .ok().and_then(|v| v.f().ok()).unwrap_or(-text_size_px * 0.8);
    let baseline_offset = -ascent; // positive distance from top to baseline

    // Measure character width
    let m_jstr = env.new_string("M").unwrap_or_else(|_| env.new_string(" ").unwrap());
    let char_width = env.call_method(&paint, "measureText",
        "(Ljava/lang/String;)F", &[JValue::Object(&m_jstr)])
        .ok().and_then(|v| v.f().ok()).unwrap_or(text_size_px * 0.6);

    // Fill background
    let _ = env.call_method(canvas, "drawColor", "(I)V", &[JValue::Int(view.background_color as i32)]);

    let lines = view.get_frame_lines();
    if lines.is_empty() {
        unsafe { env.pop_local_frame(&JObject::null()); }
        return;
    }

    // Calculate gutter width based on max line number
    let max_line = view.get_max_line_number().max(1);
    let gutter_digits = format!("{}", max_line).len();
    let gutter_width = ((gutter_digits + 1) as f32) * char_width + 8.0;

    // Draw gutter background
    let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.gutter_bg_color as i32)]);
    let style_class = env.find_class("android/graphics/Paint$Style").ok();
    if let Some(ref sc) = style_class {
        if let Ok(fill_val) = env.get_static_field(sc, "FILL", "Landroid/graphics/Paint$Style;") {
            if let Ok(fill_obj) = fill_val.l() {
                let _ = env.call_method(&paint, "setStyle",
                    "(Landroid/graphics/Paint$Style;)V", &[JValue::Object(&fill_obj)]);
            }
        }
    }
    let view_height_px = (view.get_height() * density) as f32;
    let _ = env.call_method(canvas, "drawRect", "(FFFFLandroid/graphics/Paint;)V",
        &[JValue::Float(0.0), JValue::Float(0.0),
          JValue::Float(gutter_width - 4.0), JValue::Float(view_height_px),
          JValue::Object(&paint)]);

    let d = density as f32;

    // Draw each line
    for line in lines {
        let y_px = (line.y_offset as f32) * d;
        let baseline = y_px + baseline_offset;

        // Skip lines outside visible area
        if baseline < -text_size_px || y_px > view_height_px {
            continue;
        }

        // Draw line background if set
        if let Some(bg) = line.line_bg {
            let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(bg as i32)]);
            let line_h = (view.get_line_height() as f32) * d;
            let _ = env.call_method(canvas, "drawRect", "(FFFFLandroid/graphics/Paint;)V",
                &[JValue::Float(gutter_width), JValue::Float(y_px),
                  JValue::Float(view.get_width() as f32 * d), JValue::Float(y_px + line_h),
                  JValue::Object(&paint)]);
        }

        // Draw line number
        let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.gutter_fg_color as i32)]);
        let num_str = format!("{}", line.line_number);
        if let Ok(jnum) = env.new_string(&num_str) {
            let num_x = gutter_width - ((num_str.len() as f32) * char_width) - 8.0;
            let _ = env.call_method(canvas, "drawText",
                "(Ljava/lang/String;FFLandroid/graphics/Paint;)V",
                &[JValue::Object(&jnum), JValue::Float(num_x), JValue::Float(baseline),
                  JValue::Object(&paint)]);
        }

        // Draw tokens
        if line.tokens.is_empty() {
            // Default color — draw whole line
            let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.default_text_color as i32)]);
            if let Ok(jtext) = env.new_string(&line.text) {
                let _ = env.call_method(canvas, "drawText",
                    "(Ljava/lang/String;FFLandroid/graphics/Paint;)V",
                    &[JValue::Object(&jtext), JValue::Float(gutter_width),
                      JValue::Float(baseline), JValue::Object(&paint)]);
            }
        } else {
            for token in &line.tokens {
                let s = token.start.min(line.text.len());
                let e = token.end.min(line.text.len());
                if s >= e { continue; }

                let _ = env.call_method(&paint, "setColor", "(I)V",
                    &[JValue::Int(token.color as i32)]);

                let token_text = &line.text[s..e];
                let x = gutter_width + (s as f32) * char_width;
                if let Ok(jtext) = env.new_string(token_text) {
                    let _ = env.call_method(canvas, "drawText",
                        "(Ljava/lang/String;FFLandroid/graphics/Paint;)V",
                        &[JValue::Object(&jtext), JValue::Float(x),
                          JValue::Float(baseline), JValue::Object(&paint)]);
                }
            }
        }
    }

    // Draw selection rects
    let selections = view.get_selections();
    if !selections.is_empty() {
        let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.selection_color as i32)]);
        for sel in selections {
            let sx = (sel.x as f32) * d + gutter_width;
            let sy = (sel.y as f32) * d;
            let sw = (sel.w as f32) * d;
            let sh = (sel.h as f32) * d;
            let _ = env.call_method(canvas, "drawRect", "(FFFFLandroid/graphics/Paint;)V",
                &[JValue::Float(sx), JValue::Float(sy),
                  JValue::Float(sx + sw), JValue::Float(sy + sh),
                  JValue::Object(&paint)]);
        }
    }

    // Draw cursor
    if let Some(cursor) = view.get_cursor() {
        let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.cursor_color as i32)]);
        let cx = (cursor.x as f32) * d + gutter_width;
        let cy = (cursor.y as f32) * d;
        let ch = (view.get_line_height() as f32) * d;
        let _ = env.call_method(canvas, "drawRect", "(FFFFLandroid/graphics/Paint;)V",
            &[JValue::Float(cx), JValue::Float(cy),
              JValue::Float(cx + 2.0), JValue::Float(cy + ch),
              JValue::Object(&paint)]);
    }

    unsafe { env.pop_local_frame(&JObject::null()); }
}

// === FFI Contract Implementation ===

#[no_mangle]
pub extern "C" fn hone_editor_create(width: f64, height: f64) -> *mut EditorView {
    let mut view = EditorView::new(width, height);

    if let Some((global_ref, raw_ptr)) = create_editor_android_view(width, height) {
        view.parent_view = raw_ptr;
        view.android_view_ref = Some(global_ref);
    }

    let ptr = Box::into_raw(Box::new(view));

    // Set the native handle on HoneEditorView so onDraw can call back
    let view_ref = unsafe { &*ptr };
    if let Some(ref android_ref) = view_ref.android_view_ref {
        set_editor_native_handle(android_ref, ptr as i64);
    }

    ptr
}

#[no_mangle]
pub extern "C" fn hone_editor_attach_to_view(view: *mut EditorView, parent_view: i64) {
    let view = unsafe { &mut *view };
    view.parent_view = parent_view as *mut std::ffi::c_void;
}

#[no_mangle]
pub extern "C" fn hone_editor_destroy(view: *mut EditorView) {
    if !view.is_null() { unsafe { drop(Box::from_raw(view)); } }
}

#[no_mangle]
pub extern "C" fn hone_editor_set_font(view: *mut EditorView, family: *const u8, size: f64) {
    let view = unsafe { &mut *view };
    let family_str = str_from_header(family);
    let f = if family_str.is_empty() { "monospace" } else { family_str };
    view.set_font(f, size);
}

#[no_mangle]
pub extern "C" fn hone_editor_render_line(view: *mut EditorView, line_number: i32, text: *const u8, tokens_json: *const u8, y_offset: f64) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(tokens_json);
    let t = if tokens_str.is_empty() { "[]" } else { tokens_str };
    view.render_line(line_number, text_str, t, y_offset);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(view: *mut EditorView, x: f64, y: f64, style: i32) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_selection(view: *mut EditorView, regions_json: *const u8) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(regions_json);
    let j = if json_str.is_empty() { "[]" } else { json_str };
    view.set_selection(j);
}

#[no_mangle]
pub extern "C" fn hone_editor_scroll(view: *mut EditorView, offset_y: f64) {
    let view = unsafe { &mut *view };
    view.scroll(offset_y);
}

#[no_mangle]
pub extern "C" fn hone_editor_measure_text(view: *mut EditorView, text: *const u8) -> f64 {
    let view = unsafe { &*view };
    let text_str = str_from_header(text);
    view.measure_text(text_str)
}

#[no_mangle]
pub extern "C" fn hone_editor_invalidate(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.invalidate();
}

#[no_mangle]
pub extern "C" fn hone_editor_begin_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.begin_frame();
}

#[no_mangle]
pub extern "C" fn hone_editor_end_frame(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.end_frame();
    // Trigger redraw on the Android HoneEditorView
    if let Some(ref android_ref) = view.android_view_ref {
        post_invalidate(android_ref);
    }
}

// === Extended FFI (matching iOS/macOS) ===

#[no_mangle]
pub extern "C" fn hone_editor_render_decorations(view: *mut EditorView, decorations_json: *const u8) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(decorations_json);
    let j = if json_str.is_empty() { "[]" } else { json_str };
    view.render_decorations(j);
}

#[no_mangle]
pub extern "C" fn hone_editor_render_ghost_text(view: *mut EditorView, text: *const u8, x: f64, y: f64, color: *const u8) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let color_str = str_from_header(color);
    let c = if color_str.is_empty() { "#808080" } else { color_str };
    view.render_ghost_text(text_str, x, y, c);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursors(view: *mut EditorView, cursors_json: *const u8) {
    let view = unsafe { &mut *view };
    let json_str = str_from_header(cursors_json);
    let j = if json_str.is_empty() { "[]" } else { json_str };
    view.set_cursors(j);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_text_input_callback(view: *mut EditorView, callback: TextInputCallback) {
    let view = unsafe { &mut *view };
    view.set_text_input_callback(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_action_callback(view: *mut EditorView, callback: ActionCallback) {
    let view = unsafe { &mut *view };
    view.set_action_callback(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_mouse_down_callback(view: *mut EditorView, callback: MouseDownCallback) {
    let view = unsafe { &mut *view };
    view.set_mouse_down_callback(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_scroll_callback(view: *mut EditorView, callback: ScrollCallback) {
    let view = unsafe { &mut *view };
    view.set_scroll_callback(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_add_context_menu_item(view: *mut EditorView, title: *const u8, action_id: *const u8) {
    let view = unsafe { &mut *view };
    let title_str = str_from_header(title);
    let action_str = str_from_header(action_id);
    view.add_context_menu_item(title_str, action_str);
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_context_menu_items(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_context_menu_items();
}

#[no_mangle]
pub extern "C" fn hone_editor_nsview(view: *mut EditorView) -> i64 {
    let view = unsafe { &*view };
    view.parent_view as i64
}

// === TS-mode cache protocol (IMPLEMENTED) ===

#[no_mangle]
pub extern "C" fn hone_editor_cache_line(view: *mut EditorView, line: f64, text: *const u8, tokens: *const u8) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(tokens);
    if line as i32 <= 5 {
        android_log(&format!("cache_line: line={} text_len={} text='{}'", line as i32, text_str.len(), &text_str[..text_str.len().min(80)]));
    }
    view.cache_line_packed(line as i32, text_str, tokens_str);
}

extern "C" {
    fn __android_log_write(prio: i32, tag: *const c_char, text: *const c_char) -> i32;
}

fn android_log(msg: &str) {
    let c_msg = std::ffi::CString::new(msg).unwrap_or_default();
    let c_tag = std::ffi::CString::new("HoneEditor").unwrap_or_default();
    unsafe {
        __android_log_write(3, c_tag.as_ptr(), c_msg.as_ptr());
    }
}

#[no_mangle]
pub extern "C" fn hone_editor_set_viewport(view: *mut EditorView, start_line: f64, end_line: f64, scroll_top: f64, total_lines: f64, line_height: f64) {
    let view = unsafe { &mut *view };
    android_log(&format!("set_viewport: start={} end={} scrollTop={} total={} lineH={}", start_line as i32, end_line as i32, scroll_top, total_lines as i32, line_height));
    view.set_viewport_range(start_line as i32, end_line as i32, scroll_top, total_lines as i32, line_height);
    android_log(&format!("set_viewport: frame_lines count={}", view.get_frame_lines().len()));
}

#[no_mangle]
pub extern "C" fn hone_editor_invalidate_line(view: *mut EditorView, line: f64) {
    let view = unsafe { &mut *view };
    view.invalidate_cache_line(line as i32);
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_line_cache(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.clear_line_cache();
}

// === TS-mode: view dimensions (return actual size) ===

#[no_mangle]
pub extern "C" fn hone_editor_get_view_width(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    let w = view.get_width();
    if w > 0.0 { w } else { 400.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_view_height(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    let h = view.get_height();
    if h > 0.0 { h } else { 800.0 }
}

// === TS-mode: selection rects ===

#[no_mangle]
pub extern "C" fn hone_editor_begin_selections(_view: *mut EditorView, _count: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_add_selection_rect(_view: *mut EditorView, _x: f64, _y: f64, _w: f64, _h: f64) {}

// === TS-mode: remaining stubs ===

#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(_view: *mut EditorView, _callback: i64) {}

#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(_view: *mut EditorView) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_get_event_type(_view: *mut EditorView, _index: f64) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_get_event_char(_view: *mut EditorView, _index: f64) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_get_event_action(_view: *mut EditorView, _index: f64) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_get_event_x(_view: *mut EditorView, _index: f64) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_get_event_y(_view: *mut EditorView, _index: f64) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_clear_events(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_ts_mode(_view: *mut EditorView, _mode: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_width(_view: *mut EditorView, _width: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_read_only(_view: *mut EditorView, _flag: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_set_line_background(_view: *mut EditorView, _line: f64, _r: f64, _g: f64, _b: f64, _a: f64) {}

#[no_mangle]
pub extern "C" fn hone_editor_clear_line_backgrounds(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta(_view: *mut EditorView) -> f64 { 0.0 }

#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta(_view: *mut EditorView) {}

#[no_mangle]
pub extern "C" fn hone_editor_needs_lines(_view: *mut EditorView) -> f64 { 1.0 }

#[no_mangle]
pub extern "C" fn hone_editor_set_line_background_2(_view: *mut EditorView, _line: f64, _r: f64, _g: f64, _b: f64, _a: f64) {}

// === Editor Color Settings ===

#[no_mangle]
pub extern "C" fn hone_editor_set_bg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_bg_color(r, g, b);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_fg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_fg_color(r, g, b);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_fg_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_gutter_fg_color(r, g, b);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_selection_color(view: *mut EditorView, r: f64, g: f64, b: f64, a: f64) {
    let view = unsafe { &mut *view };
    view.set_selection_color(r, g, b, a);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor_color(view: *mut EditorView, r: f64, g: f64, b: f64) {
    let view = unsafe { &mut *view };
    view.set_cursor_color(r, g, b);
}
