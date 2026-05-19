# Building the native crates after `npm install @honeide/editor`

The npm tarball ships the Rust source for every native rendering crate
(`native/macos/`, `native/ios/`, `native/windows/`, `native/linux/`,
`native/android/`) so consumers can build them as part of their Perry-AOT
pipeline. To make those builds resolve, two prerequisites must be in place
locally — both are Perry-side constraints we hope to remove once Perry ships
the missing pieces.

## 1. `perry-ffi` must be resolvable to Cargo

The crates' `Cargo.toml` files declare:

```toml
perry-ffi = { path = "../../../../perry/perry/crates/perry-ffi" }
```

That relative path resolves in a **sibling-checkout layout**:

```
~/code/
├── hone/hone-editor/     ← your fork / clone
└── perry/perry/          ← Perry monorepo checkout
```

After `npm install @honeide/editor`, the editor lands at
`node_modules/@honeide/editor/`, so the `../../../../perry/...` path no longer
points anywhere useful. You'll see:

```
error: no matching package found for `perry-ffi`
```

**Workaround until [PerryTS/perry#1112](https://github.com/PerryTS/perry/issues/1112) lands** (publishing `perry-ffi` to crates.io):

Add a `[patch.crates-io]` to **your workspace's root** `Cargo.toml` pointing
at a local Perry checkout:

```toml
[patch.crates-io]
perry-ffi = { path = "/absolute/path/to/perry-checkout/crates/perry-ffi" }
```

Or, if you're a Perry user, add a workspace `Cargo.toml` at your project root
that includes the editor's native crate as a member and uses the same `[patch]`.

Once Perry publishes `perry-ffi` to crates.io, we'll switch this dep to a
version-based requirement (`perry-ffi = "0.5"`) and this workaround goes away.

## 2. Building the demos requires the `examples/` directory

Each native crate ships its `examples/` folder in the npm tarball as of
`@honeide/editor@0.3.1+`. You can run them with:

```bash
cd node_modules/@honeide/editor/native/macos
cargo run --example demo_editor
```

(Older `@honeide/editor@0.3.0` was missing `examples/` in the tarball even
though `Cargo.toml` declared `[[example]]` blocks — that gap is fixed in
0.3.1.)

## Web doesn't need any of this

The web target compiles the editor TS itself to WASM via Perry. The
"renderer" on web is plain TypeScript (`native/web/dom-ffi.ts`) — no Rust
crate, no `perry-ffi`, no Cargo. See [`../examples/web/`](../examples/web/)
for the build pipeline.
