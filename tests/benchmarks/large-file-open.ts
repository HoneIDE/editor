/**
 * Benchmark: large file open time.
 *
 * Measures time to construct a TextBuffer, create an EditorViewModel,
 * and compute the first visible frame for a 100K-line file.
 * Target: < 500ms.
 *
 * Run: bun run tests/benchmarks/large-file-open.ts
 */

import { TextBuffer } from '../../core/buffer/text-buffer';
import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';

function generateLargeFile(lineCount: number): string {
  const lines: string[] = [];
  const templates = [
    (i: number) => `  const value_${i} = computeSomething(${i}, ${i * 2});`,
    (i: number) => `  if (value_${i} > threshold) {`,
    (i: number) => `    results.push({ index: ${i}, value: value_${i} });`,
    (i: number) => `  }`,
    (i: number) => `  // Processing item ${i} of ${lineCount}`,
    (i: number) => `  await processItem(value_${i});`,
    (i: number) => `  logger.info(\`Completed step ${i}\`);`,
    (i: number) => ``,
  ];

  lines.push('// Auto-generated large file for benchmarking');
  lines.push(`// ${lineCount} lines`);
  lines.push('');
  lines.push('async function processAll(threshold: number) {');
  lines.push('  const results: any[] = [];');

  for (let i = 0; i < lineCount - 8; i++) {
    lines.push(templates[i % templates.length](i));
  }

  lines.push('  return results;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

console.log('=== Large File Open Benchmark ===\n');

// --- 100K lines ---

const sizes = [10_000, 50_000, 100_000];

for (const lineCount of sizes) {
  console.log(`--- ${(lineCount / 1000).toFixed(0)}K lines ---`);

  // Generate content
  const genStart = performance.now();
  const content = generateLargeFile(lineCount);
  const genTime = performance.now() - genStart;
  const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(0);
  console.log(`  Generated: ${sizeKB}KB in ${genTime.toFixed(0)}ms`);

  // Buffer construction
  const bufStart = performance.now();
  const buf = new TextBuffer(content);
  const bufTime = performance.now() - bufStart;
  console.log(`  TextBuffer: ${bufTime.toFixed(1)}ms (${buf.getLineCount()} lines)`);

  // Document + ViewModel creation
  const vmStart = performance.now();
  const doc = new EditorDocument(`file:///large-${lineCount}.ts`, content, 'typescript');
  const vm = new EditorViewModel(doc);
  vm.onResize(1200, 800);
  const vmTime = performance.now() - vmStart;
  console.log(`  ViewModel: ${vmTime.toFixed(1)}ms`);

  // First frame render
  const renderStart = performance.now();
  const ffi = new NoOpFFI();
  const coord = new NativeRenderCoordinator(ffi, {
    fontFamily: 'Menlo',
    fontSize: 14,
    lineHeight: 1.5,
  });
  coord.create(1200, 800);
  coord.attach(vm);
  const renderTime = performance.now() - renderStart;
  console.log(`  First render: ${renderTime.toFixed(1)}ms (${ffi.getCalls('renderLine').length} lines rendered)`);

  // Total time
  const totalTime = bufTime + vmTime + renderTime;
  const pass = totalTime < 500;
  console.log(`  Total: ${totalTime.toFixed(1)}ms ${pass ? 'PASS' : 'FAIL'} (target: < 500ms)\n`);

  coord.destroy();
}

// --- Memory usage ---

console.log('--- Memory ---');
const memUsage = process.memoryUsage();
console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Heap used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
console.log(`  Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`);

console.log('\nDone.');
