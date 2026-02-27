/**
 * Markdown editor example with live preview pane.
 *
 * Demonstrates:
 * - Markdown syntax highlighting via Lezer
 * - Side-by-side editor + preview layout
 * - Real-time preview updates on edit
 *
 * To run with Perry:
 *   perry compile examples/markdown-editor/main.ts --target macos --bundle-ffi native/macos/
 */

import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';

// --- Sample Markdown ---

const sampleMarkdown = `# Welcome to Hone Editor

This is a **markdown editor** built with \`@honeide/editor\`.

## Features

- Syntax highlighting for markdown
- Live preview pane (side-by-side)
- Standard editing features:
  - Multi-cursor
  - Find & replace
  - Undo/redo

## Code Blocks

\`\`\`typescript
function hello(name: string) {
  console.log(\`Hello, \${name}!\`);
}
\`\`\`

## Links & Images

Visit [Hone IDE](https://honeide.dev) for more info.

> Block quotes are supported too.

---

*Built with @honeide/editor v0.2.0*
`;

// --- Editor Setup ---

const doc = new EditorDocument('file:///README.md', sampleMarkdown, 'markdown');
const viewModel = new EditorViewModel(doc);

// Create the editor view (left pane)
const ffi = new NoOpFFI();
const coordinator = new NativeRenderCoordinator(ffi, {
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  lineHeight: 1.6,
});

coordinator.create(600, 800); // Half width for side-by-side
coordinator.attach(viewModel);
viewModel.onResize(600, 800);

// --- Preview Pane ---
// In a real Perry app, the preview pane would be a separate view
// that renders parsed markdown to native UI elements:
//
// Perry.View('preview-pane', {
//   width: 600,
//   height: 800,
//   content: renderMarkdownToNative(doc.buffer.getText()),
// });
//
// viewModel.onChange(() => {
//   updatePreview(doc.buffer.getText());
// });

// --- Simple Markdown Stats ---

function getMarkdownStats(text: string) {
  const lines = text.split('\n');
  const headings = lines.filter(l => l.startsWith('#')).length;
  const codeBlocks = (text.match(/```/g) || []).length / 2;
  const links = (text.match(/\[.*?\]\(.*?\)/g) || []).length;
  const words = text.split(/\s+/).filter(w => w.length > 0).length;

  return { headings, codeBlocks, links, words, lines: lines.length };
}

const stats = getMarkdownStats(sampleMarkdown);
console.log('Markdown Editor Example');
console.log(`Document: ${stats.lines} lines, ${stats.words} words`);
console.log(`Structure: ${stats.headings} headings, ${stats.codeBlocks} code blocks, ${stats.links} links`);
console.log(`Editor: ${viewModel.visibleLines.length} visible lines`);

// Cleanup
coordinator.destroy();
