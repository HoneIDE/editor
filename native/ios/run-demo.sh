#!/bin/bash
# Build, bundle, and launch the Hone Editor iOS demo in the Simulator.
#
# Usage: cd native/ios && bash run-demo.sh

set -euo pipefail

EXAMPLE_NAME="demo_editor_ios"
BUNDLE_ID="com.honeide.demo-editor"
APP_NAME="DemoEditor"
TARGET="aarch64-apple-ios-sim"

echo "==> Building $EXAMPLE_NAME for $TARGET ..."
cargo build --example "$EXAMPLE_NAME" --target "$TARGET"

# Create minimal .app bundle
APP_DIR="target/${APP_NAME}.app"
mkdir -p "$APP_DIR"
cp "target/${TARGET}/debug/examples/${EXAMPLE_NAME}" "${APP_DIR}/${APP_NAME}"

# Write Info.plist
cat > "${APP_DIR}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
  <key>UILaunchStoryboardName</key>
  <string></string>
</dict>
</plist>
PLIST

echo "==> Booting iOS Simulator ..."
# Use IOS_SIMULATOR env var, or fall back to first available iPhone simulator
if [ -n "${IOS_SIMULATOR:-}" ]; then
  SIM_NAME="$IOS_SIMULATOR"
else
  SIM_NAME=$(xcrun simctl list devices available | grep "iPhone" | head -1 | sed 's/^ *//' | sed 's/ (.*//') || true
  if [ -z "$SIM_NAME" ]; then
    echo "Error: No available iPhone simulator found. Set IOS_SIMULATOR env var." >&2
    exit 1
  fi
fi
echo "    Using simulator: $SIM_NAME"
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
open -a Simulator

echo "==> Installing ${APP_DIR} ..."
xcrun simctl install booted "$APP_DIR"

echo "==> Launching ${BUNDLE_ID} ..."
xcrun simctl launch booted "$BUNDLE_ID"

echo "==> Done! The editor should now be visible in the Simulator."
