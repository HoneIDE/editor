/**
 * Benchmark: keystroke-to-render latency.
 *
 * Measures the time from character insertion to completed render cycle.
 * Target: < 16ms (60fps).
 *
 * Run: bun run tests/benchmarks/keystroke-latency.ts
 */

import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';

function bench(name: string, fn: () => void, iterations: number): { avg: number; min: number; max: number; p99: number } {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < 100; i++) fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const p99 = times[Math.floor(times.length * 0.99)];

  return { avg, min, max, p99 };
}

// --- Setup ---

// Generate a ~1000-line TypeScript file
const lines: string[] = [];
for (let i = 0; i < 1000; i++) {
  lines.push(`  const variable_${i} = ${i} * ${i + 1}; // computation`);
}
const content = `function generated() {\n${lines.join('\n')}\n}\n`;

const doc = new EditorDocument('file:///bench.ts', content, 'typescript');
const vm = new EditorViewModel(doc);
vm.onResize(1200, 800);

// Setup render coordinator with NoOpFFI for measurement
const ffi = new NoOpFFI();
const coordinator = new NativeRenderCoordinator(ffi, {
  fontFamily: 'Menlo',
  fontSize: 14,
  lineHeight: 1.5,
});
coordinator.create(1200, 800);
coordinator.attach(vm);

// --- Benchmark: Single character insert ---

console.log('=== Keystroke-to-Render Latency ===\n');

const insertResult = bench('char-insert', () => {
  vm.onTextInput('x');
}, 1000);

console.log(`Single char insert + render:`);
console.log(`  avg: ${insertResult.avg.toFixed(3)}ms`);
console.log(`  min: ${insertResult.min.toFixed(3)}ms`);
console.log(`  max: ${insertResult.max.toFixed(3)}ms`);
console.log(`  p99: ${insertResult.p99.toFixed(3)}ms`);
console.log(`  ${insertResult.p99 < 16 ? 'PASS' : 'FAIL'} (target: < 16ms p99)`);

// --- Benchmark: Backspace ---

const deleteResult = bench('backspace', () => {
  vm.executeCommand('editor.action.deleteLeft');
}, 1000);

console.log(`\nBackspace + render:`);
console.log(`  avg: ${deleteResult.avg.toFixed(3)}ms`);
console.log(`  min: ${deleteResult.min.toFixed(3)}ms`);
console.log(`  max: ${deleteResult.max.toFixed(3)}ms`);
console.log(`  p99: ${deleteResult.p99.toFixed(3)}ms`);
console.log(`  ${deleteResult.p99 < 16 ? 'PASS' : 'FAIL'} (target: < 16ms p99)`);

// --- Benchmark: Arrow key navigation ---

const navResult = bench('arrow-down', () => {
  vm.executeCommand('editor.action.moveCursorDown');
}, 1000);

console.log(`\nArrow down + render:`);
console.log(`  avg: ${navResult.avg.toFixed(3)}ms`);
console.log(`  min: ${navResult.min.toFixed(3)}ms`);
console.log(`  max: ${navResult.max.toFixed(3)}ms`);
console.log(`  p99: ${navResult.p99.toFixed(3)}ms`);
console.log(`  ${navResult.p99 < 16 ? 'PASS' : 'FAIL'} (target: < 16ms p99)`);

// --- Benchmark: Undo ---

// Do some edits first
for (let i = 0; i < 100; i++) vm.onTextInput('a');

const undoResult = bench('undo', () => {
  vm.executeCommand('editor.action.undo');
}, 100);

console.log(`\nUndo + render:`);
console.log(`  avg: ${undoResult.avg.toFixed(3)}ms`);
console.log(`  min: ${undoResult.min.toFixed(3)}ms`);
console.log(`  max: ${undoResult.max.toFixed(3)}ms`);
console.log(`  p99: ${undoResult.p99.toFixed(3)}ms`);
console.log(`  ${undoResult.p99 < 16 ? 'PASS' : 'FAIL'} (target: < 16ms p99)`);

coordinator.destroy();
console.log('\nDone.');
