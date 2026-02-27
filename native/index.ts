/**
 * Native barrel export: re-exports all public APIs from native/.
 */

// FFI Bridge
export {
  type NativeEditorFFI,
  type NativeViewHandle,
  type RenderToken,
  type SelectionRegion,
  type DecorationOverlay,
  CursorStyle,
  NoOpFFI,
} from './ffi-bridge';

// Render Coordinator
export {
  NativeRenderCoordinator,
  type RenderCoordinatorConfig,
} from './render-coordinator';

// Touch Input
export {
  TouchInputHandler,
  type TouchPoint,
  type TouchConfig,
} from './touch-input';

// Word Wrap
export {
  computeWrapPoints,
  WrapCache,
  type WrapPoint,
  type WrappedLine,
  type WrapMode,
  type WrapConfig,
} from './word-wrap';
