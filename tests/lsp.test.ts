import { describe, test, expect } from 'bun:test';
import { JsonRpcTransport } from '../core/lsp-client/transport';
import { LSPClient } from '../core/lsp-client/client';
import { ServerCapabilityChecker, getDefaultClientCapabilities } from '../core/lsp-client/capabilities';
import type { ServerCapabilities } from '../core/lsp-client/protocol';

// Helper: simulate a server that echoes back responses
function createMockTransportPair() {
  const clientTransport = new JsonRpcTransport();
  const sent: string[] = [];

  clientTransport.setWriter((data) => {
    sent.push(data);
  });

  return { transport: clientTransport, sent };
}

// Helper: create a Content-Length framed message
function frame(body: any): string {
  const json = JSON.stringify(body);
  const encoder = new TextEncoder();
  const byteLen = encoder.encode(json).length;
  return `Content-Length: ${byteLen}\r\n\r\n${json}`;
}

describe('JsonRpcTransport', () => {
  test('sends request with Content-Length header', () => {
    const { transport, sent } = createMockTransportPair();
    transport.sendRequest('test/method', { foo: 'bar' });

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('Content-Length:');
    expect(sent[0]).toContain('"method":"test/method"');
    expect(sent[0]).toContain('"foo":"bar"');
  });

  test('sends notification without id', () => {
    const { transport, sent } = createMockTransportPair();
    transport.sendNotification('test/notify', { x: 1 });

    expect(sent.length).toBe(1);
    expect(sent[0]).not.toContain('"id"');
    expect(sent[0]).toContain('"method":"test/notify"');
  });

  test('resolves request on matching response', async () => {
    const { transport } = createMockTransportPair();
    const promise = transport.sendRequest<{ value: number }>('test/method', {});

    // Simulate server response
    transport.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { value: 42 },
    }));

    const result = await promise;
    expect(result.value).toBe(42);
  });

  test('rejects request on error response', async () => {
    const { transport } = createMockTransportPair();
    const promise = transport.sendRequest('test/method', {});

    transport.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    }));

    try {
      await promise;
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.code).toBe(-32601);
      expect(err.message).toBe('Method not found');
    }
  });

  test('dispatches notifications to handlers', () => {
    const { transport } = createMockTransportPair();
    let received: any = null;

    transport.onNotification('test/event', (params) => {
      received = params;
    });

    transport.receiveData(frame({
      jsonrpc: '2.0',
      method: 'test/event',
      params: { hello: 'world' },
    }));

    expect(received).toEqual({ hello: 'world' });
  });

  test('handles multiple notifications to same method', () => {
    const { transport } = createMockTransportPair();
    const calls: number[] = [];

    transport.onNotification('test/event', () => calls.push(1));
    transport.onNotification('test/event', () => calls.push(2));

    transport.receiveData(frame({
      jsonrpc: '2.0',
      method: 'test/event',
      params: {},
    }));

    expect(calls).toEqual([1, 2]);
  });

  test('unsubscribes notification handler', () => {
    const { transport } = createMockTransportPair();
    let count = 0;

    const unsub = transport.onNotification('test/event', () => count++);

    transport.receiveData(frame({
      jsonrpc: '2.0',
      method: 'test/event',
      params: {},
    }));
    expect(count).toBe(1);

    unsub();

    transport.receiveData(frame({
      jsonrpc: '2.0',
      method: 'test/event',
      params: {},
    }));
    expect(count).toBe(1); // No longer called
  });

  test('handles partial data (buffering)', async () => {
    const { transport } = createMockTransportPair();
    const promise = transport.sendRequest('test/method', {});

    const fullMessage = frame({ jsonrpc: '2.0', id: 1, result: 'ok' });

    // Send in two parts
    const mid = Math.floor(fullMessage.length / 2);
    transport.receiveData(fullMessage.substring(0, mid));
    transport.receiveData(fullMessage.substring(mid));

    const result = await promise;
    expect(result).toBe('ok');
  });

  test('handles multiple messages in one chunk', async () => {
    const { transport } = createMockTransportPair();
    const p1 = transport.sendRequest('m1', {});
    const p2 = transport.sendRequest('m2', {});

    const msg1 = frame({ jsonrpc: '2.0', id: 1, result: 'r1' });
    const msg2 = frame({ jsonrpc: '2.0', id: 2, result: 'r2' });

    transport.receiveData(msg1 + msg2);

    expect(await p1).toBe('r1');
    expect(await p2).toBe('r2');
  });

  test('handles server requests', () => {
    const { transport, sent } = createMockTransportPair();

    transport.onRequest('window/showMessage', (params) => {
      return { action: 'ok' };
    });

    transport.receiveData(frame({
      jsonrpc: '2.0',
      id: 99,
      method: 'window/showMessage',
      params: { message: 'Hello' },
    }));

    // Should have sent a response
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('"id":99');
    expect(sent[0]).toContain('"result"');
  });

  test('responds with error for unknown server request', () => {
    const { transport, sent } = createMockTransportPair();

    transport.receiveData(frame({
      jsonrpc: '2.0',
      id: 50,
      method: 'unknown/method',
      params: {},
    }));

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('"error"');
    expect(sent[0]).toContain('Method not found');
  });

  test('cancelRequest rejects pending and sends notification', () => {
    const { transport, sent } = createMockTransportPair();
    const promise = transport.sendRequest('slow/method', {});

    transport.cancelRequest(1);

    // Should have sent the original request + cancel notification
    expect(sent.length).toBe(2);
    expect(sent[1]).toContain('$/cancelRequest');

    // Promise should reject
    promise.catch((err: any) => {
      expect(err.code).toBe(-32800);
    });
  });

  test('pendingCount tracks active requests', async () => {
    const { transport } = createMockTransportPair();
    expect(transport.pendingCount).toBe(0);

    transport.sendRequest('m1', {});
    expect(transport.pendingCount).toBe(1);

    transport.sendRequest('m2', {});
    expect(transport.pendingCount).toBe(2);

    transport.receiveData(frame({ jsonrpc: '2.0', id: 1, result: null }));
    expect(transport.pendingCount).toBe(1);
  });

  test('increments request IDs', () => {
    const { transport, sent } = createMockTransportPair();
    transport.sendRequest('m1', {});
    transport.sendRequest('m2', {});
    transport.sendRequest('m3', {});

    expect(sent[0]).toContain('"id":1');
    expect(sent[1]).toContain('"id":2');
    expect(sent[2]).toContain('"id":3');
  });
});

describe('ServerCapabilityChecker', () => {
  test('detects completion capability', () => {
    const caps: ServerCapabilities = {
      completionProvider: { triggerCharacters: ['.', ':'] },
    };
    const checker = new ServerCapabilityChecker(caps);
    expect(checker.hasCompletion).toBe(true);
    expect(checker.completionTriggerCharacters).toEqual(['.', ':']);
  });

  test('detects missing capabilities', () => {
    const checker = new ServerCapabilityChecker({});
    expect(checker.hasCompletion).toBe(false);
    expect(checker.hasHover).toBe(false);
    expect(checker.hasDefinition).toBe(false);
    expect(checker.hasReferences).toBe(false);
    expect(checker.hasFormatting).toBe(false);
    expect(checker.hasCodeAction).toBe(false);
    expect(checker.hasSignatureHelp).toBe(false);
  });

  test('detects text document sync kind', () => {
    const full = new ServerCapabilityChecker({ textDocumentSync: 1 });
    expect(full.textDocumentSyncKind).toBe(1);

    const incremental = new ServerCapabilityChecker({ textDocumentSync: { change: 2 } });
    expect(incremental.textDocumentSyncKind).toBe(2);

    const none = new ServerCapabilityChecker({});
    expect(none.textDocumentSyncKind).toBe(0);
  });

  test('detects openClose support', () => {
    const obj = new ServerCapabilityChecker({ textDocumentSync: { openClose: true } });
    expect(obj.supportsOpenClose).toBe(true);

    const num = new ServerCapabilityChecker({ textDocumentSync: 1 });
    expect(num.supportsOpenClose).toBe(true);

    const none = new ServerCapabilityChecker({ textDocumentSync: 0 });
    expect(none.supportsOpenClose).toBe(false);
  });
});

describe('LSPClient', () => {
  function createMockClient() {
    const client = new LSPClient();
    const sent: string[] = [];

    client.connect((data) => {
      sent.push(data);
    });

    return { client, sent };
  }

  test('initialize lifecycle', async () => {
    const { client } = createMockClient();
    expect(client.state).toBe('connecting');

    const initPromise = client.initialize('file:///workspace');

    // Simulate server response
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          completionProvider: { triggerCharacters: ['.'] },
          hoverProvider: true,
          textDocumentSync: 2,
        },
      },
    }));

    const caps = await initPromise;
    expect(client.state).toBe('ready');
    expect(caps.completionProvider).toBeTruthy();
    expect(client.serverCapabilities?.hasCompletion).toBe(true);
    expect(client.serverCapabilities?.hasHover).toBe(true);
  });

  test('didOpen sends notification', async () => {
    const { client, sent } = createMockClient();

    // Initialize first
    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { textDocumentSync: { openClose: true, change: 2 } } },
    }));
    await initPromise;

    sent.length = 0; // Clear init messages

    client.didOpen('file:///test.ts', 'typescript', 1, 'const x = 1;');

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('textDocument/didOpen');
    expect(sent[0]).toContain('file:///test.ts');
    expect(client.isDocumentOpen('file:///test.ts')).toBe(true);
  });

  test('didClose sends notification', async () => {
    const { client, sent } = createMockClient();

    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { textDocumentSync: { openClose: true } } },
    }));
    await initPromise;

    client.didOpen('file:///test.ts', 'typescript', 1, '');
    sent.length = 0;

    client.didClose('file:///test.ts');
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('textDocument/didClose');
    expect(client.isDocumentOpen('file:///test.ts')).toBe(false);
  });

  test('completion returns items', async () => {
    const { client } = createMockClient();

    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { completionProvider: { triggerCharacters: ['.'] } } },
    }));
    await initPromise;

    const completionPromise = client.completion('file:///test.ts', { line: 0, character: 5 });

    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        isIncomplete: false,
        items: [
          { label: 'toString', kind: 2, insertText: 'toString()' },
          { label: 'valueOf', kind: 2, insertText: 'valueOf()' },
        ],
      },
    }));

    const items = await completionPromise;
    expect(items.length).toBe(2);
    expect(items[0].label).toBe('toString');
  });

  test('completion returns empty if not supported', async () => {
    const { client } = createMockClient();

    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: {} },
    }));
    await initPromise;

    const items = await client.completion('file:///test.ts', { line: 0, character: 0 });
    expect(items).toEqual([]);
  });

  test('diagnostics handler receives notifications', async () => {
    const { client } = createMockClient();
    let receivedUri = '';
    let receivedDiags: any[] = [];

    client.onDiagnostics((uri, diagnostics) => {
      receivedUri = uri;
      receivedDiags = diagnostics;
    });

    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: {} },
    }));
    await initPromise;

    // Simulate server sending diagnostics
    client.receiveData(frame({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///test.ts',
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            message: 'Error here',
          },
        ],
      },
    }));

    expect(receivedUri).toBe('file:///test.ts');
    expect(receivedDiags.length).toBe(1);
    expect(receivedDiags[0].message).toBe('Error here');
  });

  test('hover returns result', async () => {
    const { client } = createMockClient();

    const initPromise = client.initialize(null);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 1,
      result: { capabilities: { hoverProvider: true } },
    }));
    await initPromise;

    const hoverPromise = client.hover('file:///test.ts', { line: 0, character: 5 });

    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        contents: { kind: 'markdown', value: '```typescript\nconst x: number\n```' },
      },
    }));

    const hover = await hoverPromise;
    expect(hover).not.toBeNull();
    expect(hover!.contents).toBeTruthy();
  });
});

describe('getDefaultClientCapabilities', () => {
  test('returns valid capabilities object', () => {
    const caps = getDefaultClientCapabilities();
    expect(caps.textDocument).toBeTruthy();
    expect(caps.textDocument?.completion).toBeTruthy();
    expect(caps.textDocument?.hover).toBeTruthy();
    expect(caps.textDocument?.signatureHelp).toBeTruthy();
    expect(caps.textDocument?.codeAction).toBeTruthy();
  });
});
