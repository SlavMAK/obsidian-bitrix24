import { App, Notice, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "../api/bitrix24-api";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { FileMapping, MappingManager } from "src/models/MappingManager";
import { SyncService } from "./SyncService";
import { Logger } from "./LoggerService";
import { SyncEvent, dedupKeyFor } from "./SyncEvents";
import {
  askBulkDeleteConfirm,
  BulkDeleteItem,
} from "src/ui/BulkDeleteConfirmModal";

/**
 * CatchUpService — startup catch-up for Bitrix24-master state.
 *
 * Runs on plugin load (after WS init) to detect Bitrix changes that occurred
 * while the plugin was not running (and therefore missed via WS). Builds a
 * fresh BitrixMap of the target tree, diffs against MappingManager, and:
 *   - enqueues bitrix:create / bitrix:update / bitrix:rename events through
 *     SyncService (so dispatch + ignore-list behave identically to steady-state);
 *   - confirms locally-orphaned deletions via BulkDeleteConfirmModal and
 *     enqueues bitrix:delete events for the user-approved subset.
 *
 * Design notes:
 *   - We deliberately do NOT pause the queue. Catch-up runs at startup before
 *     WS / vault traffic is significant; pausing would block our own delta from
 *     processing. Instead we enqueue, then poll EventQueue.size() until drained.
 *   - Errors are caught at the top level: catch-up failure should never kill
 *     plugin onload, so run() never throws.
 */
export class CatchUpService {

  private static readonly DRAIN_POLL_INTERVAL_MS = 100;
  private static readonly DRAIN_TIMEOUT_MS = 60_000;

  constructor(
    private app: App,
    private vault: Vault,
    private bitrixApi: Bitrix24Api,
    private mappingManager: MappingManager,
    private syncService: SyncService,
    private logger: Logger,
    private rootFolderId: string,
    private getLastSync: () => number,
    private setLastSync: (ts: number) => void
  ) {}

  public async run(): Promise<void> {
    try {
      this.logger.log('CatchUpService.run: started', 'INFO', {
        rootFolderId: this.rootFolderId,
        lastSync: this.getLastSync(),
      });

      // 1) Build a fresh BitrixMap of the full target tree.
      const bitrixMap = await this.buildRemoteMap();
      if (!bitrixMap) {
        // buildRemoteMap already logged + showed Notice on failure.
        return;
      }

      // 1a) Heal-pass: до подсчёта дельты приводим маппинг к реальности.
      //   - удаляем сирот (нет локального файла);
      //   - перепривязываем mapping на новый Битрикс-id при совпадении пути
      //     (например, файл был удалён и пересоздан в Битриксе).
      const healStats = this.healMapping(bitrixMap);
      this.logger.log('CatchUpService.healMapping', 'INFO', healStats);

      // 2) Compute delta against the (now-healed) local mapping.
      const { events, deletionCandidates } = this.computeDelta(bitrixMap);

      this.logger.log('CatchUpService: delta computed', 'INFO', {
        events: events.length,
        deletionCandidates: deletionCandidates.length,
      });

      // 3) Enqueue non-destructive events first so they begin processing
      //    while we ask the user about deletions.
      for (const ev of events) {
        this.syncService.enqueue(ev);
      }

      // 4) Confirm deletions via modal.
      // Семантика:
      //   - отмечено → удалить локально (через bitrix:delete);
      //   - НЕ отмечено (в т.ч. отмена / Esc / пустое Применить) → оставить
      //     локально И ВЫГРУЗИТЬ обратно в Битрикс (маппинг устарел —
      //     Битрикс-id мёртв, поэтому пушим как новые элементы).
      // Отмена и пустое Применить эквивалентны: ни то ни другое не отмечает
      // файлы к удалению, значит все «оставленные» уходят на push-back.
      if (deletionCandidates.length > 0) {
        const items: BulkDeleteItem[] = deletionCandidates.map((m) => ({
          path: m.path,
          isFolder: m.isFolder,
          hint: 'нет в Битрикс24',
        }));

        const selectedPaths = await askBulkDeleteConfirm(this.app, {
          title: 'Расхождение с Битрикс24',
          description:
            'Эти файлы есть локально, но отсутствуют в Битрикс24. ' +
            'Отмеченные будут удалены локально. Неотмеченные — выгружены обратно в Битрикс24.',
          items,
          defaultSelected: false,
        });

        const selectedSet = new Set(selectedPaths);
        const toDelete: FileMapping[] = [];
        const toPushBack: FileMapping[] = [];
        for (const mapping of deletionCandidates) {
          if (selectedSet.has(mapping.path)) {
            toDelete.push(mapping);
          } else {
            toPushBack.push(mapping);
          }
        }

        // 4a) Удаляем отмеченные.
        for (const mapping of toDelete) {
          const deleteEvent: SyncEvent = {
            kind: 'bitrix:delete',
            dedupKey: dedupKeyFor('bitrix', mapping.id),
            bitrixId: mapping.id,
            path: mapping.path,
            isFolder: mapping.isFolder,
          };
          this.syncService.enqueue(deleteEvent);
        }

        // 4b) Push-back оставленных: parents-first, прямые вызовы контроллеров
        // (через очередь нельзя — нужно гарантировать что родитель создан
        // ДО ребёнка, а очередь FIFO с дедупом не даёт такой гарантии).
        await this.pushBackKept(toPushBack);
      }

      // 5) Wait for the queue to drain (timeout-capped).
      const drained = await this.waitForDrain();
      if (!drained) {
        this.logger.log(
          'CatchUpService: drain timeout — proceeding anyway',
          'WARN',
          { remaining: this.syncService.getQueue().size() }
        );
        new Notice('Catch-up: очередь не успела опустеть за отведённое время, продолжаем.');
      }

      // 6) Persist new lastSync only after we believe the delta has been applied.
      this.setLastSync(Date.now());

      this.logger.log('CatchUpService.run: completed', 'INFO', {
        drained,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('CatchUpService.run: unhandled error', 'ERROR', { error: msg });
      new Notice(`Ошибка catch-up: ${msg}`);
      // Swallow — onload must not be killed by catch-up failure.
    }
  }

  /**
   * Builds a full BitrixMap of the configured target tree.
   * Seeds the root with `addToMap`, then recursively loads via `fillMapping`.
   * Returns `null` on failure (already logged / Notice-shown).
   */
  private async buildRemoteMap(): Promise<BitrixMap | null> {
    try {
      const map = new BitrixMap(this.bitrixApi);
      map.addToMap({
        id: this.rootFolderId,
        path: '/',
        bitrixUrl: '',
        name: 'root',
        isFolder: true,
        lastUpdate: Date.now(),
      });
      await map.fillMapping([
        { folderId: this.rootFolderId, folderName: '/' },
      ]);
      return map;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('CatchUpService.buildRemoteMap: failed', 'ERROR', { error: msg });
      new Notice(`Не удалось построить карту Битрикса для catch-up: ${msg}`);
      return null;
    }
  }

  /**
   * Heal-pass: приводит MappingManager к реальности до подсчёта дельты.
   *
   * Делает две вещи:
   *   1) Прунинг сирот — если ни локального файла/папки, ни Битрикс-id больше нет,
   *      запись маппинга мёртва, удаляем тихо.
   *   2) Rebinding по пути — если Битрикс-id мёртв, но по тому же пути в Битриксе
   *      есть элемент с новым id, считаем что это та же сущность (пересоздана).
   *      Обновляем запись маппинга: новый id, новый lastUpdatBitrix.
   *
   * Цель — чтобы в дальнейшей модалке удаления не было «фантомных» предложений.
   *
   * Локальные пути проверяем через vault.getFileByPath / getFolderByPath, которые
   * возвращают `null` если объекта нет.
   */
  private healMapping(bitrixMap: BitrixMap): { prunedOrphaned: number; rebound: number; droppedLocalMissing: number } {
    const remote = bitrixMap.getMap();
    const remoteById = new Map<string, BitrixMapElement>();
    const remoteByPath = new Map<string, BitrixMapElement>();
    for (const elt of remote) {
      remoteById.set(String(elt.id), elt);
      remoteByPath.set(elt.path, elt);
    }

    let prunedOrphaned = 0;
    let rebound = 0;
    let droppedLocalMissing = 0;

    // Снимок: getAll() возвращает readonly view, копируем чтобы безопасно мутировать.
    const all = [...this.mappingManager.getAll()];
    for (const mapping of all) {
      // Корень не трогаем.
      if (String(mapping.id) === String(this.rootFolderId)) continue;

      const localExists = mapping.isFolder
        ? !!this.vault.getFolderByPath(mapping.path)
        : !!this.vault.getFileByPath(mapping.path);
      const bitrixHasId = remoteById.has(String(mapping.id));

      // Матрица решений:
      //   (false, false) — мертво с обеих сторон → прунинг сироты.
      //   (false, true)  — локально нет, в Битриксе есть → СНОСИМ маппинг,
      //                    чтобы computeDelta увидел как новый bitrix:create
      //                    и скачал файл локально.
      //   (true,  false) — локально есть, в Битриксе нет → пробуем ребайнд по пути;
      //                    если не нашли — оставляем (попадёт в deletionCandidates).
      //   (true,  true)  — всё в порядке, отдаём дальше computeDelta.

      if (!localExists && !bitrixHasId) {
        this.mappingManager.remove(mapping.id);
        prunedOrphaned++;
        this.logger.log('healMapping: маппинг-сирота (нет ни локально, ни в Битриксе)', 'INFO', mapping);
        continue;
      }

      if (!localExists && bitrixHasId) {
        // Локально удалён пока плагин был офф; в Битриксе файл жив.
        // Сносим маппинг, чтобы computeDelta перевыставил bitrix:create.
        this.mappingManager.remove(mapping.id);
        droppedLocalMissing++;
        this.logger.log('healMapping: локально нет, в Битриксе есть — сбрасываем маппинг для bitrix:create', 'INFO', mapping);
        continue;
      }

      if (!bitrixHasId && localExists) {
        // Попробуем переподвязать на свежий Битрикс-id по совпадению пути.
        const remoteAtPath = remoteByPath.get(mapping.path);
        if (remoteAtPath && remoteAtPath.isFolder === mapping.isFolder) {
          this.mappingManager.remove(mapping.id);
          this.mappingManager.add({
            id: remoteAtPath.id,
            path: remoteAtPath.path,
            name: remoteAtPath.name,
            isFolder: remoteAtPath.isFolder,
            lastUpdatBitrix: remoteAtPath.lastUpdate,
            lastLocalMtime: mapping.lastLocalMtime,
          });
          rebound++;
          this.logger.log('healMapping: маппинг переподвязан на новый Битрикс-id', 'INFO', {
            oldId: mapping.id,
            newId: remoteAtPath.id,
            path: mapping.path,
          });
        }
        // Если по пути в Битриксе ничего нет — оставляем как есть, попадёт
        // в deletionCandidates (модалка предложит удалить локально / push-back).
      }
    }

    return { prunedOrphaned, rebound, droppedLocalMissing };
  }

  /**
   * Computes the delta between the freshly-built BitrixMap and MappingManager.
   *
   *   - bitrix element без маппинга → bitrix:create (всегда, без оглядки на lastSync);
   *   - известный маппинг с другим путём → bitrix:rename;
   *   - известный маппинг и elt.lastUpdate > mapping.lastUpdatBitrix → bitrix:update;
   *   - маппинг, id которого больше нет в BitrixMap → deletionCandidate.
   *
   * Раньше тут стоял фильтр `elt.lastUpdate > lastSync`, но он оказался опасным:
   * если предыдущий catch-up успел установить lastSync (например, после неудачной
   * попытки), новые/неизвестные файлы в Битриксе могли иметь lastUpdate меньше
   * lastSync и тогда вообще не пуллились. После heal-pass маппинг уже отражает
   * реальность — items без маппинга всегда новые, времянной фильтр избыточен.
   */
  private computeDelta(
    bitrixMap: BitrixMap
  ): { events: SyncEvent[]; deletionCandidates: FileMapping[] } {
    const events: SyncEvent[] = [];
    const remote = bitrixMap.getMap();

    // Index remote by id for O(1) "still exists" checks below.
    const remoteById = new Map<string, BitrixMapElement>();
    for (const elt of remote) {
      remoteById.set(String(elt.id), elt);
    }

    for (const elt of remote) {
      // Skip the root — we seeded it artificially; it has no real mapping.
      if (String(elt.id) === String(this.rootFolderId)) continue;

      const mapping = this.mappingManager.getById(String(elt.id));
      const dedupKey = dedupKeyFor('bitrix', String(elt.id));

      if (!mapping) {
        // Unknown id in Bitrix → treat as create.
        events.push({
          kind: 'bitrix:create',
          dedupKey,
          bitrixId: String(elt.id),
          path: elt.path,
          isFolder: elt.isFolder,
        });
        continue;
      }

      // Known mapping: decide between rename and update.
      if (mapping.path !== elt.path) {
        events.push({
          kind: 'bitrix:rename',
          dedupKey,
          bitrixId: String(elt.id),
          newPath: elt.path,
          isFolder: elt.isFolder,
        });
        continue;
      }

      // Same path — fall back to content/metadata update if remote is newer
      // than what we last recorded. Folders typically have no payload to pull,
      // but we still enqueue: the handler is a no-op for folders without
      // dedicated bitrix:update folder logic (current handler is file-oriented;
      // the SyncService bitrix:update handler will gracefully log a warning if
      // the element resolves to nothing).
      if (elt.lastUpdate > mapping.lastUpdatBitrix && !elt.isFolder) {
        events.push({
          kind: 'bitrix:update',
          dedupKey,
          bitrixId: String(elt.id),
          path: elt.path,
        });
      }
    }

    // Deletion candidates: mappings whose id is no longer present in Bitrix
    // (and which aren't the seeded root).
    const deletionCandidates: FileMapping[] = [];
    for (const mapping of this.mappingManager.getAll()) {
      if (String(mapping.id) === String(this.rootFolderId)) continue;
      if (remoteById.has(String(mapping.id))) continue;
      deletionCandidates.push(mapping);
    }

    return { events, deletionCandidates };
  }

  /**
   * Выгружает в Битрикс файлы/папки, которые юзер решил оставить локально,
   * хотя их соответствующие записи в Битриксе мертвы. Идём parents-first,
   * чтобы при создании ребёнка свежий маппинг родителя уже существовал.
   *
   * Для каждого элемента:
   *  1. удаляем устаревший маппинг (его Битрикс-id мёртв);
   *  2. находим TFile/TFolder в vault'е;
   *  3. кладём путь в ignore-list (на случай эхо-событий);
   *  4. вызываем контроллер напрямую — он создаст элемент в Битриксе и добавит свежий маппинг.
   */
  private async pushBackKept(items: FileMapping[]): Promise<void> {
    if (items.length === 0) return;

    // parents-first: меньше слэшей в пути = ближе к корню. На равной глубине
    // папки идут раньше файлов.
    const sorted = [...items].sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return 0;
    });

    this.logger.log('CatchUpService.pushBackKept: started', 'INFO', { count: sorted.length });

    let pushed = 0;
    let errors = 0;
    for (const mapping of sorted) {
      try {
        // Снимаем устаревший маппинг до создания, иначе createFile/Folder
        // увидят дубль и могут запутаться.
        this.mappingManager.remove(mapping.id);

        if (mapping.isFolder) {
          const folder = this.vault.getFolderByPath(mapping.path);
          if (!(folder instanceof TFolder)) {
            this.logger.log('pushBackKept: папка не найдена локально, пропускаем', 'WARN', mapping);
            continue;
          }
          this.syncService.addToIgnore(folder.path);
          await this.syncService.bitrixController.createFolder(folder);
        } else {
          const file = this.vault.getFileByPath(mapping.path);
          if (!(file instanceof TFile)) {
            this.logger.log('pushBackKept: файл не найден локально, пропускаем', 'WARN', mapping);
            continue;
          }
          this.syncService.addToIgnore(file.path);
          await this.syncService.bitrixController.createFile(file);
        }
        pushed++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.log('pushBackKept: ошибка при выгрузке элемента', 'ERROR', { mapping, error: msg });
      }
    }

    this.logger.log('CatchUpService.pushBackKept: completed', 'INFO', { pushed, errors });
    if (errors > 0) {
      new Notice(`Catch-up: выгружено ${pushed}, ошибок ${errors}. Смотри лог.`);
    } else if (pushed > 0) {
      new Notice(`Catch-up: выгружено в Битрикс24: ${pushed}`);
    }
  }

  /**
   * Polls EventQueue.size() until it reaches zero or the timeout elapses.
   * Returns true if drained cleanly, false on timeout.
   */
  private async waitForDrain(): Promise<boolean> {
    const queue = this.syncService.getQueue();
    const start = Date.now();
    while (queue.size() > 0) {
      if (Date.now() - start > CatchUpService.DRAIN_TIMEOUT_MS) {
        return false;
      }
      await this.sleep(CatchUpService.DRAIN_POLL_INTERVAL_MS);
    }
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
