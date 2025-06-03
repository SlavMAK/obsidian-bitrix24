import Bitrix24Sync from "main";
import { App, ButtonComponent, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";

export class Bitrix24SyncSettingTab extends PluginSettingTab {
  plugin: Bitrix24Sync;

  constructor(app: App, plugin: Bitrix24Sync, authParams:{clientId:string, clientSecret:string}) {
    super(app, plugin);
    this.plugin = plugin;
    this.tempSettings={
      refresh_token: this.plugin.settings.refresh_token || '',
      client_endpoint: this.plugin.settings.client_endpoint || '',
      access_token: this.plugin.settings.access_token || '',
      expires_in: this.plugin.settings.expires_in || 0,
    };
    this.clientId = authParams.clientId;
    this.clientSecret = authParams.clientSecret;
  }

  private tempSettings: {
    refresh_token: string;
    client_endpoint: string;
    access_token: string;
    expires_in: number;
  }

  clientId: string;
  clientSecret: string;

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
              client_id: this.clientId,
              client_secret: this.clientSecret,
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
          this.plugin.initializeComponents();
          new Notice('Настройки сохранены')
        } catch (error) {
          console.error('Ошибка сохранения настроек:', error);
          new Notice(`Ошибка: ${error.message || 'Не удалось сохранить настройки'}`);
        }
      })

  }
  
}
