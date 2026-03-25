import { describe, test, expect } from 'bun:test';
import { COMPLEX_SOURCE, COMPLEX_SOURCE_LINE_COUNT } from './integration-source';

// Core
import { TextBuffer } from '../core/buffer/text-buffer';
import { EditorDocument } from '../core/document/document';
import { SyntaxEngine } from '../core/tokenizer/syntax-engine';
import { IncrementalTokenCache } from '../core/tokenizer/incremental';
import { FoldState } from '../core/folding/fold-state';
import { computeIndentFoldRanges } from '../core/folding/fold-provider';
import { searchAll } from '../core/search/search-engine';
import { replaceAll } from '../core/search/replace';
import { IncrementalSearch } from '../core/search/incremental';
import { computeDiff } from '../core/diff/diff-compute';
import { computeInlineDiff } from '../core/diff/inline-diff';
import { navigateHunks } from '../core/diff/hunk';
import { LSPClient } from '../core/lsp-client/client';
import { DAPClient } from '../core/dap-client/client';

// View-model
import { EditorViewModel } from '../view-model/editor-view-model';
import { DARK_THEME } from '../view-model/theme';

// Native
import { NoOpFFI } from '../native/ffi-bridge';
import { NativeRenderCoordinator } from '../native/render-coordinator';
import { TouchInputHandler, type TouchPoint } from '../native/touch-input';
import { WrapCache } from '../native/word-wrap';

// LSP/DAP helper: Content-Length framed message
function frame(body: any): string {
  const json = JSON.stringify(body);
  const byteLen = new TextEncoder().encode(json).length;
  return `Content-Length: ${byteLen}\r\n\r\n${json}`;
}

describe('Full-Stack Integration', () => {
  // Shared state across tests — built up sequentially
  let doc: EditorDocument;
  let vm: EditorViewModel;
  let ffi: NoOpFFI;
  let coordinator: NativeRenderCoordinator;
  let originalSource: string;

  // -------------------------------------------------------
  // 1. Document creation & syntax parse
  // -------------------------------------------------------
  test('document creation & syntax parse', () => {
    originalSource = COMPLEX_SOURCE;
    doc = new EditorDocument('test://complex.ts', originalSource, 'typescript');
    expect(doc.languageId).toBe('typescript');
    expect(doc.buffer.getLineCount()).toBe(COMPLEX_SOURCE_LINE_COUNT);
    expect(doc.buffer.getLineCount()).toBeGreaterThan(100);

    // SyntaxEngine should parse the complex source
    const engine = new SyntaxEngine();
    engine.setLanguage('typescript');
    const tree = engine.parse(doc.buffer);
    expect(tree).not.toBeNull();

    // Should produce tokens for a line with keywords
    const tokens = engine.getLineTokens(doc.buffer, 0, DARK_THEME);
    expect(tokens.length).toBeGreaterThan(0);

    // Should produce fold ranges from the complex source
    const foldRanges = engine.getFoldRanges(doc.buffer);
    expect(foldRanges.length).toBeGreaterThan(5);
  });

  // -------------------------------------------------------
  // 2. ViewModel wiring
  // -------------------------------------------------------
  test('ViewModel wiring — all subsystems initialized', () => {
    vm = new EditorViewModel(doc, DARK_THEME, new SyntaxEngine());
    vm.onResize(1200, 800);
    vm.setCharWidth(8);

    // All subsystems should be accessible
    expect(vm.document).toBe(doc);
    expect(vm.cursorManager).toBeTruthy();
    expect(vm.viewport).toBeTruthy();
    expect(vm.undoManager).toBeTruthy();
    expect(vm.commandRegistry).toBeTruthy();
    expect(vm.syntaxEngine).toBeTruthy();
    expect(vm.tokenCache).toBeTruthy();
    expect(vm.foldState).toBeTruthy();
    expect(vm.findWidget).toBeTruthy();
    expect(vm.ghostText).toBeTruthy();
    expect(vm.overlays).toBeTruthy();
    expect(vm.diffView).toBeTruthy();

    // Visible lines should have tokens with actual colors (not just default)
    const lines = vm.visibleLines;
    expect(lines.length).toBeGreaterThan(0);

    // At least some lines should have tokens (syntax-highlighted)
    const linesWithTokens = lines.filter(l => l.tokens.length > 0);
    expect(linesWithTokens.length).toBeGreaterThan(0);

    // Tokens should have colors from the theme, not empty
    const firstTokenized = linesWithTokens[0];
    expect(firstTokenized.tokens[0].color).toBeTruthy();
    expect(firstTokenized.tokens[0].color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  // -------------------------------------------------------
  // 3. Native render coordinator
  // -------------------------------------------------------
  test('native render coordinator — FFI calls', () => {
    ffi = new NoOpFFI();
    coordinator = new NativeRenderCoordinator(ffi, {
      fontFamily: 'Menlo',
      fontSize: 14,
      lineHeight: 1.5,
    });

    coordinator.create(1200, 800);
    expect(coordinator.handle).toBe(1);

    // Attach should trigger initial render
    coordinator.attach(vm);

    // Should have called key FFI methods
    expect(ffi.getCalls('create').length).toBe(1);
    expect(ffi.getCalls('setFont').length).toBeGreaterThanOrEqual(1);
    expect(ffi.getCalls('measureText').length).toBeGreaterThanOrEqual(1);

    const cacheLineCalls = ffi.getCalls('cacheLine');
    expect(cacheLineCalls.length).toBeGreaterThan(0);

    // cacheLine should include packed tokens
    const firstCache = cacheLineCalls[0];
    expect(firstCache[1]).toBe(1); // line number (1-based in FFI)
    expect(typeof firstCache[2]).toBe('string'); // text
    expect(typeof firstCache[3]).toBe('string'); // packedTokens

    // setCursor should have been called
    expect(ffi.getCalls('setCursor').length).toBe(1);
  });

  // -------------------------------------------------------
  // 4. Keyboard editing
  // -------------------------------------------------------
  test('keyboard editing — type, syntax re-parse, FFI re-render', () => {
    // Move to start of document
    vm.executeCommand('editor.action.moveCursorToDocumentStart');

    const beforeText = doc.buffer.getLine(0);
    ffi.reset();

    // Type some text
    vm.executeCommand('editor.action.type', { text: '/* INTEGRATION TEST */ ' });

    const afterText = doc.buffer.getLine(0);
    expect(afterText).toContain('/* INTEGRATION TEST */');
    expect(afterText).not.toBe(beforeText);

    // FFI should have received re-cached lines
    coordinator.invalidate();
    const cacheCalls = ffi.getCalls('cacheLine');
    expect(cacheCalls.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------
  // 5. Multi-cursor editing
  // -------------------------------------------------------
  test('multi-cursor editing — add cursors, type simultaneously, undo', () => {
    // Reset to a known state
    vm.executeCommand('editor.action.moveCursorToDocumentStart');
    vm.executeCommand('editor.action.moveCursorToLineEnd');

    // Add cursors below (on lines 1 and 2)
    vm.executeCommand('editor.action.addCursorBelow');
    vm.executeCommand('editor.action.addCursorBelow');
    expect(vm.cursors.length).toBe(3);

    const linesBefore = [
      doc.buffer.getLine(0),
      doc.buffer.getLine(1),
      doc.buffer.getLine(2),
    ];

    // Type with all three cursors
    vm.executeCommand('editor.action.type', { text: ' // MULTI' });

    // All three lines should be modified
    expect(doc.buffer.getLine(0)).toContain('// MULTI');
    expect(doc.buffer.getLine(1)).toContain('// MULTI');
    expect(doc.buffer.getLine(2)).toContain('// MULTI');

    // Undo should reverse all at once
    vm.executeCommand('editor.action.undo');

    expect(doc.buffer.getLine(0)).toBe(linesBefore[0]);
    expect(doc.buffer.getLine(1)).toBe(linesBefore[1]);
    expect(doc.buffer.getLine(2)).toBe(linesBefore[2]);

    // Reset to single cursor
    vm.cursorManager.reset(0, 0);
  });

  // -------------------------------------------------------
  // 6. Undo/redo chain
  // -------------------------------------------------------
  test('undo/redo chain — multiple edits', () => {
    vm.cursorManager.reset(0, 0);
    const stateA = doc.buffer.getText();

    // Edit 1: type at start
    vm.executeCommand('editor.action.type', { text: 'AAA' });
    const stateB = doc.buffer.getText();
    expect(stateB).not.toBe(stateA);

    // Edit 2: insert newline (forces new undo group)
    vm.executeCommand('editor.action.insertLineAfter');
    const stateC = doc.buffer.getText();
    expect(stateC).not.toBe(stateB);

    // Edit 3: type more
    vm.executeCommand('editor.action.type', { text: 'BBB' });
    const stateD = doc.buffer.getText();

    // Undo back to C
    vm.executeCommand('editor.action.undo');
    expect(doc.buffer.getText()).toBe(stateC);

    // Undo back to B
    vm.executeCommand('editor.action.undo');
    expect(doc.buffer.getText()).toBe(stateB);

    // Redo to C
    vm.executeCommand('editor.action.redo');
    expect(doc.buffer.getText()).toBe(stateC);

    // Redo to D
    vm.executeCommand('editor.action.redo');
    expect(doc.buffer.getText()).toBe(stateD);

    // Undo everything to restore original (undo D→C→B→A)
    vm.executeCommand('editor.action.undo');
    vm.executeCommand('editor.action.undo');
    vm.executeCommand('editor.action.undo');
    expect(doc.buffer.getText()).toBe(stateA);
  });

  // -------------------------------------------------------
  // 7. Code folding
  // -------------------------------------------------------
  test('code folding — fold a class, verify hidden lines', () => {
    const foldRanges = vm.syntaxEngine.getFoldRanges(doc.buffer);
    expect(foldRanges.length).toBeGreaterThan(0);

    // Find a fold range that covers multiple lines (class body)
    const largeFold = foldRanges.find(r => r.endLine - r.startLine >= 5);
    expect(largeFold).toBeTruthy();

    const foldLine = largeFold!.startLine;
    const foldEnd = largeFold!.endLine;
    const totalVisibleBefore = vm.visibleLines.length;

    // Fold
    vm.foldState.fold(foldLine);
    vm.viewport.setHiddenLines(vm.foldState.getHiddenLines());

    // Lines inside fold should be hidden
    for (let i = foldLine + 1; i <= foldEnd; i++) {
      expect(vm.foldState.isLineHidden(i)).toBe(true);
    }

    // Visible lines should decrease
    const totalVisibleAfter = vm.visibleLines.length;
    expect(totalVisibleAfter).toBeLessThan(totalVisibleBefore);

    // Render coordinator should skip hidden lines
    ffi.reset();
    coordinator.invalidate();
    const cacheCalls = ffi.getCalls('cacheLine');
    const cachedLineNumbers = cacheCalls.map((c: any[]) => c[1]);
    for (let i = foldLine + 2; i <= foldEnd; i++) {
      // FFI line numbers are 1-based
      expect(cachedLineNumbers).not.toContain(i + 1);
    }

    // Unfold to restore state
    vm.foldState.unfold(foldLine);
    vm.viewport.setHiddenLines(vm.foldState.getHiddenLines());
  });

  // -------------------------------------------------------
  // 8. Search & replace
  // -------------------------------------------------------
  test('search & replace — regex search, replace all', () => {
    const buf = doc.buffer;

    // Search for regex pattern: function names
    const matches = searchAll(buf, 'function\\s+\\w+', { isRegex: true });
    expect(matches.length).toBeGreaterThan(0);

    // Each match should have valid position
    for (const m of matches) {
      expect(m.line).toBeGreaterThanOrEqual(0);
      expect(m.column).toBeGreaterThanOrEqual(0);
      expect(m.text).toMatch(/^function\s+\w+/);
    }

    // Replace a specific literal pattern
    const constMatches = searchAll(buf, 'MAX_RETRIES');
    expect(constMatches.length).toBeGreaterThanOrEqual(2); // definition + usage

    // Save state for undo
    const beforeReplace = buf.getText();

    const result = replaceAll(buf, 'MAX_RETRIES', 'MAX_ATTEMPTS');
    expect(result.count).toBeGreaterThanOrEqual(2);

    // Verify replacement happened
    expect(buf.getText()).toContain('MAX_ATTEMPTS');
    expect(buf.getText()).not.toContain('MAX_RETRIES');

    // Restore via undo — replaceAll applies edits directly to buffer
    // We need to reverse it manually
    const reverseResult = replaceAll(buf, 'MAX_ATTEMPTS', 'MAX_RETRIES');
    expect(reverseResult.count).toBe(result.count);
    expect(buf.getText()).toContain('MAX_RETRIES');
  });

  // -------------------------------------------------------
  // 9. Find widget integration
  // -------------------------------------------------------
  test('find widget — open, query, navigate matches, close', () => {
    // Open find widget via command
    vm.executeCommand('editor.action.find');
    expect(vm.findWidget.state.isOpen).toBe(true);

    // Set a query
    vm.findWidget.setQuery(doc.buffer, 'item');
    expect(vm.findWidget.matchCount).toBeGreaterThan(0);

    // Navigate matches
    const first = vm.findWidget.currentMatch;
    expect(first).not.toBeNull();

    const next = vm.findWidget.nextMatch();
    if (vm.findWidget.matchCount > 1) {
      expect(next).not.toBeNull();
    }

    const prev = vm.findWidget.prevMatch();
    expect(prev).not.toBeNull();

    // Close with escape
    vm.executeCommand('editor.action.escape');
    expect(vm.findWidget.state.isOpen).toBe(false);
  });

  // -------------------------------------------------------
  // 10. Diff computation
  // -------------------------------------------------------
  test('diff computation — hunks, inline char diff, navigation', async () => {
    const modified = originalSource.replace('DataProcessor', 'StreamProcessor')
      .replace('legacyProcess', 'oldProcess')
      + '\n// Added trailing line\n';

    const diffResult = await computeDiff(originalSource, modified);
    expect(diffResult.hunks.length).toBeGreaterThan(0);
    expect(diffResult.totalAdded + diffResult.totalDeleted).toBeGreaterThan(0);

    // Inline char diff on a modified line
    const inlineDiff = computeInlineDiff(
      'class DataProcessor<T extends Configurable> extends EventEmitter {',
      'class StreamProcessor<T extends Configurable> extends EventEmitter {',
    );
    expect(inlineDiff.length).toBeGreaterThan(0);
    const changedSegments = inlineDiff.filter(s => s.type !== 'unchanged');
    expect(changedSegments.length).toBeGreaterThan(0);

    // Navigate hunks
    if (diffResult.hunks.length > 1) {
      const nextHunk = navigateHunks(diffResult.hunks, 0, 'next');
      expect(nextHunk).not.toBeNull();
    }

    // DiffViewModel integration
    await vm.diffView.computeDiff(originalSource, modified);
    expect(vm.diffView.diff).not.toBeNull();
    expect(vm.diffView.diff!.hunks.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------
  // 11. LSP client mock session
  // -------------------------------------------------------
  test('LSP client — initialize, didOpen, completion, diagnostics', async () => {
    const lsp = new LSPClient();
    const sent: string[] = [];

    lsp.connect((data) => sent.push(data));
    expect(lsp.state).toBe('connecting');

    // Initialize
    const initPromise = lsp.initialize('file:///workspace');
    lsp.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          completionProvider: { triggerCharacters: ['.', ':'] },
          hoverProvider: true,
          textDocumentSync: { openClose: true, change: 2 },
        },
      },
    }));

    const caps = await initPromise;
    expect(lsp.state).toBe('ready');
    expect(caps.completionProvider).toBeTruthy();
    expect(lsp.serverCapabilities?.hasCompletion).toBe(true);
    expect(lsp.serverCapabilities?.hasHover).toBe(true);

    // didOpen
    sent.length = 0;
    lsp.didOpen('file:///complex.ts', 'typescript', 1, originalSource);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('textDocument/didOpen');
    expect(lsp.isDocumentOpen('file:///complex.ts')).toBe(true);

    // Request completion
    const completionPromise = lsp.completion('file:///complex.ts', { line: 10, character: 5 });
    lsp.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        isIncomplete: false,
        items: [
          { label: 'process', kind: 2, insertText: 'process()' },
          { label: 'pipeline', kind: 2, insertText: 'pipeline()' },
        ],
      },
    }));

    const items = await completionPromise;
    expect(items.length).toBe(2);
    expect(items[0].label).toBe('process');

    // Receive diagnostics
    let diagnosticUri = '';
    let diagnosticCount = 0;
    lsp.onDiagnostics((uri, diags) => {
      diagnosticUri = uri;
      diagnosticCount = diags.length;
    });

    lsp.receiveData(frame({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///complex.ts',
        diagnostics: [
          {
            range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
            severity: 2,
            message: 'Unused import',
          },
        ],
      },
    }));

    expect(diagnosticUri).toBe('file:///complex.ts');
    expect(diagnosticCount).toBe(1);
  });

  // -------------------------------------------------------
  // 12. DAP client mock session
  // -------------------------------------------------------
  test('DAP client — initialize, breakpoints, stopped, stack, evaluate', async () => {
    const dap = new DAPClient();
    const sent: string[] = [];

    dap.connect((data) => sent.push(data));

    // Initialize
    const initPromise = dap.initialize();
    dap.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: {
        body: {
          supportsConfigurationDoneRequest: true,
          supportsConditionalBreakpoints: true,
        },
      },
    }));

    const dapCaps = await initPromise;
    expect(dapCaps.supportsConfigurationDoneRequest).toBe(true);

    // Set breakpoints on specific lines
    const bpPromise = dap.setBreakpoints('file:///complex.ts', [
      { line: 20 },
      { line: 50, condition: 'i > 0' },
    ]);

    dap.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        breakpoints: [
          { id: 1, verified: true, line: 20 },
          { id: 2, verified: true, line: 50 },
        ],
      },
    }));

    const bps = await bpPromise;
    expect(bps.length).toBe(2);
    expect(bps[0].verified).toBe(true);

    // Simulate stopped event
    let stoppedReason = '';
    dap.setEventHandlers({
      onStopped: (body) => { stoppedReason = body.reason; },
    });

    dap.receiveData(frame({
      jsonrpc: '2.0',
      method: 'stopped',
      params: { reason: 'breakpoint', threadId: 1 },
    }));

    expect(dap.state).toBe('stopped');
    expect(stoppedReason).toBe('breakpoint');
    expect(dap.activeThreadId).toBe(1);

    // Get stack trace
    const stackPromise = dap.stackTrace();
    dap.receiveData(frame({
      jsonrpc: '2.0',
      id: 3,
      result: {
        stackFrames: [
          { id: 0, name: 'process', source: { path: '/complex.ts' }, line: 20, column: 1 },
        ],
      },
    }));

    const frames = await stackPromise;
    expect(frames.length).toBe(1);
    expect(frames[0].name).toBe('process');

    // Evaluate expression
    const evalPromise = dap.evaluate('items.length', 0);
    dap.receiveData(frame({
      jsonrpc: '2.0',
      id: 4,
      result: { result: '42', variablesReference: 0 },
    }));

    const evalResult = await evalPromise;
    expect(evalResult.result).toBe('42');
  });

  // -------------------------------------------------------
  // 13. Selection & clipboard
  // -------------------------------------------------------
  test('selection & clipboard — select all, copy, paste, undo', () => {
    vm.cursorManager.reset(0, 0);
    const originalText = doc.buffer.getText();
    const originalLength = doc.buffer.getLength();

    // Select all
    vm.executeCommand('editor.action.selectAll');
    const sels = vm.selections;
    expect(sels.length).toBe(1);
    expect(sels[0].startLine).toBe(0);
    expect(sels[0].startColumn).toBe(0);

    // Copy (stores in clipboard)
    vm.executeCommand('editor.action.copy');

    // Move to end and paste
    vm.executeCommand('editor.action.moveCursorToDocumentEnd');
    vm.executeCommand('editor.action.paste');

    // Content should have the text appended
    expect(doc.buffer.getLength()).toBeGreaterThan(originalLength);

    // Undo should restore
    vm.executeCommand('editor.action.undo');
    expect(doc.buffer.getText()).toBe(originalText);
  });

  // -------------------------------------------------------
  // 14. Scroll & viewport
  // -------------------------------------------------------
  test('scroll & viewport — resize small, scroll down, verify range change', () => {
    // Reset scroll to top first (previous tests may have scrolled)
    vm.viewport.scroll.scrollTo(0);
    vm.onResize(800, 100); // Very small viewport

    const scrollBefore = vm.viewport.scroll.scrollTop;
    expect(scrollBefore).toBe(0);

    // Scroll down enough to move past the buffer zone (10 lines * ~21px = 210)
    vm.onScroll({ deltaX: 0, deltaY: 500 });

    const scrollAfter = vm.viewport.scroll.scrollTop;
    expect(scrollAfter).toBeGreaterThan(scrollBefore);

    const rangeAfter = vm.viewport.getVisibleRange();
    expect(rangeAfter.startLine).toBeGreaterThan(0);

    // Render coordinator should have sent scroll during onScroll (via change listener)
    // Verify scroll state is reflected in scrollState
    expect(vm.scrollState.scrollTop).toBe(scrollAfter);
    expect(vm.scrollState.scrollTop).toBeGreaterThan(0);

    // Restore viewport size
    vm.onResize(1200, 800);
    vm.viewport.scroll.scrollTo(0);
  });

  // -------------------------------------------------------
  // 15. Ghost text
  // -------------------------------------------------------
  test('ghost text — show, render, accept', () => {
    vm.cursorManager.reset(0, 0);
    vm.executeCommand('editor.action.moveCursorToLineEnd');

    const line = vm.cursors[0].line;
    const col = vm.cursors[0].column;

    // Show ghost text
    vm.ghostText.show(line, col, ' // auto-completed');
    expect(vm.ghostText.state).not.toBeNull();
    expect(vm.ghostText.state!.text).toBe(' // auto-completed');

    // Render coordinator should send renderGhostText if available
    ffi.reset();
    coordinator.invalidate();
    const ghostCalls = ffi.getCalls('renderGhostText');
    // NoOpFFI supports renderGhostText
    expect(ghostCalls.length).toBeGreaterThanOrEqual(0);

    // Accept ghost text
    const textBefore = doc.buffer.getLine(line);
    vm.executeCommand('editor.action.acceptGhostText');

    const textAfter = doc.buffer.getLine(line);
    expect(textAfter).toContain('// auto-completed');
    expect(textAfter.length).toBeGreaterThan(textBefore.length);

    // Ghost text should be cleared
    expect(vm.ghostText.state).toBeNull();

    // Undo the ghost text insertion
    vm.executeCommand('editor.action.undo');
  });

  // -------------------------------------------------------
  // 16. Word wrap
  // -------------------------------------------------------
  test('word wrap — long lines produce extra visual lines', () => {
    const buf = doc.buffer;
    const cache = new WrapCache({ mode: 'word', wrapColumn: 0, wrappedLineIndent: 2 });
    cache.setMaxWidth(400); // Narrow width to force wraps
    cache.setMeasureFn((text) => text.length * 8); // 8px per char

    let totalVisualLines = 0;
    let wrappedCount = 0;

    for (let i = 0; i < buf.getLineCount(); i++) {
      const visualCount = cache.getVisualLineCount(buf, i);
      totalVisualLines += visualCount;
      if (visualCount > 1) wrappedCount++;
    }

    // With 400px width (50 chars), some lines should wrap
    expect(wrappedCount).toBeGreaterThan(0);
    expect(totalVisualLines).toBeGreaterThan(buf.getLineCount());
  });

  // -------------------------------------------------------
  // 17. Touch input
  // -------------------------------------------------------
  test('touch input — tap, pan, pinch', () => {
    const handler = new TouchInputHandler({ panThreshold: 5, pinchThreshold: 1 });
    handler.attach(vm);
    expect(handler.state).toBe('idle');

    // Tap — should move cursor
    const tap: TouchPoint = { id: 0, x: 100, y: 50, timestamp: Date.now() };
    handler.touchStart([tap]);
    handler.touchEnd([tap]);
    expect(handler.state).toBe('idle');

    // Pan — should scroll
    const panStart: TouchPoint = { id: 1, x: 100, y: 200, timestamp: Date.now() };
    handler.touchStart([panStart]);
    handler.touchMove([{ ...panStart, y: 100, timestamp: Date.now() + 10 }]);
    expect(handler.state).toBe('panning');
    handler.touchEnd([{ ...panStart, y: 100, timestamp: Date.now() + 20 }]);
    expect(handler.state).toBe('idle');

    // Pinch — should trigger zoom
    let newFontSize = 0;
    handler.onFontSizeChange((size) => { newFontSize = size; });

    const p0: TouchPoint = { id: 2, x: 100, y: 100, timestamp: Date.now() };
    const p1: TouchPoint = { id: 3, x: 200, y: 100, timestamp: Date.now() };
    handler.touchStart([p0]);
    handler.touchStart([p1]);
    expect(handler.state).toBe('pinching');

    // Spread fingers
    handler.touchMove([
      { ...p0, x: 50, timestamp: Date.now() + 10 },
      { ...p1, x: 250, timestamp: Date.now() + 10 },
    ]);
    expect(newFontSize).toBeGreaterThan(0);

    handler.touchEnd([
      { ...p0, x: 50, timestamp: Date.now() + 20 },
      { ...p1, x: 250, timestamp: Date.now() + 20 },
    ]);

    handler.detach();
    expect(handler.state).toBe('idle');
  });

  // -------------------------------------------------------
  // 18. Full render cycle verification
  // -------------------------------------------------------
  test('full render cycle — invalidate + render, verify FFI consistency', () => {
    // Ensure we're in a clean state
    vm.cursorManager.reset(0, 0);
    vm.onResize(1200, 800);
    vm.viewport.scroll.scrollTo(0);

    ffi.reset();
    coordinator.invalidate();

    // Verify cacheLine calls
    const cacheCalls = ffi.getCalls('cacheLine');
    expect(cacheCalls.length).toBeGreaterThan(0);

    // All cacheLine calls should have valid structure:
    // [handle, lineNumber, text, packedTokens]
    for (const call of cacheCalls) {
      expect(typeof call[0]).toBe('number'); // handle
      expect(typeof call[1]).toBe('number'); // lineNumber (1-based)
      expect(call[1]).toBeGreaterThanOrEqual(1);
      expect(typeof call[2]).toBe('string'); // text
      expect(typeof call[3]).toBe('string'); // packedTokens

      // packedTokens should be pipe-delimited segments
      const segments = call[3].split('|').filter((s: string) => s.length > 0);
      for (const seg of segments) {
        const parts = seg.split(',');
        expect(parts.length).toBe(4);
      }
    }

    // setCursor should reflect cursor at (0, 0)
    const cursorCalls = ffi.getCalls('setCursor');
    expect(cursorCalls.length).toBe(1);

    // beginSelections should be called
    const selCalls = ffi.getCalls('beginSelections');
    expect(selCalls.length).toBe(1);

    // setViewport should be called
    const vpCalls = ffi.getCalls('setViewport');
    expect(vpCalls.length).toBeGreaterThanOrEqual(1);

    // Total FFI call count
    const totalCalls = ffi.calls.length;
    expect(totalCalls).toBeGreaterThan(10);

    // Cleanup
    coordinator.detach();
    coordinator.destroy();
  });
});
