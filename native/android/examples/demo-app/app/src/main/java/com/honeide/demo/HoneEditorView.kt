package com.honeide.demo

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import org.json.JSONArray

class HoneEditorView(context: Context) : View(context) {

    private val density = resources.displayMetrics.density

    // Paint sizes are in logical (dp-like) coordinates — canvas.scale handles pixel conversion
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        textSize = 14f
        color = Color.parseColor("#d4d4d4")
    }

    private val gutterPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        textSize = 14f
        color = Color.parseColor("#858585")
        textAlign = Paint.Align.RIGHT
    }

    private val backgroundPaint = Paint().apply {
        color = Color.parseColor("#1e1e1e")
        style = Paint.Style.FILL
    }

    private val cursorPaint = Paint().apply {
        color = Color.parseColor("#eaeaea")
        style = Paint.Style.FILL
    }

    private val selectionPaint = Paint().apply {
        color = Color.parseColor("#264f7a")
        alpha = 102 // ~40%
        style = Paint.Style.FILL
    }

    private var initialized = false
    private var lastTouchY = 0f
    private var cursorVisible = true
    // Logical (density-independent) dimensions
    private var logicalWidth = 0f
    private var logicalHeight = 0f

    private val cursorHandler = Handler(Looper.getMainLooper())
    private val cursorBlink = object : Runnable {
        override fun run() {
            cursorVisible = !cursorVisible
            invalidate()
            cursorHandler.postDelayed(this, 530)
        }
    }

    init {
        isFocusable = true
        isFocusableInTouchMode = true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        // Convert pixel dimensions to logical coordinates matching Rust's coordinate space
        logicalWidth = w / density
        logicalHeight = h / density
        if (!initialized && w > 0 && h > 0) {
            NativeLib.nativeInit(logicalWidth.toDouble(), logicalHeight.toDouble())
            // Measure actual Paint metrics and sync to Rust so positions match
            val actualCharWidth = textPaint.measureText("M").toDouble()
            val fm = textPaint.fontMetrics
            val actualLineHeight = (fm.descent - fm.ascent + fm.leading).toDouble() + 3.0
            NativeLib.nativeSetMetrics(actualCharWidth, actualLineHeight)
            initialized = true
            cursorHandler.postDelayed(cursorBlink, 530)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!initialized) return

        // Scale canvas so Rust's logical coordinates map to physical pixels
        canvas.save()
        canvas.scale(density, density)

        // 1. Background
        canvas.drawRect(0f, 0f, logicalWidth, logicalHeight, backgroundPaint)

        val lineCount = NativeLib.nativeGetLineCount()
        val charWidth = NativeLib.nativeGetCharWidth().toFloat()
        val lineHeight = NativeLib.nativeGetLineHeight().toFloat()
        val gutterWidth = NativeLib.nativeGetGutterWidth().toFloat()
        val scrollY = NativeLib.nativeGetScrollY().toFloat()
        val cursorLine = NativeLib.nativeGetCursorLine()
        val cursorCol = NativeLib.nativeGetCursorCol()
        val ascent = -textPaint.ascent()

        // 2. Gutter background
        canvas.drawRect(0f, 0f, gutterWidth, logicalHeight, backgroundPaint)

        // 3. Determine visible lines
        val firstVisible = (scrollY / lineHeight).toInt().coerceAtLeast(0)
        val visibleCount = (logicalHeight / lineHeight).toInt() + 2
        val lastVisible = (firstVisible + visibleCount).coerceAtMost(lineCount)

        // 4. Draw selection
        val selAnchorJson = NativeLib.nativeGetSelAnchor()
        if (selAnchorJson != "null") {
            try {
                val anchor = JSONArray(selAnchorJson)
                val anchorLine = anchor.getInt(0)
                val anchorCol = anchor.getInt(1)
                val (sl, sc, el, ec) = selectionRange(anchorLine, anchorCol, cursorLine, cursorCol)
                for (lineIdx in sl..el) {
                    if (lineIdx < 0 || lineIdx >= lineCount) continue
                    val lineText = NativeLib.nativeGetLineText(lineIdx)
                    val colStart = if (lineIdx == sl) sc else 0
                    val colEnd = if (lineIdx == el) ec else lineText.length
                    val xStart = gutterWidth + colStart * charWidth
                    val xEnd = gutterWidth + colEnd * charWidth
                    val y = lineIdx * lineHeight - scrollY
                    canvas.drawRect(xStart, y, xEnd, y + lineHeight, selectionPaint)
                }
            } catch (_: Exception) {}
        }

        // 5. Draw lines
        for (i in firstVisible until lastVisible) {
            val lineText = NativeLib.nativeGetLineText(i)
            val tokensJson = NativeLib.nativeGetLineTokens(i)
            val y = i * lineHeight - scrollY

            // Gutter number (right-aligned)
            val lineNum = (i + 1).toString()
            gutterPaint.textAlign = Paint.Align.RIGHT
            canvas.drawText(lineNum, gutterWidth - 20f, y + ascent, gutterPaint)

            // Token-colored text
            try {
                val tokens = JSONArray(tokensJson)
                if (tokens.length() > 0) {
                    for (t in 0 until tokens.length()) {
                        val token = tokens.getJSONObject(t)
                        val s = token.getInt("s")
                        val e = token.getInt("e").coerceAtMost(lineText.length)
                        val colorHex = token.getString("c")
                        if (s >= e || s >= lineText.length) continue
                        textPaint.color = Color.parseColor(colorHex)
                        val tokenText = lineText.substring(s, e)
                        val x = gutterWidth + s * charWidth
                        canvas.drawText(tokenText, x, y + ascent, textPaint)
                    }
                } else {
                    // No tokens — draw as plain text
                    textPaint.color = Color.parseColor("#d4d4d4")
                    canvas.drawText(lineText, gutterWidth, y + ascent, textPaint)
                }
            } catch (_: Exception) {
                textPaint.color = Color.parseColor("#d4d4d4")
                canvas.drawText(lineText, gutterWidth, y + ascent, textPaint)
            }
        }

        // 6. Draw cursor
        if (cursorVisible) {
            val cx = gutterWidth + cursorCol * charWidth
            val cy = cursorLine * lineHeight - scrollY
            canvas.drawRect(cx, cy, cx + 2f, cy + lineHeight, cursorPaint)
        }

        canvas.restore()
    }

    private fun selectionRange(
        al: Int, ac: Int, cl: Int, cc: Int
    ): List<Int> {
        return if (al < cl || (al == cl && ac <= cc)) {
            listOf(al, ac, cl, cc)
        } else {
            listOf(cl, cc, al, ac)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Convert pixel touch coordinates to logical coordinates
        val lx = event.x / density
        val ly = event.y / density
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                lastTouchY = ly
                NativeLib.nativeOnTouchDown(lx.toDouble(), ly.toDouble())
                cursorVisible = true
                invalidate()
                // Show soft keyboard
                requestFocus()
                val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = lastTouchY - ly
                lastTouchY = ly
                NativeLib.nativeOnScroll(0.0, dy.toDouble())
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Catch printable character events that bypass the InputConnection
        if (event.action == KeyEvent.ACTION_DOWN && event.unicodeChar > 0) {
            val ch = event.unicodeChar.toChar().toString()
            NativeLib.nativeOnTextInput(ch)
            cursorVisible = true
            invalidate()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        val action = when (keyCode) {
            KeyEvent.KEYCODE_DEL -> "deleteBackward:"
            KeyEvent.KEYCODE_FORWARD_DEL -> "deleteForward:"
            KeyEvent.KEYCODE_ENTER -> "insertNewline:"
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                if (event.isShiftPressed) "moveLeftAndModifySelection:" else "moveLeft:"
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (event.isShiftPressed) "moveRightAndModifySelection:" else "moveRight:"
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                if (event.isShiftPressed) "moveUpAndModifySelection:" else "moveUp:"
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (event.isShiftPressed) "moveDownAndModifySelection:" else "moveDown:"
            }
            KeyEvent.KEYCODE_MOVE_HOME -> {
                if (event.isShiftPressed) "moveToBeginningOfLineAndModifySelection:"
                else "moveToBeginningOfLine:"
            }
            KeyEvent.KEYCODE_MOVE_END -> {
                if (event.isShiftPressed) "moveToEndOfLineAndModifySelection:"
                else "moveToEndOfLine:"
            }
            KeyEvent.KEYCODE_TAB -> "insertTab:"
            KeyEvent.KEYCODE_ESCAPE -> "cancelOperation:"
            else -> null
        }

        if (action != null) {
            NativeLib.nativeOnAction(action)
            cursorVisible = true
            invalidate()
            return true
        }

        return super.onKeyUp(keyCode, event)
    }

    override fun onCheckIsTextEditor(): Boolean = true

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
        return object : BaseInputConnection(this, true) {
            override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
                text?.toString()?.let {
                    NativeLib.nativeOnTextInput(it)
                    cursorVisible = true
                    invalidate()
                }
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                for (i in 0 until beforeLength) {
                    NativeLib.nativeOnAction("deleteBackward:")
                }
                for (i in 0 until afterLength) {
                    NativeLib.nativeOnAction("deleteForward:")
                }
                cursorVisible = true
                invalidate()
                return true
            }

            override fun sendKeyEvent(event: KeyEvent): Boolean {
                if (event.action == KeyEvent.ACTION_DOWN) {
                    if (event.keyCode == KeyEvent.KEYCODE_DEL) {
                        NativeLib.nativeOnAction("deleteBackward:")
                        cursorVisible = true
                        invalidate()
                        return true
                    }
                    if (event.keyCode == KeyEvent.KEYCODE_ENTER) {
                        NativeLib.nativeOnAction("insertNewline:")
                        cursorVisible = true
                        invalidate()
                        return true
                    }
                }
                return super.sendKeyEvent(event)
            }
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        cursorHandler.removeCallbacks(cursorBlink)
    }
}
