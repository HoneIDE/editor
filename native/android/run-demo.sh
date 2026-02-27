#!/bin/bash
# Build Rust .so for Android, then build + install Kotlin app on emulator.
#
# Prerequisites:
#   - Android SDK + NDK installed (ANDROID_HOME / ANDROID_NDK_HOME set)
#   - cargo-ndk installed: cargo install cargo-ndk
#   - Android emulator AVD created (any x86_64 API 26+ device)
#
# Usage: cd native/android && bash run-demo.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

DEMO_APP_DIR="examples/demo-app"
JNI_LIBS_DIR="$DEMO_APP_DIR/app/src/main/jniLibs"

# ── Step 1: Cross-compile Rust for Android ───────────────────────

echo "==> Building Rust library for Android x86_64 (emulator)..."
cargo ndk -t x86_64 -o "$JNI_LIBS_DIR" build

echo "==> Building Rust library for Android arm64-v8a..."
cargo ndk -t arm64-v8a -o "$JNI_LIBS_DIR" build

echo "==> Rust .so files:"
find "$JNI_LIBS_DIR" -name "*.so" -exec ls -la {} \;

# ── Step 2: Build the Kotlin app ─────────────────────────────────

echo "==> Building Android APK..."
cd "$DEMO_APP_DIR"

# Use local gradlew if available, otherwise fall back to system gradle
if [ -f "./gradlew" ]; then
    chmod +x ./gradlew
    ./gradlew assembleDebug
else
    echo "    (No gradlew found, generating wrapper...)"
    gradle wrapper --gradle-version 8.4
    chmod +x ./gradlew
    ./gradlew assembleDebug
fi

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_PATH" ]; then
    echo "ERROR: APK not found at $APK_PATH"
    exit 1
fi
echo "==> APK built: $APK_PATH"

cd "$SCRIPT_DIR"

# ── Step 3: Find / boot emulator ─────────────────────────────────

echo "==> Checking for running emulator..."
if adb devices | grep -q "emulator"; then
    echo "    Emulator already running."
else
    EMULATOR=$(emulator -list-avds | head -1)
    if [ -z "$EMULATOR" ]; then
        echo "ERROR: No Android emulator AVDs found."
        echo "Create one with: avdmanager create avd -n demo -k 'system-images;android-34;google_apis;x86_64'"
        exit 1
    fi
    echo "==> Starting emulator: $EMULATOR"
    emulator -avd "$EMULATOR" -no-snapshot-save &
    echo "    Waiting for device..."
    adb wait-for-device
    # Wait for boot completion
    adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
    echo "    Emulator booted."
fi

# ── Step 4: Install and launch ────────────────────────────────────

echo "==> Installing APK..."
adb install -r "$DEMO_APP_DIR/$APK_PATH"

echo "==> Launching Hone Editor Demo..."
adb shell am start -n com.honeide.demo/.MainActivity

echo ""
echo "==> Done! The Hone Editor demo should now be running in the emulator."
echo "    - Tap to position cursor"
echo "    - Type with the soft keyboard"
echo "    - Drag to scroll"
