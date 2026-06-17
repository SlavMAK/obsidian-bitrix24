import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { MappingManager } from "src/models/MappingManager";
import { SyncService } from "src/services/SyncService";
import { Logger } from "src/services/LoggerService";
import { dedupKeyFor } from "src/services/SyncEvents";

/**
 * Тонкий продьюсер vault-событий: преобразуем TFile/TFolder события в SyncEvent
 * и кладём в общий EventQueue (через SyncService.enqueue).
 *
 * Никаких REST-roundtrips и сравнений тут больше нет: всё это происходит
 * в SyncService.handle (где это нужно — и только там).
 */
export class LocalEventController {
  constructor(
    private readonly syncService: SyncService,
    private readonly app: App,
    private mappingManager: MappingManager,
    private bitrixApi: Bitrix24Api,
    private logger: Logger
  ) {}

  async onMove(file: TAbstractFile, oldPath: string) {
    const isFolder = file instanceof TFolder;
    if (!(file instanceof TFile) && !isFolder) return;
    this.syncService.enqueue({
      kind: 'local:rename',
      dedupKey: dedupKeyFor('local', file.path),
      oldPath,
      newPath: file.path,
      isFolder,
    });
  }

  public async onUpdate(file: TAbstractFile) {
    if (!(file instanceof TFile)) return; // обновление папки в Obsidian-событиях не приходит
    this.syncService.enqueue({
      kind: 'local:modify',
      dedupKey: dedupKeyFor('local', file.path),
      path: file.path,
    });
  }

  async onDelete(file: TAbstractFile) {
    const isFolder = file instanceof TFolder;
    if (!(file instanceof TFile) && !isFolder) return;
    this.syncService.enqueue({
      kind: 'local:delete',
      dedupKey: dedupKeyFor('local', file.path),
      path: file.path,
      isFolder,
    });
  }

  async onCreate(file: TAbstractFile) {
    const isFolder = file instanceof TFolder;
    if (!(file instanceof TFile) && !isFolder) return;
    this.syncService.enqueue({
      kind: 'local:create',
      dedupKey: dedupKeyFor('local', file.path),
      path: file.path,
      isFolder,
    });
  }
}
