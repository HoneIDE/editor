/**
 * LSP client: high-level API for language server communication.
 *
 * Wraps the JSON-RPC transport with typed methods for each LSP feature.
 * Handles the initialize/initialized lifecycle and document synchronization.
 */

import { JsonRpcTransport, WriteCallback } from './transport';
import { ServerCapabilityChecker, getDefaultClientCapabilities } from './capabilities';
import type {
  InitializeResult,
  ServerCapabilities,
  CompletionParams,
  CompletionList,
  LspCompletionItem,
  Hover,
  LspDiagnostic,
  LspLocation,
  LspPosition,
  LspRange,
  SignatureHelp,
  SignatureHelpParams,
  CodeAction,
  CodeActionParams,
  CodeActionContext,
  TextEdit,
  FormattingOptions,
  TextDocumentContentChangeEvent,
  PublishDiagnosticsParams,
  CompletionTriggerKind,
} from './protocol';

export type DiagnosticsHandler = (uri: string, diagnostics: LspDiagnostic[]) => void;

export type LspState = 'disconnected' | 'connecting' | 'initializing' | 'ready' | 'error';

export class LSPClient {
  private transport: JsonRpcTransport;
  private capabilities: ServerCapabilityChecker | null = null;
  private _state: LspState = 'disconnected';
  private _rootUri: string | null = null;
  private _openDocuments: Set<string> = new Set();
  private _diagnosticsHandler: DiagnosticsHandler | null = null;

  constructor() {
    this.transport = new JsonRpcTransport();
  }

  get state(): LspState {
    return this._state;
  }

  get serverCapabilities(): ServerCapabilityChecker | null {
    return this.capabilities;
  }

  /**
   * Connect the transport to a server via write callback.
   * The native layer calls receiveData() when data arrives from the server.
   */
  connect(writeCallback: WriteCallback): void {
    this._state = 'connecting';
    this.transport.setWriter(writeCallback);
    this.transport.setErrorHandler((err) => {
      this._state = 'error';
    });
  }

  /**
   * Feed incoming data from the server's stdout.
   */
  receiveData(data: string): void {
    this.transport.receiveData(data);
  }

  /**
   * Initialize the LSP session.
   */
  async initialize(rootUri: string | null): Promise<ServerCapabilities> {
    this._state = 'initializing';
    this._rootUri = rootUri;

    // Register diagnostics notification handler
    this.transport.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
      this._diagnosticsHandler?.(params.uri, params.diagnostics);
    });

    const result = await this.transport.sendRequest<InitializeResult>('initialize', {
      processId: null,
      rootUri,
      capabilities: getDefaultClientCapabilities(),
    });

    this.capabilities = new ServerCapabilityChecker(result.capabilities);

    // Send initialized notification
    this.transport.sendNotification('initialized', {});

    this._state = 'ready';
    return result.capabilities;
  }

  /**
   * Shutdown the server.
   */
  async shutdown(): Promise<void> {
    await this.transport.sendRequest('shutdown');
    this.transport.sendNotification('exit');
    this._state = 'disconnected';
    this._openDocuments.clear();
  }

  /**
   * Set handler for diagnostics notifications.
   */
  onDiagnostics(handler: DiagnosticsHandler): void {
    this._diagnosticsHandler = handler;
  }

  // === Document Synchronization ===

  /**
   * Notify the server that a document was opened.
   */
  didOpen(uri: string, languageId: string, version: number, text: string): void {
    if (!this.capabilities?.supportsOpenClose) return;

    this._openDocuments.add(uri);
    this.transport.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    });
  }

  /**
   * Notify the server that a document was changed.
   */
  didChange(uri: string, version: number, changes: TextDocumentContentChangeEvent[]): void {
    const syncKind = this.capabilities?.textDocumentSyncKind ?? 0;
    if (syncKind === 0) return; // No sync

    this.transport.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: changes,
    });
  }

  /**
   * Notify the server with a full document content change.
   */
  didChangeFullContent(uri: string, version: number, text: string): void {
    this.didChange(uri, version, [{ text }]);
  }

  /**
   * Notify the server that a document was closed.
   */
  didClose(uri: string): void {
    if (!this.capabilities?.supportsOpenClose) return;

    this._openDocuments.delete(uri);
    this.transport.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  /**
   * Notify the server that a document was saved.
   */
  didSave(uri: string, text?: string): void {
    this.transport.sendNotification('textDocument/didSave', {
      textDocument: { uri },
      text,
    });
  }

  // === Language Features ===

  /**
   * Request completion items.
   */
  async completion(
    uri: string,
    position: LspPosition,
    triggerKind?: number,
    triggerCharacter?: string,
  ): Promise<LspCompletionItem[]> {
    if (!this.capabilities?.hasCompletion) return [];

    const params: CompletionParams = {
      textDocument: { uri },
      position,
      context: triggerKind !== undefined
        ? { triggerKind, triggerCharacter }
        : undefined,
    };

    const result = await this.transport.sendRequest<CompletionList | LspCompletionItem[]>(
      'textDocument/completion',
      params,
    );

    if (Array.isArray(result)) {
      return result;
    }
    return result.items;
  }

  /**
   * Request hover information.
   */
  async hover(uri: string, position: LspPosition): Promise<Hover | null> {
    if (!this.capabilities?.hasHover) return null;

    return this.transport.sendRequest<Hover | null>('textDocument/hover', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Request go-to-definition.
   */
  async definition(uri: string, position: LspPosition): Promise<LspLocation | LspLocation[] | null> {
    if (!this.capabilities?.hasDefinition) return null;

    return this.transport.sendRequest<LspLocation | LspLocation[] | null>('textDocument/definition', {
      textDocument: { uri },
      position,
    });
  }

  /**
   * Request find-all-references.
   */
  async references(
    uri: string,
    position: LspPosition,
    includeDeclaration: boolean = true,
  ): Promise<LspLocation[]> {
    if (!this.capabilities?.hasReferences) return [];

    return this.transport.sendRequest<LspLocation[]>('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    });
  }

  /**
   * Request signature help.
   */
  async signatureHelp(
    uri: string,
    position: LspPosition,
    triggerCharacter?: string,
  ): Promise<SignatureHelp | null> {
    if (!this.capabilities?.hasSignatureHelp) return null;

    const params: SignatureHelpParams = {
      textDocument: { uri },
      position,
      context: triggerCharacter !== undefined
        ? { triggerKind: 2, triggerCharacter, isRetrigger: false }
        : { triggerKind: 1, isRetrigger: false },
    };

    return this.transport.sendRequest<SignatureHelp | null>('textDocument/signatureHelp', params);
  }

  /**
   * Request code actions (quick fixes, refactorings).
   */
  async codeAction(
    uri: string,
    range: LspRange,
    diagnostics: LspDiagnostic[],
  ): Promise<CodeAction[]> {
    if (!this.capabilities?.hasCodeAction) return [];

    const params: CodeActionParams = {
      textDocument: { uri },
      range,
      context: { diagnostics },
    };

    return this.transport.sendRequest<CodeAction[]>('textDocument/codeAction', params);
  }

  /**
   * Request document formatting.
   */
  async format(uri: string, options: FormattingOptions): Promise<TextEdit[]> {
    if (!this.capabilities?.hasFormatting) return [];

    return this.transport.sendRequest<TextEdit[]>('textDocument/formatting', {
      textDocument: { uri },
      options,
    });
  }

  /**
   * Request range formatting.
   */
  async rangeFormat(uri: string, range: LspRange, options: FormattingOptions): Promise<TextEdit[]> {
    if (!this.capabilities?.hasRangeFormatting) return [];

    return this.transport.sendRequest<TextEdit[]>('textDocument/rangeFormatting', {
      textDocument: { uri },
      range,
      options,
    });
  }

  /**
   * Check if a document is currently open.
   */
  isDocumentOpen(uri: string): boolean {
    return this._openDocuments.has(uri);
  }

  /**
   * Cancel all pending requests.
   */
  cancelPendingRequests(): void {
    this.transport.cancelAll();
  }
}
