import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Minimal Bitrix24 REST client for E2E assertions. Mirrors the subset of the
 * plugin's API surface we need: list folder children, find a file by name,
 * read attributes. Tokens come from the plugin's data.json so we share the
 * same auth state as the running app.
 */

const DATA_JSON = process.env.BITRIX24_DATA_JSON
  ? resolve(process.env.BITRIX24_DATA_JSON)
  : resolve(__dirname, '..', '..', '..', 'data.json');

export interface BitrixConfig {
  client_endpoint: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  folderId: number;
}

export async function loadConfig(): Promise<BitrixConfig> {
  const raw = await readFile(DATA_JSON, 'utf-8');
  const cfg = JSON.parse(raw);
  if (!cfg.client_endpoint || !cfg.access_token || !cfg.folderId) {
    throw new Error('Plugin data.json missing required fields (run reset script first?)');
  }
  return cfg;
}

export interface BitrixChild {
  ID: string;
  NAME: string;
  TYPE: 'file' | 'folder';
  UPDATE_TIME?: string;
}

async function call(cfg: BitrixConfig, method: string, params: Record<string, unknown>): Promise<any> {
  const url = `${cfg.client_endpoint}${method}?auth=${cfg.access_token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`${method}: ${body.error_description || body.error}`);
  return body;
}

export async function listChildren(folderId: number): Promise<BitrixChild[]> {
  const cfg = await loadConfig();
  const out: BitrixChild[] = [];
  let start = 0;
  for (;;) {
    const body = await call(cfg, 'disk.folder.getchildren', { id: folderId, start });
    const page: BitrixChild[] = body.result || [];
    out.push(...page);
    if (body.next == null || page.length === 0) break;
    start = body.next;
  }
  return out;
}

/** Poll until a file with the given name appears under folderId, or timeout. */
export async function waitForFile(
  name: string,
  folderId: number,
  timeoutMs = 15_000,
  intervalMs = 500,
): Promise<BitrixChild> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const children = await listChildren(folderId);
    const hit = children.find((c) => c.NAME === name && c.TYPE === 'file');
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${name} in folder ${folderId}`);
}

export async function waitForAbsence(
  name: string,
  folderId: number,
  timeoutMs = 15_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const children = await listChildren(folderId);
    if (!children.find((c) => c.NAME === name)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${name} to disappear from folder ${folderId}`);
}
