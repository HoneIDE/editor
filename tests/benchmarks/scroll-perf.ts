/**
 * Benchmark: scroll throughput.
 *
 * Measures how many scroll frames per second the editor can process.
 * Target: 60fps min (16.67ms per frame), 120fps on ProMotion.
 *
 * Run: bun run tests/benchmarks/scroll-perf.ts
 */

import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';

// --- Setup: create a 10K-line document ---

const lines: string[] = [];
for (let i = 0; i < 10000; i++) {
  lines.push(`line ${i}: const val = ${i * 3} + ${i * 7}; // some code here for rendering benchmark`);
}
const content = lines.join('\n');

const doc = new EditorDocument('file:///scroll-bench.ts', content, 'typescript');
const vm = new EditorViewModel(doc);
vm.onResize(1200, 800);

const ffi = new NoOpFFI();
const coordinator = new NativeRenderCoordinator(ffi, {
  fontFamily: 'Menlo',
  fontSize: 14,
  lineHeight: 1.5,
});
coordinator.create(1200, 800);
coordinator.attach(vm);

console.log('=== Scroll Throughput Benchmark ===\n');

// --- Benchmark: continuous scroll down ---

function benchScroll(direction: string, deltaY: number, frames: number): { fps: number; avgFrame: number; maxFrame: number } {
  const frameTimes: number[] = [];

  // Reset scroll position
  vm.onScroll({ deltaX: 0, deltaY: -100000 }); // scroll to top
  ffi.reset();

  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    vm.onScroll({ deltaX: 0, deltaY });
    coordinator.render();
    frameTimes.push(performance.now() - start);
  }

  const avgFrame = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes.sort((a, b) => a - b);
  const maxFrame = frameTimes[frameTimes.length - 1];
  const fps = 1000 / avgFrame;

  return { fps, avgFrame, maxFrame };
}

// Smooth scroll (small increments)
const smoothResult = benchScroll('smooth-down', 21, 500); // ~1 line per scroll
console.log(`Smooth scroll (1 line/frame):`);
console.log(`  FPS: ${smoothResult.fps.toFixed(0)} (target: >= 60)`);
console.log(`  avg frame: ${smoothResult.avgFrame.toFixed(3)}ms`);
console.log(`  max frame: ${smoothResult.maxFrame.toFixed(3)}ms`);
console.log(`  ${smoothResult.fps >= 60 ? 'PASS' : 'FAIL'}`);

// Fast scroll (large jumps)
const fastResult = benchScroll('fast-down', 210, 500); // ~10 lines per scroll
console.log(`\nFast scroll (10 lines/frame):`);
console.log(`  FPS: ${fastResult.fps.toFixed(0)} (target: >= 60)`);
console.log(`  avg frame: ${fastResult.avgFrame.toFixed(3)}ms`);
console.log(`  max frame: ${fastResult.maxFrame.toFixed(3)}ms`);
console.log(`  ${fastResult.fps >= 60 ? 'PASS' : 'FAIL'}`);

// Page scroll (very large jumps)
const pageResult = benchScroll('page-down', 800, 200); // ~page per scroll
console.log(`\nPage scroll (full page/frame):`);
console.log(`  FPS: ${pageResult.fps.toFixed(0)} (target: >= 60)`);
console.log(`  avg frame: ${pageResult.avgFrame.toFixed(3)}ms`);
console.log(`  max frame: ${pageResult.maxFrame.toFixed(3)}ms`);
console.log(`  ${pageResult.fps >= 60 ? 'PASS' : 'FAIL'}`);

// --- Benchmark: scroll with dirty tracking effectiveness ---

console.log('\n--- Dirty Tracking Effectiveness ---');

vm.onScroll({ deltaX: 0, deltaY: -100000 });
ffi.reset();

// First render (cold)
coordinator.invalidate();
const coldRenderLines = ffi.getCalls('renderLine').length;

ffi.reset();

// Second render (hot, nothing changed)
coordinator.render();
const hotRenderLines = ffi.getCalls('renderLine').length;

console.log(`  Cold render: ${coldRenderLines} lines`);
console.log(`  Hot render:  ${hotRenderLines} lines (should be 0)`);
console.log(`  Savings: ${((1 - hotRenderLines / Math.max(coldRenderLines, 1)) * 100).toFixed(0)}%`);

coordinator.destroy();
console.log('\nDone.');
