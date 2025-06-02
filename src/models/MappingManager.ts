import { Vault } from "obsidian";

export interface FileMapping {
  fileId: string;          // ID файла в Obsidian
  filePath: string;        // Путь к файлу
  fileName:string,
  isFolder:boolean,
  bitrixUrl:string,
  lastUpdateTimestampBitrix: number;    // Время последнего изменения файла в битриксе
  lastSyncTimestamp: number;    // Время последнего изменения файла
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
    const currentMap=this.getById(fileMapping.fileId);
    if (currentMap){
      currentMap.filePath=fileMapping.filePath;
      currentMap.lastUpdateTimestampBitrix=fileMapping.lastUpdateTimestampBitrix?new Date(fileMapping.lastUpdateTimestampBitrix).getTime():currentMap.lastUpdateTimestampBitrix;
      currentMap.lastSyncTimestamp=fileMapping.lastSyncTimestamp?new Date(fileMapping.lastSyncTimestamp).getTime():fileMapping.lastSyncTimestamp;
      currentMap.fileName=fileMapping.fileName||currentMap.fileName;
      currentMap.bitrixUrl=fileMapping.bitrixUrl||currentMap.bitrixUrl;
      currentMap.isFolder=fileMapping.isFolder!==undefined?fileMapping.isFolder:currentMap.isFolder;
    }
    else{
      this.mappings.push(fileMapping);
    }
  }

  public getMappingByLocalPath(path: string): FileMapping | undefined {
    return this.mappings.find(el=>((el.filePath+el.fileName)===path));
  }

  public getById(id:string){
    return this.mappings.find(el=>el.fileId===id);
  }
  
  // Десериализация данных после загрузки
  static fromJSON(vault: Vault, json: string): MappingManager {
    try {
      const mappings = JSON.parse(json) as FileMapping[];
      return new MappingManager(mappings);
    } catch (e) {
      console.error('Error parsing mapping data:', e);
      return new MappingManager();
    }
  }
}