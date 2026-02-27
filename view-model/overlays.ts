/**
 * Overlay state: autocomplete popup, hover tooltip, parameter hints, diagnostics popup.
 *
 * Overlays are positioned relative to buffer positions and adjusted
 * to stay within editor bounds.
 */

export interface CompletionItem {
  label: string;
  kind: string;
  detail?: string;
  insertText: string;
  sortText?: string;
}

export interface SignatureInfo {
  label: string;
  documentation?: string;
  parameters: { label: string; documentation?: string }[];
}

export interface Diagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface OverlayState {
  autocomplete: {
    items: CompletionItem[];
    selectedIndex: number;
    anchorPosition: OverlayPosition;
  } | null;

  hover: {
    content: string;
    anchorPosition: OverlayPosition;
  } | null;

  parameterHints: {
    signatures: SignatureInfo[];
    activeSignature: number;
    activeParameter: number;
    anchorPosition: OverlayPosition;
  } | null;

  diagnosticsPopup: {
    diagnostics: Diagnostic[];
    anchorPosition: OverlayPosition;
  } | null;
}

export class OverlayManager {
  private _state: OverlayState = {
    autocomplete: null,
    hover: null,
    parameterHints: null,
    diagnosticsPopup: null,
  };

  get state(): OverlayState {
    return this._state;
  }

  // Autocomplete

  showAutocomplete(items: CompletionItem[], position: OverlayPosition): void {
    this._state.autocomplete = {
      items,
      selectedIndex: 0,
      anchorPosition: position,
    };
  }

  selectAutocomplete(index: number): void {
    if (this._state.autocomplete) {
      this._state.autocomplete.selectedIndex = Math.max(0,
        Math.min(index, this._state.autocomplete.items.length - 1));
    }
  }

  selectNextAutocomplete(): void {
    if (this._state.autocomplete) {
      const max = this._state.autocomplete.items.length - 1;
      this._state.autocomplete.selectedIndex = Math.min(
        this._state.autocomplete.selectedIndex + 1, max);
    }
  }

  selectPrevAutocomplete(): void {
    if (this._state.autocomplete) {
      this._state.autocomplete.selectedIndex = Math.max(
        this._state.autocomplete.selectedIndex - 1, 0);
    }
  }

  getSelectedCompletion(): CompletionItem | null {
    if (!this._state.autocomplete) return null;
    return this._state.autocomplete.items[this._state.autocomplete.selectedIndex] ?? null;
  }

  hideAutocomplete(): void {
    this._state.autocomplete = null;
  }

  // Hover

  showHover(content: string, position: OverlayPosition): void {
    this._state.hover = { content, anchorPosition: position };
  }

  hideHover(): void {
    this._state.hover = null;
  }

  // Parameter hints

  showParameterHints(
    signatures: SignatureInfo[],
    activeSignature: number,
    activeParameter: number,
    position: OverlayPosition,
  ): void {
    this._state.parameterHints = {
      signatures,
      activeSignature,
      activeParameter,
      anchorPosition: position,
    };
  }

  hideParameterHints(): void {
    this._state.parameterHints = null;
  }

  // Diagnostics

  showDiagnostics(diagnostics: Diagnostic[], position: OverlayPosition): void {
    this._state.diagnosticsPopup = { diagnostics, anchorPosition: position };
  }

  hideDiagnostics(): void {
    this._state.diagnosticsPopup = null;
  }

  // Hide all overlays

  hideAll(): void {
    this._state = {
      autocomplete: null,
      hover: null,
      parameterHints: null,
      diagnosticsPopup: null,
    };
  }

  /**
   * Adjust overlay position to stay within editor bounds.
   */
  static adjustPosition(
    position: OverlayPosition,
    overlayWidth: number,
    overlayHeight: number,
    editorWidth: number,
    editorHeight: number,
  ): OverlayPosition {
    let { x, y } = position;

    // Flip horizontally if not enough space on the right
    if (x + overlayWidth > editorWidth) {
      x = Math.max(0, editorWidth - overlayWidth);
    }

    // Flip vertically if not enough space below
    if (y + overlayHeight > editorHeight) {
      y = Math.max(0, y - overlayHeight);
    }

    return { x, y };
  }
}
