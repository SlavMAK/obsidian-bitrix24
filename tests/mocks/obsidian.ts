/**
 * Minimal mock of the 'obsidian' module for unit tests.
 *
 * Only exports the surface that the plugin actually imports from. When a test
 * needs richer behaviour (e.g. an in-memory Vault), build it locally — keep
 * this file as a structural shim, not a simulator.
 *
 * Spies:
 *  - `noticeMock` records every `new Notice(msg)` call so tests can assert on it.
 *  - Reset with `noticeMock.mockClear()` in test setup.
 */

import { vi } from 'vitest';

export const noticeMock = vi.fn<(message: string, timeout?: number) => void>();

export class Notice {
  constructor(message: string, timeout?: number) {
    noticeMock(message, timeout);
  }
  hide(): void {}
  setMessage(_: string): this {
    return this;
  }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export async function request(_opts: unknown): Promise<string> {
  throw new Error('obsidian.request() called in unit test — mock it explicitly');
}

// Structural classes — instances only, no real behaviour. Tests that need
// fakes should construct plain objects matching these shapes.
export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = '';
  stat = { ctime: 0, mtime: 0, size: 0 };
  parent: TFolder | null = null;
}

export class TFolder {
  path = '';
  name = '';
  children: Array<TFile | TFolder> = [];
  parent: TFolder | null = null;
  isRoot(): boolean {
    return this.parent === null;
  }
}

export class TAbstractFile {
  path = '';
  name = '';
  parent: TFolder | null = null;
}

export class Vault {
  adapter = {
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(''),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  };
  on = vi.fn();
  off = vi.fn();
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }
  registerEvent(_: unknown): void {}
  addCommand(_: unknown): void {}
  addSettingTab(_: unknown): void {}
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(_: unknown): Promise<void> {}
}

export class Modal {
  app: unknown;
  containerEl = { createDiv: vi.fn(), createEl: vi.fn() };
  contentEl = { empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
  constructor(app: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Setting {
  constructor(_: unknown) {}
  setName(_: string): this {
    return this;
  }
  setDesc(_: string): this {
    return this;
  }
  addText(_: unknown): this {
    return this;
  }
  addButton(_: unknown): this {
    return this;
  }
  addToggle(_: unknown): this {
    return this;
  }
  addDropdown(_: unknown): this {
    return this;
  }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl = { empty: vi.fn(), createEl: vi.fn() };
  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}
