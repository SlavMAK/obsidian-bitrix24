import { vi } from 'vitest';
import type { Logger } from '../../src/services/LoggerService';

/**
 * Build a Logger-shaped stub that captures calls instead of writing to disk.
 * Keeps tests independent of pino, Vault, and filesystem state.
 */
export function makeFakeLogger(): Logger & { log: ReturnType<typeof vi.fn> } {
  const log = vi.fn().mockResolvedValue(undefined);
  return { log } as unknown as Logger & { log: ReturnType<typeof vi.fn> };
}
