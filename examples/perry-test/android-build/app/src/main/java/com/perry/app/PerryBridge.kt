package com.perry.app

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.View
import android.widget.*
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.CountDownLatch

/**
 * Java-side JNI bridge for Perry UI.
 *
 * Provides:
 * - Activity/Context access for widget creation
 * - Callback wiring (OnClickListener, TextWatcher, etc.)
 * - Clipboard, file dialog, dp conversion
 * - runOnUiThreadBlocking for synchronous UI operations from native
 */
object PerryBridge {

    private lateinit var activity: Activity
    private lateinit var rootLayout: FrameLayout
    private val uiHandler = Handler(Looper.getMainLooper())

    // File dialog callback tracking
    private var pendingFileDialogKey: Long = 0
    private const val FILE_PICK_REQUEST = 42

    // Location callback tracking
    private var pendingLocationCallbackKey: Long = 0
    private const val LOCATION_PERMISSION_REQUEST = 43

    fun init(activity: Activity, rootLayout: FrameLayout) {
        this.activity = activity
        this.rootLayout = rootLayout
    }

    // --- Activity access ---

    @JvmStatic
    fun getActivity(): Activity = activity

    // --- Content view ---

    @JvmStatic
    fun setContentView(view: View) {
        uiHandler.post {
            rootLayout.removeAllViews()
            rootLayout.addView(view, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
        }
    }

    // --- UI thread synchronization ---

    /**
     * Run a Runnable on the UI thread and block until it completes.
     * If already on the UI thread, run immediately.
     */
    @JvmStatic
    fun runOnUiThreadBlocking(callbackKey: Long) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            nativeInvokeCallback0(callbackKey)
        } else {
            val latch = CountDownLatch(1)
            uiHandler.post {
                nativeInvokeCallback0(callbackKey)
                latch.countDown()
            }
            latch.await()
        }
    }

    // --- dp conversion ---

    @JvmStatic
    fun dpToPx(dp: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp,
            activity.resources.displayMetrics
        ).toInt()
    }

    // --- Button click callback ---

    @JvmStatic
    fun setOnClickCallback(view: View, callbackKey: Long) {
        view.setOnClickListener {
            nativeInvokeCallback0(callbackKey)
        }
    }

    // --- Click callback with argument (e.g. tab index) ---

    @JvmStatic
    fun setOnClickCallbackWithArg(view: View, callbackKey: Long, arg: Double) {
        view.setOnClickListener {
            nativeInvokeCallback1(callbackKey, arg)
        }
    }

    // --- Button styling ---

    @JvmStatic
    fun setButtonBorderless(view: View, bordered: Boolean) {
        if (view is Button) {
            if (!bordered) {
                // Set borderless style
                val attrs = intArrayOf(android.R.attr.selectableItemBackground)
                val ta = activity.obtainStyledAttributes(attrs)
                val bg = ta.getDrawable(0)
                ta.recycle()
                view.background = bg
            }
        }
    }

    // --- LinearLayout spacing ---

    /**
     * LinearLayout doesn't have a built-in spacing property.
     * We use showDividers with a transparent space divider.
     */
    @JvmStatic
    fun setLinearLayoutSpacing(layout: LinearLayout, spacingPx: Int) {
        if (spacingPx > 0) {
            // Use divider with padding to simulate spacing
            layout.showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
            val divider = android.graphics.drawable.ShapeDrawable()
            divider.intrinsicWidth = spacingPx
            divider.intrinsicHeight = spacingPx
            divider.paint.color = android.graphics.Color.TRANSPARENT
            layout.dividerDrawable = divider
        }
    }

    // --- EditText text changed callback ---

    @JvmStatic
    fun setTextChangedCallback(editText: EditText, callbackKey: Long) {
        editText.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val text = s?.toString() ?: ""
                nativeInvokeCallback1WithString(callbackKey, text)
            }
        })
    }

    // --- Switch/Toggle callback ---

    @JvmStatic
    fun setOnCheckedChangeCallback(button: CompoundButton, callbackKey: Long) {
        button.setOnCheckedChangeListener { _, isChecked ->
            // NaN-boxed TAG_TRUE = 0x7FFC_0000_0000_0004, TAG_FALSE = 0x7FFC_0000_0000_0003
            val value = if (isChecked) {
                java.lang.Double.longBitsToDouble(0x7FFC_0000_0000_0004L)
            } else {
                java.lang.Double.longBitsToDouble(0x7FFC_0000_0000_0003L)
            }
            nativeInvokeCallback1(callbackKey, value)
        }
    }

    // --- SeekBar callback ---

    @JvmStatic
    fun setSeekBarCallback(seekBar: SeekBar, callbackKey: Long, min: Double, max: Double) {
        // Store min in tag for setSeekBarValue
        seekBar.tag = doubleArrayOf(min, max)
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    // Convert integer progress back to float value
                    val value = min + (progress.toDouble() / 100.0)
                    nativeInvokeCallback1(callbackKey, value)
                }
            }
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) {}
        })
    }

    @JvmStatic
    fun setSeekBarValue(seekBar: SeekBar, value: Double) {
        val range = seekBar.tag as? DoubleArray ?: return
        val min = range[0]
        val progress = ((value - min) * 100.0).toInt()
        seekBar.progress = progress
    }

    // --- Context menu ---

    @JvmStatic
    fun setContextMenu(view: View, menuHandle: Long) {
        view.setOnLongClickListener {
            val popup = PopupMenu(activity, view)
            val itemCount = nativeGetMenuItemCount(menuHandle)
            for (i in 0 until itemCount) {
                val title = nativeGetMenuItemTitle(menuHandle, i)
                popup.menu.add(0, i, i, title)
            }
            popup.setOnMenuItemClickListener { item ->
                nativeMenuItemSelected(menuHandle, item.itemId)
                true
            }
            popup.show()
            true
        }
    }

    // --- Clipboard ---

    @JvmStatic
    fun clipboardRead(): String? {
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        return clip.getItemAt(0).text?.toString()
    }

    @JvmStatic
    fun clipboardWrite(text: String) {
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("perry", text)
        cm.setPrimaryClip(clip)
    }

    // --- File dialog ---

    @JvmStatic
    fun openFileDialog(callbackKey: Long) {
        pendingFileDialogKey = callbackKey
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        activity.startActivityForResult(intent, FILE_PICK_REQUEST)
    }

    /**
     * Called from PerryActivity.onActivityResult when a file is picked.
     */
    fun onFileDialogResult(resultCode: Int, data: Intent?) {
        if (resultCode == Activity.RESULT_OK && data?.data != null) {
            val uri: Uri = data.data!!
            try {
                val content = activity.contentResolver.openInputStream(uri)?.use { stream ->
                    BufferedReader(InputStreamReader(stream)).readText()
                }
                nativeFileDialogResult(pendingFileDialogKey, content)
            } catch (e: Exception) {
                nativeFileDialogResult(pendingFileDialogKey, null)
            }
        } else {
            nativeFileDialogResult(pendingFileDialogKey, null)
        }
    }

    /**
     * Helper: invoke a callback with a string argument.
     * Converts the string to a NaN-boxed Perry string via JNI.
     */
    private fun nativeInvokeCallback1WithString(key: Long, text: String) {
        // This calls back into native code which will:
        // 1. Convert the Java string to a Perry runtime string
        // 2. NaN-box it
        // 3. Invoke the closure with the NaN-boxed string
        nativeInvokeCallbackWithString(key, text)
    }

    // --- Location ---

    @JvmStatic
    fun requestLocation(callbackKey: Long) {
        pendingLocationCallbackKey = callbackKey
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED) {
            fetchLastLocation(callbackKey)
        } else {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                LOCATION_PERMISSION_REQUEST
            )
        }
    }

    private fun fetchLastLocation(callbackKey: Long) {
        try {
            val lm = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            @Suppress("MissingPermission")
            val loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (loc != null) {
                nativeInvokeCallback2(callbackKey, loc.latitude, loc.longitude)
            } else {
                // No cached location — request a single update
                @Suppress("MissingPermission")
                lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER,
                    object : android.location.LocationListener {
                        override fun onLocationChanged(location: android.location.Location) {
                            nativeInvokeCallback2(callbackKey, location.latitude, location.longitude)
                        }
                        @Deprecated("Deprecated in Java")
                        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {
                            // NaN signals failure
                            nativeInvokeCallback2(callbackKey, Double.NaN, Double.NaN)
                        }
                    },
                    Looper.getMainLooper()
                )
            }
        } catch (e: Exception) {
            nativeInvokeCallback2(callbackKey, Double.NaN, Double.NaN)
        }
    }

    fun onLocationPermissionResult(granted: Boolean) {
        if (granted) {
            fetchLastLocation(pendingLocationCallbackKey)
        } else {
            nativeInvokeCallback2(pendingLocationCallbackKey, Double.NaN, Double.NaN)
        }
    }

    // --- Timer ---

    @JvmStatic
    fun setTimer(callbackKey: Long, intervalMs: Long) {
        val runnable = object : Runnable {
            override fun run() {
                nativeInvokeCallback0(callbackKey)
                uiHandler.postDelayed(this, intervalMs)
            }
        }
        uiHandler.postDelayed(runnable, intervalMs)
    }

    // --- Timer pump (equivalent to iOS PerryPumpTarget 8ms NSTimer) ---

    /**
     * Start the runtime pump timer that drives setInterval/setTimeout/Promise
     * callbacks. Fires every [intervalMs] milliseconds and calls nativePumpTick().
     * Without this, the Perry runtime timers never fire on Android.
     */
    @JvmStatic
    fun startPumpTimer(intervalMs: Long) {
        val pumpRunnable = object : Runnable {
            override fun run() {
                nativePumpTick()
                uiHandler.postDelayed(this, intervalMs)
            }
        }
        uiHandler.postDelayed(pumpRunnable, intervalMs)
    }

    // --- EditText submit callback (Enter/Done key) ---

    @JvmStatic
    fun setOnSubmitCallback(editText: EditText, callbackKey: Long) {
        editText.setOnEditorActionListener { _, actionId, _ ->
            // IME_ACTION_DONE=6, IME_ACTION_GO=2, IME_ACTION_SEND=4, IME_ACTION_SEARCH=3
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) {
                nativeInvokeCallback0(callbackKey)
                true
            } else {
                false
            }
        }
    }

    // --- Native methods ---

    @JvmStatic
    external fun nativeInit()

    @JvmStatic
    external fun nativeMain()

    @JvmStatic
    external fun nativeShutdown()

    @JvmStatic
    external fun nativePumpTick()

    @JvmStatic
    external fun nativeInvokeCallback0(key: Long)

    @JvmStatic
    external fun nativeInvokeCallback1(key: Long, arg: Double)

    @JvmStatic
    external fun nativeInvokeCallback2(key: Long, arg1: Double, arg2: Double)

    @JvmStatic
    external fun nativeInvokeCallbackWithString(key: Long, text: String)

    @JvmStatic
    external fun nativeFileDialogResult(key: Long, content: String?)

    @JvmStatic
    external fun nativeGetMenuItemCount(menuHandle: Long): Int

    @JvmStatic
    external fun nativeGetMenuItemTitle(menuHandle: Long, index: Int): String

    @JvmStatic
    external fun nativeMenuItemSelected(menuHandle: Long, index: Int)
}
