/**
 * Hone Editor — Perry Showcase App
 *
 * Build:  perry compile examples/perry-app/main.ts -o examples/perry-app/demo
 * Run:    ./examples/perry-app/demo
 */

import {
  App, VStack, HStack, Text, Button, Spacer, Divider,
  widgetSetBackgroundColor, widgetSetWidth, widgetSetHugging,
  textSetString, textSetColor, textSetFontSize,
  buttonSetBordered, buttonSetTextColor,
} from 'perry/ui';
import { HoneCodeEditorWidget } from '@honeide/editor/perry';

// ── Sample content ────────────────────────────────────────────────────────────

const sampleCode = `// Welcome to Hone Editor
// A high-performance, cross-platform code editor surface.

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

interface Config {
  theme: 'dark' | 'light';
  fontSize: number;
  tabSize: number;
}

const config: Config = {
  theme: 'dark',
  fontSize: 14,
  tabSize: 2,
};

const results: number[] = [];
for (let i = 0; i < 10; i++) {
  results.push(fibonacci(i));
}

console.log('Fibonacci:', results.join(', '));

class EventEmitter<T> {
  private listeners: Array<(event: T) => void> = [];

  on(listener: (event: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  emit(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
`;

// ── Editor widget ─────────────────────────────────────────────────────────────

const hed = new HoneCodeEditorWidget(900, 580, {
  content: sampleCode,
  language: 'typescript',
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'JetBrains Mono',
});

// ── Status bar widget refs ────────────────────────────────────────────────────
// Perry closures capture by value, so callbacks must be named functions that
// read module-level refs at call time (not capture time).

let cursorLabel: unknown = null;
let editLabel: unknown = null;
let changeCount = 0;

function onEditorChange(): void {
  changeCount++;
  textSetString(editLabel, String(changeCount));

  const cursors = hed.editor.viewModel.cursors;
  if (cursors.length > 0) {
    const c = cursors[0];
    textSetString(cursorLabel, 'Ln ' + (c.line + 1) + ', Col ' + (c.column + 1));
  }
}

hed.onChange(onEditorChange);

// ── Build the UI ──────────────────────────────────────────────────────────────

// Toolbar buttons
const undoBtn = Button('Undo', () => { hed.executeCommand('editor.action.undo'); });
const redoBtn = Button('Redo', () => { hed.executeCommand('editor.action.redo'); });
const findBtn = Button('Find', () => { hed.executeCommand('editor.action.find'); });
const fontUpBtn = Button('A+', () => { hed.setFont('JetBrains Mono', 16); });
const fontDnBtn = Button('A−', () => { hed.setFont('JetBrains Mono', 12); });

buttonSetBordered(undoBtn, 0);
buttonSetBordered(redoBtn, 0);
buttonSetBordered(findBtn, 0);
buttonSetBordered(fontUpBtn, 0);
buttonSetBordered(fontDnBtn, 0);

const titleText = Text('Hone Editor');
textSetFontSize(titleText, 13);

const toolbar = HStack(12, [
  titleText,
  Divider(),
  undoBtn, redoBtn,
  Divider(),
  findBtn,
  Spacer(),
  fontUpBtn, fontDnBtn,
]);
widgetSetBackgroundColor(toolbar, 0.13, 0.13, 0.13, 1.0);  // #222

// Status bar — widget refs assigned so onEditorChange can update them
const fileLabel = Text('untitled.ts');
textSetFontSize(fileLabel, 12);
textSetColor(fileLabel, 0.7, 0.7, 0.7, 1.0);

cursorLabel = Text('Ln 1, Col 1');
textSetFontSize(cursorLabel, 12);
textSetColor(cursorLabel, 0.85, 0.85, 0.85, 1.0);

editLabel = Text('0');
textSetFontSize(editLabel, 12);
textSetColor(editLabel, 0.7, 0.7, 0.7, 1.0);

const editsTag = Text(' edits');
textSetFontSize(editsTag, 12);
textSetColor(editsTag, 0.5, 0.5, 0.5, 1.0);

const statusBar = HStack(8, [fileLabel, Spacer(), cursorLabel, editsTag, editLabel]);
widgetSetBackgroundColor(statusBar, 0.12, 0.47, 0.78, 1.0);  // VS Code blue

App({
  title: 'Hone Editor',
  width: 900,
  height: 644,
  body: VStack(0, [
    toolbar,
    hed.widget,
    statusBar,
  ]),
});
