export function debugLog(...args: unknown[]): void {
  const denoEnv = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno?.env;
  if (denoEnv?.get('DEBUG_LOGS') === '1') {
    console.log(...args);
  }
}
