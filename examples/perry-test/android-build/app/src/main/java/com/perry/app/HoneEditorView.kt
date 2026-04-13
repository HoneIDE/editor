package com.perry.app

import android.content.Context
import android.graphics.Canvas
import android.text.InputType
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager

/**
 * Custom View for Hone Editor rendering.
 * Drawing is delegated to Rust via JNI (hone-editor-android crate).
 * Rust's draw_editor() uses Canvas/Paint to render lines, tokens, cursor, etc.
 *
 * Touch events, IME text input, and key actions are forwarded to Rust where
 * they are queued in pending_events for TypeScript's setInterval polling loop.
 */
class HoneEditorView(context: Context) : View(context) {

    /** Rust EditorView pointer — set by native code after creation. */
    @JvmField var nativeHandle: Long = 0L

    /** Track previous touch Y for scroll delta computation. */
    private var prevTouchY: Float = 0f
    private var prevTouchX: Float = 0f
    private var touchPointerId: Int = -1
    private var isDragging: Boolean = false

    init {
        isFocusable = true
        isFocusableInTouchMode = true
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(
            if (w > 0) w else 1080,
            if (h > 0) h else 1920
        )
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (nativeHandle != 0L) {
            nativeDrawEditor(nativeHandle, canvas)
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (nativeHandle != 0L) {
            nativeOnSizeChanged(nativeHandle, w.toFloat(), h.toFloat())
            postInvalidate()
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (nativeHandle == 0L) return super.onTouchEvent(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchPointerId = event.getPointerId(0)
                prevTouchX = event.x
                prevTouchY = event.y
                isDragging = false

                // Request focus and show soft keyboard
                requestFocus()
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                // Single-finger drag: scroll the editor
                val dy = event.y - prevTouchY
                val dx = event.x - prevTouchX
                if (!isDragging && (dx * dx + dy * dy) > 64) { // 8px threshold
                    isDragging = true
                }
                if (isDragging) {
                    // Finger up = content scrolls up (standard mobile scrolling)
                    // Scale by 0.5 to match expected scroll feel on touch screens
                    nativeOnScroll(nativeHandle, 0f, dy * 0.5f)
                }
                prevTouchX = event.x
                prevTouchY = event.y
                return true
            }

            MotionEvent.ACTION_UP -> {
                if (!isDragging) {
                    // Short tap without drag — position cursor
                    nativeOnTouchDown(nativeHandle, event.x, event.y)
                }
                isDragging = false
                touchPointerId = -1
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                isDragging = false
                touchPointerId = -1
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onCheckIsTextEditor(): Boolean = true

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN or
                EditorInfo.IME_ACTION_NONE
        return object : BaseInputConnection(this, true) {
            override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
                if (nativeHandle != 0L && text != null && text.isNotEmpty()) {
                    val str = text.toString()
                    if (str == "\n") {
                        nativeOnAction(nativeHandle, "insertNewline")
                    } else {
                        nativeOnTextInput(nativeHandle, str)
                    }
                }
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                if (nativeHandle != 0L) {
                    for (i in 0 until beforeLength) {
                        nativeOnAction(nativeHandle, "deleteBackward")
                    }
                    for (i in 0 until afterLength) {
                        nativeOnAction(nativeHandle, "deleteForward")
                    }
                }
                return true
            }

            override fun sendKeyEvent(event: KeyEvent): Boolean {
                if (nativeHandle != 0L && event.action == KeyEvent.ACTION_DOWN) {
                    val action = when (event.keyCode) {
                        KeyEvent.KEYCODE_DEL -> "deleteBackward"
                        KeyEvent.KEYCODE_FORWARD_DEL -> "deleteForward"
                        KeyEvent.KEYCODE_ENTER -> "insertNewline"
                        KeyEvent.KEYCODE_TAB -> "insertTab"
                        KeyEvent.KEYCODE_DPAD_LEFT -> {
                            if (event.isShiftPressed) "moveLeftAndModifySelection"
                            else if (event.isAltPressed) "moveWordLeft"
                            else "moveLeft"
                        }
                        KeyEvent.KEYCODE_DPAD_RIGHT -> {
                            if (event.isShiftPressed) "moveRightAndModifySelection"
                            else if (event.isAltPressed) "moveWordRight"
                            else "moveRight"
                        }
                        KeyEvent.KEYCODE_DPAD_UP -> {
                            if (event.isShiftPressed) "moveUpAndModifySelection"
                            else "moveUp"
                        }
                        KeyEvent.KEYCODE_DPAD_DOWN -> {
                            if (event.isShiftPressed) "moveDownAndModifySelection"
                            else "moveDown"
                        }
                        KeyEvent.KEYCODE_MOVE_HOME -> {
                            if (event.isCtrlPressed) "moveToBeginningOfDocument"
                            else if (event.isShiftPressed) "moveToBeginningOfLineAndModifySelection"
                            else "moveToBeginningOfLine"
                        }
                        KeyEvent.KEYCODE_MOVE_END -> {
                            if (event.isCtrlPressed) "moveToEndOfDocument"
                            else if (event.isShiftPressed) "moveToEndOfLineAndModifySelection"
                            else "moveToEndOfLine"
                        }
                        KeyEvent.KEYCODE_PAGE_UP -> "pageUp"
                        KeyEvent.KEYCODE_PAGE_DOWN -> "pageDown"
                        KeyEvent.KEYCODE_A -> if (event.isCtrlPressed) "selectAll" else null
                        KeyEvent.KEYCODE_C -> if (event.isCtrlPressed) "copy" else null
                        KeyEvent.KEYCODE_X -> if (event.isCtrlPressed) "cut" else null
                        KeyEvent.KEYCODE_V -> if (event.isCtrlPressed) "paste" else null
                        KeyEvent.KEYCODE_Z -> {
                            if (event.isCtrlPressed) {
                                if (event.isShiftPressed) "redo" else "undo"
                            } else null
                        }
                        else -> null
                    }
                    if (action != null) {
                        nativeOnAction(nativeHandle, action)
                        return true
                    }
                }
                return super.sendKeyEvent(event)
            }
        }
    }

    // Handle hardware keyboard events that bypass InputConnection
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (nativeHandle != 0L) {
            // Let the InputConnection handle most keys, but catch printable characters
            // from hardware keyboards that may not go through commitText
            val unicodeChar = event.unicodeChar
            if (unicodeChar != 0 && !event.isCtrlPressed && !event.isAltPressed) {
                val ch = unicodeChar.toChar()
                if (ch == '\n') {
                    nativeOnAction(nativeHandle, "insertNewline")
                } else if (!ch.isISOControl() || ch == '\t') {
                    nativeOnTextInput(nativeHandle, ch.toString())
                }
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    // JNI native methods — implemented in libhone_editor_android.so
    private external fun nativeDrawEditor(handle: Long, canvas: Canvas)
    private external fun nativeOnSizeChanged(handle: Long, widthPx: Float, heightPx: Float)
    private external fun nativeOnTouchDown(handle: Long, x: Float, y: Float)
    private external fun nativeOnTouchMove(handle: Long, x: Float, y: Float)
    private external fun nativeOnScroll(handle: Long, dx: Float, dy: Float)
    private external fun nativeOnTextInput(handle: Long, text: String)
    private external fun nativeOnAction(handle: Long, action: String)
}
