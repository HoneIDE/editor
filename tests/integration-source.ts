/**
 * Complex TypeScript source file designed to stress every subsystem of hone-editor.
 * Used by integration tests to exercise tokenizer, folding, search, diff, etc.
 */
export const COMPLEX_SOURCE = `\
// 这是一个复杂的 TypeScript 模块 — designed to stress every editor subsystem
// Unicode: über résumé naïve café — CJK: 你好世界 — Emoji: 🚀✨🎯

import { EventEmitter } from 'events';
import type { Readable } from 'stream';

/**
 * @deprecated Use DataProcessor instead
 * @param items - Array of items to process
 * @returns Processed result map
 */
function legacyProcess<T extends Record<string, unknown>>(
  items: T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const key = JSON.stringify(item);
    if (!result.has(key)) {
      result.set(key, item);
    }
  }
  return result;
}

interface Configurable<T = unknown> {
  readonly id: string;
  name: string;
  value: T;
  metadata?: Record<string, string | number | boolean>;
}

type EventMap = {
  data: [buffer: Uint8Array, offset: number];
  error: [err: Error];
  close: [];
};

const PATTERN_ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PATTERN_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/g;
const MAX_RETRIES = 3;
const über = "unicode identifier test";
const TAG = \`prefix_\${Date.now()}_suffix\`;

enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
  Critical = 3,
}

class DataProcessor<T extends Configurable> extends EventEmitter {
  private items: T[] = [];
  private readonly cache = new Map<string, T>();
  private _running = false;

  constructor(
    public readonly config: { maxBatch: number; retryCount: number },
    private readonly transformer: (item: T) => T,
  ) {
    super();
  }

  get running(): boolean {
    return this._running;
  }

  get size(): number {
    return this.items.length;
  }

  async process(input: T[]): Promise<T[]> {
    this._running = true;
    const results: T[] = [];

    try {
      for (let i = 0; i < input.length; i++) {
        const item = input[i];
        const cached = this.cache.get(item.id);

        if (cached !== undefined) {
          results.push(cached);
          continue;
        }

        // Deeply nested control flow — fold testing
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            if (item.metadata) {
              for (const [key, val] of Object.entries(item.metadata)) {
                if (typeof val === 'string') {
                  if (val.length > 100) {
                    switch (key) {
                      case 'description':
                        item.metadata[key] = val.slice(0, 100);
                        break;
                      case 'notes':
                        item.metadata[key] = val.slice(0, 50);
                        break;
                      default:
                        break;
                    }
                  }
                }
              }
            }

            const transformed = this.transformer(item);
            this.cache.set(item.id, transformed);
            results.push(transformed);
            break;
          } catch (err) {
            if (retry === MAX_RETRIES - 1) {
              throw err;
            }
            await new Promise(r => setTimeout(r, 100 * (retry + 1)));
          }
        }
      }
    } finally {
      this._running = false;
    }

    return results;
  }

  /** Clear internal state */
  reset(): void {
    this.items = [];
    this.cache.clear();
    this._running = false;
  }
}

// Type guard
function isConfigurable(obj: unknown): obj is Configurable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'name' in obj &&
    'value' in obj
  );
}

// Assertion function
function assertNonEmpty(arr: unknown[], msg?: string): asserts arr is [unknown, ...unknown[]] {
  if (arr.length === 0) {
    throw new Error(msg ?? 'Expected non-empty array');
  }
}

// Mapped type
type ReadonlyDeep<T> = {
  readonly [K in keyof T]: T[K] extends object ? ReadonlyDeep<T[K]> : T[K];
};

// Async generator — advanced TS syntax
async function* streamChunks(
  source: Readable,
  chunkSize: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  let buffer = new Uint8Array(0);

  for await (const data of source) {
    const chunk = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (buffer.length >= chunkSize) {
      yield buffer.slice(0, chunkSize);
      buffer = buffer.slice(chunkSize);
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}

// Template literal type
type Route = \`/api/\${'v1' | 'v2'}/\${'users' | 'items'}\`;

// Conditional type
type Unwrap<T> = T extends Promise<infer U> ? U : T extends Array<infer V> ? V : T;

// Utility function with regex
function parseColor(input: string): [number, number, number] | null {
  const match = input.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

// Error subclass
class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

// Top-level function — breakpoint-worthy entry
export function createPipeline(
  config: Configurable<{ maxBatch: number; retryCount: number }>,
): DataProcessor<Configurable> {
  assertNonEmpty([config], 'Config required');

  const processor = new DataProcessor(
    config.value,
    (item: Configurable) => ({
      ...item,
      name: \`processed_\${item.name}\`,
      metadata: {
        ...item.metadata,
        processedAt: Date.now(),
        tag: TAG,
      },
    }),
  );

  return processor;
}

// Immediately-invoked for testing
const _selfTest = (() => {
  const color = parseColor('#ff8800');
  const isValid = PATTERN_ID.test('hello_world');
  const priority = Priority.High;
  return { color, isValid, priority, über };
})();

export { DataProcessor, Priority, isConfigurable, parseColor, streamChunks };
export type { Configurable, EventMap, ReadonlyDeep, Route, Unwrap };
`;

/** Line count of the complex source (for verification) */
export const COMPLEX_SOURCE_LINE_COUNT = COMPLEX_SOURCE.split('\n').length;
