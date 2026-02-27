/**
 * Perry compiler configuration for hone-editor.
 *
 * Perry compiles TypeScript to native binaries for all 6 platforms.
 * Each platform links against its corresponding Rust FFI crate for
 * native text rendering.
 *
 * Build commands:
 *   perry compile src/index.ts --target macos   --bundle-ffi native/macos/
 *   perry compile src/index.ts --target windows  --bundle-ffi native/windows/
 *   perry compile src/index.ts --target linux    --bundle-ffi native/linux/
 *   perry compile src/index.ts --target ios      --bundle-ffi native/ios/
 *   perry compile src/index.ts --target android  --bundle-ffi native/android/
 *   perry compile src/index.ts --target web      --bundle-ffi native/web/
 */

export default {
  /** Package name for Perry registry. */
  name: '@honeide/editor',

  /** Package version. */
  version: '0.2.0',

  /** Entry point. */
  entry: 'core/index.ts',

  /** Perry compiler version pin. */
  perry: '0.2.162',

  /** Build targets with platform-specific FFI crate paths. */
  targets: {
    macos: {
      ffi: 'native/macos/',
      arch: ['arm64', 'x86_64'],
      minOs: '13.0',
      frameworks: ['CoreText', 'CoreGraphics', 'CoreFoundation', 'Metal', 'QuartzCore'],
    },
    ios: {
      ffi: 'native/ios/',
      arch: ['arm64'],
      minOs: '16.0',
      frameworks: ['CoreText', 'CoreGraphics', 'CoreFoundation', 'UIKit'],
    },
    windows: {
      ffi: 'native/windows/',
      arch: ['x86_64', 'aarch64'],
      minOs: '10.0.17763', // Windows 10 1809+
      libs: ['dwrite', 'd2d1', 'dcomp'],
    },
    linux: {
      ffi: 'native/linux/',
      arch: ['x86_64', 'aarch64'],
      pkgConfig: ['pango', 'pangocairo', 'cairo'],
    },
    android: {
      ffi: 'native/android/',
      arch: ['arm64-v8a', 'armeabi-v7a', 'x86_64'],
      minSdk: 26,
      ndk: '26.1.10909125',
    },
    web: {
      ffi: 'native/web/',
      wasmTarget: 'wasm32-unknown-unknown',
      wasmBindgen: true,
      optimizeSize: true,
    },
  },

  /** Shared compiler options. */
  compiler: {
    /** Strip debug info in release builds. */
    stripDebug: true,
    /** Enable link-time optimization for Rust crates. */
    lto: true,
    /** Rust edition for all FFI crates. */
    rustEdition: '2021',
  },

  /** Development settings. */
  dev: {
    /** Default development target. */
    defaultTarget: 'macos',
    /** Hot reload on file save. */
    hotReload: true,
    /** Verbose FFI logging in debug builds. */
    ffiDebugLog: false,
  },
};
