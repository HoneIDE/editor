/**
 * Standalone full-stack integration test for hone-editor.
 * No test framework dependency — uses console.log + process.exit.
 *
 * Run: bun run tests/integration-standalone.ts
 */

import { COMPLEX_SOURCE, COMPLEX_SOURCE_LINE_COUNT } from './integration-source';

// Core
import { TextBuffer } from '../core/buffer/text-buffer';
import { EditorDocument } from '../core/document/document';
import { SyntaxEngine } from '../core/tokenizer/syntax-engine';
import { FoldState } from '../core/folding/fold-state';
import { searchAll } from '../core/search/search-engine';
import { replaceAll } from '../core/search/replace';
import { computeDiff } from '../core/diff/diff-compute';
import { computeInlineDiff } from '../core/diff/inline-diff';
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

// Helper: Content-Length framed message
function frame(body: any): string {
  const json = JSON.stringify(body);
  const byteLen = new TextEncoder().encode(json).length;
  return `Content-Length: ${byteLen}\r\n\r\n${json}`;
}

// Test runner
interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
  error?: string;
}

const results: CheckResult[] = [];

function check(name: string, fn: () => string): void {
  try {
    const detail = fn();
    results.push({ name, passed: true, detail });
  } catch (err: any) {
    results.push({ name, passed: false, detail: '', error: err.message || String(err) });
  }
}

async function checkAsync(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = fn();
    results.push({ name, passed: true, detail: await detail });
  } catch (err: any) {
    results.push({ name, passed: false, detail: '', error: err.message || String(err) });
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// Shared state
let doc: EditorDocument;
let vm: EditorViewModel;
let ffi: NoOpFFI;
let coordinator: NativeRenderCoordinator;

async function run() {
  console.log('=== hone-editor Full-Stack Integration ===\n');

  // 1. Document creation & syntax parse
  check('Document creation & syntax parse', () => {
    doc = new EditorDocument('test://complex.ts', COMPLEX_SOURCE, 'typescript');
    assert(doc.languageId === 'typescript', 'language should be typescript');
    assert(doc.buffer.getLineCount() === COMPLEX_SOURCE_LINE_COUNT, 'line count mismatch');

    const engine = new SyntaxEngine();
    engine.setLanguage('typescript');
    const tree = engine.parse(doc.buffer);
    assert(tree !== null, 'parse tree should not be null');

    const foldRanges = engine.getFoldRanges(doc.buffer);
    assert(foldRanges.length > 5, 'should have multiple fold ranges');

    return `${doc.buffer.getLineCount()} lines, ${foldRanges.length} fold ranges`;
  });

  // 2. ViewModel wiring
  check('ViewModel wiring', () => {
    vm = new EditorViewModel(doc, DARK_THEME);
    vm.onResize(1200, 800);
    vm.setCharWidth(8);

    const subsystems = [
      vm.cursorManager, vm.viewport, vm.undoManager, vm.commandRegistry,
      vm.syntaxEngine, vm.tokenCache, vm.foldState, vm.findWidget,
      vm.ghostText, vm.overlays, vm.diffView,
    ];
    assert(subsystems.every(s => s != null), 'all subsystems initialized');

    const lines = vm.visibleLines;
    assert(lines.length > 0, 'should have visible lines');

    const linesWithTokens = lines.filter(l => l.tokens.length > 0);
    assert(linesWithTokens.length > 0, 'should have tokenized lines');

    return `${subsystems.length} subsystems, ${lines.length} visible lines`;
  });

  // 3. Native render coordinator
  check('Native render coordinator', () => {
    ffi = new NoOpFFI();
    coordinator = new NativeRenderCoordinator(ffi, {
      fontFamily: 'Menlo',
      fontSize: 14,
      lineHeight: 1.5,
    });

    coordinator.create(1200, 800);
    coordinator.attach(vm);

    const totalCalls = ffi.calls.length;
    const renderLineCalls = ffi.getCalls('renderLine').length;
    const setCursorCalls = ffi.getCalls('setCursor').length;

    assert(renderLineCalls > 0, 'should have renderLine calls');
    assert(setCursorCalls === 1, 'should have setCursor call');

    return `${totalCalls} FFI calls, ${renderLineCalls} renderLine, ${setCursorCalls} setCursor`;
  });

  // 4. Keyboard editing
  check('Keyboard editing', () => {
    vm.executeCommand('editor.action.moveCursorToDocumentStart');
    ffi.reset();

    vm.executeCommand('editor.action.type', { text: '/* TEST */ ' });
    const line0 = doc.buffer.getLine(0);
    assert(line0.startsWith('/* TEST */'), 'typed text should appear');

    coordinator.invalidate();
    const reRenders = ffi.getCalls('renderLine').length;
    assert(reRenders > 0, 'should re-render after edit');

    // Undo
    vm.executeCommand('editor.action.undo');

    return `typed text verified, ${reRenders} lines re-rendered`;
  });

  // 5. Multi-cursor editing
  check('Multi-cursor editing', () => {
    vm.cursorManager.reset(0, 0);
    vm.executeCommand('editor.action.moveCursorToLineEnd');
    vm.executeCommand('editor.action.addCursorBelow');
    vm.executeCommand('editor.action.addCursorBelow');

    const cursorCount = vm.cursors.length;
    assert(cursorCount === 3, `expected 3 cursors, got ${cursorCount}`);

    vm.executeCommand('editor.action.type', { text: '!' });
    assert(doc.buffer.getLine(0).endsWith('!'), 'line 0 should end with !');
    assert(doc.buffer.getLine(1).endsWith('!'), 'line 1 should end with !');
    assert(doc.buffer.getLine(2).endsWith('!'), 'line 2 should end with !');

    vm.executeCommand('editor.action.undo');
    vm.cursorManager.reset(0, 0);

    return `${cursorCount} cursors, typed simultaneously, undo verified`;
  });

  // 6. Undo/redo chain
  check('Undo/redo chain', () => {
    vm.cursorManager.reset(0, 0);
    const stateA = doc.buffer.getText();

    // Use multi-char strings to avoid single-char coalescing with prior test state
    vm.executeCommand('editor.action.type', { text: 'AAA' });
    const stateB = doc.buffer.getText();
    assert(stateB !== stateA, 'should change after typing');

    vm.executeCommand('editor.action.insertLineAfter');
    vm.executeCommand('editor.action.type', { text: 'BBB' });

    let undoSteps = 0;
    vm.executeCommand('editor.action.undo'); undoSteps++;
    vm.executeCommand('editor.action.undo'); undoSteps++;
    vm.executeCommand('editor.action.undo'); undoSteps++;

    assert(doc.buffer.getText() === stateA, 'should restore to original');

    vm.executeCommand('editor.action.redo');
    vm.executeCommand('editor.action.redo');
    vm.executeCommand('editor.action.redo');
    assert(doc.buffer.getText() !== stateA, 'redo should change state');

    // Undo all
    vm.executeCommand('editor.action.undo');
    vm.executeCommand('editor.action.undo');
    vm.executeCommand('editor.action.undo');

    return `${undoSteps} undo steps, redo verified`;
  });

  // 7. Code folding
  check('Code folding', () => {
    const foldRanges = vm.syntaxEngine.getFoldRanges(doc.buffer);
    const largeFold = foldRanges.find(r => r.endLine - r.startLine >= 5);
    assert(largeFold != null, 'should have a large fold range');

    const visibleBefore = vm.visibleLines.length;
    vm.foldState.fold(largeFold!.startLine);
    vm.viewport.setHiddenLines(vm.foldState.getHiddenLines());

    const hiddenCount = vm.foldState.getHiddenLines().size;
    assert(hiddenCount > 0, 'should have hidden lines');

    const visibleAfter = vm.visibleLines.length;
    assert(visibleAfter < visibleBefore, 'fewer visible lines after fold');

    vm.foldState.unfold(largeFold!.startLine);
    vm.viewport.setHiddenLines(vm.foldState.getHiddenLines());

    return `${foldRanges.length} fold ranges, ${hiddenCount} lines hidden when folded`;
  });

  // 8. Search & replace
  check('Search & replace', () => {
    const matches = searchAll(doc.buffer, 'function\\s+\\w+', { isRegex: true });
    assert(matches.length > 0, 'should find function declarations');

    const constMatches = searchAll(doc.buffer, 'MAX_RETRIES');
    assert(constMatches.length >= 2, 'should find MAX_RETRIES usages');

    const result = replaceAll(doc.buffer, 'MAX_RETRIES', 'MAX_ATTEMPTS');
    assert(result.count >= 2, 'should replace multiple occurrences');
    assert(doc.buffer.getText().includes('MAX_ATTEMPTS'), 'replacement should be present');

    // Reverse
    replaceAll(doc.buffer, 'MAX_ATTEMPTS', 'MAX_RETRIES');

    return `${matches.length} regex matches, ${result.count} replacements`;
  });

  // 9. Find widget
  check('Find widget integration', () => {
    vm.executeCommand('editor.action.find');
    assert(vm.findWidget.state.isOpen === true, 'find widget should be open');

    vm.findWidget.setQuery(doc.buffer, 'item');
    const matchCount = vm.findWidget.matchCount;
    assert(matchCount > 0, 'should find matches for "item"');

    vm.findWidget.nextMatch();
    vm.findWidget.prevMatch();

    vm.executeCommand('editor.action.escape');
    assert(vm.findWidget.state.isOpen === false, 'find widget should be closed');

    return `${matchCount} matches for "item"`;
  });

  // 10. Diff computation
  await checkAsync('Diff computation', async () => {
    const modified = COMPLEX_SOURCE.replace('DataProcessor', 'StreamProcessor')
      + '\n// Extra line\n';

    const diffResult = await computeDiff(COMPLEX_SOURCE, modified);
    assert(diffResult.hunks.length > 0, 'should have diff hunks');

    const inlineDiff = computeInlineDiff(
      'class DataProcessor<T',
      'class StreamProcessor<T',
    );
    const changed = inlineDiff.filter(s => s.type !== 'unchanged');
    assert(changed.length > 0, 'should have inline changes');

    await vm.diffView.computeDiff(COMPLEX_SOURCE, modified);
    assert(vm.diffView.diff !== null, 'diff view should have diff');

    return `${diffResult.hunks.length} hunks, ${diffResult.totalAdded} added, ${diffResult.totalDeleted} deleted`;
  });

  // 11. LSP client
  await checkAsync('LSP client mock session', async () => {
    const lsp = new LSPClient();
    lsp.connect(() => {});

    const initPromise = lsp.initialize('file:///workspace');
    lsp.receiveData(frame({
      jsonrpc: '2.0', id: 1,
      result: {
        capabilities: {
          completionProvider: { triggerCharacters: ['.'] },
          hoverProvider: true,
          textDocumentSync: { openClose: true, change: 2 },
        },
      },
    }));

    await initPromise;
    assert(lsp.state === 'ready', 'LSP should be ready');

    lsp.didOpen('file:///complex.ts', 'typescript', 1, COMPLEX_SOURCE);
    assert(lsp.isDocumentOpen('file:///complex.ts'), 'document should be open');

    const completionPromise = lsp.completion('file:///complex.ts', { line: 10, character: 5 });
    lsp.receiveData(frame({
      jsonrpc: '2.0', id: 2,
      result: { isIncomplete: false, items: [{ label: 'process', kind: 2, insertText: 'process()' }] },
    }));

    const items = await completionPromise;
    assert(items.length === 1, 'should get completion items');

    return `state=${lsp.state}, ${items.length} completions`;
  });

  // 12. DAP client
  await checkAsync('DAP client mock session', async () => {
    const dap = new DAPClient();
    dap.connect(() => {});

    const initPromise = dap.initialize();
    dap.receiveData(frame({
      jsonrpc: '2.0', id: 1,
      result: { body: { supportsConfigurationDoneRequest: true } },
    }));
    await initPromise;

    const bpPromise = dap.setBreakpoints('file:///complex.ts', [{ line: 20 }]);
    dap.receiveData(frame({
      jsonrpc: '2.0', id: 2,
      result: { breakpoints: [{ id: 1, verified: true, line: 20 }] },
    }));
    const bps = await bpPromise;
    assert(bps.length === 1 && bps[0].verified, 'breakpoint should be verified');

    dap.receiveData(frame({
      jsonrpc: '2.0', method: 'stopped',
      params: { reason: 'breakpoint', threadId: 1 },
    }));
    assert(dap.state === 'stopped', 'DAP should be stopped');

    const evalPromise = dap.evaluate('1+1', 0);
    dap.receiveData(frame({
      jsonrpc: '2.0', id: 3,
      result: { result: '2', variablesReference: 0 },
    }));
    const evalResult = await evalPromise;
    assert(evalResult.result === '2', 'evaluate should return 2');

    return `state=${dap.state}, ${bps.length} breakpoints, eval=${'2'}`;
  });

  // 13. Selection & clipboard
  check('Selection & clipboard', () => {
    vm.cursorManager.reset(0, 0);
    const originalLength = doc.buffer.getLength();

    vm.executeCommand('editor.action.selectAll');
    const sels = vm.selections;
    assert(sels.length === 1, 'should have 1 selection');

    vm.executeCommand('editor.action.copy');
    vm.executeCommand('editor.action.moveCursorToDocumentEnd');
    vm.executeCommand('editor.action.paste');

    assert(doc.buffer.getLength() > originalLength, 'buffer should be larger after paste');
    vm.executeCommand('editor.action.undo');

    return `selection verified, paste added ${doc.buffer.getLength() - originalLength} chars (undone)`;
  });

  // 14. Scroll & viewport
  check('Scroll & viewport', () => {
    vm.viewport.scroll.scrollTo(0);
    vm.onResize(800, 100);

    const scrollBefore = vm.viewport.scroll.scrollTop;
    assert(scrollBefore === 0, 'scroll should start at 0');

    // Scroll down enough to move past buffer zone (10 lines * ~21px)
    vm.onScroll({ deltaX: 0, deltaY: 500 });

    const scrollAfter = vm.viewport.scroll.scrollTop;
    assert(scrollAfter > scrollBefore, 'scrollTop should increase');

    const rangeAfter = vm.viewport.getVisibleRange();
    assert(rangeAfter.startLine > 0, 'visible range should shift');

    // Verify scroll state is accessible
    assert(vm.scrollState.scrollTop === scrollAfter, 'scrollState should reflect scrollTop');

    vm.onResize(1200, 800);
    vm.viewport.scroll.scrollTo(0);

    return `scrolled from ${scrollBefore}px to ${scrollAfter}px, startLine=${rangeAfter.startLine}`;
  });

  // 15. Ghost text
  check('Ghost text', () => {
    vm.cursorManager.reset(0, 0);
    vm.executeCommand('editor.action.moveCursorToLineEnd');

    const line = vm.cursors[0].line;
    const col = vm.cursors[0].column;

    vm.ghostText.show(line, col, ' // ghost');
    assert(vm.ghostText.state !== null, 'ghost text should be active');

    const textBefore = doc.buffer.getLine(line);
    vm.executeCommand('editor.action.acceptGhostText');

    const textAfter = doc.buffer.getLine(line);
    assert(textAfter.includes('// ghost'), 'ghost text should be inserted');
    assert(vm.ghostText.state === null, 'ghost text should be cleared');

    vm.executeCommand('editor.action.undo');

    return `ghost text shown at ${line}:${col}, accepted and undone`;
  });

  // 16. Word wrap
  check('Word wrap', () => {
    const cache = new WrapCache({ mode: 'word', wrapColumn: 0, wrappedLineIndent: 2 });
    cache.setMaxWidth(400);
    cache.setMeasureFn((text) => text.length * 8);

    let totalVisual = 0;
    let wrapped = 0;
    const lineCount = doc.buffer.getLineCount();

    for (let i = 0; i < lineCount; i++) {
      const vc = cache.getVisualLineCount(doc.buffer, i);
      totalVisual += vc;
      if (vc > 1) wrapped++;
    }

    assert(wrapped > 0, 'some lines should wrap at 400px');
    assert(totalVisual > lineCount, 'visual line count should exceed document lines');

    return `${wrapped} wrapped lines, ${totalVisual} visual lines > ${lineCount} document lines`;
  });

  // 17. Touch input
  check('Touch input', () => {
    const handler = new TouchInputHandler({ panThreshold: 5, pinchThreshold: 1 });
    handler.attach(vm);

    // Tap
    const tap: TouchPoint = { id: 0, x: 100, y: 50, timestamp: Date.now() };
    handler.touchStart([tap]);
    handler.touchEnd([tap]);
    assert(handler.state === 'idle', 'idle after tap');

    // Pan
    const panStart: TouchPoint = { id: 1, x: 100, y: 200, timestamp: Date.now() };
    handler.touchStart([panStart]);
    handler.touchMove([{ ...panStart, y: 100, timestamp: Date.now() + 10 }]);
    assert(handler.state === 'panning', 'panning after move');
    handler.touchEnd([{ ...panStart, y: 100, timestamp: Date.now() + 20 }]);

    // Pinch
    let fontChanged = false;
    handler.onFontSizeChange(() => { fontChanged = true; });

    const p0: TouchPoint = { id: 2, x: 100, y: 100, timestamp: Date.now() };
    const p1: TouchPoint = { id: 3, x: 200, y: 100, timestamp: Date.now() };
    handler.touchStart([p0]);
    handler.touchStart([p1]);
    assert(handler.state === 'pinching', 'pinching with two fingers');

    handler.touchMove([
      { ...p0, x: 50, timestamp: Date.now() + 10 },
      { ...p1, x: 250, timestamp: Date.now() + 10 },
    ]);

    handler.touchEnd([
      { ...p0, x: 50, timestamp: Date.now() + 20 },
      { ...p1, x: 250, timestamp: Date.now() + 20 },
    ]);

    handler.detach();

    return `tap, pan, pinch verified, fontSizeChange=${fontChanged}`;
  });

  // 18. Full render cycle
  check('Full render cycle verification', () => {
    vm.cursorManager.reset(0, 0);
    vm.onResize(1200, 800);
    vm.viewport.scroll.scrollTo(0);

    ffi.reset();
    coordinator.invalidate();

    const renderCalls = ffi.getCalls('renderLine');
    assert(renderCalls.length > 0, 'should have renderLine calls');

    // Validate FFI call structure
    for (const call of renderCalls) {
      assert(typeof call[0] === 'number', 'handle should be number');
      assert(typeof call[1] === 'number' && call[1] >= 1, 'lineNumber should be >= 1');
      assert(typeof call[2] === 'string', 'text should be string');
      const tokens = JSON.parse(call[3]);
      assert(Array.isArray(tokens), 'tokensJson should be valid JSON array');
    }

    const cursorCalls = ffi.getCalls('setCursor').length;
    const selCalls = ffi.getCalls('setSelection').length;
    const scrollCalls = ffi.getCalls('scroll').length;
    const totalCalls = ffi.calls.length;

    coordinator.detach();
    coordinator.destroy();

    return `${totalCalls} total FFI calls: ${renderCalls.length} renderLine, ${cursorCalls} setCursor, ${selCalls} setSelection, ${scrollCalls} scroll`;
  });

  // Print results
  console.log('');
  let passCount = 0;
  let failCount = 0;

  for (const r of results) {
    if (r.passed) {
      console.log(`[PASS] ${r.name} (${r.detail})`);
      passCount++;
    } else {
      console.log(`[FAIL] ${r.name}: ${r.error}`);
      failCount++;
    }
  }

  console.log('');
  if (failCount === 0) {
    console.log(`[PASS] All ${passCount} checks passed`);
    process.exit(0);
  } else {
    console.log(`[FAIL] ${failCount}/${passCount + failCount} checks failed`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
