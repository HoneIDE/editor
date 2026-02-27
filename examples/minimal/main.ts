/**
 * Minimal hone-editor example.
 *
 * Opens a file, creates an editor view, and handles input.
 * This is the simplest possible integration of @honeide/editor.
 *
 * To run with Perry:
 *   perry compile examples/minimal/main.ts --target macos --bundle-ffi native/macos/
 */

import { EditorDocument } from '../../core/document/document';
import { EditorViewModel } from '../../view-model/editor-view-model';
import { NativeRenderCoordinator } from '../../native/render-coordinator';
import { NoOpFFI } from '../../native/ffi-bridge';
// In production with Perry:
// import { hone_editor_create, ... } from 'perry/ffi';

// --- Setup ---

// Create a document from sample text
const sampleCode = `// Welcome to hone-editor
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const result = greet("World");
console.log(result);

// Features:
// - Syntax highlighting (10 languages)
// - Multi-cursor editing
// - Find & replace (regex)
// - Code folding
// - Undo/redo with coalescing
// - LSP integration
// - DAP debugging
// - Ghost text (AI completions)
`;

const doc = new EditorDocument('file:///example.ts', sampleCode, 'typescript');
const viewModel = new EditorViewModel(doc);

// --- Create native view ---

// In production, use the platform FFI implementation.
// For this example, we use NoOpFFI to demonstrate the API.
const ffi = new NoOpFFI();
const coordinator = new NativeRenderCoordinator(ffi, {
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  lineHeight: 1.5,
});

const handle = coordinator.create(1200, 800);
coordinator.attach(viewModel);

// --- Simulate interaction ---

// The editor is now rendering. In a real Perry app, input events
// would come from the native event loop:
//
// Perry.onKeyDown((event) => viewModel.onKeyDown(event));
// Perry.onMouseDown((event) => viewModel.onMouseDown(event));
// Perry.onScroll((event) => viewModel.onScroll(event));
// Perry.onResize((w, h) => viewModel.onResize(w, h));

// For this example, let's simulate some edits:
viewModel.onResize(1200, 800);

// Type at the end
viewModel.executeCommand('editor.action.moveCursorToDocumentEnd');
viewModel.onTextInput('\n\n// Added by example\n');

// Show the state
console.log(`Document: ${doc.buffer.getLineCount()} lines`);
console.log(`Cursors: ${viewModel.cursors.length}`);
console.log(`Visible lines: ${viewModel.visibleLines.length}`);
console.log(`FFI calls made: ${ffi.calls.length}`);

// Cleanup
coordinator.destroy();
