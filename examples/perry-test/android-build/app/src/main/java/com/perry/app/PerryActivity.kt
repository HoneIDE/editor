package com.perry.app

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.FrameLayout

/**
 * Minimal Activity that hosts a Perry-compiled native UI.
 *
 * Lifecycle:
 * 1. onCreate: create root FrameLayout, init PerryBridge, spawn native thread
 * 2. Native thread runs the compiled TypeScript (which creates widgets via JNI)
 * 3. Native thread calls App() which blocks forever
 * 4. onDestroy: signal native thread to unpark and exit
 */
class PerryActivity : Activity() {

    private lateinit var rootLayout: FrameLayout
    private var nativeThread: Thread? = null

    companion object {
        @Volatile var mainStarted = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Switch from splash theme to normal theme before inflating layout
        setTheme(android.R.style.Theme_Material_Light_NoActionBar)

        rootLayout = FrameLayout(this)
        setContentView(rootLayout)

        // Initialize the bridge with this Activity
        PerryBridge.init(this, rootLayout)

        // Load optional native libraries (e.g. hone-editor) before perry_app
        // so their JNI_OnLoad initializes before symbols are resolved
        try { System.loadLibrary("hone_editor_android") } catch (_: UnsatisfiedLinkError) {}

        // Load the native library (the compiled Perry app)
        System.loadLibrary("perry_app")

        // Initialize JNI cache on the UI thread first
        PerryBridge.nativeInit()

        // Spawn native init thread — this runs the compiled TypeScript main().
        // Guard: nativeInit() may already spawn main() internally on some
        // devices (Pixel). Wait briefly, then only call nativeMain if it
        // hasn't started yet (detected by hone_editor_create being called).
        rootLayout.postDelayed({
            if (!mainStarted) {
                mainStarted = true
                nativeThread = Thread {
                    PerryBridge.nativeMain()
                }.apply {
                    name = "perry-native"
                    isDaemon = true
                    start()
                }
            }
        }, 300)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 43) { // LOCATION_PERMISSION_REQUEST
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            PerryBridge.onLocationPermissionResult(granted)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        PerryBridge.nativeShutdown()
    }

}
