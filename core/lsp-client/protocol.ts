/**
 * LSP protocol types matching the Language Server Protocol specification.
 *
 * These are a subset of the full LSP spec, covering the features
 * used by the editor surface.
 */

// === Positions and Ranges ===

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: LspPosition;
}

// === Content Changes ===

export interface TextDocumentContentChangeEvent {
  /** Range of the change. If omitted, the entire document changed. */
  range?: LspRange;
  /** Length of the replaced range (deprecated). */
  rangeLength?: number;
  /** New text. */
  text: string;
}

// === Completion ===

export const CompletionTriggerKind = {
  Invoked: 1,
  TriggerCharacter: 2,
  TriggerForIncompleteCompletions: 3,
} as const;

export interface CompletionContext {
  triggerKind: number;
  triggerCharacter?: string;
}

export interface CompletionParams extends TextDocumentPositionParams {
  context?: CompletionContext;
}

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
}

export interface CompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

// === Hover ===

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

export interface Hover {
  contents: string | MarkupContent | (string | MarkupContent)[];
  range?: LspRange;
}

// === Diagnostics ===

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export interface DiagnosticRelatedInformation {
  location: LspLocation;
  message: string;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
  version?: number;
}

// === Signature Help ===

export interface ParameterInformation {
  label: string | [number, number];
  documentation?: string | MarkupContent;
}

export interface SignatureInformation {
  label: string;
  documentation?: string | MarkupContent;
  parameters?: ParameterInformation[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface SignatureHelpParams extends TextDocumentPositionParams {
  context?: {
    triggerKind: number;
    triggerCharacter?: string;
    isRetrigger: boolean;
    activeSignatureHelp?: SignatureHelp;
  };
}

// === Definition / References ===

export interface DefinitionParams extends TextDocumentPositionParams {}
export interface ReferenceParams extends TextDocumentPositionParams {
  context: { includeDeclaration: boolean };
}

// === Code Actions ===

export interface CodeActionContext {
  diagnostics: LspDiagnostic[];
  only?: string[];
}

export interface CodeActionParams {
  textDocument: TextDocumentIdentifier;
  range: LspRange;
  context: CodeActionContext;
}

export interface TextEdit {
  range: LspRange;
  newText: string;
}

export interface WorkspaceEdit {
  changes?: { [uri: string]: TextEdit[] };
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: LspCommand;
}

export interface LspCommand {
  title: string;
  command: string;
  arguments?: any[];
}

// === Formatting ===

export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  trimFinalNewlines?: boolean;
}

export interface DocumentFormattingParams {
  textDocument: TextDocumentIdentifier;
  options: FormattingOptions;
}

export interface DocumentRangeFormattingParams {
  textDocument: TextDocumentIdentifier;
  range: LspRange;
  options: FormattingOptions;
}

// === Initialize ===

export interface ClientCapabilities {
  textDocument?: {
    completion?: { completionItem?: { snippetSupport?: boolean } };
    hover?: { contentFormat?: string[] };
    signatureHelp?: { signatureInformation?: { parameterInformation?: { labelOffsetSupport?: boolean } } };
    codeAction?: { codeActionLiteralSupport?: { codeActionKind?: { valueSet?: string[] } } };
  };
}

export interface ServerCapabilities {
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean };
  hoverProvider?: boolean;
  signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] };
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  documentFormattingProvider?: boolean;
  documentRangeFormattingProvider?: boolean;
  codeActionProvider?: boolean | { codeActionKinds?: string[] };
  textDocumentSync?: number | { openClose?: boolean; change?: number };
}

export interface InitializeParams {
  processId: number | null;
  rootUri: string | null;
  capabilities: ClientCapabilities;
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
}
