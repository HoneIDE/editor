//! Android native rendering for Hone Editor.
//!
//! Uses JNI to call android.graphics.Canvas and android.graphics.Paint
//! for text rendering. Integrates with InputMethodManager for soft keyboard.

use std::ffi::c_char;
use jni::objects::{JObject, JValue};

mod editor_view;
mod input_handler;
#[cfg(feature = "demo")]
mod demo_jni;
pub mod tokenizer;

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

        // Set layout params: width=MATCH_PARENT, height=0, weight=1.0
        // This fills remaining vertical space in Perry's LinearLayout (VStack).
        let lp = env.new_object(
            "android/widget/LinearLayout$LayoutParams",
            "(IIF)V",
            &[JValue::Int(-1), JValue::Int(0), JValue::Float(1.0)], // MATCH_PARENT, 0, weight=1
        ).ok()?;
        let _ = env.call_method(&editor_view, "setLayoutParams",
            "(Landroid/view/ViewGroup$LayoutParams;)V",
            &[JValue::Object(&lp)]);

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

/// Trigger a redraw on the HoneEditorView via postInvalidate (thread-safe).
fn post_invalidate_view(android_ref: &jni::objects::GlobalRef) {
    if let Some(vm) = JAVA_VM.get() {
        if let Ok(mut env) = vm.attach_current_thread() {
            let _ = env.call_method(android_ref.as_obj(), "postInvalidate", "()V", &[]);
        }
    }
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
        // cursor.x = column (character index), cursor.y = line (fractional, scroll-adjusted)
        let _ = env.call_method(&paint, "setColor", "(I)V", &[JValue::Int(view.cursor_color as i32)]);
        let cx = gutter_width + (cursor.x as f32) * char_width;
        let cy = (cursor.y as f32) * text_size_px * 1.5;
        let ch = text_size_px * 1.5;
        let _ = env.call_method(canvas, "drawRect", "(FFFFLandroid/graphics/Paint;)V",
            &[JValue::Float(cx), JValue::Float(cy),
              JValue::Float(cx + 3.0), JValue::Float(cy + ch),
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

/// Set PerryActivity.mainStarted = true via JNI to prevent double nativeMain().
fn notify_main_started() {
    let vm = match JAVA_VM.get() {
        Some(vm) => vm,
        None => return,
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(_) => return,
    };
    let class = match env.find_class("com/perry/app/PerryActivity") {
        Ok(c) => c,
        Err(_) => return,
    };
    let field_id = match env.get_static_field_id(&class, "mainStarted", "Z") {
        Ok(f) => f,
        Err(_) => return,
    };
    let _ = env.set_static_field(&class, field_id, jni::objects::JValue::Bool(1));
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
pub extern "C" fn hone_editor_render_line(view: *mut EditorView, line_number: f64, text: *const u8, tokens_json: *const u8, y_offset: f64) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(tokens_json);
    let t = if tokens_str.is_empty() { "[]" } else { tokens_str };
    view.render_line(line_number as i32, text_str, t, y_offset);
}

#[no_mangle]
pub extern "C" fn hone_editor_set_cursor(view: *mut EditorView, x: f64, y: f64, style: f64) {
    let view = unsafe { &mut *view };
    view.set_cursor(x, y, style as i32);
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
    if let Some(ref android_ref) = view.android_view_ref {
        post_invalidate_view(android_ref);
    }
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
pub extern "C" fn hone_editor_nsview(view: *mut EditorView) -> *mut std::ffi::c_void {
    let view = unsafe { &*view };
    view.parent_view
}

// === TS-mode cache protocol (IMPLEMENTED) ===

#[no_mangle]
pub extern "C" fn hone_editor_cache_line(view: *mut EditorView, line: f64, text: *const u8, tokens: *const u8) {
    let view = unsafe { &mut *view };
    let text_str = str_from_header(text);
    let tokens_str = str_from_header(tokens);
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
    view.set_viewport_range(start_line as i32, end_line as i32, scroll_top, total_lines as i32, line_height);
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
pub extern "C" fn hone_editor_begin_selections(view: *mut EditorView, count: f64) {
    let view = unsafe { &mut *view };
    view.begin_selections_new(count as usize);
}

#[no_mangle]
pub extern "C" fn hone_editor_add_selection_rect(view: *mut EditorView, x: f64, y: f64, w: f64, h: f64) {
    let view = unsafe { &mut *view };
    view.add_selection_rect_new(x, y, w, h);
}

// === TypeScript mode control ===

#[no_mangle]
pub extern "C" fn hone_editor_set_ts_mode(view: *mut EditorView, mode: f64) {
    let view = unsafe { &mut *view };
    view.ts_handles_events = mode > 0.5;
}

#[no_mangle]
pub extern "C" fn hone_editor_set_gutter_width(view: *mut EditorView, width: f64) {
    let view = unsafe { &mut *view };
    view.ts_gutter_width = Some(width);
}

// === TypeScript event polling API (Perry mode) ===
// All values are f64 for Perry ABI compatibility.

#[no_mangle]
pub extern "C" fn hone_editor_set_event_callback(view: *mut EditorView, callback: extern "C" fn()) {
    let view = unsafe { &mut *view };
    view.event_callback = Some(callback);
}

#[no_mangle]
pub extern "C" fn hone_editor_pending_event_count(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.pending_events.len() as f64
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_type(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].event_type as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_char(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].char_code as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_action(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].action_id as f64 } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_x(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].x } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_get_event_y(view: *mut EditorView, index: f64) -> f64 {
    let view = unsafe { &*view };
    let i = index as usize;
    if i < view.pending_events.len() { view.pending_events[i].y } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_events(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.pending_events.clear();
}

// === Read-only mode ===

#[no_mangle]
pub extern "C" fn hone_editor_set_read_only(view: *mut EditorView, flag: f64) {
    let view = unsafe { &mut *view };
    view.read_only = flag > 0.5;
}

// === Per-line background colors (diff highlighting) ===

#[no_mangle]
pub extern "C" fn hone_editor_set_line_background(view: *mut EditorView, line: f64, r: f64, g: f64, b: f64, a: f64) {
    let view = unsafe { &mut *view };
    view.line_backgrounds.insert(line as i32, (r, g, b, a));
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_line_backgrounds(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.line_backgrounds.clear();
}

// === Scroll delta + line needs ===

#[no_mangle]
pub extern "C" fn hone_editor_get_scroll_delta(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    view.rust_scroll_delta
}

#[no_mangle]
pub extern "C" fn hone_editor_clear_scroll_delta(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    view.rust_scroll_delta = 0.0;
}

#[no_mangle]
pub extern "C" fn hone_editor_needs_lines(view: *mut EditorView) -> f64 {
    let view = unsafe { &*view };
    if view.needs_lines { 1.0 } else { 0.0 }
}

// === Clipboard ===

#[no_mangle]
pub extern "C" fn hone_editor_copy_to_clipboard(_view: *mut EditorView, text_ptr: *const u8) {
    let text = str_from_header(text_ptr);
    if text.is_empty() { return; }
    let vm = match JAVA_VM.get() {
        Some(vm) => vm,
        None => return,
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(_) => return,
    };
    let _ = env.push_local_frame(8);
    let _ = (|| -> Option<()> {
        let cm = get_clipboard_manager(&mut env)?;
        let jtext = env.new_string(text).ok()?;
        let clip = env.call_static_method(
            "android/content/ClipData", "newPlainText",
            "(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;",
            &[JValue::Object(&jtext), JValue::Object(&jtext)],
        ).ok()?.l().ok()?;
        env.call_method(&cm, "setPrimaryClip",
            "(Landroid/content/ClipData;)V",
            &[JValue::Object(&clip)]).ok()?;
        Some(())
    })();
    unsafe { env.pop_local_frame(&JObject::null()); }
}

#[no_mangle]
pub extern "C" fn hone_editor_paste_from_clipboard(view: *mut EditorView) {
    let view = unsafe { &mut *view };
    let vm = match JAVA_VM.get() {
        Some(vm) => vm,
        None => return,
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(_) => return,
    };
    let _ = env.push_local_frame(16);
    let text = (|| -> Option<String> {
        let cm = get_clipboard_manager(&mut env)?;
        let clip = env.call_method(&cm, "getPrimaryClip",
            "()Landroid/content/ClipData;", &[]).ok()?.l().ok()?;
        if clip.is_null() { return None; }
        let count: i32 = env.call_method(&clip, "getItemCount", "()I", &[]).ok()?.i().ok()?;
        if count <= 0 { return None; }
        let item = env.call_method(&clip, "getItemAt",
            "(I)Landroid/content/ClipData$Item;",
            &[JValue::Int(0)]).ok()?.l().ok()?;
        let cs = env.call_method(&item, "getText",
            "()Ljava/lang/CharSequence;", &[]).ok()?.l().ok()?;
        if cs.is_null() { return None; }
        let jstr: jni::objects::JString = cs.into();
        let s: String = env.get_string(&jstr).ok()?.into();
        Some(s)
    })();
    unsafe { env.pop_local_frame(&JObject::null()); }
    if let Some(t) = text {
        for ch in t.chars() {
            view.pending_events.push(editor_view::PendingEvent {
                event_type: 1, // TEXT
                char_code: ch as u32,
                action_id: 0,
                x: 0.0,
                y: 0.0,
            });
        }
    }
}

fn get_clipboard_manager<'a>(env: &mut jni::JNIEnv<'a>) -> Option<JObject<'a>> {
    let app = env.call_static_method(
        "android/app/ActivityThread", "currentApplication",
        "()Landroid/app/Application;", &[],
    ).ok()?.l().ok()?;
    if app.is_null() { return None; }
    let svc_name = env.new_string("clipboard").ok()?;
    let cm = env.call_method(&app, "getSystemService",
        "(Ljava/lang/String;)Ljava/lang/Object;",
        &[JValue::Object(&svc_name)]).ok()?.l().ok()?;
    if cm.is_null() { None } else { Some(cm) }
}

// === JNI Input Event Handlers ===
// Called from HoneEditorView in Java/Kotlin when touch/key events occur.

/// Called from HoneEditorView.onTouchEvent(ACTION_DOWN).
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnTouchDown(
    _env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    x: jni::sys::jfloat,
    y: jni::sys::jfloat,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let density = get_density_cached();
    view.on_mouse_down((x as f64) / density, (y as f64) / density);
}

/// Called from HoneEditorView.onTouchEvent(ACTION_MOVE).
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnTouchMove(
    _env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    x: jni::sys::jfloat,
    y: jni::sys::jfloat,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let density = get_density_cached();
    view.on_mouse_drag((x as f64) / density, (y as f64) / density);
}

/// Called from HoneEditorView when the user scrolls (fling/pan gesture).
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnScroll(
    _env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    dx: jni::sys::jfloat,
    dy: jni::sys::jfloat,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let density = get_density_cached();
    view.on_scroll((dx as f64) / density, (dy as f64) / density);
}

/// Called from HoneEditorView when the user types text (IME commitText).
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnTextInput(
    mut env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    text: jni::objects::JString,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let text_str: String = env.get_string(&text).map(|s| s.into()).unwrap_or_default();
    if !text_str.is_empty() {
        view.on_text_input(&text_str);
    }
}

/// Called from HoneEditorView when a key action occurs (backspace, enter, arrows, etc.).
#[no_mangle]
pub extern "C" fn Java_com_perry_app_HoneEditorView_nativeOnAction(
    mut env: jni::JNIEnv,
    _this: JObject,
    handle: jni::sys::jlong,
    action: jni::objects::JString,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut EditorView) };
    let action_str: String = env.get_string(&action).map(|s| s.into()).unwrap_or_default();
    if !action_str.is_empty() {
        view.on_action(&action_str);
    }
}

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

// === Platform detection + stubs ===

#[no_mangle]
pub extern "C" fn hone_editor_is_ios() -> f64 {
    // Return 1.0 to use _directRenderText path (coordinator.render doesn't work
    // on mobile platforms — only macOS supports the coordinator path).
    1.0
}

#[no_mangle]
pub extern "C" fn hone_editor_poll_touch(_view: *mut EditorView) -> f64 {
    0.0 // No-op on Android (touch handled by JNI)
}

// Stubs for features not yet implemented on Android
#[no_mangle]
pub extern "C" fn hone_editor_set_line_diagnostics(_view: *mut EditorView, _data: f64) {}
#[no_mangle]
pub extern "C" fn hone_editor_clear_diagnostics(_view: *mut EditorView) {}
#[no_mangle]
pub extern "C" fn hone_editor_set_breakpoints(_view: *mut EditorView, _data: f64) {}
#[no_mangle]
pub extern "C" fn hone_editor_set_fold_ranges(_view: *mut EditorView, _data: f64) {}
#[no_mangle]
pub extern "C" fn hone_editor_set_find_highlights(_view: *mut EditorView, _json: *const u8) {}
#[no_mangle]
pub extern "C" fn hone_editor_clear_find_highlights(_view: *mut EditorView) {}
