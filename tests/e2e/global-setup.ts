import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Wipe the Bitrix24 test folder once before the suite. Re-uses the shared
 * reset script so behaviour matches `npm run bitrix:reset`. Invoked as a
 * child process to keep playwright's loader untouched by the script's ESM.
 *
 * Resolved from CWD (== project root when Playwright runs) rather than
 * import.meta.url, which would force ESM mode on the whole package.
 */
export default async function globalSetup(): Promise<void> {
  const script = resolve(process.cwd(), 'tests/scripts/reset-bitrix-folder.mjs');
  execFileSync('node', [script], { stdio: 'inherit' });
}
