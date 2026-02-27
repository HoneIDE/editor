/**
 * Side-by-side diff viewer example.
 *
 * Demonstrates:
 * - Myers diff algorithm for line-level diffing
 * - Inline character-level diffs within changed lines
 * - Hunk navigation (next/prev hunk)
 * - Side-by-side rendering with aligned line numbers
 *
 * To run with Perry:
 *   perry compile examples/diff-viewer/main.ts --target macos --bundle-ffi native/macos/
 */

import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { computeDiff, computeLineDiff } from '../../core/diff/diff-compute';
import { computeInlineDiff } from '../../core/diff/inline-diff';
import { mergeAdjacentHunks, navigateHunks } from '../../core/diff/hunk';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';

// --- Sample files to diff ---

const originalCode = `import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}

export default Counter;
`;

const modifiedCode = `import { useState, useCallback } from 'react';

function Counter({ initialValue = 0 }) {
  const [count, setCount] = useState(initialValue);

  const increment = useCallback(() => {
    setCount(prev => prev + 1);
  }, []);

  const decrement = useCallback(() => {
    setCount(prev => prev - 1);
  }, []);

  return (
    <div className="counter">
      <h1>Count: {count}</h1>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  );
}

export default Counter;
`;

// --- Compute diff ---

const diff = computeDiff(originalCode, modifiedCode);
const mergedHunks = mergeAdjacentHunks(diff.hunks, 3);

console.log('=== Diff Viewer Example ===\n');
console.log(`Original: ${originalCode.split('\n').length} lines`);
console.log(`Modified: ${modifiedCode.split('\n').length} lines`);
console.log(`Hunks: ${diff.hunks.length} (${mergedHunks.length} after merging adjacent)\n`);

// --- Display hunks ---

for (const hunk of diff.hunks) {
  const typeSymbol = hunk.type === 'add' ? '+' : hunk.type === 'delete' ? '-' : '~';
  const lines = hunk.type === 'delete'
    ? originalCode.split('\n').slice(hunk.oldStart, hunk.oldStart + hunk.oldCount)
    : modifiedCode.split('\n').slice(hunk.newStart, hunk.newStart + hunk.newCount);

  for (const line of lines) {
    console.log(`${typeSymbol} ${line}`);
  }
}

// --- Inline diff for modified lines ---

console.log('\n=== Inline Diffs ===\n');

for (const hunk of diff.hunks) {
  if (hunk.type === 'modify') {
    const oldLines = originalCode.split('\n').slice(hunk.oldStart, hunk.oldStart + hunk.oldCount);
    const newLines = modifiedCode.split('\n').slice(hunk.newStart, hunk.newStart + hunk.newCount);

    for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
      const segments = computeInlineDiff(oldLines[i], newLines[i]);
      const display = segments.map(s => {
        if (s.type === 'equal') return s.text;
        if (s.type === 'insert') return `[+${s.text}]`;
        if (s.type === 'delete') return `[-${s.text}]`;
        return s.text;
      }).join('');
      console.log(`  ${display}`);
    }
  }
}

// --- Hunk navigation ---

console.log('\n=== Hunk Navigation ===\n');
let currentHunkIdx = -1;
for (let i = 0; i < diff.hunks.length; i++) {
  const next = navigateHunks(diff.hunks, currentHunkIdx, 'next');
  currentHunkIdx = next;
  const hunk = diff.hunks[next];
  console.log(`Hunk ${next + 1}/${diff.hunks.length}: ${hunk.type} at old:${hunk.oldStart} new:${hunk.newStart}`);
}

// --- Side-by-side editor views ---

const leftDoc = new EditorDocument('file:///original.tsx', originalCode, 'typescript');
const rightDoc = new EditorDocument('file:///modified.tsx', modifiedCode, 'typescript');

const leftVM = new EditorViewModel(leftDoc);
const rightVM = new EditorViewModel(rightDoc);

leftVM.onResize(600, 800);
rightVM.onResize(600, 800);

// Wire diff view models
leftVM.diffView.setOriginal(originalCode);
leftVM.diffView.setModified(modifiedCode);
rightVM.diffView.setOriginal(originalCode);
rightVM.diffView.setModified(modifiedCode);

console.log(`\nLeft pane: ${leftVM.visibleLines.length} visible lines`);
console.log(`Right pane: ${rightVM.visibleLines.length} visible lines`);
console.log('Diff viewer ready.');
