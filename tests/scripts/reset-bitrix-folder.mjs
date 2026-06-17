#!/usr/bin/env node
/**
 * Reset the configured Bitrix24 test folder: deletes every child (recursively),
 * leaves the folder itself in place. Used between automated test runs.
 *
 * Reads auth from the plugin's data.json (refresh_token + endpoint + folderId).
 * Refreshes the access token if needed and writes the new tokens back so the
 * running Obsidian plugin keeps working.
 *
 *   npm run bitrix:reset                  # uses data.json next to plugin
 *   BITRIX24_DATA_JSON=/path/to/data.json npm run bitrix:reset
 *   BITRIX24_FOLDER_ID=12345 npm run bitrix:reset   # override target folder
 *
 * Exits non-zero on any failure so CI / Playwright globalSetup can abort.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..');
const DATA_JSON_PATH = process.env.BITRIX24_DATA_JSON
  ? resolve(process.env.BITRIX24_DATA_JSON)
  : resolve(PLUGIN_ROOT, 'data.json');

// Mirrors the constants embedded in main.ts. If main.ts rotates these, update here.
const CLIENT_ID = process.env.BITRIX24_CLIENT_ID || 'app.6852f7fce097f5.55195369';
const CLIENT_SECRET =
  process.env.BITRIX24_CLIENT_SECRET || 'A3yMqlIZnAvZuvOZ1ljztkc9mUL1r0tVfmJ5WkdH80bSkFgNmu';

/** ANSI-coloured logger for quick scanning. */
const log = {
  info: (m) => console.log(`\x1b[36m[reset]\x1b[0m ${m}`),
  ok: (m) => console.log(`\x1b[32m[reset]\x1b[0m ${m}`),
  warn: (m) => console.warn(`\x1b[33m[reset]\x1b[0m ${m}`),
  err: (m) => console.error(`\x1b[31m[reset]\x1b[0m ${m}`),
};

async function loadConfig() {
  const raw = await readFile(DATA_JSON_PATH, 'utf-8');
  const cfg = JSON.parse(raw);
  if (!cfg.client_endpoint) throw new Error(`client_endpoint missing in ${DATA_JSON_PATH}`);
  if (!cfg.refresh_token) throw new Error(`refresh_token missing in ${DATA_JSON_PATH}`);
  const folderId = process.env.BITRIX24_FOLDER_ID
    ? Number(process.env.BITRIX24_FOLDER_ID)
    : cfg.folderId;
  if (!folderId) throw new Error('folderId missing (set BITRIX24_FOLDER_ID or configure plugin)');
  return { cfg, folderId };
}

async function persistTokens(cfg, fresh) {
  // Only overwrite if anything actually changed. Keeps mtime stable for the watcher.
  if (
    cfg.access_token === fresh.access_token &&
    cfg.refresh_token === fresh.refresh_token &&
    cfg.expires_in === fresh.expires_in
  ) {
    return cfg;
  }
  const next = { ...cfg, ...fresh };
  await writeFile(DATA_JSON_PATH, JSON.stringify(next, null, 2), 'utf-8');
  log.info('Refreshed tokens written back to data.json');
  return next;
}

async function refreshIfNeeded(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (cfg.expires_in && cfg.expires_in > now + 60) return cfg;
  log.info('Access token expired — refreshing');
  const url =
    'https://oauth.bitrix.info/oauth/token?' +
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: cfg.refresh_token,
    }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`token refresh failed: ${body.error_description || body.error}`);
  return persistTokens(cfg, {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    client_endpoint: body.client_endpoint || cfg.client_endpoint,
  });
}

async function call(cfg, method, params) {
  const url = `${cfg.client_endpoint}${method}?auth=${cfg.access_token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`${method} failed: ${body.error_description || body.error}`);
  return body;
}

async function listChildren(cfg, folderId) {
  // Bitrix paginates via 'next' (offset). Loop until exhausted.
  const out = [];
  let start = 0;
  for (;;) {
    const body = await call(cfg, 'disk.folder.getchildren', { id: folderId, start });
    const page = body.result || [];
    out.push(...page);
    if (body.next == null || page.length === 0) break;
    start = body.next;
  }
  return out;
}

async function deleteChild(cfg, child) {
  const isFolder = child.TYPE === 'folder';
  const method = isFolder ? 'disk.folder.deletetree' : 'disk.file.delete';
  await call(cfg, method, { id: child.ID });
  return { id: child.ID, name: child.NAME, isFolder };
}

async function main() {
  log.info(`Using data.json at ${DATA_JSON_PATH}`);
  let { cfg, folderId } = await loadConfig();
  cfg = await refreshIfNeeded(cfg);
  log.info(`Target folder id=${folderId} (endpoint: ${cfg.client_endpoint})`);

  const children = await listChildren(cfg, folderId);
  if (children.length === 0) {
    log.ok('Test folder is already empty');
    return;
  }
  log.info(`Found ${children.length} top-level entries; deleting…`);

  let failed = 0;
  for (const child of children) {
    try {
      const r = await deleteChild(cfg, child);
      log.ok(`  ✓ ${r.isFolder ? '[folder]' : '[file]  '} ${r.name} (id=${r.id})`);
    } catch (e) {
      failed++;
      log.err(`  ✗ ${child.NAME} (id=${child.ID}): ${e.message}`);
    }
  }

  if (failed > 0) {
    log.err(`${failed} deletion(s) failed`);
    process.exit(1);
  }
  log.ok(`Cleaned ${children.length} entries`);
}

main().catch((e) => {
  log.err(e.stack || e.message || String(e));
  process.exit(1);
});
