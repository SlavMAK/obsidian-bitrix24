import { App, ButtonComponent, Modal } from "obsidian";

/**
 * Модальное окно для визуализации различий
 */
export class DiffViewModal extends Modal {
  private localContent: string;
  private remoteContent: string;
  private fileName: string;

  constructor(
    app: App, 
    localContent: string, 
    remoteContent: string,
    fileName: string
  ) {
    super(app);
    this.localContent = localContent;
    this.remoteContent = remoteContent;
    this.fileName = fileName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('diff-view-modal');
    
    // Заголовок
    contentEl.createEl('h3', { text: `Различия в файле: ${this.fileName}` });
    
    // Контейнер для дифа
    const diffContainer = contentEl.createDiv('diff-container');
    
    // Создаем визуализацию различий
    this.createDiffView(diffContainer, this.localContent, this.remoteContent);
    
    // Кнопка закрытия
    const buttonContainer = contentEl.createDiv('button-container');
    new ButtonComponent(buttonContainer)
      .setButtonText('Закрыть')
      .setCta()
      .onClick(() => this.close());
    
    // Устанавливаем размер модального окна
    contentEl.style.width = '90wh';
    contentEl.style.height = '80vh';
    contentEl.style.maxHeight = '800px';
  }
  
  // Создаем визуальное представление различий
  private createDiffView(container: HTMLElement, local: string, remote: string) {
    // Простая реализация - построчное сравнение
    const localLines = local.split('\n');
    const remoteLines = remote.split('\n');
    
    const table = container.createEl('table', { cls: 'diff-table' });
    const headerRow = table.createEl('tr');
    headerRow.createEl('th', { text: 'Локальная версия', cls: 'local-header' });
    headerRow.createEl('th', { text: 'Версия из Bitrix24', cls: 'remote-header' });
    
    // Максимальное количество строк
    const maxLines = Math.max(localLines.length, remoteLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const row = table.createEl('tr');
      
      // Локальная версия
      const localCell = row.createEl('td', { cls: 'diff-cell local-cell' });
      if (i < localLines.length) {
        if (i >= remoteLines.length || localLines[i] !== remoteLines[i]) {
          localCell.addClass('diff-changed');
        }
        localCell.createEl('div', { text: localLines[i], cls: 'line-content' });
      }
      
      // Удаленная версия
      const remoteCell = row.createEl('td', { cls: 'diff-cell remote-cell' });
      if (i < remoteLines.length) {
        if (i >= localLines.length || localLines[i] !== remoteLines[i]) {
          remoteCell.addClass('diff-changed');
        }
        remoteCell.createEl('div', { text: remoteLines[i], cls: 'line-content' });
      }
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
