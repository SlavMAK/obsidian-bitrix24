import { App, Notice, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "../api/bitrix24-api";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";
import { Logger } from "./LoggerService";
import { SyncService } from "./SyncService";
import { askBulkDeleteConfirm, BulkDeleteItem } from "src/ui/BulkDeleteConfirmModal";

/**
 * Команда «Загрузить всё из Битрикс24» (pull-all).
 *
 * Source of truth = Битрикс24. Сервис обходит свежепостроенную BitrixMap,
 * создаёт/обновляет недостающие локальные файлы и папки, после чего
 * предлагает удалить «лишние» (есть локально, нет в Битриксе).
 *
 * На время выполнения общая EventQueue ставится на паузу: операции идут
 * напрямую через LocalController, без enqueue. Self-induced echo от
 * локальных модификаций гасится через syncService.addToIgnore.
 */
export class PullAllService {
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
      this.logger.log('PullAllService.run: start', 'INFO', { rootFolderId: this.rootFolderId });

      // 1. Построить свежий BitrixMap для целевой папки.
      const bitrixMap = new BitrixMap(this.bitrixApi);
      bitrixMap.addToMap({
        id: this.rootFolderId,
        path: '/',
        bitrixUrl: '',
        name: 'root',
        isFolder: true,
        lastUpdate: Date.now(),
      });

      // Заодно гарантируем, что у корня есть маппинг (нужен для resolve-у дочерних путей).
      if (!this.mappingManager.getById(this.rootFolderId)) {
        this.mappingManager.add({
          id: this.rootFolderId,
          name: 'root',
          path: '/',
          isFolder: true,
          lastLocalMtime: Date.now(),
          lastUpdatBitrix: Date.now(),
        });
      }

      await bitrixMap.fillMapping([{ folderId: this.rootFolderId, folderName: '/' }]);

      // 2. Отсортировать: папки раньше своих детей. Сортируем по глубине пути,
      //    при равной глубине — папки перед файлами. Это гарантирует, что
      //    LocalController.createFolder выполнится до createFile для вложенных.
      const sortedElements = [...bitrixMap.getMap()].sort((a, b) => {
        const depthA = this.pathDepth(a.path);
        const depthB = this.pathDepth(b.path);
        if (depthA !== depthB) return depthA - depthB;
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.path.localeCompare(b.path);
      });

      // 3. Пройти по элементам Битрикса.
      for (const elt of sortedElements) {
        // Корень пропускаем — он уже учтён маппингом.
        if (elt.id === this.rootFolderId) continue;
        if (elt.path === '/' || elt.path === '') continue;

        try {
          if (elt.isFolder) {
            await this.applyFolder(elt, result);
          } else {
            await this.applyFile(elt, result);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const message = `PullAllService: ошибка обработки ${elt.path}: ${msg}`;
          this.logger.log(message, 'ERROR', { element: elt, error: msg });
          result.errors.push(message);
        }
      }

      // 4. Найти «лишние» локально (есть в vault, нет в BitrixMap).
      const bitrixPaths = new Set(bitrixMap.getMap().map(el => el.path));
      const extras: BulkDeleteItem[] = [];
      const allLoaded = this.vault.getAllLoadedFiles();
      for (const af of allLoaded) {
        // Корень vault — пропускаем.
        if (!af.path || af.path === '/' || af.path === '') continue;
        const isFolder = af instanceof TFolder;
        const isFile = af instanceof TFile;
        if (!isFolder && !isFile) continue;
        if (bitrixPaths.has(af.path)) continue;
        extras.push({
          path: af.path,
          isFolder,
          hint: 'нет в Битрикс24',
        });
      }

      // Удаляем сначала более глубокие пути, чтобы потом не натыкаться на исчезнувших родителей.
      extras.sort((a, b) => this.pathDepth(b.path) - this.pathDepth(a.path));

      if (extras.length > 0) {
        const selected = await askBulkDeleteConfirm(this.app, {
          title: 'Удалить лишние локальные файлы?',
          description: 'Эти файлы существуют локально, но отсутствуют в Битрикс24. Удалить их локально?',
          items: extras,
          defaultSelected: false,
        });

        for (const path of selected) {
          try {
            await this.deleteLocalByPath(path, result);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const message = `PullAllService: ошибка удаления ${path}: ${msg}`;
            this.logger.log(message, 'ERROR', { path, error: msg });
            result.errors.push(message);
          }
        }
      }

      this.logger.log('PullAllService.run: finished', 'INFO', result);
      new Notice(
        `Загрузка из Битрикс24 завершена: создано ${result.created}, обновлено ${result.updated}, удалено ${result.deleted}` +
        (result.errors.length ? `, ошибок: ${result.errors.length}` : '')
      );

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('PullAllService.run: top-level error', 'ERROR', { error: msg });
      new Notice(`Ошибка загрузки из Битрикс24: ${msg}`);
      result.errors.push(msg);
      return result;
    } finally {
      queue.resume();
    }
  }

  private async applyFolder(
    elt: BitrixMapElement,
    result: { created: number; updated: number; deleted: number; errors: string[] }
  ): Promise<void> {
    const existing = this.vault.getFolderByPath(elt.path);
    if (existing) {
      // Папка уже есть — освежим маппинг, если устарел / отсутствует.
      const mapping = this.mappingManager.getById(elt.id);
      if (!mapping) {
        this.mappingManager.add({
          id: elt.id,
          name: elt.name,
          path: elt.path,
          isFolder: true,
          lastLocalMtime: Date.now(),
          lastUpdatBitrix: elt.lastUpdate,
        });
      }
      return;
    }
    this.syncService.addToIgnore(elt.path);
    await this.syncService.localController.createFolder(elt);
    result.created++;
  }

  private async applyFile(
    elt: BitrixMapElement,
    result: { created: number; updated: number; deleted: number; errors: string[] }
  ): Promise<void> {
    const localFile = this.vault.getFileByPath(elt.path);
    if (!localFile) {
      this.syncService.addToIgnore(elt.path);
      await this.syncService.localController.createFile(elt);
      result.created++;
      return;
    }
    const mapping = this.mappingManager.getById(elt.id) ?? this.mappingManager.getMappingByLocalPath(elt.path);
    const remoteIsNewer = mapping ? elt.lastUpdate > mapping.lastUpdatBitrix : true;
    if (remoteIsNewer) {
      this.syncService.addToIgnore(elt.path);
      await this.syncService.localController.updateFile(localFile, elt);
      result.updated++;
    }
  }

  private async deleteLocalByPath(
    path: string,
    result: { created: number; updated: number; deleted: number; errors: string[] }
  ): Promise<void> {
    this.syncService.addToIgnore(path);
    const abstractFile = this.vault.getAbstractFileByPath(path);
    if (!abstractFile) {
      this.logger.log('PullAllService.deleteLocalByPath: путь не найден в vault', 'WARN', { path });
      return;
    }
    const mapping = this.mappingManager.getMappingByLocalPath(path);

    if (abstractFile instanceof TFolder) {
      if (mapping) {
        await this.syncService.localController.deleteFolder(abstractFile, mapping);
      } else {
        // Не было в маппинге — просто в корзину vault, MappingManager трогать нечего.
        await this.vault.trash(abstractFile, false);
      }
      result.deleted++;
      return;
    }

    if (abstractFile instanceof TFile) {
      if (mapping) {
        await this.syncService.localController.deleteFile(abstractFile, mapping);
      } else {
        await this.vault.trash(abstractFile, false);
      }
      result.deleted++;
      return;
    }

    this.logger.log('PullAllService.deleteLocalByPath: неизвестный тип', 'WARN', { path });
  }

  private pathDepth(path: string): number {
    if (!path || path === '/') return 0;
    // Срезаем ведущий слэш, считаем оставшиеся.
    const trimmed = path.startsWith('/') ? path.slice(1) : path;
    if (trimmed.length === 0) return 0;
    return trimmed.split('/').length;
  }
}
