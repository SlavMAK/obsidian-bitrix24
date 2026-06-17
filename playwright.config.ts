import { defineConfig } from '@playwright/test';

/**
 * E2E config — drives the live Obsidian Electron app against the real Bitrix24
 * test folder. NOT run by `npm test` (which only covers Vitest unit suite); use
 * `npm run e2e` explicitly.
 *
 * Serial mode is forced: a single Obsidian instance + a single Bitrix folder
 * mean tests cannot share state safely.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.report' }]],
  // globalSetup wipes the Bitrix test folder once before the suite starts.
  globalSetup: './tests/e2e/global-setup.ts',
});
