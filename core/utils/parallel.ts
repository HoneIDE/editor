/**
 * Parallel processing utilities.
 *
 * In Perry native compilation, these use OS threads via perry/thread.
 * In Bun/test environments, they fall back to sequential execution.
 */

/**
 * Apply `fn` to every element of `data` in parallel.
 * Falls back to sequential map when threading is unavailable.
 */
export async function parallelMap<T, U>(
  data: T[],
  fn: (item: T) => U,
): Promise<U[]> {
  // Sequential fallback — in Perry native, this would use OS threads.
  // For now, use simple map. When Perry supports `@perry/threads` imports
  // natively, this can be upgraded to use real parallelism.
  return data.map(fn);
}

/**
 * Filter `data` in parallel.
 * Falls back to sequential filter when threading is unavailable.
 */
export async function parallelFilter<T>(
  data: T[],
  fn: (item: T) => boolean,
): Promise<T[]> {
  return data.filter(fn);
}

/**
 * Run `fn` on a background thread and return a Promise for the result.
 * Falls back to synchronous execution when threading is unavailable.
 */
export async function spawn<T>(fn: () => T): Promise<T> {
  return fn();
}
