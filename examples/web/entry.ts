/**
 * Web demo entry point. Compiled by Perry → WASM.
 *
 * Reads its construction options from JS via the FFI imports defined in
 * native/web/dom-ffi.ts (hone_get_init_*). This lets the consumer pass options
 * at runtime through mount(el, opts) without recompiling the WASM module.
 *
 * The DOM-side FFI (native/web/dom-ffi.ts) handles platform rendering and
 * mounts the editor surface into the element passed to mount().
 */

import { Editor } from '../../perry/editor-component';
import { KeywordSyntaxEngine } from '../../core/tokenizer/keyword-syntax-engine';
import { CompositeEngine } from '../../core/tokenizer/composite-engine';

// Init opts pulled from the JS host at boot. dom-ffi.ts provides these as FFI
// imports; their defaults live there too, so we don't need to repeat them here.
declare function hone_get_init_content(): string;
declare function hone_get_init_language(): string;
declare function hone_get_init_theme(): string;
declare function hone_get_init_font_size(): number;
declare function hone_get_init_font_family(): string;
declare function hone_get_init_width(): number;
declare function hone_get_init_height(): number;
declare function hone_get_init_read_only(): number;
declare function hone_get_init_use_tree_sitter(): number;

const width = hone_get_init_width();
const height = hone_get_init_height();
const themeName = hone_get_init_theme();
const useTreeSitter = hone_get_init_use_tree_sitter() === 1;

// CompositeEngine routes per-language to TreeSitterEngine (which calls our
// hone_editor_ts_* FFI implementations from native/web/tree-sitter-bridge.ts)
// or falls back to KeywordSyntaxEngine. When tree-sitter init wasn't requested
// in mount(), use KeywordSyntaxEngine directly so the FFI calls aren't made.
const engine = useTreeSitter ? new CompositeEngine() : new KeywordSyntaxEngine();

// The JS-side controller drives overlays directly through the dom-ffi
// functions using the handle captured during hone_editor_create — no need to
// expose the Editor instance across the WASM↔JS boundary.
new Editor(width, height, {
  content: hone_get_init_content(),
  language: hone_get_init_language(),
  theme: themeName === 'light' ? 'light' : 'dark',
  fontSize: hone_get_init_font_size(),
  fontFamily: hone_get_init_font_family(),
  readOnly: hone_get_init_read_only() === 1,
  syntaxEngine: engine,
});
