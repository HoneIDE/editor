//! Thin shim over `perry-ffi` for the call sites that take `*const u8`.
//!
//! Perry's `StringHeader` layout is owned by `perry-runtime` and changes
//! between minor versions. Going through `perry-ffi` keeps this crate
//! on the stable wrapper surface.

pub use perry_ffi::StringHeader;

pub fn str_from_header(ptr: *const u8) -> &'static str {
    if ptr.is_null() || (ptr as usize) < 0x1000 {
        return "";
    }
    let handle = unsafe { perry_ffi::JsString::from_raw(ptr as *mut perry_ffi::StringHeader) };
    perry_ffi::read_string(handle).unwrap_or("")
}
