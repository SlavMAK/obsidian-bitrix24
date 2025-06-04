import {
  Notice,
  Plugin,
} from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";
import { SyncService } from "src/services/SyncService";
import { Bitrix24SyncSettingTab } from "src/ui/Bitrix24SyncSettingTab";

const clientId='local.65f7e966bea826.93817329';
const clientSecret='XS7KY0jMJxKAHfY1D010Wr7Qbcjw40EujLMQIZqLR3oJPen2PH';
// Remember to rename these classes and interfaces!

interface Bitrix24SyncSettings {
  client_endpoint: string;
  refresh_token: string;
  expires_in: number;
  syncInterval: number;
  access_token: string;
  mappings:string;
  lastSync:number;
  currentUserId:number;
}

const DEFAULT_SETTINGS: Bitrix24SyncSettings = {
  mappings:'[]',
  client_endpoint: "",
  currentUserId:0,
  refresh_token: "",
  expires_in: 0,
  syncInterval: 30,
  access_token: "",
  lastSync:0
};

export default class Bitrix24Sync extends Plugin {
  settings: Bitrix24SyncSettings;
  isSyncing:boolean;
  syncService: SyncService;
  bitrix24Api: Bitrix24Api;
  mappingManager:MappingManager

  async onload() {
    await this.loadSettings();
    console.log("Loading Bitrix24 Sync plugin. Period sync: "+this.settings.syncInterval);

    this.initializeComponents();
    //Вкладка настроек
    const settingsTab=new Bitrix24SyncSettingTab(this.app, this, {clientId, clientSecret})
    this.addSettingTab(settingsTab);
    this.addCommands();
    
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath)=>{
        this.isSyncing=true;
        try {
          const localFile=await this.app.vault.getFileByPath(file.path);
          if (!localFile) throw new Error('Не удалось получить файл по пути '+file.path);
          this.syncService.addMoveFile(file, oldPath, file.path);
          await this.syncService.checkLocalFile(localFile);
          this.syncService.clearMovedFiles();
          await this.syncService.processFileQueue();
          this.settings.lastSync=new Date().getTime();
          this.settings.mappings=this.mappingManager.toJSON();
          await this.saveSettings();
        } catch (error) {
          new Notice('Ошибка выполнения команды перемещения файла: '+error.message);
        }
        finally{
          this.isSyncing=false;
        }
      })
    )
    this.addPeriodicSync();
  }

  onunload() {
    console.log("Unloading Bitrix24 Sync plugin");
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  initializeComponents() {
    // Инициализация API клиента
    this.bitrix24Api = new Bitrix24Api({
      client_id: clientId,
      client_secret: clientSecret,
      access_token: this.settings.access_token,
      refresh_token: this.settings.refresh_token,
      client_endpoint: this.settings.client_endpoint,
      expires_in: this.settings.expires_in
    });
    
    // Инициализация сервиса маппинга
    this.mappingManager = MappingManager.fromJSON(this.app.vault, this.settings.mappings);
    
    // Инициализация сервиса синхронизации
    this.syncService = new SyncService(
      this.bitrix24Api,
      this.mappingManager,
      this.app.vault,
      this.app,
      // Number(this.settings.lastSync)||0
      0
    );
  }

  addCommands() {
    // Команда полной синхронизации
    this.addCommand({
      id: 'sync-with-bitrix-disk',
      name: 'Sync with Bitrix.Disk',
      callback: () => this.syncWithBitrix()
    });

    this.addCommand({
      id: 'clear-mapping',
      name: 'Сбросить карту',
      callback: () => {this.mappingManager.mappings=[]}
    });
  }

  async addPeriodicSync(){
    if (this.isSyncing) return;
    await this.syncWithBitrix();
    setTimeout(()=>this.addPeriodicSync(), this.settings.syncInterval*1000);
  }

  async syncWithBitrix(){
    if (!this.settings.access_token || !this.settings.client_endpoint) {
      new Notice('Please configure Bitrix24 API access in settings');
      return;
    }

    if (this.isSyncing) {
      new Notice('Sync is already in progress');
      return;
    }

    this.isSyncing = true;

    try {
      const folderId='19477'; //TODO брать из настроек
      this.mappingManager.add({
        id:folderId,
        path:'/',
        name:'root',
        isFolder:true,
        lastLocalMtime:new Date().getTime(),
        lastUpdatBitrix:new Date().getTime(),
      });
      this.syncService.setLastSync(this.settings.lastSync||0);
      // this.syncService.setLastSync(0);

      const bitrixMap=new BitrixMap(this.bitrix24Api);
      bitrixMap.addToMap({
        id:folderId,
        path:'/',
        bitrixUrl:'',
        name:'root',
        isFolder:true,
        lastUpdate:new Date().getTime()
      })
      await bitrixMap.fillMapping([{folderId, folderName:'/'}]);
      await this.syncService.sync(bitrixMap);
      
      this.settings.lastSync=new Date().getTime();
      this.settings.mappings=this.mappingManager.toJSON();
      this.saveSettings();
    } catch (error) {
      console.error('Error during sync with Bitrix.Disk:', error);
      new Notice(`Sync error: ${error.message || 'Unknown error'}`);
    }
    finally{
      this.isSyncing = false;
    }
  }
}

