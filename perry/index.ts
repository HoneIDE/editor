/**
 * Perry component API for @honeide/editor.
 *
 * Import this from Perry apps:
 *   import { Editor } from '@honeide/editor/perry';
 */

export { Editor, type EditorOptions, editorSetBgColor, editorSetFgColor, editorSetGutterFgColor, editorSetSelectionColor, editorSetCursorColor } from './editor-component';
export { HoneCodeEditorWidget } from './widget';
export { type NativeEditorFFI, NoOpFFI } from '../native/ffi-bridge';
