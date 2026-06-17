# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> smoke (раздел 1) >> 1.1 + 1.2: file create then delete propagates to Bitrix
- Location: tests/e2e/smoke.spec.ts:17:7

# Error details

```
Error: locator.waitFor: Target page, context or browser has been closed
Call log:
  - waiting for locator('.workspace') to be visible

```

# Test source

```ts
  1  | import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
  2  | import { existsSync, mkdtempSync } from 'node:fs';
  3  | import { tmpdir } from 'node:os';
  4  | import { join } from 'node:path';
  5  | 
  6  | /**
  7  |  * Resolve the Obsidian binary. Prefers $OBSIDIAN_BIN; otherwise checks the
  8  |  * common Linux locations. AppImages and Nix-store paths both work because
  9  |  * `_electron.launch` only needs an executable that hosts an Electron renderer.
  10 |  */
  11 | function resolveObsidianBin(): string {
  12 |   if (process.env.OBSIDIAN_BIN) return process.env.OBSIDIAN_BIN;
  13 |   const candidates = [
  14 |     '/etc/profiles/per-user/' + (process.env.USER || '') + '/bin/obsidian',
  15 |     '/usr/bin/obsidian',
  16 |     '/opt/Obsidian/obsidian',
  17 |     '/opt/obsidian/obsidian',
  18 |   ];
  19 |   for (const c of candidates) {
  20 |     if (c && existsSync(c)) return c;
  21 |   }
  22 |   throw new Error(
  23 |     'Obsidian binary not found. Set OBSIDIAN_BIN=/path/to/obsidian before running.',
  24 |   );
  25 | }
  26 | 
  27 | /**
  28 |  * The vault Obsidian opens. Defaults to the dev vault we built the plugin in;
  29 |  * override with OBSIDIAN_VAULT for CI or alternate envs.
  30 |  */
  31 | export function vaultPath(): string {
  32 |   return process.env.OBSIDIAN_VAULT || '/home/muxaujl/dev-obsidian';
  33 | }
  34 | 
  35 | export interface ObsidianHandle {
  36 |   app: ElectronApplication;
  37 |   window: Page;
  38 | }
  39 | 
  40 | /**
  41 |  * Launch Obsidian with an isolated user-data dir so the test run can't smash
  42 |  * the user's real Obsidian profile (open windows, recent vaults, layout).
  43 |  * The plugin under test still reads .obsidian/ from the vault on disk —
  44 |  * that part is intentionally shared with the live setup.
  45 |  */
  46 | export async function launchObsidian(): Promise<ObsidianHandle> {
  47 |   const binary = resolveObsidianBin();
  48 |   const userDataDir = mkdtempSync(join(tmpdir(), 'obsidian-e2e-'));
  49 | 
  50 |   const app = await electron.launch({
  51 |     executablePath: binary,
  52 |     args: [
  53 |       `--user-data-dir=${userDataDir}`,
  54 |       '--no-sandbox', // typical Electron-in-CI need; harmless on dev box
  55 |       vaultPath(),    // last positional arg is the vault Obsidian opens
  56 |     ],
  57 |     timeout: 30_000,
  58 |   });
  59 | 
  60 |   const window = await app.firstWindow({ timeout: 30_000 });
  61 |   await window.waitForLoadState('domcontentloaded');
  62 |   // Wait for Obsidian's workspace to mount — '.workspace' is stable across versions.
> 63 |   await window.locator('.workspace').waitFor({ state: 'visible', timeout: 30_000 });
     |                                      ^ Error: locator.waitFor: Target page, context or browser has been closed
  64 |   return { app, window };
  65 | }
  66 | 
  67 | /** Open the command palette and run a command by its visible name. */
  68 | export async function runCommand(window: Page, name: string): Promise<void> {
  69 |   await window.keyboard.press('Control+P');
  70 |   const input = window.locator('.prompt-input');
  71 |   await input.waitFor({ state: 'visible' });
  72 |   await input.fill(name);
  73 |   // First matching suggestion is what Obsidian highlights by default.
  74 |   await window.locator('.suggestion-item.is-selected').first().click();
  75 | }
  76 | 
  77 | /** Create a file in the vault via Obsidian's "Create new note" command. */
  78 | export async function createNote(window: Page, filename: string): Promise<void> {
  79 |   await runCommand(window, 'Create new note');
  80 |   // Obsidian opens the new untitled note in the editor — rename via F2.
  81 |   await window.keyboard.press('F2');
  82 |   await window.keyboard.type(filename);
  83 |   await window.keyboard.press('Enter');
  84 | }
  85 | 
```