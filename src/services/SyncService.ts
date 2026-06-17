import { MappingManager } from "src/models/MappingManager";
import { Bitrix24Api } from "../api/bitrix24-api";
import { App, Notice, TFile, TFolder, Vault } from "obsidian";
import { BitrixMap } from "src/models/BitrixMap";
import { LocalController } from "src/controllers/LocalController";
import { BitrixController } from "src/controllers/BitrixController";
import { ConflictResolutionModal, DiffContents } from "src/ui/ConflictResolutionModal";
import { getTextRemoteFile } from "src/helpers/getTextRemoteFile";
import { Logger } from "./LoggerService";
import { EventQueue } from "./EventQueue";
import { SyncEvent } from "./SyncEvents";

/**
 * SyncService: тонкая обёртка над общей EventQueue<SyncEvent>.
 *
 * Сравнения «что обновилось где» больше нет в горячем пути — каждое событие
 * имеет единственный intended action, и хендлер просто его исполняет.
 * Cравнительная логика (нужна только при массовом импорте/экспорте и catch-up)
 * вынесена в отдельные сервисы (PushAllService, PullAllService, CatchUpService).
 *
 * Self-induced echo событий подавляется через addToIgnore/isIgnore (5-секундное окно).
 */
export class SyncService {

  private bitrixApi: Bitrix24Api;
  private mappingManager: MappingManager;
  private vault: Vault;
  private logger: Logger;
  private clientWebsocketId: string;

  private queue: EventQueue<SyncEvent>;

  bitrixController: BitrixController;
  localController: LocalController;

  tempIgnoreFile: Set<string> = new Set();
  mapTempIgnoreTimer: Map<string, NodeJS.Timeout> = new Map();

  makeid(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  addToIgnore(pathFile: string) {
    if (!this.tempIgnoreFile.has(pathFile)) {
      this.tempIgnoreFile.add(pathFile);
    }
    const tempTimer = this.mapTempIgnoreTimer.get(pathFile);
    if (tempTimer) {
      clearTimeout(tempTimer);
    }
    const timer = setTimeout(() => {
      if (this.tempIgnoreFile.has(pathFile)) {
        this.tempIgnoreFile.delete(pathFile);
      }
    }, 5000);
    this.mapTempIgnoreTimer.set(pathFile, timer);
  }

  isIgnore(path: string) {
    return this.tempIgnoreFile.has(path);
  }

  constructor(
    bitrixApi: Bitrix24Api,
    mappingManager: MappingManager,
    vault: Vault,
    private readonly app: App,
    _lastSync: number,
    logger: Logger
  ) {
    this.bitrixApi = bitrixApi;
    this.vault = vault;
    this.logger = logger;
    this.mappingManager = mappingManager;
    this.clientWebsocketId = this.makeid(32);
    this.localController = new LocalController(
      vault,
      mappingManager,
      this.logger
    );
    this.bitrixController = new BitrixController(
      mappingManager,
      bitrixApi,
      vault,
      this.clientWebsocketId,
      this.logger
    );

    this.queue = new EventQueue<SyncEvent>(this.logger);
    this.queue.setHandler((ev) => this.handle(ev));
  }

  /**
   * Публичный enqueue: единственная точка входа в очередь для продьюсеров
   * (LocalEventController + parseEventWebSocket).
   * Если путь сейчас в ignore-листе — событие тихо отбрасывается.
   */
  public enqueue(event: SyncEvent): void {
    const eventPath = this.pathForEvent(event);
    if (eventPath && this.isIgnore(eventPath)) {
      this.logger.log(
        'EventQueue: событие проигнорировано (ignore-list)',
        'INFO',
        { kind: event.kind, path: eventPath }
      );
      return;
    }
    this.queue.enqueue(event);
  }

  public getQueue(): EventQueue<SyncEvent> {
    return this.queue;
  }

  private pathForEvent(event: SyncEvent): string | null {
    switch (event.kind) {
      case 'local:create':
      case 'local:modify':
      case 'local:delete':
      case 'bitrix:create':
      case 'bitrix:update':
      case 'bitrix:delete':
        return event.path;
      case 'local:rename':
      case 'bitrix:rename':
        return event.newPath;
      default:
        return null;
    }
  }

  /**
   * Главный диспетчер: вызывается EventQueue, по одному событию.
   * Любая ошибка пробрасывается выше — EventQueue её залогирует и поедет дальше.
   */
  private async handle(event: SyncEvent): Promise<void> {
    this.logger.log('SyncService.handle', 'INFO', event);
    switch (event.kind) {
      case 'local:create':
        await this.handleLocalCreate(event);
        return;
      case 'local:modify':
        await this.handleLocalModify(event);
        return;
      case 'local:rename':
        await this.handleLocalRename(event);
        return;
      case 'local:delete':
        await this.handleLocalDelete(event);
        return;
      case 'bitrix:create':
        await this.handleBitrixCreate(event);
        return;
      case 'bitrix:update':
        await this.handleBitrixUpdate(event);
        return;
      case 'bitrix:rename':
        await this.handleBitrixRename(event);
        return;
      case 'bitrix:delete':
        await this.handleBitrixDelete(event);
        return;
    }
  }

  // ---------- local handlers ----------

  private async handleLocalCreate(ev: Extract<SyncEvent, { kind: 'local:create' }>) {
    if (ev.isFolder) {
      const folder = this.vault.getFolderByPath(ev.path);
      if (!folder) {
        this.logger.log('local:create: папка не найдена в vault', 'WARN', ev);
        return;
      }
      this.addToIgnore(ev.path);
      await this.bitrixController.createFolder(folder);
      return;
    }
    const file = this.vault.getFileByPath(ev.path);
    if (!file) {
      this.logger.log('local:create: файл не найден в vault', 'WARN', ev);
      return;
    }
    this.addToIgnore(ev.path);
    await this.bitrixController.createFile(file);
  }

  private async handleLocalModify(ev: Extract<SyncEvent, { kind: 'local:modify' }>) {
    const file = this.vault.getFileByPath(ev.path);
    if (!file) {
      this.logger.log('local:modify: файл не найден в vault', 'WARN', ev);
      return;
    }
    const mapping = this.mappingManager.getMappingByLocalPath(ev.path);
    this.addToIgnore(ev.path);
    if (!mapping) {
      // Нет маппинга — трактуем как первичное создание.
      await this.bitrixController.createFile(file);
      return;
    }
    // Для updateFile нужен BitrixMapElement — собираем минимально достаточный.
    await this.bitrixController.updateFile(file, {
      id: mapping.id,
      path: mapping.path,
      name: mapping.name,
      isFolder: false,
      bitrixUrl: '',
      lastUpdate: mapping.lastUpdatBitrix,
    });
  }

  private async handleLocalRename(ev: Extract<SyncEvent, { kind: 'local:rename' }>) {
    if (ev.isFolder) {
      const folder = this.vault.getFolderByPath(ev.newPath);
      if (!folder) {
        this.logger.log('local:rename: папка не найдена в vault', 'WARN', ev);
        return;
      }
      this.addToIgnore(ev.newPath);
      await this.bitrixController.moveFolder(folder, ev.oldPath);
      return;
    }
    const file = this.vault.getFileByPath(ev.newPath);
    if (!file) {
      this.logger.log('local:rename: файл не найден в vault', 'WARN', ev);
      return;
    }
    this.addToIgnore(ev.newPath);
    await this.bitrixController.moveFile(file, ev.oldPath);
  }

  private async handleLocalDelete(ev: Extract<SyncEvent, { kind: 'local:delete' }>) {
    const localMap = this.mappingManager.getMappingByLocalPath(ev.path);
    if (!localMap) {
      this.logger.log('local:delete: маппинг не найден, пропускаем', 'INFO', ev);
      return;
    }
    // Для bitrixController.deleteFile/Folder нужен BitrixMapElement — берём из маппинга.
    const bitrixMapElement = {
      id: localMap.id,
      path: localMap.path,
      name: localMap.name,
      isFolder: ev.isFolder,
      bitrixUrl: '',
      lastUpdate: localMap.lastUpdatBitrix,
    };
    this.addToIgnore(ev.path);
    if (ev.isFolder) {
      await this.bitrixController.deleteFolder(bitrixMapElement, localMap);
    } else {
      await this.bitrixController.deleteFile(bitrixMapElement, localMap);
    }
  }

  // ---------- bitrix handlers ----------

  private async handleBitrixCreate(ev: Extract<SyncEvent, { kind: 'bitrix:create' }>) {
    // Идемпотентность: если этот id уже в маппинге — событие это эхо нашей
    // собственной операции (или дубль от Битрикса). Не делаем ничего.
    const existing = this.mappingManager.getById(ev.bitrixId);
    if (existing) {
      this.logger.log('bitrix:create: id уже в маппинге, пропускаем', 'INFO', { bitrixId: ev.bitrixId, mappedPath: existing.path });
      return;
    }
    const elt = ev.isFolder
      ? await new BitrixMap(this.bitrixApi).getFolderByMapId(ev.bitrixId, [...this.mappingManager.getAll()])
      : await new BitrixMap(this.bitrixApi).getFileByMapId(ev.bitrixId, [...this.mappingManager.getAll()]);
    if (!elt) {
      this.logger.log('bitrix:create: элемент не найден через API', 'WARN', ev);
      return;
    }
    this.addToIgnore(elt.path);
    if (ev.isFolder) {
      await this.localController.createFolder(elt);
    } else {
      await this.localController.createFile(elt);
    }
  }

  private async handleBitrixUpdate(ev: Extract<SyncEvent, { kind: 'bitrix:update' }>) {
    const elt = await new BitrixMap(this.bitrixApi).getFileByMapId(ev.bitrixId, [...this.mappingManager.getAll()]);
    if (!elt) {
      this.logger.log('bitrix:update: файл не найден через API', 'WARN', ev);
      return;
    }
    const localFile = this.vault.getFileByPath(elt.path) || this.vault.getFileByPath(ev.path);
    if (!localFile) {
      this.logger.log('bitrix:update: локальный файл не найден, создаём', 'INFO', ev);
      this.addToIgnore(elt.path);
      await this.localController.createFile(elt);
      return;
    }
    const mapping = this.mappingManager.getById(ev.bitrixId);

    // Проверка конфликта: обе стороны двигались с момента последней синхронизации.
    if (mapping) {
      const localMoved = localFile.stat.mtime > mapping.lastLocalMtime;
      const remoteMoved = elt.lastUpdate > mapping.lastUpdatBitrix;
      if (localMoved && remoteMoved) {
        await this.handleConflict(localFile, elt);
        return;
      }
      if (localMoved && !remoteMoved) {
        // Только локальное движение — пушим локальную версию.
        this.addToIgnore(localFile.path);
        await this.bitrixController.updateFile(localFile, elt);
        return;
      }
    }
    // Только удалённое движение (или нет маппинга) — тянем удалённую версию.
    this.addToIgnore(elt.path);
    await this.localController.updateFile(localFile, elt);
  }

  private async handleBitrixRename(ev: Extract<SyncEvent, { kind: 'bitrix:rename' }>) {
    const elt = ev.isFolder
      ? await new BitrixMap(this.bitrixApi).getFolderByMapId(ev.bitrixId, [...this.mappingManager.getAll()])
      : await new BitrixMap(this.bitrixApi).getFileByMapId(ev.bitrixId, [...this.mappingManager.getAll()]);
    if (!elt) {
      this.logger.log('bitrix:rename: элемент не найден через API', 'WARN', ev);
      return;
    }
    const localMap = this.mappingManager.getById(ev.bitrixId);
    if (!localMap) {
      this.logger.log('bitrix:rename: нет локального маппинга — обрабатываем как create', 'INFO', ev);
      this.addToIgnore(elt.path);
      if (ev.isFolder) {
        await this.localController.createFolder(elt);
      } else {
        await this.localController.createFile(elt);
      }
      return;
    }
    this.addToIgnore(elt.path);
    if (ev.isFolder) {
      const folder = this.vault.getFolderByPath(localMap.path);
      if (!folder) {
        this.logger.log('bitrix:rename: локальная папка не найдена', 'WARN', ev);
        return;
      }
      await this.localController.moveFolder(folder, elt, localMap);
    } else {
      const file = this.vault.getFileByPath(localMap.path);
      if (!file) {
        this.logger.log('bitrix:rename: локальный файл не найден', 'WARN', ev);
        return;
      }
      await this.localController.moveFile(file, elt, localMap);
    }
  }

  private async handleBitrixDelete(ev: Extract<SyncEvent, { kind: 'bitrix:delete' }>) {
    const localMap = this.mappingManager.getById(ev.bitrixId);
    if (!localMap) {
      this.logger.log('bitrix:delete: маппинг не найден, пропускаем', 'INFO', ev);
      return;
    }
    // TODO: prompt user via BulkDeleteConfirmModal before applying
    // (Wave 3/4 свопнет прямое удаление на подтверждение через модалку.)
    this.addToIgnore(localMap.path);
    if (ev.isFolder) {
      const folder = this.vault.getFolderByPath(localMap.path);
      if (!folder) {
        this.logger.log('bitrix:delete: локальная папка уже отсутствует', 'INFO', ev);
        this.mappingManager.remove(ev.bitrixId);
        return;
      }
      await this.localController.deleteFolder(folder, localMap);
    } else {
      const file = this.vault.getFileByPath(localMap.path);
      if (!file) {
        this.logger.log('bitrix:delete: локальный файл уже отсутствует', 'INFO', ev);
        this.mappingManager.remove(ev.bitrixId);
        return;
      }
      await this.localController.deleteFile(file, localMap);
    }
  }

  // ---------- conflict resolution (non-blocking) ----------

  /**
   * Конфликт: обе стороны двигались. Ставим очередь на паузу, открываем модалку,
   * по результату — синхронно применяем выбор (без re-enqueue), снимаем паузу.
   * Esc / клик-вне модалки = «не делать ничего этот раз», следующий sync переспросит.
   */
  private async handleConflict(file: TFile, bitrixMapping: { id: string; path: string; name: string; bitrixUrl: string; lastUpdate: number; isFolder: boolean }) {
    const showContent = ['md'].includes(file.extension);
    let localContent = '';
    let remoteContent: string | undefined;
    if (showContent) {
      localContent = await this.vault.read(file);
      remoteContent = await getTextRemoteFile(bitrixMapping.bitrixUrl);
    }

    if (localContent === remoteContent && showContent) {
      const mapping = this.mappingManager.getById(bitrixMapping.id);
      if (mapping) {
        this.mappingManager.set(bitrixMapping.id, {
          lastLocalMtime: file.stat.mtime,
          lastUpdatBitrix: bitrixMapping.lastUpdate
        });
      } else {
        this.mappingManager.add({
          id: bitrixMapping.id,
          name: file.name,
          isFolder: bitrixMapping.isFolder,
          lastLocalMtime: file.stat.mtime,
          lastUpdatBitrix: bitrixMapping.lastUpdate,
          path: file.path
        });
      }
      return;
    }

    const conflict: DiffContents = {
      localContent,
      remoteContent: remoteContent || '',
      fileName: file.name,
      localTime: file.stat.mtime,
      remoteTime: bitrixMapping.lastUpdate,
      showContent
    };

    this.queue.pause();
    await new Promise<void>((resolve) => {
      const modal = new ConflictResolutionModal(
        this.app,
        conflict,
        async (resolution, content) => {
          try {
            switch (resolution) {
              case 'local':
                this.addToIgnore(file.path);
                await this.bitrixController.updateFile(file, bitrixMapping);
                break;
              case 'remote':
                this.addToIgnore(file.path);
                await this.localController.updateFile(file, bitrixMapping);
                break;
              case 'merged':
                this.addToIgnore(file.path);
                await this.bitrixController.updateFileByContent(bitrixMapping, content || '');
                await this.localController.updateFileByContent(file, content || '', bitrixMapping.lastUpdate);
                break;
              default:
                break;
            }
            new Notice(`Конфликт разрешен для файла: ${file.name}`);
            this.logger.log('Конфликт разрешен для файла', 'INFO', file);
          } catch (error) {
            new Notice(`Ошибка при разрешении конфликта: ${error.message}`);
            this.logger.log('Ошибка при разрешении конфликта', 'ERROR', { file, error });
          } finally {
            resolve();
          }
        }
      );
      // Если пользователь закрывает модалку через Esc / клик-вне — onClose
      // в ConflictResolutionModal зовёт onResolve(undefined) (см. изменение),
      // что приводит сюда же.
      modal.open();
    });
    this.queue.resume();
  }

  // ---------- WS-event ingress ----------

  /**
   * Парсим сообщение, прилетевшее по веб-сокету. Конвертируем в SyncEvent
   * и кладём в очередь — обработчик сделает остальное.
   */
  parseEventWebSocket(event: { command: string, params: any }) {
    const clientWebsocketId = event.params.client;
    if (!clientWebsocketId || clientWebsocketId === this.clientWebsocketId) return;

    if (!event.command) return;
    const isFile = event.command.includes('FILE_');
    const isFolder = event.command.includes('FOLDER_');
    if (!isFile && !isFolder) return;

    const bitrixId = String(event.params.fileId);
    const path = event.params.path as string;
    if (!bitrixId) return;

    const dedupKey = `bitrix:${bitrixId}`;

    if (event.command.endsWith('CREATE')) {
      this.enqueue({
        kind: 'bitrix:create',
        dedupKey,
        bitrixId,
        path,
        isFolder: isFolder ? true : false,
      });
    } else if (event.command.endsWith('UPDATE')) {
      this.enqueue({
        kind: 'bitrix:update',
        dedupKey,
        bitrixId,
        path,
      });
    } else if (event.command.endsWith('DELETE')) {
      this.enqueue({
        kind: 'bitrix:delete',
        dedupKey,
        bitrixId,
        path,
        isFolder: isFolder ? true : false,
      });
    } else if (event.command.endsWith('RENAME') || event.command.endsWith('MOVE')) {
      this.enqueue({
        kind: 'bitrix:rename',
        dedupKey,
        bitrixId,
        newPath: path,
        isFolder: isFolder ? true : false,
      });
    }
  }
}
