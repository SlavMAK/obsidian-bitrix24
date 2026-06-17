import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Vault } from 'obsidian';
import { MappingManager, type FileMapping } from '../../src/models/MappingManager';

function makeMapping(over: Partial<FileMapping> = {}): FileMapping {
  return {
    id: '1',
    path: 'note.md',
    name: 'note.md',
    isFolder: false,
    lastLocalMtime: 0,
    lastUpdatBitrix: 0,
    ...over,
  };
}

describe('MappingManager', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let mgr: MappingManager;

  beforeEach(() => {
    onChange = vi.fn();
    mgr = new MappingManager([], onChange);
  });

  describe('add', () => {
    it('inserts a new mapping and triggers onChange', () => {
      mgr.add(makeMapping({ id: '42', path: 'a.md' }));
      expect(mgr.getAll()).toHaveLength(1);
      expect(mgr.getById('42')?.path).toBe('a.md');
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('coerces id to string', () => {
      mgr.add(makeMapping({ id: 99 as unknown as string }));
      expect(typeof mgr.getAll()[0].id).toBe('string');
    });

    it('updates existing record when id matches (merge semantics)', () => {
      mgr.add(makeMapping({ id: '1', path: 'old.md', name: 'old.md', lastUpdatBitrix: 100 }));
      mgr.add(makeMapping({ id: '1', path: 'new.md', name: 'new.md', lastUpdatBitrix: 200 }));

      expect(mgr.getAll()).toHaveLength(1);
      expect(mgr.getById('1')?.path).toBe('new.md');
      expect(mgr.getById('1')?.name).toBe('new.md');
      expect(mgr.getById('1')?.lastUpdatBitrix).toBe(200);
    });

    it('keeps existing lastUpdatBitrix when incoming value is 0/falsy', () => {
      mgr.add(makeMapping({ id: '1', lastUpdatBitrix: 500 }));
      mgr.add(makeMapping({ id: '1', path: 'b.md', lastUpdatBitrix: 0 }));
      expect(mgr.getById('1')?.lastUpdatBitrix).toBe(500);
    });
  });

  describe('set', () => {
    it('updates only specified fields', () => {
      mgr.add(makeMapping({ id: '1', path: 'a.md', name: 'a.md', lastLocalMtime: 10 }));
      onChange.mockClear();
      mgr.set('1', { name: 'renamed.md' });

      const m = mgr.getById('1');
      expect(m?.name).toBe('renamed.md');
      expect(m?.path).toBe('a.md');
      expect(m?.lastLocalMtime).toBe(10);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('is a no-op (no onChange) for unknown id', () => {
      mgr.add(makeMapping({ id: '1' }));
      onChange.mockClear();
      mgr.set('999', { name: 'ghost' });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes by id and fires onChange', () => {
      mgr.add(makeMapping({ id: '1' }));
      mgr.add(makeMapping({ id: '2' }));
      onChange.mockClear();
      mgr.remove('1');
      expect(mgr.getAll()).toHaveLength(1);
      expect(mgr.getById('1')).toBeUndefined();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('does nothing for unknown id', () => {
      mgr.add(makeMapping({ id: '1' }));
      onChange.mockClear();
      mgr.remove('does-not-exist');
      expect(onChange).not.toHaveBeenCalled();
      expect(mgr.getAll()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('empties the map and fires onChange', () => {
      mgr.add(makeMapping({ id: '1' }));
      mgr.add(makeMapping({ id: '2' }));
      onChange.mockClear();
      mgr.clear();
      expect(mgr.getAll()).toHaveLength(0);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('does not fire onChange on already-empty map', () => {
      mgr.clear();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('lookups', () => {
    it('getMappingByLocalPath finds by exact path', () => {
      mgr.add(makeMapping({ id: '1', path: 'folder/note.md' }));
      expect(mgr.getMappingByLocalPath('folder/note.md')?.id).toBe('1');
      expect(mgr.getMappingByLocalPath('Folder/note.md')).toBeUndefined();
    });

    it('filterFiles / filterFolders partition by isFolder', () => {
      mgr.add(makeMapping({ id: '1', path: 'a.md', isFolder: false }));
      mgr.add(makeMapping({ id: '2', path: 'b', isFolder: true }));
      mgr.add(makeMapping({ id: '3', path: 'c.md', isFolder: false }));

      expect(mgr.filterFiles().map((m) => m.id)).toEqual(['1', '3']);
      expect(mgr.filterFolders().map((m) => m.id)).toEqual(['2']);
    });
  });

  describe('updateMappingAfterMoveFolder', () => {
    it('rewrites paths of all children under the moved folder', () => {
      mgr.add(makeMapping({ id: 'F', path: 'old', isFolder: true }));
      mgr.add(makeMapping({ id: 'C1', path: 'old/note.md' }));
      mgr.add(makeMapping({ id: 'C2', path: 'old/sub/deep.md' }));
      mgr.add(makeMapping({ id: 'X', path: 'other/note.md' }));
      onChange.mockClear();

      mgr.updateMappingAfterMoveFolder('old', 'new');

      expect(mgr.getById('C1')?.path).toBe('new/note.md');
      expect(mgr.getById('C2')?.path).toBe('new/sub/deep.md');
      expect(mgr.getById('X')?.path).toBe('other/note.md'); // untouched
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('does not fire onChange when no children matched', () => {
      mgr.add(makeMapping({ id: '1', path: 'other/x.md' }));
      onChange.mockClear();
      mgr.updateMappingAfterMoveFolder('missing', 'new');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not touch the folder mapping itself (only children)', () => {
      mgr.add(makeMapping({ id: 'F', path: 'old', isFolder: true }));
      mgr.add(makeMapping({ id: 'C', path: 'old/x.md' }));
      mgr.updateMappingAfterMoveFolder('old', 'new');
      expect(mgr.getById('F')?.path).toBe('old');
      expect(mgr.getById('C')?.path).toBe('new/x.md');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips through JSON', () => {
      mgr.add(makeMapping({ id: '1', path: 'a.md' }));
      mgr.add(makeMapping({ id: '2', path: 'b', isFolder: true }));

      const json = mgr.toJSON();
      const restored = MappingManager.fromJSON(new Vault(), json);

      expect(restored.getAll()).toHaveLength(2);
      expect(restored.getById('1')?.path).toBe('a.md');
      expect(restored.getById('2')?.isFolder).toBe(true);
    });

    it('drops null/undefined entries from stored array', () => {
      const dirty = JSON.stringify([
        makeMapping({ id: '1' }),
        null,
        makeMapping({ id: '2' }),
      ]);
      const restored = MappingManager.fromJSON(new Vault(), dirty);
      expect(restored.getAll()).toHaveLength(2);
    });

    it('returns empty manager on malformed JSON (10.5: broken data.json)', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const restored = MappingManager.fromJSON(new Vault(), '{not json');
      expect(restored.getAll()).toEqual([]);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
