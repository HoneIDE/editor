/**
 * Headless smoke test: extracts the .wasm from Perry's HTML output and
 * instantiates it with stub FFI to verify the module loads cleanly.
 *
 * This catches link errors and basic structural issues without needing
 * a browser. Does NOT test rendering — for that, open dist/index.html.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const html = readFileSync(resolve(HERE, 'dist/editor.html'), 'utf8');

// Extract the base64 WASM payload.
const m = html.match(/__perryWasmB64\s*=\s*"([A-Za-z0-9+/=]+)"/);
if (!m) {
  console.error('FAIL: could not find __perryWasmB64 in editor.html');
  process.exit(1);
}
const b64 = m[1];
const wasmBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
console.log(`WASM payload: ${(wasmBytes.length / 1024).toFixed(1)} KB`);

// Build minimal stub imports. Goal is to instantiate the module, not run it
// — many of the rt/ffi calls would need real impls.
const stubFn = () => 0n;
const stubNs = new Proxy({}, { get: () => stubFn });
const imports = new Proxy({}, { get: () => stubNs });

try {
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const expCount = Object.keys(instance.exports).length;
  console.log(`✓ instantiate OK (${expCount} exports)`);
  // Sanity: confirm a known export is present.
  const hasStart = typeof instance.exports._start === 'function'
                || typeof instance.exports.main === 'function';
  console.log(hasStart ? '✓ entry point present' : '⚠ no _start or main export');
} catch (e: any) {
  console.error('FAIL: WebAssembly.instantiate threw');
  console.error(e.message);
  process.exit(1);
}
