import {
  App,
  ButtonComponent,
  // Editor,
  // MarkdownView,
  // Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { MappingManager } from "src/models/MappingManager";
import { SyncService } from "src/services/SyncService";

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
}

const DEFAULT_SETTINGS: Bitrix24SyncSettings = {
  mappings:'[]',
  client_endpoint: "",
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
    console.log("Loading Bitrix24 Sync plugin");
    await this.loadSettings();

    this.initializeComponents();
    //Вкладка настроек
    this.addSettingTab(new Bitrix24SyncSettingTab(this.app, this));
    this.addCommands();

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
      Number(this.settings.lastSync)||0
    );
  }

  addCommands() {
    // Команда полной синхронизации
    this.addCommand({
      id: 'sync-with-bitrix-disk',
      name: 'Sync with Bitrix.Disk',
      callback: () => this.syncWithBitrix()
    });

    // // Команда синхронизации текущего файла
    // this.addCommand({
    //   id: 'sync-current-file',
    //   name: 'Sync current file with Bitrix.Disk',
    //   checkCallback: (checking) => {
    //     const activeFile = this.app.workspace.getActiveFile();
    //     if (!activeFile) return false;
        
    //     if (checking) return true;
        
    //     // this.syncCurrentFile(activeFile);
    //     return true;
    //   }
    // });
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
      const arrParents=[{folderId:'19477', folderName:'Мой obsidian'}];
      for (const parent of arrParents){
         this.mappingManager.add({
          fileId:parent.folderId,
          filePath:'./',
          bitrixUrl:'',
          fileName:parent.folderName,
          lastSyncTimestampBitrix:0,
          isFolder:true,
          lastSyncTimestamp:0
        });
      }
      await this.syncService.fillMapping(arrParents);
      await this.syncService.sync();
      console.log('mappings', this.mappingManager.toJSON());




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

class Bitrix24SyncSettingTab extends PluginSettingTab {
  plugin: Bitrix24Sync;

  constructor(app: App, plugin: Bitrix24Sync) {
    super(app, plugin);
    this.plugin = plugin;
    this.tempSettings={
      refresh_token: this.plugin.settings.refresh_token || '',
      client_endpoint: this.plugin.settings.client_endpoint || '',
      access_token: this.plugin.settings.access_token || '',
      expires_in: this.plugin.settings.expires_in || 0,
    };
  }

  private tempSettings: {
    refresh_token: string;
    client_endpoint: string;
    access_token: string;
    expires_in: number;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    let clientEndpointTextComponent: TextComponent;
    let refreshTokenTextComponent: TextComponent;

    new Setting(containerEl)
      .setName("Код приложения")
      .setDesc('Вставьте код из приложения "Obsidian для Bitrix24"')
      .addText((text) =>{
        text
          .setPlaceholder("Код (70 символов)")
          .setValue(this.plugin.settings.refresh_token)
          .onChange(async (value) => {
            const bitrix24Api = new Bitrix24Api({
              client_id: clientId,
              client_secret: clientSecret,
              access_token: this.plugin.settings.access_token || "",
              refresh_token: value || "",
              client_endpoint: this.plugin.settings.client_endpoint || "",
              expires_in: 0,
            });
            try {
              await bitrix24Api.requestToKen();
            } catch (error) {
              new Notice(`Ошибка: ${error.message || 'Не удалось получить токен'}`);
              clientEndpointTextComponent.setValue('');
              this.plugin.settings.client_endpoint = '';
              return;
            }
            this.tempSettings.client_endpoint =bitrix24Api.clientEndpoint;
            this.tempSettings.access_token = bitrix24Api.accessToken;
            this.tempSettings.refresh_token = bitrix24Api.refreshToken;
            this.tempSettings.expires_in = bitrix24Api.expiresIn;
            clientEndpointTextComponent.setValue(bitrix24Api.clientEndpoint);
          })
          refreshTokenTextComponent=text;
          return text;
      }
    );

  new Setting(containerEl)
    .setName("Адрес портала Bitrix24")
    .setDesc("Определяется автоматически")
    .setDisabled(true)
    .addText((text) =>{
      text.setPlaceholder(
        "Адрес портала (например, https://myportal.bitrix24.ru/rest/)"
      )
      .setValue(this.plugin.settings.client_endpoint)

      clientEndpointTextComponent=text;

      return text;
      }
    );

    const buttonContainer = containerEl.createDiv('bitrix24-settings-buttons');
    buttonContainer.addClass('setting-item');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.marginTop = '2rem';
    
    const actionButtonsContainer = buttonContainer.createDiv();
    // Кнопка "Отмена"
    new ButtonComponent(actionButtonsContainer)
      .setButtonText("Отмена")
      .onClick(() => {
        // Восстанавливаем временные настройки из сохраненных
        this.tempSettings = {
          refresh_token: this.plugin.settings.refresh_token || '',
          client_endpoint: this.plugin.settings.client_endpoint || '',
          access_token: this.plugin.settings.access_token || '',
          expires_in: this.plugin.settings.expires_in || 0,
        };
        
        // Обновляем поля ввода
        refreshTokenTextComponent.setValue(this.tempSettings.refresh_token);
        clientEndpointTextComponent.setValue(this.tempSettings.client_endpoint);
        
        new Notice('Изменения отменены');
      })
      .buttonEl.style.marginRight='0.5em';

    new ButtonComponent(actionButtonsContainer)
      .setButtonText("Сохранить")
      .setCta() // делаем её выделенной (call-to-action)
      .onClick(async () => {
        if (!this.tempSettings.refresh_token) {
          new Notice('Укажите код приложения');
          return;
        }
        
        try {
          this.plugin.settings.access_token=this.tempSettings.access_token;
          this.plugin.settings.client_endpoint=this.tempSettings.client_endpoint;
          this.plugin.settings.expires_in=this.tempSettings.expires_in;
          this.plugin.settings.refresh_token=this.tempSettings.refresh_token;
          await this.plugin.saveSettings();
          new Notice('Настройки сохранены')
        } catch (error) {
          console.error('Ошибка сохранения настроек:', error);
          new Notice(`Ошибка: ${error.message || 'Не удалось сохранить настройки'}`);
        }
      })

  }
  
}
