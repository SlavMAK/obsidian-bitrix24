import { Vault } from "obsidian";

export interface FileMapping {
  id: string;          // ID файла в Obsidian
  path: string;        // Полный путь к файлу (например Мой обсидиан/test.md)
  name:string,        // Имя файла (test.md)
  isFolder:boolean,

  lastLocalMtime:number,      // Время последнего изменения файла в локальной системе
  lastUpdatBitrix: number;    // Время последнего изменения файла в битриксе
}

export class MappingManager {
  private mappings: FileMapping[] = [];
  private onChange?: () => void;

  constructor(initialMappings?: FileMapping[], onChange?: () => void) {
    this.mappings = initialMappings || [];
    this.onChange = onChange;
  }

  /**
   * Назначить колбэк, вызываемый после каждого успешного изменения карты.
   * Дебаунс — забота вызывающей стороны.
   */
  setOnChange(onChange?: () => void) {
    this.onChange = onChange;
  }

  // Сериализация данных для сохранения
  toJSON(): string {
    return JSON.stringify(this.mappings);
  }

  /** Только для чтения; внешние мутации запрещены. */
  public getAll(): readonly FileMapping[] {
    return this.mappings;
  }

  /** Файлы (не папки) — read-only. */
  public filterFiles(): readonly FileMapping[] {
    return this.mappings.filter(el => !el.isFolder);
  }

  /** Папки — read-only. */
  public filterFolders(): readonly FileMapping[] {
    return this.mappings.filter(el => el.isFolder);
  }

  public add(fileMapping: FileMapping) {
    const currentMap=this.getById(fileMapping.id);
    if (currentMap){
      currentMap.path=fileMapping.path;
      currentMap.lastUpdatBitrix=fileMapping.lastUpdatBitrix?new Date(fileMapping.lastUpdatBitrix).getTime():currentMap.lastUpdatBitrix;
      currentMap.name=fileMapping.name||currentMap.name;
      currentMap.isFolder=fileMapping.isFolder!==undefined?fileMapping.isFolder:currentMap.isFolder;
    }
    else{
      fileMapping.id=String(fileMapping.id);
      this.mappings.push(fileMapping);
    }
    this.onChange?.();
  }

  public set(id:string, fields: Partial<FileMapping>) {
    const index = this.mappings.findIndex(el => el.id === id);
    if (index !== -1) {
      this.mappings[index] = { ...this.mappings[index], ...fields };
      this.onChange?.();
    }
  }

  /** Удалить запись по id. Заменяет внешние findIndex/splice-паттерны. */
  public remove(id: string): void {
    const idx = this.mappings.findIndex(el => el.id === id);
    if (idx === -1) return;
    this.mappings.splice(idx, 1);
    this.onChange?.();
  }

  /** Полностью очистить карту (используется командой сброса). */
  public clear(): void {
    if (this.mappings.length === 0) return;
    this.mappings = [];
    this.onChange?.();
  }

  public getMappingByLocalPath(path: string): FileMapping | undefined {
    return this.mappings.find(el=>el?.path===path);
  }

  public getById(id:string){
    return this.mappings.find(el=>String(el.id)===String(id));
  }

  public updateMappingAfterMoveFolder(oldFolderPath:string, newPath:string){
    const regex=new RegExp(`^${oldFolderPath}/(.*)`);
    const childRecords=this.mappings.filter(el=>regex.test(el.path));
    let changed = false;
    for (const child of childRecords){
      const newPathChild=child.path.replace(regex, newPath+'/$1');
      child.path=newPathChild;
      changed = true;
    }
    if (changed) {
      this.onChange?.();
    }
  }

  // Десериализация данных после загрузки
  static fromJSON(vault: Vault, json: string, onChange?: () => void): MappingManager {
    try {
      const mappings = (JSON.parse(json) as FileMapping[]).filter(el=>!!el);
      return new MappingManager(mappings, onChange);
    } catch (e) {
      console.error('Error parsing mapping data:', e);
      return new MappingManager(undefined, onChange);
    }
  }
}
