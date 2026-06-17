import { Modal, App, ButtonComponent } from 'obsidian';

export interface BulkDeleteItem {
  path: string;
  isFolder: boolean;
  hint?: string;
}

export interface BulkDeleteConfirmOptions {
  title: string;
  description: string;
  items: BulkDeleteItem[];
  defaultSelected?: boolean;
}

/**
 * Модальное окно для подтверждения массового удаления.
 * Используется при catch-up на старте, "push all" и "pull all".
 *
 * Любой выход (Отмена / Esc / клик вне / «Применить» без галок) возвращает
 * пустой массив. То есть «отмена» и «применить с пустым выбором» эквивалентны:
 * ничего не отмечено к удалению — никаких удалений не происходит. Вызывающая
 * сторона сама решает что делать с НЕотмеченными элементами (catch-up,
 * например, в этом случае выгружает их обратно в Битрикс).
 */
export class BulkDeleteConfirmModal extends Modal {
  private options: BulkDeleteConfirmOptions;
  private onResolve: (selectedPaths: string[]) => void;
  private checkboxes: Map<string, HTMLInputElement> = new Map();
  private resolved = false;

  constructor(
    app: App,
    options: BulkDeleteConfirmOptions,
    onResolve: (selectedPaths: string[]) => void
  ) {
    super(app);
    this.options = options;
    this.onResolve = onResolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: this.options.title });
    contentEl.createEl('p', {
      text: this.options.description,
      cls: 'bulk-delete-description'
    });

    // Пустой список — показываем только OK
    if (this.options.items.length === 0) {
      contentEl.createEl('p', {
        text: 'Нет элементов для удаления.',
        cls: 'bulk-delete-empty'
      });

      const actionsContainer = contentEl.createDiv('modal-button-container');
      new ButtonComponent(actionsContainer)
        .setButtonText('OK')
        .setCta()
        .onClick(() => {
          this.resolveWith([]);
          this.close();
        });
      return;
    }

    const defaultSelected = this.options.defaultSelected ?? true;

    // Тулбар: выделить всё / снять всё
    const toolbar = contentEl.createDiv('bulk-delete-toolbar');
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';
    toolbar.style.marginBottom = '8px';

    new ButtonComponent(toolbar)
      .setButtonText('Выделить всё')
      .onClick(() => {
        this.checkboxes.forEach(cb => { cb.checked = true; });
      });

    new ButtonComponent(toolbar)
      .setButtonText('Снять всё')
      .onClick(() => {
        this.checkboxes.forEach(cb => { cb.checked = false; });
      });

    // Прокручиваемый контейнер со списком
    const listContainer = contentEl.createDiv('bulk-delete-list');
    listContainer.style.maxHeight = '50vh';
    listContainer.style.overflowY = 'auto';
    listContainer.style.border = '1px solid var(--background-modifier-border)';
    listContainer.style.borderRadius = '4px';
    listContainer.style.padding = '8px';
    listContainer.style.marginBottom = '12px';

    for (const item of this.options.items) {
      const row = listContainer.createDiv('bulk-delete-row');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.padding = '2px 0';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = defaultSelected;
      row.appendChild(checkbox);
      this.checkboxes.set(item.path, checkbox);

      const icon = row.createSpan({ cls: 'bulk-delete-icon' });
      icon.setText(item.isFolder ? '📁' : '📄');

      const pathLabel = row.createSpan({ cls: 'bulk-delete-path' });
      pathLabel.setText(item.path);
      pathLabel.style.flex = '1';
      pathLabel.style.overflow = 'hidden';
      pathLabel.style.textOverflow = 'ellipsis';
      pathLabel.style.whiteSpace = 'nowrap';

      if (item.hint) {
        const hintEl = row.createSpan({ cls: 'bulk-delete-hint' });
        hintEl.setText(item.hint);
        hintEl.style.color = 'var(--text-muted)';
        hintEl.style.fontSize = '0.85em';
        hintEl.style.marginLeft = '8px';
      }

      // Клик по строке (но не по самому чекбоксу) переключает чекбокс
      row.addEventListener('click', (e) => {
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked;
        }
      });
    }

    // Футер: Отмена / Удалить отмеченное
    const actionsContainer = contentEl.createDiv('modal-button-container');

    new ButtonComponent(actionsContainer)
      .setButtonText('Отмена')
      .onClick(() => {
        this.resolveWith([]);
        this.close();
      });

    new ButtonComponent(actionsContainer)
      .setButtonText('Применить')
      .setCta()
      .onClick(() => {
        const selected: string[] = [];
        this.checkboxes.forEach((cb, path) => {
          if (cb.checked) {
            selected.push(path);
          }
        });
        this.resolveWith(selected);
        this.close();
      });
  }

  onClose() {
    if (!this.resolved) {
      this.resolveWith([]);
    }
    const { contentEl } = this;
    contentEl.empty();
    this.checkboxes.clear();
  }

  private resolveWith(paths: string[]) {
    if (this.resolved) return;
    this.resolved = true;
    this.onResolve(paths);
  }
}

/**
 * Удобная обёртка над BulkDeleteConfirmModal, возвращающая Promise.
 * Возвращается список путей к удалению. Любой выход без явного выбора — `[]`.
 */
export function askBulkDeleteConfirm(
  app: App,
  options: ConstructorParameters<typeof BulkDeleteConfirmModal>[1]
): Promise<string[]> {
  return new Promise((resolve) => {
    const modal = new BulkDeleteConfirmModal(app, options, (selectedPaths) => {
      resolve(selectedPaths);
    });
    modal.open();
  });
}
