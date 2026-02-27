import { describe, test, expect } from 'bun:test';
import { DAPClient } from '../core/dap-client/client';

// Helper: create a Content-Length framed message
function frame(body: any): string {
  const json = JSON.stringify(body);
  const encoder = new TextEncoder();
  const byteLen = encoder.encode(json).length;
  return `Content-Length: ${byteLen}\r\n\r\n${json}`;
}

function createMockDap() {
  const client = new DAPClient();
  const sent: string[] = [];

  client.connect((data) => {
    sent.push(data);
  });

  return { client, sent };
}

async function initializeDap(client: DAPClient) {
  const initPromise = client.initialize();
  client.receiveData(frame({
    jsonrpc: '2.0',
    id: 1,
    result: {
      body: {
        supportsConfigurationDoneRequest: true,
        supportsConditionalBreakpoints: true,
        supportsTerminateRequest: true,
        supportsRestartRequest: true,
      },
    },
  }));
  return initPromise;
}

describe('DAPClient', () => {
  test('initial state is disconnected', () => {
    const { client } = createMockDap();
    expect(client.state).toBe('disconnected');
  });

  test('initialize sets capabilities', async () => {
    const { client } = createMockDap();
    const caps = await initializeDap(client);

    expect(caps.supportsConfigurationDoneRequest).toBe(true);
    expect(caps.supportsConditionalBreakpoints).toBe(true);
    expect(client.capabilities).toBeTruthy();
  });

  test('launch starts running state', async () => {
    const client = new DAPClient();
    let nextId = 0;

    // Auto-respond to all requests
    client.connect((data) => {
      // Parse the request to get the id
      const bodyMatch = data.match(/\r\n\r\n(.+)$/s);
      if (bodyMatch) {
        const msg = JSON.parse(bodyMatch[1]);
        if (msg.id !== undefined) {
          // Auto-respond with success
          queueMicrotask(() => {
            client.receiveData(frame({ jsonrpc: '2.0', id: msg.id, result: { body: msg.method === 'initialize' ? { supportsConfigurationDoneRequest: true } : {} } }));
          });
        }
      }
    });

    await client.initialize();
    await client.launch({ program: '/test/app' });

    expect(client.state).toBe('running');
  });

  test('setBreakpoints sends request', async () => {
    const { client, sent } = createMockDap();
    await initializeDap(client);

    const bpPromise = client.setBreakpoints('file:///test.ts', [
      { line: 10 },
      { line: 20, condition: 'x > 5' },
    ]);

    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        breakpoints: [
          { id: 1, verified: true, line: 10 },
          { id: 2, verified: true, line: 20 },
        ],
      },
    }));

    const bps = await bpPromise;
    expect(bps.length).toBe(2);
    expect(bps[0].verified).toBe(true);
    expect(bps[1].line).toBe(20);
  });

  test('toggleBreakpoint adds and removes', async () => {
    const { client } = createMockDap();
    await initializeDap(client);

    // Add breakpoint at line 10
    const addPromise = client.toggleBreakpoint('file:///test.ts', 10);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: { breakpoints: [{ id: 1, verified: true, line: 10 }] },
    }));
    await addPromise;

    expect(client.getBreakpoints('file:///test.ts').length).toBe(1);

    // Toggle removes it
    const removePromise = client.toggleBreakpoint('file:///test.ts', 10);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 3,
      result: { breakpoints: [] },
    }));
    await removePromise;

    expect(client.getBreakpoints('file:///test.ts').length).toBe(0);
  });

  test('stopped event sets state and thread id', async () => {
    const { client } = createMockDap();
    let stoppedReason = '';

    client.setEventHandlers({
      onStopped: (body) => { stoppedReason = body.reason; },
    });

    await initializeDap(client);

    client.receiveData(frame({
      jsonrpc: '2.0',
      method: 'stopped',
      params: { reason: 'breakpoint', threadId: 5 },
    }));

    expect(client.state).toBe('stopped');
    expect(client.activeThreadId).toBe(5);
    expect(stoppedReason).toBe('breakpoint');
  });

  test('terminated event changes state', async () => {
    const { client } = createMockDap();
    let terminated = false;

    client.setEventHandlers({
      onTerminated: () => { terminated = true; },
    });

    await initializeDap(client);

    client.receiveData(frame({
      jsonrpc: '2.0',
      method: 'terminated',
      params: {},
    }));

    expect(client.state).toBe('terminated');
    expect(terminated).toBe(true);
  });

  test('output event dispatches to handler', async () => {
    const { client } = createMockDap();
    let output = '';

    client.setEventHandlers({
      onOutput: (body) => { output = body.output; },
    });

    await initializeDap(client);

    client.receiveData(frame({
      jsonrpc: '2.0',
      method: 'output',
      params: { category: 'stdout', output: 'Hello debug!\n' },
    }));

    expect(output).toBe('Hello debug!\n');
  });

  test('stackTrace returns frames', async () => {
    const { client } = createMockDap();
    await initializeDap(client);

    // Simulate a stopped event to set the active thread
    client.receiveData(frame({
      jsonrpc: '2.0',
      method: 'stopped',
      params: { reason: 'breakpoint', threadId: 1 },
    }));

    const stackPromise = client.stackTrace();

    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        stackFrames: [
          { id: 0, name: 'main', source: { path: '/test.ts' }, line: 10, column: 1 },
          { id: 1, name: 'helper', source: { path: '/util.ts' }, line: 5, column: 1 },
        ],
      },
    }));

    const frames = await stackPromise;
    expect(frames.length).toBe(2);
    expect(frames[0].name).toBe('main');
    expect(frames[1].name).toBe('helper');
  });

  test('scopes and variables', async () => {
    const { client } = createMockDap();
    await initializeDap(client);

    // Scopes
    const scopesPromise = client.scopes(0);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: {
        scopes: [
          { name: 'Local', variablesReference: 100, expensive: false },
          { name: 'Global', variablesReference: 101, expensive: true },
        ],
      },
    }));

    const scopes = await scopesPromise;
    expect(scopes.length).toBe(2);
    expect(scopes[0].name).toBe('Local');

    // Variables
    const varsPromise = client.variables(100);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 3,
      result: {
        variables: [
          { name: 'x', value: '42', type: 'number', variablesReference: 0 },
          { name: 'arr', value: '[1, 2, 3]', type: 'Array', variablesReference: 200 },
        ],
      },
    }));

    const vars = await varsPromise;
    expect(vars.length).toBe(2);
    expect(vars[0].name).toBe('x');
    expect(vars[0].value).toBe('42');
  });

  test('evaluate returns result', async () => {
    const { client } = createMockDap();
    await initializeDap(client);

    const evalPromise = client.evaluate('1 + 2', 0);
    client.receiveData(frame({
      jsonrpc: '2.0',
      id: 2,
      result: { result: '3', variablesReference: 0 },
    }));

    const result = await evalPromise;
    expect(result.result).toBe('3');
  });

  test('disconnect resets state', async () => {
    const { client } = createMockDap();
    await initializeDap(client);

    const disconnectPromise = client.disconnect();
    client.receiveData(frame({ jsonrpc: '2.0', id: 2, result: {} }));
    await disconnectPromise;

    expect(client.state).toBe('disconnected');
  });

  test('getBreakpoints returns empty for unknown file', () => {
    const { client } = createMockDap();
    expect(client.getBreakpoints('unknown://file')).toEqual([]);
  });
});
