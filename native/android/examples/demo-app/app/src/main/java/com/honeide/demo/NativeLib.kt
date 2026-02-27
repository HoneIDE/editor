package com.honeide.demo

object NativeLib {
    init {
        System.loadLibrary("hone_editor_android")
    }

    external fun nativeInit(width: Double, height: Double)
    external fun nativeSetMetrics(charWidth: Double, lineHeight: Double)
    external fun nativeDestroy()
    external fun nativeGetLineCount(): Int
    external fun nativeGetLineText(lineIndex: Int): String
    external fun nativeGetLineTokens(lineIndex: Int): String
    external fun nativeGetCursorLine(): Int
    external fun nativeGetCursorCol(): Int
    external fun nativeGetSelAnchor(): String
    external fun nativeGetScrollY(): Double
    external fun nativeGetCharWidth(): Double
    external fun nativeGetLineHeight(): Double
    external fun nativeGetGutterWidth(): Double
    external fun nativeOnTextInput(text: String)
    external fun nativeOnAction(action: String)
    external fun nativeOnTouchDown(x: Double, y: Double)
    external fun nativeOnScroll(dx: Double, dy: Double)
    external fun nativeRender()
}
