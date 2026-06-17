import {
  Notice,
  Plugin,
} from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { LocalEventController } from "src/controllers/LocalEventController";
import { MappingManager } from "src/models/MappingManager";
import { CatchUpService } from "src/services/CatchUpService";
import { Logger } from "src/services/LoggerService";
import { PullAllService } from "src/services/PullAllService";
import { PushAllService } from "src/services/PushAllService";
import { SyncService } from "src/services/SyncService";
import { Bitrix24SyncSettingTab } from "src/ui/Bitrix24SyncSettingTab";

const clientId='app.6852f7fce097f5.55195369';
const clientSecret='A3yMqlIZnAvZuvOZ1ljztkc9mUL1r0tVfmJ5WkdH80bSkFgNmu';

interface Bitrix24SyncSettings {
  client_endpoint: string;
  refresh_token: string;
  expires_in: number;
  syncInterval: number;
  access_token: string;
  currentUserName:string,
  mappings:string;
  lastSync:number;
  currentUserId:number;
  storageId:number;
  folderId:number;
}

const DEFAULT_SETTINGS: Bitrix24SyncSettings = {
  mappings:'[]',
  client_endpoint: "",
  currentUserId:0,
  currentUserName:'',
  refresh_token: "",
  expires_in: 0,
  syncInterval: 30,
  access_token: "",
  lastSync:0,
  storageId:0,
  folderId:0
};

export default class Bitrix24Sync extends Plugin {
  settings: Bitrix24SyncSettings;
  syncService: SyncService;
  bitrix24Api: Bitrix24Api;
  mappingManager:MappingManager
  localEventController:LocalEventController;
  logger: Logger;

  /** Таймер дебаунса автосейва маппинга (~500ms). */
  private mappingSaveTimer: NodeJS.Timeout | null = null;

  async onload() {
    await this.loadSettings();
    this.logger=new Logger(this.app.vault);
    this.logger.log("Loading Bitrix24 Sync plugin. Period sync: "+this.settings.syncInterval, 'INFO');

    this.initializeComponents();
    //Вкладка настроек
    const settingsTab=new Bitrix24SyncSettingTab(this.app, this, {clientId, clientSecret})
    this.addSettingTab(settingsTab);
    this.addCommands();


    // Регистрируем vault-листенеры ТОЛЬКО после layoutReady, иначе
    // Obsidian при первичном скане vault фаерит `create` на все существующие
    // файлы (это документированное поведение), и мы их ошибочно
    // попытаемся «создать» в Битриксе с уже устаревшими parent-id.
    // Catch-up тоже запускаем после layoutReady, чтобы он не гонялся с
    // первичным сканом.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvents();
      if (this.isConnectionConfigured()) {
        // fire-and-forget
        void this.runCatchUp();
      }
    });
  }

  /** True если задан endpoint, access_token и folderId. */
  private isConnectionConfigured(): boolean {
    return !!this.settings.client_endpoint
      && !!this.settings.access_token
      && !!this.settings.folderId;
  }

  registerEvents(){
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath)=>{
        try {
          await this.localEventController.onMove(file, oldPath);
          this.settings.lastSync=new Date().getTime();
          await this.saveSettings();
        } catch (error) {
          new Notice('Ошибка выполнения команды перемещения файла: '+error.message);
        }
      })
    )
    this.registerEvent(
      this.app.vault.on('modify', async (file)=>{
        try {
          await this.localEventController.onUpdate(file);
          this.settings.lastSync=new Date().getTime();
          await this.saveSettings();
        } catch (error) {
          new Notice('Ошибка выполнения обновления файла: '+error.message);
        }
      })
    )

    this.registerEvent(
      this.app.vault.on('delete', async (file)=>{
        this.logger.log('Обнаружено удаление файла: '+file.path);
        try {
          await this.localEventController.onDelete(file);
          this.settings.lastSync=new Date().getTime();
          await this.saveSettings();
        } catch (error) {
          new Notice('Ошибка выполнения удаления файла: '+error.message);
        }
      })
    )

    this.registerEvent(
      this.app.vault.on('create', async (file)=>{
        // Отбрасываем временные файлы Obsidian (.tmp).
        if (file.path.endsWith('.tmp')) return;
        this.logger.log('Обнаружено создание файла: '+file.path);
        try {
          await this.localEventController.onCreate(file);
          this.settings.lastSync=new Date().getTime();
          await this.saveSettings();
        } catch (error) {
          new Notice('Ошибка выполнения создания файла: '+error.message);
        }
      })
    )
  }

  onunload() {
    if (this.mappingSaveTimer) {
      clearTimeout(this.mappingSaveTimer);
      this.mappingSaveTimer = null;
    }
    this.logger.log("Unloading Bitrix24 Sync plugin");
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(reloadPlugin=false) {
    await this.saveData(this.settings);
    if (reloadPlugin){
      if (this.bitrix24Api?.webSocketClient){
        this.bitrix24Api.webSocketDisconnect();
      }
      this.initializeComponents();
    }
  }

  /**
   * Дебаунсим автосейв маппинга: каждый вызов сбрасывает предыдущий таймер.
   * После ~500ms тишины — сериализуем и сохраняем.
   */
  private scheduleMappingSave() {
    if (this.mappingSaveTimer) {
      clearTimeout(this.mappingSaveTimer);
    }
    this.mappingSaveTimer = setTimeout(async () => {
      this.mappingSaveTimer = null;
      try {
        this.settings.mappings = this.mappingManager.toJSON();
        await this.saveSettings();
      } catch (err) {
        this.logger.log('Не удалось сохранить mapping', 'ERROR', err);
      }
    }, 500);
  }

  initializeComponents() {
    // Инициализация API клиента
    if (!this.bitrix24Api){
      this.bitrix24Api = new Bitrix24Api({
        client_id: clientId,
        client_secret: clientSecret,
        access_token: this.settings.access_token,
        refresh_token: this.settings.refresh_token,
        client_endpoint: this.settings.client_endpoint,
        expires_in: this.settings.expires_in
      }, params=>{
        this.settings.access_token=params.accessToken;
        this.settings.refresh_token=params.refreshToken;
        this.settings.expires_in=params.expiresIn;
        this.saveSettings(true);
      });
    }
    else{
      this.bitrix24Api.refreshToken=this.settings.refresh_token;
      this.bitrix24Api.accessToken=this.settings.access_token;
      this.bitrix24Api.clientEndpoint=this.settings.client_endpoint;
      this.bitrix24Api.expiresIn=this.settings.expires_in;
    }


    // Инициализация сервиса маппинга с автосейвом по onChange.
    this.mappingManager = MappingManager.fromJSON(
      this.app.vault,
      this.settings.mappings,
      () => this.scheduleMappingSave()
    );

    // Гарантируем что корневая папка синхронизации присутствует в маппинге.
    // Без неё BitrixController.createFile / BitrixMap.getFileByMapId не смогут
    // найти родителя для файлов первого уровня, и стационарный поток + catch-up
    // будут молча промахиваться по корневым файлам.
    if (this.settings.folderId) {
      const rootId = String(this.settings.folderId);
      if (!this.mappingManager.getById(rootId)) {
        this.mappingManager.add({
          id: rootId,
          path: '/',
          name: 'root',
          isFolder: true,
          lastLocalMtime: Date.now(),
          lastUpdatBitrix: Date.now(),
        });
      }
    }

    // Инициализация сервиса синхронизации
    this.syncService = new SyncService(
      this.bitrix24Api,
      this.mappingManager,
      this.app.vault,
      this.app,
      0,
      this.logger
    );

    if (!this.settings.access_token||!this.settings.refresh_token) return;
    this.bitrix24Api.getWebSocketClient().then(result=>{
      if (!result) return;
      result.onmessage=(event)=>{
        const dataRaw=(event?.data||'').replace(/#!NGINXNMS!#(.*)#!NGINXNME!#/, '$1');
        try {
          const data=JSON.parse(dataRaw);
          this.syncService.parseEventWebSocket(data?.text||{});
        } catch (error) {
          this.logger.log('Неверный формат полученного по вебсокету сообщения', 'ERROR', event);
        }
      };
    });

    this.localEventController=new LocalEventController(
      this.syncService,
      this.app,
      this.mappingManager,
      this.bitrix24Api,
      this.logger
    );
  }

  addCommands() {
    this.addCommand({
      id: 'push-all-to-bitrix',
      name: 'Выгрузить всё в Битрикс24',
      callback: () => { void this.runPushAll(); }
    });

    this.addCommand({
      id: 'pull-all-from-bitrix',
      name: 'Загрузить всё из Битрикс24',
      callback: () => { void this.runPullAll(); }
    });

    this.addCommand({
      id: 'catch-up-from-bitrix',
      name: 'Догнать изменения из Битрикс24',
      callback: () => { void this.runCatchUp(); }
    });

    this.addCommand({
      id: 'clear-mapping',
      name: 'Сбросить карту',
      callback: () => { this.mappingManager.clear(); }
    });
  }

  /**
   * Полная выгрузка локального vault в Битрикс24.
   * Сервис ставит общую очередь на паузу на время работы и снимает по выходу.
   */
  async runPushAll(): Promise<void> {
    if (!this.isConnectionConfigured()) {
      new Notice('Настройте подключение и папку синхронизации');
      return;
    }
    const service = new PushAllService(
      this.app,
      this.app.vault,
      this.bitrix24Api,
      this.mappingManager,
      this.syncService,
      this.logger,
      String(this.settings.folderId)
    );
    try {
      const res = await service.run();
      // Полная сверка с Битриксом → можно сдвинуть lastSync.
      this.settings.lastSync = Date.now();
      // Принудительный flush маппинга (на всякий случай — debounce уже стоит в очереди).
      this.settings.mappings = this.mappingManager.toJSON();
      await this.saveSettings();
      new Notice(
        `Готово. Создано: ${res.created}, обновлено: ${res.updated}, удалено: ${res.deleted}, ошибок: ${res.errors.length}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('runPushAll: ошибка', 'ERROR', { error: msg });
      new Notice('Ошибка выгрузки в Битрикс24: ' + msg);
    }
  }

  /**
   * Полная загрузка из Битрикс24 в локальный vault.
   */
  async runPullAll(): Promise<void> {
    if (!this.isConnectionConfigured()) {
      new Notice('Настройте подключение и папку синхронизации');
      return;
    }
    const service = new PullAllService(
      this.app,
      this.app.vault,
      this.bitrix24Api,
      this.mappingManager,
      this.syncService,
      this.logger,
      String(this.settings.folderId)
    );
    try {
      const res = await service.run();
      this.settings.lastSync = Date.now();
      this.settings.mappings = this.mappingManager.toJSON();
      await this.saveSettings();
      new Notice(
        `Готово. Создано: ${res.created}, обновлено: ${res.updated}, удалено: ${res.deleted}, ошибок: ${res.errors.length}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('runPullAll: ошибка', 'ERROR', { error: msg });
      new Notice('Ошибка загрузки из Битрикс24: ' + msg);
    }
  }

  /**
   * Догнать пропущенные изменения Битрикса (на старте плагина или вручную).
   * lastSync обновляется внутри сервиса через setLastSync-колбэк.
   */
  async runCatchUp(): Promise<void> {
    if (!this.isConnectionConfigured()) {
      new Notice('Настройте подключение и папку синхронизации');
      return;
    }
    const service = new CatchUpService(
      this.app,
      this.app.vault,
      this.bitrix24Api,
      this.mappingManager,
      this.syncService,
      this.logger,
      String(this.settings.folderId),
      () => this.settings.lastSync || 0,
      (ts: number) => {
        this.settings.lastSync = ts;
        // saveSettings возвращает Promise — fire-and-forget внутри колбэка.
        void this.saveSettings();
      }
    );
    // CatchUpService.run сам ловит свои ошибки; внешний try на всякий случай.
    try {
      await service.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.log('runCatchUp: непредвиденная ошибка', 'ERROR', { error: msg });
    }
  }
}
