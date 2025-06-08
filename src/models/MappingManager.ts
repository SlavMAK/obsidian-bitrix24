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
  public mappings: FileMapping[] = [];
  
  constructor(initialMappings?: FileMapping[]) {
    this.mappings = initialMappings || [];
  }
  
  // Методы для работы с маппингами
  // ...
  
  // Сериализация данных для сохранения
  toJSON(): string {
    return JSON.stringify(this.mappings);
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
  }

  public set(id:string, fields: Partial<FileMapping>) {
    const index = this.mappings.findIndex(el => el.id === id);
    if (index !== -1) {
      this.mappings[index] = { ...this.mappings[index], ...fields };
    }
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
    for (const child of childRecords){
      const newPathChild=child.path.replace(regex, newPath+'/$1');
      child.path=newPathChild;
    }
  }
  
  // Десериализация данных после загрузки
  static fromJSON(vault: Vault, json: string): MappingManager {
    try {
      const mappings = (JSON.parse(json) as FileMapping[]).filter(el=>!!el);
      return new MappingManager(mappings);
    } catch (e) {
      console.error('Error parsing mapping data:', e);
      return new MappingManager();
    }
  }
}