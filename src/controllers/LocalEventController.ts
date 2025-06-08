import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";
import { SyncService } from "src/services/SyncService";
import { ACTION as BITRIX_ACTION } from "./BitrixController";

export class LocalEventController{
  constructor(
    private readonly syncService:SyncService,
    private readonly app:App,
    private mappingManager:MappingManager,
    private bitrixApi:Bitrix24Api
  ){}

  async onMove(file:TAbstractFile, oldPath:string){
      if (file instanceof TFile){
        if (this.syncService.isAwaitMoveByNewPath(file.parent?.path||'')){
          console.log('Не обрабатываем перемещение файла, так как сейчас перемещается его родитель - ', file.path);
          return;
        }
        const localFile=await this.app.vault.getFileByPath(file.path);
        if (!localFile) throw new Error('Не удалось получить файл по пути '+file.path);
        this.syncService.addMoveFile(file, oldPath, file.path);
        await this.syncService.checkLocalFile(localFile, undefined, undefined);
      }
      if (file instanceof TFolder){
        const localFolder=await this.app.vault.getFolderByPath(file.path);
        if (!localFolder) throw new Error('Не удалось получить папку по пути '+file.path);
        this.syncService.addMoveFile(file, oldPath, file.path);
        await this.syncService.checkLocalFolder(localFolder, undefined, undefined);
      }
      this.syncService.clearMovedFiles();
      await this.syncService.processFileQueue();
      this.syncService.clearQueue();
  }

  public async onUpdate(file:TAbstractFile){
    const localFile=await this.app.vault.getFileByPath(file.path);
    if (!localFile) throw new Error('Не удалось получить файл по пути '+file.path);
    const localMap=this.mappingManager.getMappingByLocalPath(localFile.path);

    const inQueue=this.syncService.fileQueue.find(el=>el.action===BITRIX_ACTION.UPDATE_FILE
                                                    &&el.data?.file
                                                    &&el?.data?.file?.id===localMap?.id);

    if (inQueue) return;//Если файл уже в очереди на обновление, то не обрабатываем его снова

    if (file instanceof TFile){
      const bitrixMap=!localMap?undefined:await new BitrixMap(this.bitrixApi).getFileByMapId(localMap.id, this.mappingManager.mappings);
      await this.syncService.checkLocalFile(localFile, localMap, bitrixMap);
    }
    if (file instanceof TFolder){
      const bitrixMap=!localMap?undefined:await new BitrixMap(this.bitrixApi).getFileByMapId(localMap.id, this.mappingManager.mappings);
      await this.syncService.checkLocalFolder(file, bitrixMap, localMap);//TODO доделать когда будет проверка папки по трём параметрам
    }
    await this.syncService.processFileQueue();
    this.syncService.clearQueue();
  }

  async onDelete(file:TAbstractFile){
    const localMap=this.mappingManager.getMappingByLocalPath(file.path);
    if (!localMap){
      console.log('Файл не входит в синхронизацию - ', file.path);
      return;
    }

    if (file instanceof TFile){
      const bitrixMap=await new BitrixMap(this.bitrixApi).getFileByMapId(localMap.id, this.mappingManager.mappings);
      if (!bitrixMap){
        return;
      }
      this.syncService.checkBitrixFile(bitrixMap, localMap, undefined);
    }
    if (file instanceof TFolder){
      const bitrixMap=await new BitrixMap(this.bitrixApi).getFileByMapId(localMap.id, this.mappingManager.mappings);
      if (!bitrixMap){
        return;
      }
      this.syncService.checkBitrixFolder(bitrixMap, localMap, undefined);
    }
    await this.syncService.processFileQueue();
    this.syncService.clearQueue();
  }

  async onCreate(file:TAbstractFile){
    if (file instanceof TFile){
      await this.syncService.checkLocalFile(file, undefined, undefined);
    }
    else if (file instanceof TFolder){
      await this.syncService.checkLocalFolder(file, undefined, undefined);
    }
    await this.syncService.processFileQueue();
    this.syncService.clearQueue();
  }
}