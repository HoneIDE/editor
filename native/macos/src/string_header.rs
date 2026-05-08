//! Thin shim over `perry-ffi` for the call sites that take `*const u8`.
//!
//! Perry's `StringHeader` layout is owned by `perry-runtime` and changes
//! between minor versions (it grew from 12 → 20 bytes in v0.5.213 to back
//! the SSO infrastructure). Going through `perry-ffi` keeps this crate on
//! the stable wrapper surface so we don't break each time the runtime is
//! refactored.

pub use perry_ffi::StringHeader;

/// Extract a `&str` from a Perry-runtime `StringHeader` pointer.
///
/// The caller passes the pointer it received as a `*const u8` parameter
/// in its `extern "C"` signature. We do a guard against null / obviously
/// bogus low addresses (Perry occasionally hands us a NaN-box scalar
/// that we shouldn't dereference) and forward to `perry-ffi`.
pub fn str_from_header(ptr: *const u8) -> &'static str {
    if ptr.is_null() || (ptr as usize) < 0x1000 {
        return "";
    }
    let handle = unsafe { perry_ffi::JsString::from_raw(ptr as *mut perry_ffi::StringHeader) };
    perry_ffi::read_string(handle).unwrap_or("")
}
