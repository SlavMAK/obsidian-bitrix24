import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the Obsidian binary. Prefers $OBSIDIAN_BIN; otherwise checks the
 * common Linux locations. AppImages and Nix-store paths both work because
 * `_electron.launch` only needs an executable that hosts an Electron renderer.
 */
function resolveObsidianBin(): string {
  if (process.env.OBSIDIAN_BIN) return process.env.OBSIDIAN_BIN;
  const candidates = [
    '/etc/profiles/per-user/' + (process.env.USER || '') + '/bin/obsidian',
    '/usr/bin/obsidian',
    '/opt/Obsidian/obsidian',
    '/opt/obsidian/obsidian',
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error(
    'Obsidian binary not found. Set OBSIDIAN_BIN=/path/to/obsidian before running.',
  );
}

/**
 * The vault Obsidian opens. Defaults to the dev vault we built the plugin in;
 * override with OBSIDIAN_VAULT for CI or alternate envs.
 */
export function vaultPath(): string {
  return process.env.OBSIDIAN_VAULT || '/home/muxaujl/dev-obsidian';
}

export interface ObsidianHandle {
  app: ElectronApplication;
  window: Page;
}

/**
 * Launch Obsidian with an isolated user-data dir so the test run can't smash
 * the user's real Obsidian profile (open windows, recent vaults, layout).
 * The plugin under test still reads .obsidian/ from the vault on disk —
 * that part is intentionally shared with the live setup.
 */
export async function launchObsidian(): Promise<ObsidianHandle> {
  const binary = resolveObsidianBin();
  const userDataDir = mkdtempSync(join(tmpdir(), 'obsidian-e2e-'));

  const app = await electron.launch({
    executablePath: binary,
    args: [
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox', // typical Electron-in-CI need; harmless on dev box
      vaultPath(),    // last positional arg is the vault Obsidian opens
    ],
    timeout: 30_000,
  });

  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
  // Wait for Obsidian's workspace to mount — '.workspace' is stable across versions.
  await window.locator('.workspace').waitFor({ state: 'visible', timeout: 30_000 });
  return { app, window };
}

/** Open the command palette and run a command by its visible name. */
export async function runCommand(window: Page, name: string): Promise<void> {
  await window.keyboard.press('Control+P');
  const input = window.locator('.prompt-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(name);
  // First matching suggestion is what Obsidian highlights by default.
  await window.locator('.suggestion-item.is-selected').first().click();
}

/** Create a file in the vault via Obsidian's "Create new note" command. */
export async function createNote(window: Page, filename: string): Promise<void> {
  await runCommand(window, 'Create new note');
  // Obsidian opens the new untitled note in the editor — rename via F2.
  await window.keyboard.press('F2');
  await window.keyboard.type(filename);
  await window.keyboard.press('Enter');
}
