//! Win32 window class and WndProc for the Hone editor view.
//!
//! Registers `HoneEditorView` window class with an I-beam cursor.
//! WndProc dispatches WM_PAINT, WM_CHAR, WM_KEYDOWN, WM_LBUTTONDOWN,
//! WM_MOUSEWHEEL, WM_SIZE, and WM_RBUTTONDOWN to the EditorView.
//!
//! Key design: VK codes are mapped to macOS-style action selectors
//! ("moveLeft:", "deleteBackward:", etc.) for cross-platform FFI parity.

use std::sync::Once;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{BeginPaint, EndPaint, HBRUSH, PAINTSTRUCT};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, SetFocus};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::editor_view::EditorView;

/// VK code constants (u16 values matching Windows API).
const VK_BACK: u16 = 0x08;
const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0D;
const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_ESCAPE: u16 = 0x1B;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;
const VK_DELETE: u16 = 0x2E;
const VK_HOME: u16 = 0x24;
const VK_END: u16 = 0x23;

static REGISTER_CLASS: Once = Once::new();

const CLASS_NAME: PCWSTR = w!("HoneEditorView");

/// Register the HoneEditorView window class (idempotent).
fn ensure_class_registered() {
    REGISTER_CLASS.call_once(|| {
        unsafe {
            let hinstance = GetModuleHandleW(None).unwrap_or_default();
            let cursor = LoadCursorW(None, IDC_IBEAM).unwrap_or_default();

            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS,
                lpfnWndProc: Some(wnd_proc),
                cbClsExtra: 0,
                cbWndExtra: std::mem::size_of::<usize>() as i32,
                hInstance: hinstance.into(),
                hIcon: HICON::default(),
                hCursor: cursor,
                hbrBackground: HBRUSH::default(),
                lpszMenuName: PCWSTR::null(),
                lpszClassName: CLASS_NAME,
                hIconSm: HICON::default(),
            };

            RegisterClassExW(&wc);
        }
    });
}

/// Create a new HoneEditorView child HWND with the given parent.
///
/// The window is created as a child window (WS_CHILD | WS_VISIBLE).
/// The EditorView pointer is stored via SetWindowLongPtrW(GWLP_USERDATA).
pub fn create_editor_hwnd(
    parent: HWND,
    width: i32,
    height: i32,
    state: *mut EditorView,
) -> HWND {
    ensure_class_registered();

    unsafe {
        let hinstance = GetModuleHandleW(None).unwrap_or_default();

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS_NAME,
            w!(""),
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
            0,
            0,
            width,
            height,
            parent,
            None,
            hinstance,
            None,
        );

        SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);

        hwnd
    }
}

/// Get the EditorView pointer from a window's GWLP_USERDATA.
unsafe fn get_editor(hwnd: HWND) -> Option<&'static mut EditorView> {
    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut EditorView;
    if ptr.is_null() {
        None
    } else {
        Some(&mut *ptr)
    }
}

/// Check if the Shift key is currently held.
fn shift_held() -> bool {
    unsafe { GetKeyState(VK_SHIFT as i32) < 0 }
}

/// Check if the Ctrl key is currently held.
fn ctrl_held() -> bool {
    unsafe { GetKeyState(VK_CONTROL as i32) < 0 }
}

/// The WndProc for HoneEditorView windows.
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let _ = BeginPaint(hwnd, &mut ps);
            if let Some(editor) = get_editor(hwnd) {
                editor.paint();
            }
            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }

        WM_CHAR => {
            let ch = wparam.0 as u32;
            // Only handle printable characters (>= 0x20), skip control chars
            if ch >= 0x20 {
                if let Some(c) = char::from_u32(ch) {
                    if let Some(editor) = get_editor(hwnd) {
                        let mut buf = [0u8; 4];
                        let s = c.encode_utf8(&mut buf);
                        editor.on_text_input(s);
                    }
                }
            }
            LRESULT(0)
        }

        WM_KEYDOWN => {
            let vk = wparam.0 as u16;
            let shift = shift_held();
            let ctrl = ctrl_held();

            // Map VK codes to macOS-style selector strings for cross-platform parity
            let action: Option<&str> = if ctrl {
                match vk {
                    0x43 /* C */ => Some("copy:"),
                    0x56 /* V */ => Some("paste:"),
                    0x58 /* X */ => Some("cut:"),
                    0x41 /* A */ => Some("selectAll:"),
                    _ => None,
                }
            } else {
                match vk {
                    VK_LEFT => {
                        if shift { Some("moveLeftAndModifySelection:") } else { Some("moveLeft:") }
                    }
                    VK_RIGHT => {
                        if shift { Some("moveRightAndModifySelection:") } else { Some("moveRight:") }
                    }
                    VK_UP => {
                        if shift { Some("moveUpAndModifySelection:") } else { Some("moveUp:") }
                    }
                    VK_DOWN => {
                        if shift { Some("moveDownAndModifySelection:") } else { Some("moveDown:") }
                    }
                    VK_HOME => {
                        if shift {
                            Some("moveToBeginningOfLineAndModifySelection:")
                        } else {
                            Some("moveToBeginningOfLine:")
                        }
                    }
                    VK_END => {
                        if shift {
                            Some("moveToEndOfLineAndModifySelection:")
                        } else {
                            Some("moveToEndOfLine:")
                        }
                    }
                    VK_BACK => Some("deleteBackward:"),
                    VK_DELETE => Some("deleteForward:"),
                    VK_RETURN => Some("insertNewline:"),
                    VK_TAB => {
                        if shift { Some("insertBacktab:") } else { Some("insertTab:") }
                    }
                    VK_ESCAPE => Some("cancelOperation:"),
                    _ => None,
                }
            };

            if let Some(sel) = action {
                if let Some(editor) = get_editor(hwnd) {
                    editor.on_action(sel);
                }
                return LRESULT(0);
            }

            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        WM_LBUTTONDOWN => {
            let x = (lparam.0 & 0xFFFF) as i16 as f64;
            let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as f64;
            let _ = SetFocus(hwnd);
            if let Some(editor) = get_editor(hwnd) {
                editor.on_mouse_down(x, y);
            }
            LRESULT(0)
        }

        WM_MOUSEWHEEL => {
            let delta = ((wparam.0 >> 16) & 0xFFFF) as i16;
            // Normalize: WHEEL_DELTA (120) = ~3 lines, convert to pixel delta
            let dy = -(delta as f64) * 40.0 / 120.0;
            if let Some(editor) = get_editor(hwnd) {
                editor.on_scroll(0.0, dy);
            }
            LRESULT(0)
        }

        WM_SIZE => {
            let width = (lparam.0 & 0xFFFF) as u16 as u32;
            let height = ((lparam.0 >> 16) & 0xFFFF) as u16 as u32;
            if let Some(editor) = get_editor(hwnd) {
                editor.resize(width, height);
            }
            LRESULT(0)
        }

        WM_RBUTTONDOWN => {
            let x = (lparam.0 & 0xFFFF) as i16 as i32;
            let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;

            if let Some(editor) = get_editor(hwnd) {
                let menu = CreatePopupMenu().unwrap();

                let items: &[(&str, u32)] = &[
                    ("Cut", 1),
                    ("Copy", 2),
                    ("Paste", 3),
                ];
                for &(title, id) in items {
                    let wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
                    let _ = AppendMenuW(menu, MF_STRING, id as usize, PCWSTR(wide.as_ptr()));
                }

                let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());

                {
                    let wide: Vec<u16> =
                        "Select All".encode_utf16().chain(std::iter::once(0)).collect();
                    let _ = AppendMenuW(menu, MF_STRING, 4, PCWSTR(wide.as_ptr()));
                }

                let custom_items = editor.context_menu_items();
                if !custom_items.is_empty() {
                    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
                    for (i, item) in custom_items.iter().enumerate() {
                        let wide: Vec<u16> =
                            item.title.encode_utf16().chain(std::iter::once(0)).collect();
                        let _ = AppendMenuW(
                            menu,
                            MF_STRING,
                            (100 + i) as usize,
                            PCWSTR(wide.as_ptr()),
                        );
                    }
                }

                // Convert client coords to screen coords
                let mut pt = windows::Win32::Foundation::POINT { x, y };
                let _ = windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut pt);

                let cmd = TrackPopupMenu(
                    menu,
                    TPM_RETURNCMD | TPM_LEFTALIGN | TPM_TOPALIGN,
                    pt.x,
                    pt.y,
                    0,
                    hwnd,
                    None,
                );

                let _ = DestroyMenu(menu);

                if cmd.as_bool() {
                    let id = cmd.0 as u32;
                    let action = match id {
                        1 => Some("cut:"),
                        2 => Some("copy:"),
                        3 => Some("paste:"),
                        4 => Some("selectAll:"),
                        id if id >= 100 => {
                            let idx = (id - 100) as usize;
                            let items = editor.context_menu_items();
                            if idx < items.len() {
                                let action_id = items[idx].action_id.clone();
                                editor.on_action(&action_id);
                                None
                            } else {
                                None
                            }
                        }
                        _ => None,
                    };
                    if let Some(sel) = action {
                        editor.on_action(sel);
                    }
                }
            }
            LRESULT(0)
        }

        WM_ERASEBKGND => {
            LRESULT(1)
        }

        WM_SETFOCUS | WM_KILLFOCUS => {
            if let Some(editor) = get_editor(hwnd) {
                editor.invalidate();
            }
            LRESULT(0)
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
