/**
 * Hone Editor — Test App
 *
 * Standalone test harness for the editor with:
 * - Light/dark mode toggle
 * - Multiple sample files (TypeScript, JSON, Rust, C++)
 * - Font size controls
 *
 * Build:  perry compile examples/perry-test/main.ts -o examples/perry-test/test-app
 * Run:    ./examples/perry-test/test-app
 */

import {
  App, VStack, HStack, Text, Button, Spacer, Divider,
  widgetSetBackgroundColor, widgetSetHugging,
  textSetString, textSetColor, textSetFontSize, textSetFontFamily,
  buttonSetBordered,
  stackSetDistribution,
  setPadding,
} from 'perry/ui';
import { HoneCodeEditorWidget } from '@honeide/editor/perry';

// ── Sample files ─────────────────────────────────────────────────────────────

const sampleTS = `// TypeScript example
interface User {
  name: string;
  email: string;
  age: number;
  role: 'admin' | 'user' | 'guest';
}

function greet(user: User): string {
  if (user.role === 'admin') {
    return 'Welcome back, ' + user.name + '!';
  }
  return 'Hello, ' + user.name;
}

const users: User[] = [
  { name: 'Alice', email: 'alice@example.com', age: 30, role: 'admin' },
  { name: 'Bob', email: 'bob@example.com', age: 25, role: 'user' },
];

for (const user of users) {
  console.log(greet(user));
}

class EventEmitter {
  private listeners: Array<Function> = [];

  on(listener: Function): void {
    this.listeners.push(listener);
  }

  emit(event: any): void {
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](event);
    }
  }
}
`;

const sampleJSON = `{
  "name": "Alice",
  "email": "alice@example.com",
  "age": 30,
  "role": "admin",
  "address": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701"
  },
  "tags": ["developer", "manager", "open-source"],
  "active": true,
  "score": 98.5,
  "metadata": null
}
`;

const sampleRust = `// Rust example
use std::collections::HashMap;

struct Config {
    name: String,
    values: HashMap<String, i64>,
    enabled: bool,
}

impl Config {
    fn new(name: &str) -> Self {
        Config {
            name: name.to_string(),
            values: HashMap::new(),
            enabled: true,
        }
    }

    fn set(&mut self, key: &str, value: i64) {
        self.values.insert(key.to_string(), value);
    }

    fn get(&self, key: &str) -> Option<i64> {
        self.values.get(key).copied()
    }
}

fn main() {
    let mut config = Config::new("production");
    config.set("max_connections", 100);
    config.set("timeout_ms", 5000);

    match config.get("max_connections") {
        Some(v) => println!("Max connections: {}", v),
        None => println!("Not configured"),
    }
}
`;

const sampleCPP = `// C++ example
#include <iostream>
#include <vector>
#include <memory>
#include <string>

template<typename T>
class Stack {
private:
    std::vector<T> data;

public:
    void push(const T& value) {
        data.push_back(value);
    }

    T pop() {
        T value = data.back();
        data.pop_back();
        return value;
    }

    bool empty() const {
        return data.empty();
    }

    size_t size() const {
        return data.size();
    }
};

int main() {
    Stack<std::string> stack;
    stack.push("hello");
    stack.push("world");

    while (!stack.empty()) {
        std::cout << stack.pop() << std::endl;
    }

    return 0;
}
`;

// ── Theme colors ─────────────────────────────────────────────────────────────

const dkBg = 0.118;
const dkBar = 0.17;
const dkStatus = 0.13;

const ltBg = 1.0;
const ltBar = 0.96;
const ltStatus = 0.93;

// ── State ────────────────────────────────────────────────────────────────────

let isDark = 1;
let currentFontSize = 14;

// ── Editor ───────────────────────────────────────────────────────────────────

const hed = new HoneCodeEditorWidget(900, 500, {
  content: sampleTS,
  language: 'typescript',
  theme: 'dark',
  fontSize: 14,
  fontFamily: 'Menlo',
});

// ── Widget refs ──────────────────────────────────────────────────────────────

const titleText = Text('Hone Editor Test');
textSetFontSize(titleText, 13);
textSetFontFamily(titleText, 'Menlo');
textSetColor(titleText, 0.85, 0.85, 0.85, 1.0);

const fileLabel = Text('typescript.ts');
textSetFontSize(fileLabel, 12);
textSetFontFamily(fileLabel, 'Menlo');
textSetColor(fileLabel, 0.7, 0.7, 0.7, 1.0);

const themeLabel = Text('Dark');
textSetFontSize(themeLabel, 12);
textSetFontFamily(themeLabel, 'Menlo');
textSetColor(themeLabel, 0.7, 0.7, 0.7, 1.0);

const fontLabel = Text('14px');
textSetFontSize(fontLabel, 12);
textSetFontFamily(fontLabel, 'Menlo');
textSetColor(fontLabel, 0.7, 0.7, 0.7, 1.0);

// ── File buttons ─────────────────────────────────────────────────────────────

const btnTS = Button('TypeScript', () => {
  hed.setContent(sampleTS);
  textSetString(fileLabel, 'typescript.ts');
});
buttonSetBordered(btnTS, 0);

const btnJSON = Button('JSON', () => {
  hed.setContent(sampleJSON);
  textSetString(fileLabel, 'document.json');
});
buttonSetBordered(btnJSON, 0);

const btnRust = Button('Rust', () => {
  hed.setContent(sampleRust);
  textSetString(fileLabel, 'config.rs');
});
buttonSetBordered(btnRust, 0);

const btnCPP = Button('C++', () => {
  hed.setContent(sampleCPP);
  textSetString(fileLabel, 'stack.cpp');
});
buttonSetBordered(btnCPP, 0);

// ── Theme toggle ─────────────────────────────────────────────────────────────

function applyDark(): void {
  isDark = 1;
  textSetString(themeLabel, 'Dark');
  const ed = hed.editor;
  ed.setBgColor(dkBg, dkBg, dkBg);
  ed.setFgColor(0.831, 0.831, 0.831);
  ed.setGutterFgColor(0.52, 0.52, 0.52);
  ed.setCursorColor(0.68, 0.69, 0.68);
  ed.setSelectionColor(0.15, 0.31, 0.47, 1.0);
  widgetSetBackgroundColor(toolbar, dkBar, dkBar, dkBar, 1.0);
  widgetSetBackgroundColor(statusBar, dkStatus, dkStatus, dkStatus, 1.0);
  widgetSetBackgroundColor(appBody, dkBg, dkBg, dkBg, 1.0);
  textSetColor(fileLabel, 0.7, 0.7, 0.7, 1.0);
  textSetColor(themeLabel, 0.7, 0.7, 0.7, 1.0);
  textSetColor(fontLabel, 0.7, 0.7, 0.7, 1.0);
  textSetColor(titleText, 0.85, 0.85, 0.85, 1.0);
}

function applyLight(): void {
  isDark = 0;
  textSetString(themeLabel, 'Light');
  const ed = hed.editor;
  ed.setBgColor(ltBg, ltBg, ltBg);
  ed.setFgColor(0.141, 0.161, 0.180);
  ed.setGutterFgColor(0.59, 0.6, 0.62);
  ed.setCursorColor(0.141, 0.161, 0.180);
  ed.setSelectionColor(0.01, 0.4, 0.84, 0.15);
  widgetSetBackgroundColor(toolbar, ltBar, ltBar, ltBar, 1.0);
  widgetSetBackgroundColor(statusBar, ltStatus, ltStatus, ltStatus, 1.0);
  widgetSetBackgroundColor(appBody, ltBg, ltBg, ltBg, 1.0);
  textSetColor(fileLabel, 0.3, 0.3, 0.3, 1.0);
  textSetColor(themeLabel, 0.3, 0.3, 0.3, 1.0);
  textSetColor(fontLabel, 0.3, 0.3, 0.3, 1.0);
  textSetColor(titleText, 0.15, 0.15, 0.15, 1.0);
}

const themeBtn = Button('Toggle Theme', () => {
  if (isDark > 0) { applyLight(); } else { applyDark(); }
});
buttonSetBordered(themeBtn, 0);

// ── Font controls ────────────────────────────────────────────────────────────

const fontUpBtn = Button('A+', () => {
  currentFontSize = currentFontSize + 2;
  hed.setFont('Menlo', currentFontSize);
  textSetString(fontLabel, currentFontSize + 'px');
});
buttonSetBordered(fontUpBtn, 0);

const fontDnBtn = Button('A-', () => {
  if (currentFontSize > 8) currentFontSize = currentFontSize - 2;
  hed.setFont('Menlo', currentFontSize);
  textSetString(fontLabel, currentFontSize + 'px');
});
buttonSetBordered(fontDnBtn, 0);

// ── Layout ───────────────────────────────────────────────────────────────────

const toolbar = HStack(8, [
  titleText, Divider(),
  btnTS, btnJSON, btnRust, btnCPP, Divider(),
  themeBtn,
  Spacer(),
  fontDnBtn, fontLabel, fontUpBtn,
]);
setPadding(toolbar, 6, 12, 6, 12);
widgetSetBackgroundColor(toolbar, dkBar, dkBar, dkBar, 1.0);

const statusBar = HStack(12, [fileLabel, Spacer(), themeLabel]);
setPadding(statusBar, 4, 12, 4, 12);
widgetSetBackgroundColor(statusBar, dkStatus, dkStatus, dkStatus, 1.0);

const appBody = VStack(0, [toolbar, hed.widget, statusBar]);
widgetSetBackgroundColor(appBody, dkBg, dkBg, dkBg, 1.0);
stackSetDistribution(appBody, 0);
widgetSetHugging(toolbar, 750);
widgetSetHugging(statusBar, 750);

App({
  title: 'Hone Editor Test',
  width: 960,
  height: 640,
  body: appBody,
});
