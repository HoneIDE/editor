# hone-editor — web demo

End-to-end demo of the web target. Same TypeScript editor source as every other
platform, compiled to WASM via Perry, rendering through the DOM-based FFI at
`native/web/dom-ffi.ts`.

## Build

```bash
bun run examples/web/build.ts
```

Produces `examples/web/dist/index.html`. Open it directly in a browser:

```bash
open examples/web/dist/index.html
```

## What the build does

1. `perry compile perry/editor-component.ts --target web` → a self-contained
   `editor.html` with the editor TS compiled to embedded base64 WASM and a
   3,800-line JS runtime bridge.
2. `bun build native/web/dom-ffi.ts` → a bundled ESM of the DOM renderer that
   implements every `hone_editor_*` symbol the WASM module needs.
3. Patches `editor.html` so the DOM FFI is assigned to `window.__ffiImports`
   before Perry's `bootPerryWasm()` call runs.

## Architecture

The output is the same shape as on macOS/iOS/Windows/Linux/Android:

- **TS source** (`core/`, `view-model/`, `perry/editor-component.ts`) — single
  source of truth for editor behavior. Compiled by Perry per target.
- **Platform renderer** — implements the `hone_editor_*` FFI contract against
  the platform's native rendering primitive. Rust against Core Text on macOS;
  TypeScript against the DOM on web.

There is no JS reimplementation of editor logic. The editor *is* the WASM
module; the FFI is *only* the rendering surface.
