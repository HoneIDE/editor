/**
 * Debug Adapter Protocol client.
 *
 * Manages debug sessions: launch/attach, breakpoints, stepping,
 * stack frames, variables. Uses the same JSON-RPC transport pattern
 * as the LSP client but with DAP-specific message framing.
 */

import { JsonRpcTransport, WriteCallback } from '../lsp-client/transport';
import type {
  Breakpoint,
  SourceBreakpoint,
  Source,
  StackFrame,
  Scope,
  Variable,
  Thread,
  Capabilities,
  StoppedEventBody,
  OutputEventBody,
  TerminatedEventBody,
  BreakpointEventBody,
} from './protocol';

export type DapState = 'disconnected' | 'initializing' | 'running' | 'stopped' | 'terminated';

export interface DebugEventHandlers {
  onStopped?: (body: StoppedEventBody) => void;
  onTerminated?: (body?: TerminatedEventBody) => void;
  onOutput?: (body: OutputEventBody) => void;
  onBreakpoint?: (body: BreakpointEventBody) => void;
  onExited?: (exitCode: number) => void;
}

export class DAPClient {
  private transport: JsonRpcTransport;
  private _state: DapState = 'disconnected';
  private _capabilities: Capabilities | null = null;
  private _eventHandlers: DebugEventHandlers = {};
  private _breakpoints: Map<string, SourceBreakpoint[]> = new Map(); // uri -> breakpoints
  private _activeThreadId: number = -1;

  constructor() {
    this.transport = new JsonRpcTransport();
  }

  get state(): DapState {
    return this._state;
  }

  get capabilities(): Capabilities | null {
    return this._capabilities;
  }

  get activeThreadId(): number {
    return this._activeThreadId;
  }

  /**
   * Connect the transport to a debug adapter.
   */
  connect(writeCallback: WriteCallback): void {
    this.transport.setWriter(writeCallback);
    this.transport.setErrorHandler(() => {
      this._state = 'disconnected';
    });
    this.registerEventHandlers();
  }

  /**
   * Feed incoming data from the debug adapter.
   */
  receiveData(data: string): void {
    this.transport.receiveData(data);
  }

  /**
   * Set event handlers.
   */
  setEventHandlers(handlers: DebugEventHandlers): void {
    this._eventHandlers = handlers;
  }

  /**
   * Initialize the debug adapter.
   */
  async initialize(): Promise<Capabilities> {
    this._state = 'initializing';

    const result = await this.transport.sendRequest<{ body: Capabilities }>('initialize', {
      clientID: 'hone-editor',
      clientName: 'Hone Editor',
      adapterID: 'generic',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: false,
    });

    this._capabilities = result.body ?? result as any;
    return this._capabilities;
  }

  /**
   * Launch a debug session.
   */
  async launch(config: Record<string, any>): Promise<void> {
    await this.transport.sendRequest('launch', config);
    this._state = 'running';

    // Send configurationDone if supported
    if (this._capabilities?.supportsConfigurationDoneRequest) {
      await this.transport.sendRequest('configurationDone');
    }
  }

  /**
   * Attach to a running process.
   */
  async attach(config: Record<string, any>): Promise<void> {
    await this.transport.sendRequest('attach', config);
    this._state = 'running';

    if (this._capabilities?.supportsConfigurationDoneRequest) {
      await this.transport.sendRequest('configurationDone');
    }
  }

  /**
   * Disconnect from the debug session.
   */
  async disconnect(restart: boolean = false): Promise<void> {
    await this.transport.sendRequest('disconnect', { restart });
    this._state = 'disconnected';
    this._breakpoints.clear();
    this._activeThreadId = -1;
  }

  /**
   * Terminate the debug session.
   */
  async terminate(): Promise<void> {
    if (this._capabilities?.supportsTerminateRequest) {
      await this.transport.sendRequest('terminate');
    } else {
      await this.disconnect();
    }
  }

  // === Breakpoints ===

  /**
   * Set breakpoints for a source file.
   * Replaces all breakpoints for that file.
   */
  async setBreakpoints(
    uri: string,
    breakpoints: SourceBreakpoint[],
  ): Promise<Breakpoint[]> {
    const source: Source = { path: uri };
    this._breakpoints.set(uri, [...breakpoints]);

    const result = await this.transport.sendRequest<{ breakpoints: Breakpoint[] }>(
      'setBreakpoints',
      { source, breakpoints },
    );

    return result.breakpoints;
  }

  /**
   * Toggle a breakpoint on a specific line.
   */
  async toggleBreakpoint(uri: string, line: number): Promise<Breakpoint[]> {
    const existing = this._breakpoints.get(uri) ?? [];
    const idx = existing.findIndex(b => b.line === line);

    if (idx !== -1) {
      existing.splice(idx, 1);
    } else {
      existing.push({ line });
    }

    return this.setBreakpoints(uri, existing);
  }

  /**
   * Clear all breakpoints for a file.
   */
  async clearBreakpoints(uri: string): Promise<void> {
    await this.setBreakpoints(uri, []);
  }

  /**
   * Get the current breakpoints for a file.
   */
  getBreakpoints(uri: string): readonly SourceBreakpoint[] {
    return this._breakpoints.get(uri) ?? [];
  }

  // === Execution Control ===

  /**
   * Continue execution.
   */
  async continue(threadId?: number): Promise<void> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return;

    await this.transport.sendRequest('continue', { threadId: tid });
    this._state = 'running';
  }

  /**
   * Step over (next line).
   */
  async next(threadId?: number): Promise<void> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return;

    await this.transport.sendRequest('next', { threadId: tid });
    this._state = 'running';
  }

  /**
   * Step into.
   */
  async stepIn(threadId?: number): Promise<void> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return;

    await this.transport.sendRequest('stepIn', { threadId: tid });
    this._state = 'running';
  }

  /**
   * Step out.
   */
  async stepOut(threadId?: number): Promise<void> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return;

    await this.transport.sendRequest('stepOut', { threadId: tid });
    this._state = 'running';
  }

  /**
   * Pause execution.
   */
  async pause(threadId?: number): Promise<void> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return;

    await this.transport.sendRequest('pause', { threadId: tid });
  }

  /**
   * Restart the debug session.
   */
  async restart(): Promise<void> {
    if (this._capabilities?.supportsRestartRequest) {
      await this.transport.sendRequest('restart');
      this._state = 'running';
    }
  }

  // === Inspection ===

  /**
   * Get all threads.
   */
  async threads(): Promise<Thread[]> {
    const result = await this.transport.sendRequest<{ threads: Thread[] }>('threads');
    return result.threads;
  }

  /**
   * Get the call stack for a thread.
   */
  async stackTrace(threadId?: number, levels: number = 20): Promise<StackFrame[]> {
    const tid = threadId ?? this._activeThreadId;
    if (tid < 0) return [];

    const result = await this.transport.sendRequest<{ stackFrames: StackFrame[] }>(
      'stackTrace',
      { threadId: tid, startFrame: 0, levels },
    );

    return result.stackFrames;
  }

  /**
   * Get scopes for a stack frame.
   */
  async scopes(frameId: number): Promise<Scope[]> {
    const result = await this.transport.sendRequest<{ scopes: Scope[] }>(
      'scopes',
      { frameId },
    );

    return result.scopes;
  }

  /**
   * Get variables for a scope or container.
   */
  async variables(variablesReference: number, start?: number, count?: number): Promise<Variable[]> {
    const result = await this.transport.sendRequest<{ variables: Variable[] }>(
      'variables',
      { variablesReference, start, count },
    );

    return result.variables;
  }

  /**
   * Evaluate an expression in the current context.
   */
  async evaluate(expression: string, frameId?: number, context?: string): Promise<{ result: string; variablesReference: number }> {
    return this.transport.sendRequest('evaluate', {
      expression,
      frameId,
      context: context ?? 'repl',
    });
  }

  // === Internal ===

  private registerEventHandlers(): void {
    this.transport.onNotification('stopped', (body: StoppedEventBody) => {
      this._state = 'stopped';
      if (body.threadId !== undefined) {
        this._activeThreadId = body.threadId;
      }
      this._eventHandlers.onStopped?.(body);
    });

    this.transport.onNotification('terminated', (body?: TerminatedEventBody) => {
      this._state = 'terminated';
      this._eventHandlers.onTerminated?.(body);
    });

    this.transport.onNotification('exited', (body: { exitCode: number }) => {
      this._eventHandlers.onExited?.(body.exitCode);
    });

    this.transport.onNotification('output', (body: OutputEventBody) => {
      this._eventHandlers.onOutput?.(body);
    });

    this.transport.onNotification('breakpoint', (body: BreakpointEventBody) => {
      this._eventHandlers.onBreakpoint?.(body);
    });
  }
}
