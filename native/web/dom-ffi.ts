/**
 * Web platform renderer for hone-editor.
 *
 * Implements the hone_editor_* FFI contract that every platform provides.
 * On macOS/iOS/Windows/Linux/Android the contract is satisfied by a Rust crate
 * linking against a platform UI framework; on web the platform UI framework is
 * the DOM, so the renderer is written in TypeScript and runs in the browser
 * host as JS imports into the Perry-compiled WASM module.
 *
 * Usage:
 *   import { createDomFfi } from '@honeide/editor/native/web/dom-ffi';
 *   const ffi = createDomFfi(document.getElementById('editor'));
 *   await bootPerryWasm(wasmBase64, ffi);
 *
 * The factory binds one mount element; the FFI then supports multiple editor
 * handles inside that mount (matching the macOS pattern of 1–3 concurrent
 * editors per process).
 */

import { resolveTokenScope } from '../../core/tokenizer/token-theme';
import { DARK_THEME, LIGHT_THEME } from '../../view-model/theme';

const EVENT_TYPE_TEXT = 1;
const EVENT_TYPE_ACTION = 2;
const EVENT_TYPE_SCROLL = 3;
const EVENT_TYPE_MOUSE_DOWN = 4;

interface PendingEvent {
  type: number;
  char: number;
  action: number;
  x: number;
  y: number;
}

/** Per-range diagnostic (gh#2). All line/col fields are 0-based. */
export interface RangeDiag {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  severity: number;   // 1=error, 2=warning, 3=info, 4=hint
  message: string;
  code?: string;
}

interface EditorState {
  root: HTMLDivElement;
  linesContainer: HTMLDivElement;
  selContainer: HTMLDivElement;
  overlayContainer: HTMLDivElement;    // find highlights / diagnostics / decorations
  gutterContainer: HTMLDivElement;     // breakpoints + fold chevrons
  cursorEl: HTMLDivElement;
  cursorEls: HTMLDivElement[];
  ghostEl: HTMLDivElement | null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  linePool: HTMLDivElement[];
  activeLines: Map<number, HTMLDivElement>;
  fontFamily: string;
  fontSize: number;
  charWidth: number;
  lineHeight: number;
  gutterWidth: number;
  scrollOffsetY: number;
  scrollDelta: number;
  scrollDeltaX: number;
  needsLines: number;
  readOnly: number;
  batchMode: boolean;
  pendingEvents: PendingEvent[];
  lineCache: Map<number, { text: string; tokens: string }>;
  lineBackgrounds: Map<number, string>;
  vpStart: number;
  vpEnd: number;
  vpScrollTop: number;
  vpTotalLines: number;
  gutterFg: string;
  selectionColor: string;
  breakpoints: Set<number>;            // 1-based line numbers
  foldedLines: Set<number>;            // 1-based line numbers that are currently folded
  // --- Host ↔ editor bridge (gh#1) ---
  bufferText: string;                  // last text pushed from WASM via set_buffer_text
  textChangeListeners: Array<(text: string) => void>;
  pendingSetText: string | null;       // queued by the host; drained by the WASM poll loop
  pendingCursor: { line: number; col: number } | null;
  // --- Per-range diagnostics (gh#2) ---
  rangeDiagnostics: RangeDiag[];
  rangeTooltipEl: HTMLDivElement | null;
  rangeHoverHandler: ((e: globalThis.MouseEvent) => void) | null;
}

let cssInjected = false;
function injectCSS(): void {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.hone-editor { position: relative; overflow: hidden; contain: strict; outline: none;
  font-variant-ligatures: contextual; -webkit-font-smoothing: antialiased;
  cursor: text; background-color: #1e1e1e; color: #d4d4d4; }
.hone-editor-lines { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
.hone-editor-line { position: absolute; left: var(--hone-gutter, 0); right: 0;
  white-space: pre; pointer-events: none; }
.hone-editor-cursor-el { position: absolute; width: 2px; pointer-events: none;
  animation: hone-blink 1s step-end infinite; }
.hone-editor-selection-rect { position: absolute; pointer-events: none; }
.hone-editor-ghost { position: absolute; pointer-events: none; white-space: pre; }
.hone-editor-decoration { position: absolute; pointer-events: none; }
.hone-editor-find-highlight { position: absolute; pointer-events: none;
  background: rgba(234, 179, 8, 0.30); border-radius: 2px; }
.hone-editor-find-highlight.current { background: rgba(234, 179, 8, 0.55);
  outline: 1px solid rgba(234, 179, 8, 0.95); }
.hone-editor-diag-line { position: absolute; left: 0; right: 0; pointer-events: none; }
.hone-editor-diag-line.severity-1 { background: rgba(220, 38, 38, 0.10); }
.hone-editor-diag-line.severity-2 { background: rgba(234, 179, 8, 0.10); }
.hone-editor-diag-line.severity-3 { background: rgba(59, 130, 246, 0.10); }
.hone-editor-diag-line.severity-4 { background: rgba(120, 120, 120, 0.08); }
.hone-editor-diag-msg { position: absolute; right: 8px; pointer-events: none;
  font-size: 0.85em; opacity: 0.7; font-style: italic;
  text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 60%; }
.hone-editor-diag-msg.severity-1 { color: #f87171; }
.hone-editor-diag-msg.severity-2 { color: #facc15; }
.hone-editor-diag-msg.severity-3 { color: #60a5fa; }
.hone-editor-diag-msg.severity-4 { color: #9ca3af; }
.hone-editor-breakpoint { position: absolute; pointer-events: none;
  width: 10px; height: 10px; border-radius: 50%; background: #e51400;
  box-shadow: 0 0 4px rgba(229, 20, 0, 0.6); }
.hone-editor-fold { position: absolute; pointer-events: none;
  color: rgba(255,255,255,0.4); font-size: 10px; line-height: 1;
  width: 12px; height: 12px; text-align: center; }
.hone-editor-range-squiggle { position: absolute; pointer-events: none;
  background-repeat: repeat-x; background-position: left bottom; background-size: 6px 3px; }
.hone-editor-range-tooltip { position: absolute; z-index: 10; pointer-events: none;
  max-width: 480px; padding: 6px 9px; border-radius: 4px;
  background: #252526; color: #d4d4d4; border: 1px solid #454545;
  box-shadow: 0 2px 8px rgba(0,0,0,0.45); font-size: 0.85em; line-height: 1.4;
  white-space: pre-wrap; word-break: break-word; }
.hone-editor-range-tooltip .hone-editor-range-code { display: block; margin-top: 3px;
  opacity: 0.6; font-size: 0.9em; }
@keyframes hone-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
`;
  document.head.appendChild(style);
}

function mapKeyToAction(key: string, ctrl: boolean, shift: boolean, meta: boolean, alt: boolean): number {
  const mod = meta || ctrl;
  if (key === 'ArrowLeft' && shift) return 15;
  if (key === 'ArrowRight' && shift) return 16;
  if (key === 'ArrowUp' && shift) return 17;
  if (key === 'ArrowDown' && shift) return 18;
  if (key === 'ArrowLeft' && alt) return 13;
  if (key === 'ArrowRight' && alt) return 14;
  if (key === 'ArrowLeft') return 1;
  if (key === 'ArrowRight') return 2;
  if (key === 'ArrowUp') return 3;
  if (key === 'ArrowDown') return 4;
  if (key === 'Home' && shift) return 19;
  if (key === 'End' && shift) return 20;
  if (key === 'Home') return 5;
  if (key === 'End') return 6;
  if (key === 'Backspace' && alt) return 27;
  if (key === 'Backspace') return 10;
  if (key === 'Delete') return 11;
  if (key === 'Enter') return 9;
  if (key === 'Tab') return 12;
  if (key === 'PageUp') return 28;
  if (key === 'PageDown') return 29;
  if (mod && key === 'a') return 21;
  if (mod && key === 'x') return 22;
  if (mod && key === 'c') return 23;
  if (mod && key === 'v') return 24;
  if (mod && key === 'z' && shift) return 26;
  if (mod && key === 'z') return 25;
  return 0;
}

/**
 * Resolve a TextMate scope string (e.g. `keyword.control`) to a hex color for
 * the active theme. Used as the web fallback when a token's WASM-resolved color
 * came through as `undefined` — `theme.tokens.*` reads return undefined inside
 * Perry's WASM (PerryTS/perry#1071), so the editor ships the scope string and
 * we resolve it here in plain JS where object access works. Delegates to the
 * same `resolveTokenScope` table the native renderers use, so web and native
 * highlight identically.
 */
export function scopeColor(scope: string, themeName: string | undefined): string {
  const theme = themeName === 'light' ? LIGHT_THEME : DARK_THEME;
  return resolveTokenScope(theme, scope);
}

function renderTokenizedLine(div: HTMLDivElement, text: string, packedTokens: string): void {
  // Format: "startCol,endCol,hexColor,styleInt|..." with optional "BG:hexColor|" prefix.
  let packed = packedTokens;
  if (packed.length > 3 && packed.charAt(0) === 'B' && packed.charAt(1) === 'G' && packed.charAt(2) === ':') {
    const bgEnd = packed.indexOf('|');
    if (bgEnd > 3) {
      div.style.backgroundColor = '#' + packed.substring(3, bgEnd);
      packed = packed.substring(bgEnd + 1);
    }
  }
  if (packed.length < 3) {
    div.textContent = text;
    return;
  }
  const segments = packed.split('|');
  let lastEnd = 0;
  for (let t = 0; t < segments.length; t++) {
    const seg = segments[t];
    if (seg.length < 3) continue;
    const parts = seg.split(',');
    if (parts.length < 3) continue;
    const s = parseInt(parts[0]) || 0;
    const e = parseInt(parts[1]) || s;
    const hex = parts[2] || 'd4d4d4';
    const styleInt = parts.length > 3 ? parseInt(parts[3]) : 0;
    if (s > lastEnd) {
      div.appendChild(document.createTextNode(text.substring(lastEnd, s)));
    }
    const span = document.createElement('span');
    span.style.color = '#' + hex;
    if (styleInt === 1) span.style.fontStyle = 'italic';
    if (styleInt === 2) span.style.fontWeight = 'bold';
    if (styleInt === 3) { span.style.fontSize = '1.4em'; span.style.fontWeight = 'bold'; }
    if (styleInt === 4) { span.style.fontSize = '1.2em'; span.style.fontWeight = 'bold'; }
    span.textContent = text.substring(s, e);
    div.appendChild(span);
    lastEnd = e;
  }
  if (lastEnd < text.length) {
    div.appendChild(document.createTextNode(text.substring(lastEnd)));
  }
}

// ── Per-range diagnostics: pure helpers (exported for unit tests) ──────────

/** Severity → squiggle/underline color (VS Code editorError/Warning/Info palette). */
export function severityColor(severity: number): string {
  if (severity === 1) return '#f14c4c'; // error
  if (severity === 2) return '#cca700'; // warning
  if (severity === 3) return '#3794ff'; // info
  return '#888888';                     // hint / unknown
}

/** A wavy-underline CSS `background` shorthand value for the given color. */
export function squiggleBackground(color: string): string {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'>" +
    "<path d='M0 2.5 Q1.5 0 3 2.5 T6 2.5' fill='none' stroke='" + color +
    "' stroke-width='0.9'/></svg>";
  return "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\")";
}

/**
 * Break a multi-line range diagnostic into one drawable segment per spanned
 * line. `lineLengths[i]` is the character length of line i; used to extend a
 * segment to end-of-line for the interior lines of a multi-line range.
 * Each segment is guaranteed at least 1 column wide so the squiggle is visible.
 */
export function computeDiagSegments(
  diag: RangeDiag,
  lineLengths: number[],
): Array<{ line: number; startCol: number; endCol: number }> {
  const out: Array<{ line: number; startCol: number; endCol: number }> = [];
  const startLine = diag.startLine < 0 ? 0 : diag.startLine;
  const endLine = diag.endLine < startLine ? startLine : diag.endLine;
  for (let line = startLine; line <= endLine; line++) {
    const lineLen = line < lineLengths.length ? lineLengths[line] : 0;
    let startCol = line === startLine ? diag.startCol : 0;
    if (startCol < 0) startCol = 0;
    let endCol = line === endLine ? diag.endCol : lineLen;
    // Interior/empty lines: fall back to line length, then a 1-col minimum.
    if (endCol <= startCol) endCol = lineLen > startCol ? lineLen : startCol + 1;
    out.push({ line, startCol, endCol });
  }
  return out;
}

/**
 * Find the first range diagnostic whose span contains the 0-based (line, col),
 * or null. Used to drive the hover tooltip via pointer hit-testing.
 */
export function rangeDiagAtPosition(
  diags: RangeDiag[],
  line: number,
  col: number,
): RangeDiag | null {
  for (let i = 0; i < diags.length; i++) {
    const d = diags[i];
    if (line < d.startLine || line > d.endLine) continue;
    if (line === d.startLine && col < d.startCol) continue;
    if (line === d.endLine && col > d.endCol) continue;
    return d;
  }
  return null;
}

/**
 * The FFI object Perry's WASM module imports. Keys are the `hone_editor_*`
 * symbols Perry will call. Pass to `bootPerryWasm(wasmBase64, ffi)`.
 */
export type HoneEditorFFI = Record<string, (...args: any[]) => number | string | void>;

/**
 * Initial editor configuration provided to mount() and forwarded to the
 * WASM-side Editor constructor through the hone_get_init_* FFI imports.
 */
export interface InitOpts {
  content?: string;
  language?: string;
  theme?: 'dark' | 'light';
  fontSize?: number;
  fontFamily?: string;
  width?: number;
  height?: number;
  readOnly?: boolean;
  /** Set to true when the tree-sitter bridge has been initialized and merged
   *  into the FFI. The Perry-compiled entry picks CompositeEngine vs
   *  KeywordSyntaxEngine based on this. */
  useTreeSitter?: boolean;
}

/**
 * Handles created across the FFI's lifetime — exposed so the JS-side controller
 * returned from `mount()` can drive overlays without going back through the
 * WASM editor instance.
 */
export interface FfiContext {
  /** Returns the most recently created editor handle, or 0 if none yet. */
  latestHandle(): number;
  /** The full set of FFI functions to pass to bootPerryWasm via __ffiImports. */
  ffi: HoneEditorFFI;
  // ── Host bridge (gh#1) ── These read/write editor state on the JS side
  // without a round-trip through the WASM Editor instance.
  /** Current buffer text (last pushed from WASM via set_buffer_text). */
  getText(handle: number): string;
  /** Queue a full-text replacement; drained by the WASM poll loop. */
  requestSetText(handle: number, value: string): void;
  /** Subscribe to text changes. Returns an unsubscribe function. */
  onTextChange(handle: number, cb: (text: string) => void): () => void;
  /** Queue a 0-based cursor move; drained by the WASM poll loop. */
  requestSetCursor(handle: number, line: number, column: number): void;
}

// ── Per-range diagnostics: DOM rendering + hover (gh#2) ────────────────────

/** Repaint the squiggle overlays for `ed.rangeDiagnostics`. */
function renderRangeSquiggles(ed: EditorState): void {
  ed.overlayContainer.querySelectorAll('.hone-editor-range-squiggle').forEach(n => n.remove());
  if (ed.rangeDiagnostics.length === 0) return;
  const lineLengths = ed.bufferText.length > 0
    ? ed.bufferText.split('\n').map(l => l.length)
    : [];
  for (const diag of ed.rangeDiagnostics) {
    const bg = squiggleBackground(severityColor(diag.severity));
    const segs = computeDiagSegments(diag, lineLengths);
    for (const seg of segs) {
      const div = document.createElement('div');
      div.className = 'hone-editor-range-squiggle';
      div.style.left = (ed.gutterWidth + seg.startCol * ed.charWidth) + 'px';
      div.style.top = (seg.line * ed.lineHeight - ed.scrollOffsetY) + 'px';
      div.style.width = ((seg.endCol - seg.startCol) * ed.charWidth) + 'px';
      div.style.height = ed.lineHeight + 'px';
      div.style.backgroundImage = bg;
      ed.overlayContainer.appendChild(div);
    }
  }
}

function hideRangeTooltip(ed: EditorState): void {
  if (ed.rangeTooltipEl) ed.rangeTooltipEl.style.display = 'none';
}

function showRangeTooltip(ed: EditorState, diag: RangeDiag, pointerX: number, line: number): void {
  let tip = ed.rangeTooltipEl;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hone-editor-range-tooltip';
    ed.root.appendChild(tip);
    ed.rangeTooltipEl = tip;
  }
  tip.innerHTML = '';
  tip.appendChild(document.createTextNode(diag.message));
  if (diag.code && diag.code.length > 0) {
    const codeEl = document.createElement('span');
    codeEl.className = 'hone-editor-range-code';
    codeEl.textContent = diag.code;
    tip.appendChild(codeEl);
  }
  tip.style.display = '';
  // Anchor under the hovered line; track the pointer's x, clamped to the view.
  const maxLeft = Math.max(0, ed.root.clientWidth - tip.offsetWidth - 8);
  tip.style.left = Math.min(Math.max(0, pointerX), maxLeft) + 'px';
  tip.style.top = ((line + 1) * ed.lineHeight - ed.scrollOffsetY + 2) + 'px';
}

/** Register the one pointer-move hit-test that drives the hover tooltip. */
function attachRangeHover(ed: EditorState): void {
  if (ed.rangeHoverHandler) return;
  const handler = (e: globalThis.MouseEvent) => {
    if (ed.rangeDiagnostics.length === 0) { hideRangeTooltip(ed); return; }
    const rect = ed.root.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const line = Math.floor((y + ed.scrollOffsetY) / ed.lineHeight);
    const col = Math.round((x - ed.gutterWidth) / ed.charWidth);
    const diag = rangeDiagAtPosition(ed.rangeDiagnostics, line, col);
    if (diag) showRangeTooltip(ed, diag, x, line);
    else hideRangeTooltip(ed);
  };
  ed.root.addEventListener('mousemove', handler);
  ed.root.addEventListener('mouseleave', () => hideRangeTooltip(ed));
  ed.rangeHoverHandler = handler;
}

/**
 * Create a DOM-backed FFI bound to a mount element. Calls to `hone_editor_create`
 * inside this FFI append the editor surface to `mount`.
 *
 * `initOpts` are surfaced as `hone_get_init_*` imports that the Perry-compiled
 * entry.ts reads at construction time.
 *
 * Returns the FFI object directly when no context is needed (legacy callers).
 * Use `createDomFfiCtx()` to get the FfiContext wrapper for the controller path.
 */
export function createDomFfi(mount: HTMLElement, initOpts: InitOpts = {}): HoneEditorFFI {
  return createDomFfiCtx(mount, initOpts).ffi;
}

/**
 * Like `createDomFfi` but returns the wrapping `FfiContext` so the caller can
 * read the most-recent handle (used by `mount()` to build the controller).
 */
export function createDomFfiCtx(mount: HTMLElement, initOpts: InitOpts = {}): FfiContext {
  if (typeof document === 'undefined') {
    throw new Error('createDomFfi requires a DOM environment');
  }
  injectCSS();

  const editors = new Map<number, EditorState>();
  let nextHandle = 1;
  let _latestHandle = 0;

  function get(h: number): EditorState | undefined {
    return editors.get(h);
  }

  function setupEvents(root: HTMLDivElement, ed: EditorState): void {
    root.addEventListener('keydown', (e) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        ed.pendingEvents.push({ type: EVENT_TYPE_TEXT, char: e.key.charCodeAt(0), action: 0, x: 0, y: 0 });
      } else {
        const actionId = mapKeyToAction(e.key, e.ctrlKey, e.shiftKey, e.metaKey, e.altKey);
        if (actionId > 0) {
          ed.pendingEvents.push({ type: EVENT_TYPE_ACTION, char: 0, action: actionId, x: 0, y: 0 });
        }
      }
      e.preventDefault();
    });

    root.addEventListener('wheel', (e) => {
      ed.pendingEvents.push({ type: EVENT_TYPE_SCROLL, char: 0, action: 0, x: e.deltaX, y: e.deltaY });
      ed.scrollDelta += e.deltaY;
      ed.scrollDeltaX += e.deltaX;
      ed.needsLines = 1;
      e.preventDefault();
    }, { passive: false });

    root.addEventListener('mousedown', (e) => {
      const rect = root.getBoundingClientRect();
      ed.pendingEvents.push({
        type: EVENT_TYPE_MOUSE_DOWN, char: 0, action: 0,
        x: e.clientX - rect.left, y: e.clientY - rect.top,
      });
      root.focus();
    });

    root.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 10) {
          ed.pendingEvents.push({ type: EVENT_TYPE_ACTION, char: 0, action: 9, x: 0, y: 0 });
        } else if (ch !== 13) {
          ed.pendingEvents.push({ type: EVENT_TYPE_TEXT, char: ch, action: 0, x: 0, y: 0 });
        }
      }
      e.preventDefault();
    });
  }

  const ffi: HoneEditorFFI = {
    hone_editor_create(width: number, height: number): number {
      const h = nextHandle++;
      const root = document.createElement('div');
      root.className = 'hone-editor';
      root.tabIndex = 0;
      root.style.width = width + 'px';
      root.style.height = height + 'px';
      // Don't set `flex: 1 1 0%` — the parent chain (perry-root in body) may not
      // be a sized flex container, in which case flex-grow collapses height to 0.
      // The explicit width/height above wins for the standalone-embed case.

      const linesContainer = document.createElement('div');
      linesContainer.className = 'hone-editor-lines';
      root.appendChild(linesContainer);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      const cursorEl = document.createElement('div');
      cursorEl.className = 'hone-editor-cursor-el';
      cursorEl.style.background = '#d4d4d4';
      root.appendChild(cursorEl);

      const selContainer = document.createElement('div');
      selContainer.style.position = 'absolute';
      selContainer.style.inset = '0';
      selContainer.style.pointerEvents = 'none';
      root.insertBefore(selContainer, linesContainer);

      // Overlay layer for find highlights + diagnostics. Sits above text so the
      // colored rectangles tint the line, below the cursor so the cursor stays
      // visible. Positioned absolutely.
      const overlayContainer = document.createElement('div');
      overlayContainer.style.position = 'absolute';
      overlayContainer.style.inset = '0';
      overlayContainer.style.pointerEvents = 'none';
      root.appendChild(overlayContainer);

      // Gutter layer for breakpoints + fold chevrons. Anchored at left edge.
      const gutterContainer = document.createElement('div');
      gutterContainer.style.position = 'absolute';
      gutterContainer.style.left = '0';
      gutterContainer.style.top = '0';
      gutterContainer.style.bottom = '0';
      gutterContainer.style.width = '20px';
      gutterContainer.style.pointerEvents = 'none';
      root.appendChild(gutterContainer);

      const ed: EditorState = {
        root, linesContainer, selContainer, overlayContainer, gutterContainer,
        cursorEl, canvas, ctx,
        cursorEls: [cursorEl],
        ghostEl: null,
        linePool: [],
        activeLines: new Map(),
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
        fontSize: 14,
        charWidth: 8.4,
        lineHeight: 21,
        gutterWidth: 0,
        scrollOffsetY: 0,
        scrollDelta: 0,
        scrollDeltaX: 0,
        needsLines: 0,
        readOnly: 0,
        batchMode: false,
        pendingEvents: [],
        lineCache: new Map(),
        lineBackgrounds: new Map(),
        vpStart: 0, vpEnd: 0, vpScrollTop: 0, vpTotalLines: 0,
        gutterFg: '#858585',
        selectionColor: 'rgba(38,79,120,0.5)',
        breakpoints: new Set(),
        foldedLines: new Set(),
        bufferText: '',
        textChangeListeners: [],
        pendingSetText: null,
        pendingCursor: null,
        rangeDiagnostics: [],
        rangeTooltipEl: null,
        rangeHoverHandler: null,
      };

      ctx.font = ed.fontSize + 'px ' + ed.fontFamily;
      ed.charWidth = ctx.measureText('M').width;

      setupEvents(root, ed);
      editors.set(h, ed);
      _latestHandle = h;

      // Auto-attach to the FFI mount. macOS uses embedNSView via perry/ui;
      // on web we own the mount directly.
      mount.appendChild(root);
      // Boot probe so headless harnesses can verify the editor came up.
      console.log('HONE_EDITOR_MOUNTED handle=' + h + ' size=' + width + 'x' + height);

      return h;
    },

    hone_editor_destroy(h: number): void {
      const ed = get(h);
      if (ed?.root.parentNode) ed.root.parentNode.removeChild(ed.root);
      editors.delete(h);
    },

    hone_editor_attach_to_view(_h: number, _parentId: number): void {
      // No-op on web — the root is attached to the FFI mount at create time.
    },

    hone_editor_nsview(h: number): number {
      // perry/ui expects an opaque view handle. Return the editor handle directly;
      // there is no Cocoa indirection on web. Return as BigInt for i64 ABI.
      return h;
    },

    hone_editor_set_font(h: number, family: string, size: number): void {
      const ed = get(h);
      if (!ed) return;
      if (typeof family === 'string' && family.length > 0) {
        ed.fontFamily = family + ', Menlo, Monaco, Courier New, monospace';
      }
      ed.fontSize = size;
      ed.lineHeight = Math.round(size * 1.5);
      ed.ctx.font = size + 'px ' + ed.fontFamily;
      ed.charWidth = ed.ctx.measureText('M').width;
      ed.root.style.fontFamily = ed.fontFamily;
      ed.root.style.fontSize = size + 'px';
      ed.root.style.lineHeight = ed.lineHeight + 'px';
    },

    hone_editor_measure_text(h: number, text: string): number {
      const ed = get(h);
      if (!ed || typeof text !== 'string') return 0;
      return ed.ctx.measureText(text).width;
    },

    hone_editor_render_line(h: number, lineNumber: number, text: string, tokensJson: string, yOffset: number): void {
      const ed = get(h);
      if (!ed) return;
      // Skip when using the TS-authoritative viewport protocol — set_viewport renders from cache.
      if (ed.lineCache.size > 0) return;

      let lineEl = ed.activeLines.get(lineNumber);
      if (!lineEl) {
        lineEl = ed.linePool.pop() ?? document.createElement('div');
        lineEl.className = 'hone-editor-line';
        lineEl.style.fontFamily = ed.fontFamily;
        lineEl.style.fontSize = ed.fontSize + 'px';
        lineEl.style.lineHeight = ed.lineHeight + 'px';
        ed.linesContainer.appendChild(lineEl);
        ed.activeLines.set(lineNumber, lineEl);
      }

      lineEl.style.top = yOffset + 'px';
      lineEl.innerHTML = '';

      // Tokens use the short-key form from editor-component.ts:_directRenderText:
      //   {"s": startCol, "e": endCol, "c": "#hexColor", "st": "normal|italic|bold|bold-italic"}
      // The Rust renderers (macOS/iOS/etc.) parse the same shape.
      let tokens: Array<{ s?: number; e?: number; c?: string; st?: string; sc?: string }> | null = null;
      if (typeof tokensJson === 'string' && tokensJson.length > 2) {
        try { tokens = JSON.parse(tokensJson); } catch {}
      }

      if (tokens && tokens.length > 0) {
        let lastEnd = 0;
        for (const tok of tokens) {
          let s = tok.s ?? 0;
          const e = tok.e ?? text.length;
          // Tree-sitter sometimes emits nested overlapping tokens for the same
          // range (e.g. `string` wrapping `string_content`). Skip any token
          // fully contained in the previously-emitted one; clip start of any
          // token that partially overlaps so we never re-emit the same chars.
          if (e <= lastEnd) continue;
          if (s < lastEnd) s = lastEnd;
          if (s > lastEnd) {
            lineEl.appendChild(document.createTextNode(text.substring(lastEnd, s)));
          }
          const span = document.createElement('span');
          // A color of "undefined" is the marker for PerryTS/perry#1071 — the
          // editor's theme.tokens.* reads return undefined inside WASM, so the
          // resolved `c` is unusable on web. When the editor also shipped the
          // scope string (`sc`), resolve the color here in JS instead of falling
          // through to the inherited foreground. (gh#3)
          if (tok.c && tok.c !== 'undefined') {
            span.style.color = tok.c;
          } else if (tok.sc && tok.sc.length > 0) {
            const resolved = scopeColor(tok.sc, initOpts.theme);
            if (resolved && resolved.length > 0) span.style.color = resolved;
          }
          const st = tok.st;
          if (st === 'italic') span.style.fontStyle = 'italic';
          else if (st === 'bold') span.style.fontWeight = 'bold';
          else if (st === 'bold-italic') { span.style.fontStyle = 'italic'; span.style.fontWeight = 'bold'; }
          span.textContent = text.substring(s, e);
          lineEl.appendChild(span);
          lastEnd = e;
        }
        if (lastEnd < text.length) {
          lineEl.appendChild(document.createTextNode(text.substring(lastEnd)));
        }
      } else {
        lineEl.textContent = text;
      }
    },

    hone_editor_set_cursor(h: number, x: number, y: number, cursorStyle: number): void {
      const ed = get(h);
      if (!ed) return;
      const el = ed.cursorEl;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.height = ed.lineHeight + 'px';
      if (cursorStyle === 1) {
        el.style.width = ed.charWidth + 'px';
        el.style.background = 'rgba(212, 212, 212, 0.4)';
      } else if (cursorStyle === 2) {
        el.style.width = ed.charWidth + 'px';
        el.style.height = '2px';
        el.style.top = (y + ed.lineHeight - 2) + 'px';
        el.style.background = '#d4d4d4';
      } else {
        el.style.width = '2px';
        el.style.background = '#d4d4d4';
      }
    },

    hone_editor_set_cursors(h: number, cursorsJson: string): void {
      const ed = get(h);
      if (!ed) return;
      let cursors: Array<{ x: number; y: number }> | null = null;
      try { cursors = JSON.parse(cursorsJson); } catch { return; }
      if (!cursors) return;
      while (ed.cursorEls.length < cursors.length) {
        const cel = document.createElement('div');
        cel.className = 'hone-editor-cursor-el';
        cel.style.background = '#d4d4d4';
        ed.root.appendChild(cel);
        ed.cursorEls.push(cel);
      }
      for (let i = cursors.length; i < ed.cursorEls.length; i++) {
        ed.cursorEls[i].style.display = 'none';
      }
      for (let j = 0; j < cursors.length; j++) {
        const c = cursors[j];
        const el = ed.cursorEls[j];
        el.style.display = '';
        el.style.left = c.x + 'px';
        el.style.top = c.y + 'px';
        el.style.height = ed.lineHeight + 'px';
        el.style.width = '2px';
      }
    },

    hone_editor_set_selection(h: number, regionsJson: string): void {
      const ed = get(h);
      if (!ed) return;
      let regions: Array<{ x: number; y: number; w: number; h: number }> | null = null;
      if (typeof regionsJson === 'string' && regionsJson.length > 2) {
        try { regions = JSON.parse(regionsJson); } catch {}
      }
      ed.selContainer.innerHTML = '';
      if (!regions || regions.length === 0) return;
      for (const r of regions) {
        const rect = document.createElement('div');
        rect.className = 'hone-editor-selection-rect';
        rect.style.left = r.x + 'px';
        rect.style.top = r.y + 'px';
        rect.style.width = r.w + 'px';
        rect.style.height = r.h + 'px';
        rect.style.background = 'rgba(38, 79, 122, 0.3)';
        ed.selContainer.appendChild(rect);
      }
    },

    hone_editor_scroll(h: number, offsetY: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.scrollOffsetY = offsetY;
      ed.linesContainer.style.transform = 'translateY(' + (-offsetY) + 'px)';
    },

    hone_editor_begin_frame(h: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.batchMode = true;
      for (const [, lineEl] of ed.activeLines) {
        lineEl.style.display = 'none';
        ed.linePool.push(lineEl);
      }
      ed.activeLines.clear();
    },

    hone_editor_end_frame(h: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.batchMode = false;
      for (const [, lineEl] of ed.activeLines) {
        lineEl.style.display = '';
      }
    },

    hone_editor_invalidate(_h: number): void {
      // No-op on web — rendering is immediate via DOM mutation.
    },

    hone_editor_render_ghost_text(h: number, text: string, x: number, y: number, color: string): void {
      const ed = get(h);
      if (!ed) return;
      if (!ed.ghostEl) {
        ed.ghostEl = document.createElement('div');
        ed.ghostEl.className = 'hone-editor-ghost';
        ed.root.appendChild(ed.ghostEl);
      }
      ed.ghostEl.style.left = x + 'px';
      ed.ghostEl.style.top = y + 'px';
      ed.ghostEl.style.color = typeof color === 'string' ? color : 'rgba(128,128,128,0.5)';
      ed.ghostEl.style.fontFamily = ed.fontFamily;
      ed.ghostEl.style.fontSize = ed.fontSize + 'px';
      ed.ghostEl.textContent = text;
      ed.ghostEl.style.display = '';
    },

    hone_editor_render_decorations(h: number, decorationsJson: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.root.querySelectorAll('.hone-editor-decoration').forEach(n => n.remove());
      let decorations: Array<{ x: number; y: number; w: number; h: number; background?: string; borderBottom?: string }> | null = null;
      try { decorations = JSON.parse(decorationsJson); } catch { return; }
      if (!decorations) return;
      for (const d of decorations) {
        const el = document.createElement('div');
        el.className = 'hone-editor-decoration';
        el.style.left = d.x + 'px';
        el.style.top = d.y + 'px';
        el.style.width = d.w + 'px';
        el.style.height = d.h + 'px';
        if (d.background) el.style.background = d.background;
        if (d.borderBottom) el.style.borderBottom = d.borderBottom;
        ed.root.appendChild(el);
      }
    },

    hone_editor_set_gutter_width(h: number, width: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.gutterWidth = width;
      ed.root.style.setProperty('--hone-gutter', width + 'px');
    },

    hone_editor_set_ts_mode(_h: number, _mode: number): void { /* TS always authoritative on web */ },
    hone_editor_set_event_callback(_h: number, _cb: number): void { /* Polling mode only on web */ },

    // --- Event queue polling ---
    hone_editor_pending_event_count(h: number): number {
      return get(h)?.pendingEvents.length ?? 0;
    },
    hone_editor_get_event_type(h: number, i: number): number {
      const ed = get(h);
      return ed && i < ed.pendingEvents.length ? ed.pendingEvents[i].type : 0;
    },
    hone_editor_get_event_char(h: number, i: number): number {
      const ed = get(h);
      return ed && i < ed.pendingEvents.length ? ed.pendingEvents[i].char : 0;
    },
    hone_editor_get_event_action(h: number, i: number): number {
      const ed = get(h);
      return ed && i < ed.pendingEvents.length ? ed.pendingEvents[i].action : 0;
    },
    hone_editor_get_event_x(h: number, i: number): number {
      const ed = get(h);
      return ed && i < ed.pendingEvents.length ? ed.pendingEvents[i].x : 0;
    },
    hone_editor_get_event_y(h: number, i: number): number {
      const ed = get(h);
      return ed && i < ed.pendingEvents.length ? ed.pendingEvents[i].y : 0;
    },
    hone_editor_clear_events(h: number): void {
      const ed = get(h);
      if (ed) ed.pendingEvents.length = 0;
    },

    // --- TS-authoritative viewport protocol ---
    hone_editor_cache_line(h: number, lineNumber: number, text: string, packedTokens: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.lineCache.set(lineNumber, { text, tokens: packedTokens });
    },

    hone_editor_clear_line_cache(h: number): void {
      const ed = get(h);
      if (ed) ed.lineCache.clear();
    },

    hone_editor_invalidate_line(h: number, lineNumber: number): void {
      const ed = get(h);
      if (ed) ed.lineCache.delete(lineNumber);
    },

    hone_editor_set_viewport(h: number, startLine: number, endLine: number, scrollTop: number, totalLines: number, lineHeight: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.vpStart = startLine;
      ed.vpEnd = endLine;
      ed.vpScrollTop = scrollTop;
      ed.vpTotalLines = totalLines;
      if (lineHeight > 0) ed.lineHeight = lineHeight;

      ed.linesContainer.innerHTML = '';
      ed.linesContainer.style.position = 'relative';
      ed.linesContainer.style.height = (totalLines * ed.lineHeight) + 'px';

      for (let line = startLine; line < endLine; line++) {
        const entry = ed.lineCache.get(line);
        const div = document.createElement('div');
        div.className = 'hone-editor-line';
        div.style.position = 'absolute';
        div.style.top = ((line - startLine) * ed.lineHeight) + 'px';
        // Inherit `left` from the CSS variable --hone-gutter set by
        // hone_editor_set_gutter_width. Don't write an inline value here:
        // gutter width is often updated AFTER the first render (line number
        // measurement, breakpoint auto-reservation, etc.), and an inline value
        // would freeze this line at the stale width.
        div.style.height = ed.lineHeight + 'px';
        div.style.lineHeight = ed.lineHeight + 'px';
        div.style.whiteSpace = 'pre';
        div.style.fontFamily = ed.fontFamily;
        div.style.fontSize = ed.fontSize + 'px';
        if (entry) {
          if (entry.tokens && entry.tokens.length > 0) {
            renderTokenizedLine(div, entry.text, entry.tokens);
          } else {
            div.textContent = entry.text;
          }
        }
        const bg = ed.lineBackgrounds.get(line);
        if (bg) div.style.backgroundColor = bg;
        ed.linesContainer.appendChild(div);
      }

      if (ed.gutterWidth > 0) {
        for (let line = startLine; line < endLine; line++) {
          const gutter = document.createElement('div');
          gutter.style.position = 'absolute';
          gutter.style.top = ((line - startLine) * ed.lineHeight) + 'px';
          gutter.style.left = '0';
          gutter.style.width = ed.gutterWidth + 'px';
          gutter.style.height = ed.lineHeight + 'px';
          gutter.style.lineHeight = ed.lineHeight + 'px';
          gutter.style.textAlign = 'right';
          gutter.style.paddingRight = '8px';
          gutter.style.fontFamily = ed.fontFamily;
          gutter.style.fontSize = ed.fontSize + 'px';
          gutter.style.color = ed.gutterFg;
          gutter.style.userSelect = 'none';
          gutter.textContent = String(line + 1);
          ed.linesContainer.appendChild(gutter);
        }
      }
    },

    hone_editor_begin_selections(h: number, _count: number): void {
      const ed = get(h);
      if (ed) ed.selContainer.innerHTML = '';
    },

    hone_editor_add_selection_rect(h: number, x: number, y: number, w: number, ht: number): void {
      const ed = get(h);
      if (!ed) return;
      const rect = document.createElement('div');
      rect.style.position = 'absolute';
      rect.style.left = x + 'px';
      rect.style.top = y + 'px';
      rect.style.width = w + 'px';
      rect.style.height = ht + 'px';
      rect.style.backgroundColor = ed.selectionColor;
      rect.style.pointerEvents = 'none';
      ed.selContainer.appendChild(rect);
    },

    hone_editor_set_read_only(h: number, mode: number): void {
      const ed = get(h);
      if (ed) ed.readOnly = mode;
    },

    // --- Line backgrounds ---
    hone_editor_set_line_background(h: number, line: number, r: number, g: number, b: number, a: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.lineBackgrounds.set(line, `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`);
    },

    hone_editor_clear_line_backgrounds(h: number): void {
      const ed = get(h);
      if (ed) ed.lineBackgrounds.clear();
    },

    // --- View metrics + scroll deltas ---
    hone_editor_get_view_width(h: number): number {
      return get(h)?.root.clientWidth ?? 800;
    },
    hone_editor_get_view_height(h: number): number {
      return get(h)?.root.clientHeight ?? 600;
    },
    hone_editor_get_scroll_delta(h: number): number {
      return get(h)?.scrollDelta ?? 0;
    },
    hone_editor_clear_scroll_delta(h: number): void {
      const ed = get(h);
      if (ed) ed.scrollDelta = 0;
    },
    hone_editor_get_scroll_delta_x(h: number): number {
      return get(h)?.scrollDeltaX ?? 0;
    },
    hone_editor_clear_scroll_delta_x(h: number): void {
      const ed = get(h);
      if (ed) ed.scrollDeltaX = 0;
    },
    hone_editor_get_scroll_x(_h: number): number { return 0; },
    hone_editor_needs_lines(h: number): number {
      const ed = get(h);
      if (!ed) return 0;
      const n = ed.needsLines;
      ed.needsLines = 0;
      return n;
    },

    // --- Clipboard ---
    hone_editor_copy_to_clipboard(_h: number, text: string): void {
      if (typeof text === 'string' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    },
    hone_editor_paste_from_clipboard(h: number): void {
      const ed = get(h);
      if (!ed || !navigator.clipboard?.readText) return;
      navigator.clipboard.readText().then((text) => {
        for (let i = 0; i < text.length; i++) {
          const ch = text.charCodeAt(i);
          if (ch === 10) ed.pendingEvents.push({ type: EVENT_TYPE_ACTION, char: 0, action: 9, x: 0, y: 0 });
          else if (ch !== 13) ed.pendingEvents.push({ type: EVENT_TYPE_TEXT, char: ch, action: 0, x: 0, y: 0 });
        }
      }).catch(() => {});
    },

    // --- Theme colors ---
    hone_editor_set_bg_color(h: number, r: number, g: number, b: number): void {
      const ed = get(h);
      if (ed) ed.root.style.backgroundColor = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    },
    hone_editor_set_fg_color(h: number, r: number, g: number, b: number): void {
      const ed = get(h);
      if (ed) ed.root.style.color = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    },
    hone_editor_set_gutter_fg_color(h: number, r: number, g: number, b: number): void {
      const ed = get(h);
      if (ed) ed.gutterFg = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    },
    hone_editor_set_selection_color(h: number, r: number, g: number, b: number, a: number): void {
      const ed = get(h);
      if (ed) ed.selectionColor = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
    },
    hone_editor_set_cursor_color(h: number, r: number, g: number, b: number): void {
      const ed = get(h);
      if (!ed) return;
      const color = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      ed.cursorEl.style.background = color;
      for (const el of ed.cursorEls) el.style.background = color;
    },

    // --- Find highlights ---
    // JSON array of {line, col, len, current} (0-based line/col, len in chars,
    // current=1 marks the active match). Same shape as macOS Rust.
    hone_editor_set_find_highlights(h: number, json: string): void {
      const ed = get(h);
      if (!ed) return;
      // Remove only find-highlight nodes; leave other overlays intact.
      ed.overlayContainer.querySelectorAll('.hone-editor-find-highlight').forEach(n => n.remove());
      let matches: Array<{ line: number; col: number; len: number; current: number }> = [];
      if (typeof json === 'string' && json.length > 2) {
        try { matches = JSON.parse(json); } catch { return; }
      }
      for (const m of matches) {
        const div = document.createElement('div');
        div.className = m.current === 1 ? 'hone-editor-find-highlight current' : 'hone-editor-find-highlight';
        div.style.left = (ed.gutterWidth + m.col * ed.charWidth) + 'px';
        div.style.top = (m.line * ed.lineHeight - ed.scrollOffsetY) + 'px';
        div.style.width = (m.len * ed.charWidth) + 'px';
        div.style.height = ed.lineHeight + 'px';
        ed.overlayContainer.appendChild(div);
      }
    },

    hone_editor_clear_find_highlights(h: number): void {
      const ed = get(h);
      if (ed) ed.overlayContainer.querySelectorAll('.hone-editor-find-highlight').forEach(n => n.remove());
    },

    // --- Diagnostics (Error Lens style) ---
    // Packed format: "line:severity:color:message\n..." (1-based lines)
    // severity: 1=error, 2=warning, 3=info, 4=hint
    hone_editor_set_line_diagnostics(h: number, packedData: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.overlayContainer.querySelectorAll('.hone-editor-diag-line, .hone-editor-diag-msg').forEach(n => n.remove());
      if (typeof packedData !== 'string' || packedData.length === 0) return;
      const lines = packedData.split('\n');
      for (const raw of lines) {
        if (raw.length === 0) continue;
        const parts = raw.split(':');
        if (parts.length < 4) continue;
        const lineNum = parseInt(parts[0], 10) - 1; // 0-based for layout
        const severity = parseInt(parts[1], 10) || 1;
        // parts[2] is the per-diagnostic color; we use the severity class instead
        // so themes stay consistent across the editor surface.
        const message = parts.slice(3).join(':');
        const top = lineNum * ed.lineHeight - ed.scrollOffsetY;

        const lineBg = document.createElement('div');
        lineBg.className = 'hone-editor-diag-line severity-' + severity;
        lineBg.style.top = top + 'px';
        lineBg.style.height = ed.lineHeight + 'px';
        ed.overlayContainer.appendChild(lineBg);

        if (message.length > 0) {
          const msg = document.createElement('div');
          msg.className = 'hone-editor-diag-msg severity-' + severity;
          msg.style.top = top + 'px';
          msg.style.lineHeight = ed.lineHeight + 'px';
          msg.textContent = message;
          ed.overlayContainer.appendChild(msg);
        }
      }
    },

    hone_editor_clear_diagnostics(h: number): void {
      const ed = get(h);
      if (ed) ed.overlayContainer.querySelectorAll('.hone-editor-diag-line, .hone-editor-diag-msg').forEach(n => n.remove());
    },

    // --- Per-range diagnostics: squiggles + hover tooltip (gh#2) ---
    // json = [{startLine,startCol,endLine,endCol,severity,message,code?}, …] (0-based)
    hone_editor_set_range_diagnostics(h: number, json: string): void {
      const ed = get(h);
      if (!ed) return;
      let diags: RangeDiag[] = [];
      if (typeof json === 'string' && json.length > 2) {
        try { const parsed = JSON.parse(json); if (Array.isArray(parsed)) diags = parsed; } catch {}
      }
      ed.rangeDiagnostics = diags;
      renderRangeSquiggles(ed);
      attachRangeHover(ed);
    },

    hone_editor_clear_range_diagnostics(h: number): void {
      const ed = get(h);
      if (!ed) return;
      ed.rangeDiagnostics = [];
      ed.overlayContainer.querySelectorAll('.hone-editor-range-squiggle').forEach(n => n.remove());
      hideRangeTooltip(ed);
    },

    // --- Host ↔ editor bridge (gh#1) ---
    // Push from WASM: store the latest buffer text and notify host listeners.
    hone_editor_set_buffer_text(h: number, text: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.bufferText = typeof text === 'string' ? text : '';
      // Multi-line range squiggles depend on line lengths — repaint if shown.
      if (ed.rangeDiagnostics.length > 0) renderRangeSquiggles(ed);
      for (let i = 0; i < ed.textChangeListeners.length; i++) {
        try { ed.textChangeListeners[i](ed.bufferText); } catch {}
      }
    },
    // Pull by WASM poll loop: drain a queued setText request.
    hone_editor_has_pending_set_text(h: number): number {
      const ed = get(h);
      return ed && ed.pendingSetText !== null ? 1 : 0;
    },
    hone_editor_take_pending_set_text(h: number): string {
      const ed = get(h);
      if (!ed || ed.pendingSetText === null) return '';
      const t = ed.pendingSetText;
      ed.pendingSetText = null;
      return t;
    },
    // Pull by WASM poll loop: drain a queued cursor move.
    hone_editor_has_pending_cursor(h: number): number {
      const ed = get(h);
      return ed && ed.pendingCursor !== null ? 1 : 0;
    },
    hone_editor_pending_cursor_line(h: number): number {
      const ed = get(h);
      return ed && ed.pendingCursor !== null ? ed.pendingCursor.line : 0;
    },
    hone_editor_pending_cursor_col(h: number): number {
      const ed = get(h);
      return ed && ed.pendingCursor !== null ? ed.pendingCursor.col : 0;
    },
    hone_editor_clear_pending_cursor(h: number): void {
      const ed = get(h);
      if (ed) ed.pendingCursor = null;
    },
    hone_editor_focus(h: number): void {
      const ed = get(h);
      if (ed && typeof ed.root.focus === 'function') ed.root.focus();
    },

    // --- Breakpoints ---
    // Newline-separated 1-based line numbers.
    hone_editor_set_breakpoints(h: number, packedLines: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.breakpoints.clear();
      if (typeof packedLines === 'string' && packedLines.length > 0) {
        for (const raw of packedLines.split('\n')) {
          const n = parseInt(raw, 10);
          if (!isNaN(n) && n > 0) ed.breakpoints.add(n);
        }
      }
      // If any breakpoints are set and the consumer didn't reserve gutter space,
      // give the gutter a default width so the dots don't overlap the text.
      if (ed.breakpoints.size > 0 && ed.gutterWidth === 0) {
        ed.gutterWidth = 20;
        ed.root.style.setProperty('--hone-gutter', '20px');
      }
      // Re-paint gutter
      ed.gutterContainer.querySelectorAll('.hone-editor-breakpoint').forEach(n => n.remove());
      for (const line of ed.breakpoints) {
        const dot = document.createElement('div');
        dot.className = 'hone-editor-breakpoint';
        dot.style.top = ((line - 1) * ed.lineHeight - ed.scrollOffsetY + (ed.lineHeight - 10) / 2) + 'px';
        dot.style.left = '4px';
        ed.gutterContainer.appendChild(dot);
      }
    },

    // --- Fold ranges ---
    // Packed format: "line:collapsed\n..." — `collapsed` is 1 for currently-folded.
    hone_editor_set_fold_ranges(h: number, packedData: string): void {
      const ed = get(h);
      if (!ed) return;
      ed.foldedLines.clear();
      ed.gutterContainer.querySelectorAll('.hone-editor-fold').forEach(n => n.remove());
      if (typeof packedData !== 'string' || packedData.length === 0) return;
      for (const raw of packedData.split('\n')) {
        if (raw.length === 0) continue;
        const parts = raw.split(':');
        const lineNum = parseInt(parts[0], 10);
        const collapsed = parts.length > 1 ? parseInt(parts[1], 10) === 1 : false;
        if (isNaN(lineNum)) continue;
        if (collapsed) ed.foldedLines.add(lineNum);
        const chev = document.createElement('div');
        chev.className = 'hone-editor-fold';
        chev.textContent = collapsed ? '▶' : '▼';
        chev.style.top = ((lineNum - 1) * ed.lineHeight - ed.scrollOffsetY + (ed.lineHeight - 12) / 2) + 'px';
        chev.style.left = '4px';
        ed.gutterContainer.appendChild(chev);
      }
    },

    // --- Tree-sitter bridge ---
    // Stubs for v1 — web doesn't ship the Rust tree-sitter bridge yet.
    // KeywordSyntaxEngine handles tokenization in the TS layer.
    hone_editor_ts_parse(_source: string, _langId: number): number { return 0; },
    hone_editor_ts_clear(): void {},
    hone_editor_ts_token_count(): number { return 0; },
    hone_editor_ts_token_start(_idx: number): number { return 0; },
    hone_editor_ts_token_end(_idx: number): number { return 0; },
    hone_editor_ts_token_scope(_idx: number): string { return ''; },
    hone_editor_set_tokenizer_language(_langId: number): void {},
    hone_editor_set_token_colors(
      _keyword: number, _str: number, _comment: number, _variable: number,
      _typename: number, _fn: number, _num: number, _def: number,
    ): void {},

    // --- iOS detection / touch polling — always false on web ---
    hone_editor_is_ios(): number { return 0; },
    hone_editor_poll_touch(_h: number): number { return 0; },

    // --- Init options ---
    // Read once by the Perry-compiled entry at module load. Defaults match the
    // Editor constructor defaults so consumers can omit fields freely.
    hone_get_init_content(): string {
      return initOpts.content ?? '';
    },
    hone_get_init_language(): string {
      return initOpts.language ?? 'typescript';
    },
    hone_get_init_theme(): string {
      return initOpts.theme ?? 'dark';
    },
    hone_get_init_font_size(): number {
      return initOpts.fontSize ?? 14;
    },
    hone_get_init_font_family(): string {
      return initOpts.fontFamily ?? 'JetBrains Mono, Menlo, Monaco, monospace';
    },
    hone_get_init_width(): number {
      // Default to the mount element's intrinsic width, or fall back to 900.
      return initOpts.width ?? (mount.clientWidth || 900);
    },
    hone_get_init_height(): number {
      return initOpts.height ?? (mount.clientHeight || 600);
    },
    hone_get_init_read_only(): number {
      return initOpts.readOnly === true ? 1 : 0;
    },
    hone_get_init_use_tree_sitter(): number {
      return initOpts.useTreeSitter === true ? 1 : 0;
    },
  };

  return {
    ffi,
    latestHandle: () => _latestHandle,
    getText: (h: number) => {
      const ed = get(h);
      return ed ? ed.bufferText : '';
    },
    requestSetText: (h: number, value: string) => {
      const ed = get(h);
      if (ed) ed.pendingSetText = typeof value === 'string' ? value : String(value);
    },
    onTextChange: (h: number, cb: (text: string) => void) => {
      const ed = get(h);
      if (!ed) return () => {};
      ed.textChangeListeners.push(cb);
      return () => {
        const i = ed.textChangeListeners.indexOf(cb);
        if (i >= 0) ed.textChangeListeners.splice(i, 1);
      };
    },
    requestSetCursor: (h: number, line: number, column: number) => {
      const ed = get(h);
      if (ed) ed.pendingCursor = { line, col: column };
    },
  };
}
