import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchObsidian, vaultPath } from './helpers/obsidian';
import { loadConfig, waitForFile, waitForAbsence } from './helpers/bitrix';

/**
 * Smoke (раздел 1 плана). Bypasses Obsidian's UI: writes directly to the vault
 * on disk and relies on Obsidian's chokidar watcher firing 'create'/'delete'
 * events into the plugin. This keeps the test independent of Obsidian's
 * keyboard shortcuts and theme.
 *
 * The single-test invariant: after the test the vault and Bitrix folder are
 * left in the same state (file is removed in teardown so re-runs don't drift).
 */
test.describe('smoke (раздел 1)', () => {
  test('1.1 + 1.2: file create then delete propagates to Bitrix', async () => {
    const cfg = await loadConfig();
    const vault = vaultPath();
    const filename = `smoke-${Date.now()}.md`;
    const absPath = join(vault, filename);

    const { app, window } = await launchObsidian();
    try {
      // Give the plugin a beat to attach its 'create' listener after onload.
      await window.waitForTimeout(2_000);

      // 1.1 — create
      writeFileSync(absPath, '# smoke\n', 'utf-8');
      const created = await waitForFile(filename, cfg.folderId, 20_000);
      expect(created.NAME).toBe(filename);

      // 1.2 — delete
      rmSync(absPath);
      await waitForAbsence(filename, cfg.folderId, 20_000);
    } finally {
      // Clean up regardless of pass/fail so the next run starts clean.
      try {
        rmSync(absPath);
      } catch {
        /* already gone */
      }
      await app.close();
    }
  });

  test('1.3 + 1.4: folder create then delete propagates to Bitrix', async () => {
    const cfg = await loadConfig();
    const vault = vaultPath();
    const folder = `smoke-folder-${Date.now()}`;
    const absPath = join(vault, folder);

    const { app, window } = await launchObsidian();
    try {
      await window.waitForTimeout(2_000);

      mkdirSync(absPath);
      const created = await waitForFile(folder, cfg.folderId, 20_000).catch(async () => {
        // Folders show up as TYPE='folder' — re-list and check.
        const { listChildren } = await import('./helpers/bitrix');
        const children = await listChildren(cfg.folderId);
        const hit = children.find((c) => c.NAME === folder && c.TYPE === 'folder');
        if (!hit) throw new Error(`folder ${folder} not seen in Bitrix`);
        return hit;
      });
      expect(created.NAME).toBe(folder);

      rmSync(absPath, { recursive: true });
      await waitForAbsence(folder, cfg.folderId, 20_000);
    } finally {
      try {
        rmSync(absPath, { recursive: true });
      } catch {
        /* already gone */
      }
      await app.close();
    }
  });
});
