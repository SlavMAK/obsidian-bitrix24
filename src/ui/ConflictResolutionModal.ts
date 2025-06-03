import { Modal, App, ButtonComponent } from 'obsidian';
import { DiffViewModal } from './DiffViewModal';

export interface DiffContents {
  localContent: string;
  remoteContent: string;
  fileName: string;
  localTime: number;
  remoteTime: number;
  showContent?: boolean
}

/**
 * Модальное окно для разрешения конфликтов
 */
export class ConflictResolutionModal extends Modal {
  private conflict: DiffContents;
  private mergeResult: string;
  private onResolve: (resolution: 'local' | 'remote' | 'merged', content?: string) => void;
  private editorEl: HTMLTextAreaElement;

  constructor(
    app: App, 
    conflict: DiffContents, 
    onResolve: (resolution: 'local' | 'remote' | 'merged', content?: string) => void
  ) {
    super(app);
    this.conflict = conflict;
    this.mergeResult = conflict.localContent; // По умолчанию используем локальную версию
    this.onResolve = onResolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h3', { text: `Конфликт изменений файла: ${this.conflict.fileName}` });
    
    const infoEl = contentEl.createDiv('conflict-info');
    infoEl.createEl('p', { 
      text: 'Этот файл был изменен и в Obsidian, и в Bitrix24. Выберите версию, которую нужно сохранить:',
      cls: 'conflict-description'
    });
    
    const timeInfo = contentEl.createDiv('conflict-times');
    timeInfo.createEl('div', { 
      text: `Локальная версия изменена: ${new Date(this.conflict.localTime).toLocaleString()}`,
      cls: 'time-info local'
    });
    timeInfo.createEl('div', { 
      text: `Версия в Bitrix24 изменена: ${new Date(this.conflict.remoteTime).toLocaleString()}`,
      cls: 'time-info remote'
    });
    
    if (this.conflict.showContent) {
      const selectButtonsContainer = contentEl.createDiv('version-buttons');
      
      const localButton = new ButtonComponent(selectButtonsContainer)
        .setButtonText('Использовать локальную версию')
        .onClick(() => {
          this.editorEl.value = this.conflict.localContent;
          this.mergeResult = this.conflict.localContent;
          
          localButton.setCta();
          remoteButton.removeCta();
        });
      
      const remoteButton = new ButtonComponent(selectButtonsContainer)
        .setButtonText('Использовать версию из Bitrix24')
        .onClick(() => {
          this.editorEl.value = this.conflict.remoteContent;
          this.mergeResult = this.conflict.remoteContent;
          
          remoteButton.setCta();
          localButton.removeCta();
        });
      
      localButton.setCta();
      
      const editorContainer = contentEl.createDiv('merge-editor-container');
      editorContainer.createEl('h4', { text: 'Редактор для слияния изменений:' });

      this.editorEl = document.createElement('textarea');
      this.editorEl.className = 'merge-editor';
      this.editorEl.value = this.conflict.localContent;
      this.editorEl.style.width = '100%';
      this.editorEl.style.height = '200px';
      this.editorEl.style.fontFamily = 'monospace';
      this.editorEl.addEventListener('input', () => {
        this.mergeResult = this.editorEl.value;
        
        localButton.removeCta();
        remoteButton.removeCta();
      });
      editorContainer.appendChild(this.editorEl);
      const diffButton = editorContainer.createEl('button', {
        text: 'Показать различия',
        cls: 'diff-button',
      });
      diffButton.addEventListener('click', () => {
        this.showDiff();
      });
    }

    const actionsContainer = contentEl.createDiv('modal-button-container');
    
    // Кнопка "Отмена"
    new ButtonComponent(actionsContainer)
      .setButtonText('Отмена')
      .onClick(() => {
        this.close();
      });
    
    new ButtonComponent(actionsContainer)
      .setButtonText('Использовать локальную')
      .onClick(() => {
        this.close();
        this.onResolve('local');
      });
      
    new ButtonComponent(actionsContainer)
      .setButtonText('Использовать из Bitrix24')
      .onClick(() => {
        this.close();
        this.onResolve('remote');
      });
    
    if (this.conflict.showContent){
      new ButtonComponent(actionsContainer)
        .setButtonText('Сохранить объединенную')
        .setCta()
        .onClick(() => {
          this.close();
          this.onResolve('merged', this.mergeResult);
        });
    }
    
    // Устанавливаем максимальный размер модального окна
    contentEl.style.width = '90wh';
    contentEl.style.height = '80vh';
    contentEl.style.maxHeight = '800px';
  }
  
  // Показать различия между версиями файла
  private showDiff() {
    // Открываем модальное окно с визуализацией различий
    const modal = new DiffViewModal(
      this.app, 
      this.conflict.localContent, 
      this.conflict.remoteContent,
      this.conflict.fileName
    );
    modal.open();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
