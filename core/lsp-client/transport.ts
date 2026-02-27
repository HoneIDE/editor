/**
 * JSON-RPC transport layer for LSP communication.
 *
 * Handles message framing (Content-Length headers), request/response
 * correlation, and bidirectional message streaming.
 *
 * This is a platform-independent implementation. The actual stdio/pipe
 * connection is abstracted behind read/write callbacks that the native
 * layer provides.
 */

// === JSON-RPC Types ===

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// Standard JSON-RPC error codes
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
} as const;

// === Transport Abstraction ===

/**
 * Write callback: sends raw bytes to the server process.
 * The native layer provides this (stdio pipe, socket, etc.).
 */
export type WriteCallback = (data: string) => void;

/**
 * Pending request tracker for correlating responses.
 */
interface PendingRequest {
  method: string;
  resolve: (result: any) => void;
  reject: (error: JsonRpcError) => void;
  timestamp: number;
}

/**
 * JSON-RPC transport for LSP/DAP communication.
 *
 * Encodes outgoing messages with Content-Length headers.
 * Decodes incoming messages from a stream of bytes.
 * Tracks pending requests for response correlation.
 */
export class JsonRpcTransport {
  private _nextId: number = 1;
  private _pendingRequests: Map<number, PendingRequest> = new Map();
  private _notificationHandlers: Map<string, ((params: any) => void)[]> = new Map();
  private _requestHandlers: Map<string, (params: any) => any> = new Map();
  private _writeCallback: WriteCallback | null = null;
  private _onError: ((error: Error) => void) | null = null;

  // Incoming message buffer for Content-Length framing
  private _buffer: string = '';
  private _expectedLength: number = -1;
  private _headerComplete: boolean = false;

  /**
   * Set the write callback for sending data to the server.
   */
  setWriter(callback: WriteCallback): void {
    this._writeCallback = callback;
  }

  /**
   * Set error handler.
   */
  setErrorHandler(handler: (error: Error) => void): void {
    this._onError = handler;
  }

  /**
   * Send a request and return a promise for the response.
   */
  sendRequest<T = any>(method: string, params?: any): Promise<T> {
    const id = this._nextId++;

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this._pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      this.writeMessage(message);
    });
  }

  /**
   * Send a notification (no response expected).
   */
  sendNotification(method: string, params?: any): void {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.writeMessage(message);
  }

  /**
   * Register a handler for server-initiated notifications.
   */
  onNotification(method: string, handler: (params: any) => void): () => void {
    const handlers = this._notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this._notificationHandlers.set(method, handlers);

    return () => {
      const list = this._notificationHandlers.get(method);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  /**
   * Register a handler for server-initiated requests.
   */
  onRequest(method: string, handler: (params: any) => any): () => void {
    this._requestHandlers.set(method, handler);
    return () => {
      if (this._requestHandlers.get(method) === handler) {
        this._requestHandlers.delete(method);
      }
    };
  }

  /**
   * Feed incoming data from the server process.
   * Call this whenever data is received from the server's stdout.
   */
  receiveData(data: string): void {
    this._buffer += data;
    this.processBuffer();
  }

  /**
   * Cancel a pending request.
   */
  cancelRequest(id: number): void {
    const pending = this._pendingRequests.get(id);
    if (pending) {
      this._pendingRequests.delete(id);
      pending.reject({
        code: ErrorCodes.RequestCancelled,
        message: 'Request cancelled',
      });
      // Send $/cancelRequest notification
      this.sendNotification('$/cancelRequest', { id });
    }
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    for (const [id, pending] of this._pendingRequests) {
      pending.reject({
        code: ErrorCodes.RequestCancelled,
        message: 'All requests cancelled',
      });
    }
    this._pendingRequests.clear();
  }

  /**
   * Get number of pending requests.
   */
  get pendingCount(): number {
    return this._pendingRequests.size;
  }

  // === Internal ===

  private writeMessage(message: JsonRpcMessage): void {
    if (!this._writeCallback) {
      this._onError?.(new Error('No write callback set'));
      return;
    }

    const body = JSON.stringify(message);
    const header = `Content-Length: ${byteLength(body)}\r\n\r\n`;

    this._writeCallback(header + body);
  }

  private processBuffer(): void {
    while (this._buffer.length > 0) {
      if (!this._headerComplete) {
        // Look for the header/body separator
        const headerEnd = this._buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return; // Need more data

        const header = this._buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this._onError?.(new Error(`Invalid LSP header: ${header}`));
          this._buffer = this._buffer.substring(headerEnd + 4);
          continue;
        }

        this._expectedLength = parseInt(match[1], 10);
        this._headerComplete = true;
        this._buffer = this._buffer.substring(headerEnd + 4);
      }

      // Check if we have the full body
      if (this._buffer.length < this._expectedLength) return; // Need more data

      const body = this._buffer.substring(0, this._expectedLength);
      this._buffer = this._buffer.substring(this._expectedLength);
      this._headerComplete = false;
      this._expectedLength = -1;

      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: any;
    try {
      message = JSON.parse(body);
    } catch {
      this._onError?.(new Error(`Failed to parse JSON-RPC message: ${body.substring(0, 100)}`));
      return;
    }

    if ('id' in message && 'method' in message) {
      // Server request
      this.handleServerRequest(message);
    } else if ('id' in message) {
      // Response to our request
      this.handleResponse(message);
    } else if ('method' in message) {
      // Server notification
      this.handleNotification(message);
    } else {
      this._onError?.(new Error(`Unknown JSON-RPC message type: ${JSON.stringify(message).substring(0, 100)}`));
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this._pendingRequests.get(message.id);
    if (!pending) {
      // Response for unknown request (might have been cancelled)
      return;
    }

    this._pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(message.error);
    } else {
      pending.resolve(message.result);
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    const handlers = this._notificationHandlers.get(message.method);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message.params);
        } catch (err) {
          this._onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  private handleServerRequest(message: JsonRpcRequest): void {
    const handler = this._requestHandlers.get(message.method);

    if (handler) {
      try {
        const result = handler(message.params);
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };
        this.writeMessage(response);
      } catch (err) {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: ErrorCodes.InternalError,
            message: err instanceof Error ? err.message : String(err),
          },
        };
        this.writeMessage(response);
      }
    } else {
      // Method not found
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: ErrorCodes.MethodNotFound,
          message: `Method not found: ${message.method}`,
        },
      };
      this.writeMessage(response);
    }
  }
}

/**
 * Compute byte length of a string (UTF-8).
 */
function byteLength(str: string): number {
  // Simple byte length calculation for Content-Length header
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7F) len += 1;
    else if (code <= 0x7FF) len += 2;
    else if (code >= 0xD800 && code <= 0xDBFF) {
      // Surrogate pair
      len += 4;
      i++; // Skip low surrogate
    } else len += 3;
  }
  return len;
}
