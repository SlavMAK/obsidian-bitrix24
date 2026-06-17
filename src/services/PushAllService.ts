import { App, Notice, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";
import { SyncService } from "./SyncService";
import { Logger } from "./LoggerService";
import { askBulkDeleteConfirm, BulkDeleteItem } from "src/ui/BulkDeleteConfirmModal";

/**
 * PushAllService: реализация команды «Выгрузить всё в Битрикс24».
 *
 * Source of truth — локальный vault. Алгоритм:
 *  1) Ставим общую очередь событий на паузу (чтобы локальные/WS события не
 *     гонялись с массовой выгрузкой).
 *  2) Строим свежий BitrixMap всего поддерева (от rootFolderId), чтобы знать
 *     что уже есть в Битриксе.
 *  3) Создаём недостающие папки (parents-first), затем файлы; обновляем файлы,
 *     у которых локальный mtime новее, чем lastUpdatBitrix.
 *  4) Лишнее в Битриксе (есть удалённо, нет локально) — спрашиваем через
 *     BulkDeleteConfirmModal; что отметили — удаляем.
 *
 * Замечание по батчингу: каждый вызов BitrixController.createFile/updateFile/
 * createFolder/deleteFile/deleteFolder уже делает свой callBatch из 2 операций
 * (основной вызов + pull.application.event.add). Сквозной батчинг между
 * файлами в этом сервисе — отдельная задача (см. plan B1). Пока используем
 * существующие контроллеры последовательно: корректность > оптимизация квоты.
 */
export class PushAllService {
  constructor(
    private app: App,
    private vault: Vault,
    private bitrixApi: Bitrix24Api,
    private mappingManager: MappingManager,
    private syncService: SyncService,
    private logger: Logger,
    private rootFolderId: string
  ) {}

  public async run(): Promise<{ created: number; updated: number; deleted: number; errors: string[] }> {
    const result = { created: 0, updated: 0, deleted: 0, errors: [] as string[] };

    const queue = this.syncService.getQueue();
    queue.pause();

    try {
      // 1. Построить полный BitrixMap.
      const bitrixMap = new BitrixMap(this.bitrixApi);
      bitrixMap.addToMap({
        id: this.rootFolderId,
        path: '/',
        bitrixUrl: '',
        name: 'root',
        isFolder: true,
        lastUpdate: Date.now(),
      });

      // Гарантируем наличие маппинга корня — иначе BitrixController.createFile
      // (для файлов в корне) не найдёт parent через getMappingByLocalPath('/').
      if (!this.mappingManager.getById(this.rootFolderId)) {
        this.mappingManager.add({
          id: this.rootFolderId,
          path: '/',
          name: 'root',
          isFolder: true,
          lastLocalMtime: Date.now(),
          lastUpdatBitrix: Date.now(),
        });
      }

      try {
        await bitrixMap.fillMapping([{ folderId: this.rootFolderId, folderName: '/' }]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.log('PushAllService: ошибка при загрузке BitrixMap', 'ERROR', { error: msg });
        new Notice('Ошибка при выгрузке: не удалось получить состояние Битрикс24: ' + msg);
        result.errors.push('BitrixMap: ' + msg);
        return result;
      }

      // Связываем карту с контроллером — createFolder/moveFile/... читают её.
      this.syncService.bitrixController.setBitrixMap(bitrixMap);

      // 2. Соберём локальные сущности.
      const allLoaded = this.vault.getAllLoadedFiles();
      const localFolders: TFolder[] = [];
      const localFiles: TFile[] = [];
      for (const node of allLoaded) {
        if (node instanceof TFolder) {
          localFolders.push(node);
        } else if (node instanceof TFile) {
          localFiles.push(node);
        }
      }

      // Папки — parents-first (по глубине пути).
      localFolders.sort((a, b) => this.depth(a.path) - this.depth(b.path));

      // 3. Создаём недостающие папки.
      for (const folder of localFolders) {
        if (folder.path === '/' || folder.path === '') continue;
        try {
          const existing = this.findByPath(bitrixMap, folder.path);
          if (existing) {
            // Уже есть в Битриксе — убеждаемся, что маппинг корректен.
            if (!this.mappingManager.getById(existing.id)) {
              this.mappingManager.add({
                id: existing.id,
                path: folder.path,
                name: folder.name,
                isFolder: true,
                lastLocalMtime: Date.now(),
                lastUpdatBitrix: existing.lastUpdate,
              });
            }
            continue;
          }
          this.syncService.addToIgnore(folder.path);
          await this.syncService.bitrixController.createFolder(folder);
          // BitrixController.createFolder сам добавляет в mappingManager; нам же
          // нужно отразить новую папку в локальном bitrixMap, чтобы дочерние
          // элементы могли её найти.
          const newMapping = this.mappingManager.getMappingByLocalPath(folder.path);
          if (newMapping) {
            bitrixMap.addToMap({
              id: newMapping.id,
              path: folder.path,
              name: folder.name,
              isFolder: true,
              bitrixUrl: '',
              lastUpdate: newMapping.lastUpdatBitrix,
            });
            result.created++;
          } else {
            // createFolder мог тихо упасть (см. BitrixController.createFolder —
            // он ничего не возвращает при ошибке и не бросает).
            const msg = `Не удалось создать папку ${folder.path} (нет маппинга после createFolder)`;
            this.logger.log('PushAllService: ' + msg, 'WARN', { folder: folder.path });
            result.errors.push(msg);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.log('PushAllService: ошибка создания папки', 'ERROR', { folder: folder.path, error: msg });
          result.errors.push(`folder ${folder.path}: ${msg}`);
        }
      }

      // 4. Файлы: create или update.
      for (const file of localFiles) {
        try {
          const existing = this.findByPath(bitrixMap, file.path);
          if (!existing) {
            this.syncService.addToIgnore(file.path);
            await this.syncService.bitrixController.createFile(file);
            const newMapping = this.mappingManager.getMappingByLocalPath(file.path);
            if (newMapping) {
              bitrixMap.addToMap({
                id: newMapping.id,
                path: file.path,
                name: file.name,
                isFolder: false,
                bitrixUrl: '',
                lastUpdate: newMapping.lastUpdatBitrix,
              });
              result.created++;
            } else {
              const msg = `Не удалось создать файл ${file.path} (нет маппинга после createFile)`;
              this.logger.log('PushAllService: ' + msg, 'WARN', { file: file.path });
              result.errors.push(msg);
            }
            continue;
          }

          // Файл уже есть в Битриксе. Решаем — обновить ли.
          const mapping = this.mappingManager.getById(existing.id);
          const lastBitrix = mapping ? mapping.lastUpdatBitrix : existing.lastUpdate;
          if (file.stat.mtime > lastBitrix) {
            this.syncService.addToIgnore(file.path);
            await this.syncService.bitrixController.updateFile(file, existing);
            result.updated++;
          } else if (!mapping) {
            // Файл существует на обеих сторонах, но маппинга нет — фиксируем,
            // чтобы будущие события (rename/modify) нашли соответствие.
            this.mappingManager.add({
              id: existing.id,
              path: file.path,
              name: file.name,
              isFolder: false,
              lastLocalMtime: file.stat.mtime,
              lastUpdatBitrix: existing.lastUpdate,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.log('PushAllService: ошибка обработки файла', 'ERROR', { file: file.path, error: msg });
          result.errors.push(`file ${file.path}: ${msg}`);
        }
      }

      // 5. Лишнее в Битриксе.
      const extras = this.computeExtras(bitrixMap);
      if (extras.length > 0) {
        const items: BulkDeleteItem[] = extras.map(elt => ({
          path: elt.path,
          isFolder: elt.isFolder,
          hint: 'есть в Битрикс24, нет локально',
        }));

        const selected = await askBulkDeleteConfirm(this.app, {
          title: 'Удалить лишние файлы из Битрикс24?',
          description: 'Эти файлы существуют в Битрикс24, но отсутствуют в локальном vault. Удалить их из Битрикс24?',
          items,
          defaultSelected: false,
        });

        if (selected.length > 0) {
          // Удаляем папки последними (children-first), чтобы Битрикс не пытался
          // удалить уже снесённого родителя.
          const selectedSet = new Set(selected);
          const toDelete = extras
            .filter(e => selectedSet.has(e.path))
            .sort((a, b) => {
              // files first, then folders deepest-first.
              if (a.isFolder !== b.isFolder) return a.isFolder ? 1 : -1;
              return this.depth(b.path) - this.depth(a.path);
            });

          for (const elt of toDelete) {
            try {
              const mapping = this.mappingManager.getById(elt.id);
              if (!mapping) {
                this.logger.log('PushAllService: маппинг для удаляемого элемента не найден — пропускаем', 'WARN', { path: elt.path, id: elt.id });
                continue;
              }
              this.syncService.addToIgnore(elt.path);
              if (elt.isFolder) {
                await this.syncService.bitrixController.deleteFolder(elt, mapping);
              } else {
                await this.syncService.bitrixController.deleteFile(elt, mapping);
              }
              result.deleted++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.logger.log('PushAllService: ошибка удаления', 'ERROR', { path: elt.path, error: msg });
              result.errors.push(`delete ${elt.path}: ${msg}`);
            }
          }
        }
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('PushAllService: непредвиденная ошибка', 'ERROR', { error: msg });
      new Notice('Ошибка при выгрузке: ' + msg);
      result.errors.push(msg);
      return result;
    } finally {
      queue.resume();
    }
  }

  /** Глубина пути для топологической сортировки. */
  private depth(path: string): number {
    if (!path || path === '/') return 0;
    return path.split('/').filter(p => p.length > 0).length;
  }

  /** Найти элемент BitrixMap по path. Возвращает первый match (id уникален). */
  private findByPath(bitrixMap: BitrixMap, path: string): BitrixMapElement | undefined {
    return bitrixMap.map.find(el => el.path === path);
  }

  /**
   * Лишние в Битриксе: есть в bitrixMap, но нет локально (ни как TFile, ни как
   * TFolder). Корень пропускаем.
   */
  private computeExtras(bitrixMap: BitrixMap): BitrixMapElement[] {
    const extras: BitrixMapElement[] = [];
    for (const elt of bitrixMap.map) {
      if (elt.path === '/' || elt.id === this.rootFolderId) continue;
      const localFile = this.vault.getFileByPath(elt.path);
      const localFolder = this.vault.getFolderByPath(elt.path);
      if (!localFile && !localFolder) {
        extras.push(elt);
      }
    }
    return extras;
  }
}
