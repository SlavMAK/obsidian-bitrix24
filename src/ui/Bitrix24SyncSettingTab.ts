import Bitrix24Sync from "main";
import { App, ButtonComponent, DropdownComponent, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { BatchHelper } from "src/api/BatchHelper";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { batchCmdElement } from "src/types/batchElement";

interface Storage {
  id: string;
  title: string;
}

interface Folder {
  id: string;
  title: string;
}

export class Bitrix24SyncSettingTab extends PluginSettingTab {
  plugin: Bitrix24Sync;

  // Компоненты интерфейса для доступа из разных методов
  refreshTokenTextComponent: TextComponent;
  storageDropdown: DropdownComponent;
  folderDropdown: DropdownComponent;
  buttonSave: ButtonComponent;
  storageSettingEl: HTMLElement;
  folderSettingEl: HTMLElement;
  userInfoEl: HTMLElement;
  
  // Временное хранение данных
  storages: Storage[] = [];
  folders: Folder[] = [];
  selectedStorageId = '';
  selectedFolderId = '';

  constructor(app: App, plugin: Bitrix24Sync, authParams:{clientId:string, clientSecret:string}) {
    super(app, plugin);
    this.plugin = plugin;
    this.clientId = authParams.clientId;
    this.clientSecret = authParams.clientSecret;
    this.fillTempSettingsFromPluginSettings();
  }

  private tempSettings: {
    refresh_token: string;
    client_endpoint: string;
    access_token: string;
    expires_in: number;
    syncInterval:number;
    storageId: number;
    folderId:number;
  }

  clientId: string;
  clientSecret: string;

  fillTempSettingsFromPluginSettings(){
    this.tempSettings={
      refresh_token: this.plugin.settings.refresh_token || '',
      client_endpoint: this.plugin.settings.client_endpoint || '',
      access_token: this.plugin.settings.access_token || '',
      expires_in: this.plugin.settings.expires_in || 0,
      storageId: this.plugin.settings.storageId || 0,
      syncInterval:this.plugin.settings.syncInterval || 5,
      folderId:this.plugin.settings.folderId || 0
    };

  }

  async requestUserAndStorage(bitrix24Api: Bitrix24Api) {
    const props={
      filter:{ENTITY_TYPE:'group'}
    };
    const batch:batchCmdElement={
      'getUser':['profile', {}],
      'listStorage':['disk.storage.getlist', props],
      'storageCurrentUser':['disk.storage.getlist', {filter:{ENTITY_TYPE:'user', ENTITY_ID:'$result[getUser][ID]'}}],
      'commonStorage':['disk.storage.getlist', {filter:{ENTITY_TYPE:'common'}}]
    };
    const tempResult=await bitrix24Api.callBatch(batch);
    if (tempResult.getUser.error()){
      new Notice(`Ошибка получения информации о пользователе: ${tempResult.getUser.error()}`);
      return;
    }
    if (tempResult.commonStorage.error()){
      new Notice(`Ошибка получения информации о общем хранилище: ${tempResult.commonStorage.error()}`);
      return;
    }
    if (tempResult.storageCurrentUser.error()){
      new Notice('Ошибка получения информации о хранилище текущего пользователя: ' + tempResult.storageCurrentUser.error());
      return;
    }

    const user=tempResult.getUser.data();
    this.storages=[];
      this.storages=[
        {id:tempResult.storageCurrentUser.data()[0].ID, title:'Ваш диск в битрикс24 (диск пользователя)'},
        {id:tempResult.commonStorage.data()[0].ID, title:'Общий диск'}
      ];
    if (tempResult.listStorage.total()>50){
      const batchHelper=new BatchHelper();
      batchHelper.getBatchForLength('disk.storage.getlist', 'getStorageList', tempResult.listStorage.total(), props);
      const ress=await batchHelper.runAll(bitrix24Api);
      for (const request in ress){
        if (ress[request].error()){
          console.error('Ошибка получения данных хранилищ:', ress[request].error());
          continue;
        }
        this.storages.push(...ress[request].data().map((el:any)=>({
            id:el.ID,
            title:el.NAME
          }))
        );
      }
    }
    else{
      this.storages.push(
          ...tempResult.listStorage.data().map((el:any)=>({
          id:el.ID,
          title:el.NAME
        }))
      );
    }

    //Вывод информации о домене и пользователе
    this.userInfoEl.empty();
    this.userInfoEl.createEl('h3', { text: 'Информация о подключении' });
    
    const userInfoTable = this.userInfoEl.createEl('table', { cls: 'bitrix-user-info' });
    
    // Добавляем строки в таблицу
    const addRow = (label: string, value: string) => {
      const row = userInfoTable.createEl('tr');
      row.createEl('td', { text: label, cls: 'bitrix-info-label' });
      row.createEl('td', { text: value, cls: 'bitrix-info-value' });
    };
    
    addRow('Пользователь:', `${user.NAME} ${user.LAST_NAME} (#${user.ID})`);
    if (!this.tempSettings.client_endpoint) return;
    addRow('Портал Bitrix24:', new URL(this.tempSettings.client_endpoint||'').host);
    
    // Делаем блок с информацией видимым
    this.userInfoEl.style.display = 'block';
    this.fillDropDownStorage(bitrix24Api);
  }

  async fillDropDownStorage(bitrix24:Bitrix24Api){
    const storageOptions: Record<string, string> = {};
    this.storages.forEach(storage => {
      storageOptions[storage.id] = storage.title;
    });
    this.storageDropdown.selectEl.empty();
    this.storageDropdown.addOptions(storageOptions);

    if (this.tempSettings.storageId>0&&storageOptions[this.tempSettings.storageId]){
      this.storageDropdown.setValue(String(this.tempSettings.storageId));
      this.loadFolders(bitrix24);
    }
    else{
      this.storageDropdown.setValue('');
    }
    this.storageSettingEl.style.display = 'block';

  }

  async loadFolders(bitrix24:Bitrix24Api){
    if (!this.tempSettings.storageId) return;
    const tempResult=await bitrix24.callMethod('disk.storage.getchildren', {id:this.tempSettings.storageId});
    if (tempResult.error()){
      new Notice(`Ошибка получения списка папок хранилища: ${tempResult.error()}`);
      return;
    }

    this.folders=[];
    if (tempResult.total()>50){
      const batchHelper=new BatchHelper();
      batchHelper.getBatchForLength('disk.storage.getchildren', 'getStorageList', tempResult.total(), {id:this.tempSettings.storageId});
      const ress=await batchHelper.runAll(bitrix24);
      for (const request in ress){
        if (ress[request].error()){
          new Notice('Ошибка получения данных папок хранилища:', ress[request].error());
          continue;
        }
        this.folders.push(
          ...ress[request].data()
            .map((el:any)=>({
              id:el.ID,
              title:el.NAME
            }))
        );
      }
    }
    else{
      this.folders.push(
        ...tempResult.data()
          .map((el:any)=>({
            id:el.ID,
            title:el.NAME
          }))
      );
    }

    this.folderDropdown.selectEl.empty();
    const folderOptions: Record<string, string> = {};
    this.folders.forEach(folder => {
      folderOptions[folder.id] = folder.title;
    });
    this.folderDropdown.addOptions(folderOptions);

    if (this.tempSettings.folderId>0&&folderOptions[this.tempSettings.folderId]){
      this.folderDropdown.setValue(String(this.tempSettings.folderId));
    }
    else{
      this.folderDropdown.setValue('');
    }
      
    this.folderSettingEl.style.display = 'block';
    this.checkFields();
  }

  display(): void {
    const { containerEl } = this;

    this.fillTempSettingsFromPluginSettings();

    containerEl.empty();

    new Setting(containerEl)
      .setName("Код приложения")
      .setDesc('Вставьте код из приложения "Obsidian для Bitrix24"')
      .addText((text) =>{
        this.refreshTokenTextComponent=text;
        text
          .setPlaceholder("Код (70 символов)")
          .setValue(this.plugin.settings.refresh_token)
          .onChange(async (value) => {
            if (!value) return;
            const bitrix24Api = new Bitrix24Api({
              client_id: this.clientId,
              client_secret: this.clientSecret,
              access_token: this.plugin.settings.access_token || "",
              refresh_token: value || "",
              client_endpoint: this.plugin.settings.client_endpoint || "",
              expires_in: 0,
            });
            try {
              await bitrix24Api.requestToKen();
              this.tempSettings.client_endpoint =bitrix24Api.clientEndpoint;
              this.tempSettings.access_token = bitrix24Api.accessToken;
              this.tempSettings.refresh_token = bitrix24Api.refreshToken;
              this.tempSettings.expires_in = bitrix24Api.expiresIn;
              this.refreshTokenTextComponent=text;
              await this.requestUserAndStorage(bitrix24Api);
            } catch (error) {
              new Notice(`Ошибка: ${error.message || 'Не удалось получить токен'}`);
              this.plugin.settings.client_endpoint = '';
              this.checkFields();
              return;
            }
            this.checkFields();
          })
          return text;
      }
    );


    new Setting(containerEl)
      .setName("Периодичность полной проверки")
      .setDesc('Обновление файлов вне событий битрикса"')
      .addText((text) =>{
        this.refreshTokenTextComponent=text;
        text
          .setPlaceholder("В минутах")
          .setValue(this.tempSettings.syncInterval.toString())
          .onChange(async (value) => {
            if (!Number(value)){
              this.tempSettings.syncInterval=5;
              text.setValue('5');
            }
            else{
              this.tempSettings.syncInterval=Number(value);
              text.setValue(Number(value).toString());
            }
          })
          return text;
      }
    );

    containerEl.createEl('p', { 
      text: 'Код приложения должен быть взят из приложения "Obsidian для Bitrix24", ' +
            'установленного в вашем портале Bitrix24. Если приложение еще не установлено, ' +
            'обратитесь к администратору вашего портала.',
      cls: 'setting-item-description'
    });

    this.userInfoEl = containerEl.createDiv('user-info-container');
    this.userInfoEl.style.display = 'none';
    this.userInfoEl.createEl('h3', { text: 'Информация о подключении' });

    this.storageSettingEl = containerEl.createDiv('storage-setting-container');
    this.storageSettingEl.style.display = 'none';

    const storageSetting = new Setting(this.storageSettingEl)
      .setName("Хранилище")
      .setDesc("Выберите хранилище в Bitrix24");

    storageSetting.addDropdown((dropdown) => {
      this.storageDropdown = dropdown;
      dropdown.setValue('');
      dropdown.onChange(async (value) => {
        this.tempSettings.storageId=Number(value)||0;
        if (!this.tempSettings.storageId) return;
        await this.loadFolders(new Bitrix24Api({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          access_token: this.tempSettings.access_token || "",
          refresh_token: this.tempSettings.refresh_token || "",
          client_endpoint: this.tempSettings.client_endpoint || "",
          expires_in: this.tempSettings.expires_in || 0,
        }));
        this.checkFields();
      });
    });

    this.folderSettingEl = containerEl.createDiv('folder-setting-container');
    this.folderSettingEl.style.display = 'none';
    
    const folderSetting = new Setting(this.folderSettingEl)
      .setName("Папка")
      .setDesc("Выберите папку для синхронизации");
    
    folderSetting.addDropdown((dropdown) => {
      this.folderDropdown = dropdown;
      dropdown.onChange((value) => {
        this.tempSettings.folderId = Number(value);
        this.checkFields();
      });
    });



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
          storageId: this.plugin.settings.storageId || 0,
          client_endpoint: this.plugin.settings.client_endpoint || '',
          access_token: this.plugin.settings.access_token || '',
          expires_in: this.plugin.settings.expires_in || 0,
          syncInterval: this.plugin.settings.syncInterval || 5,
          folderId: this.plugin.settings.folderId || 0
        };
        
        // Обновляем поля ввода
        this.refreshTokenTextComponent.setValue(this.tempSettings.refresh_token);
        this.folderDropdown.setValue(this.tempSettings.folderId.toString());
        this.storageDropdown.setValue(this.tempSettings.storageId.toString());
        
        new Notice('Изменения отменены');
      })
      .buttonEl.style.marginRight='0.5em';

    this.buttonSave=new ButtonComponent(actionButtonsContainer)
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
          this.plugin.settings.storageId=this.tempSettings.storageId;
          this.plugin.settings.folderId=this.tempSettings.folderId;
          await this.plugin.saveSettings(true);
          this.plugin.initializeComponents();
          new Notice('Настройки сохранены')
        } catch (error) {
          console.error('Ошибка сохранения настроек:', error);
          new Notice(`Ошибка: ${error.message || 'Не удалось сохранить настройки'}`);
        }
      })


    //Проверка заполненности токена и заполнение информации если он есть
    if (this.tempSettings.refresh_token){
      const bitrix24Api = new Bitrix24Api({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        access_token: this.plugin.settings.access_token || "",
        refresh_token: this.plugin.settings.refresh_token,
        client_endpoint: this.plugin.settings.client_endpoint || "",
        expires_in: 0,
      });
      bitrix24Api.requestToKen().then(bitrixApi=>{
        this.tempSettings.client_endpoint=bitrix24Api.clientEndpoint;
        this.tempSettings.access_token = bitrix24Api.accessToken;
        this.tempSettings.refresh_token = bitrix24Api.refreshToken;
        this.tempSettings.expires_in = bitrix24Api.expiresIn;
        this.requestUserAndStorage(bitrix24Api);
      }).catch((error) => {
        new Notice(`Ошибка: ${error.message || 'Не удалось проверить токен'}`);
      });
    }
    this.checkFields();
  }
  
  private checkFields(){
    this.buttonSave.setDisabled(true);
    if (!this.tempSettings.refresh_token){
      this.storageSettingEl.style.display='none';
      this.folderSettingEl.style.display='none';
    }
    if (!this.tempSettings.storageId){
      this.folderSettingEl.style.display='none';
    }
    if (this.tempSettings.refresh_token&&this.tempSettings.storageId&&this.tempSettings.folderId){
      this.buttonSave.setDisabled(false);
    }
  }
}
