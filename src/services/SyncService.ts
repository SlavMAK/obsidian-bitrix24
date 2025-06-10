import { FileMapping, MappingManager } from "src/models/MappingManager";
import { Bitrix24Api } from "../api/bitrix24-api";
import { App, Notice, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { BitrixMap, BitrixMapElement} from "src/models/BitrixMap";
import { ACTION as ACTION_LOCAL, LocalController } from "src/controllers/LocalController";
import { ACTION as ACTION_BITRIX, BitrixController } from 'src/controllers/BitrixController';
import { ConflictResolutionModal, DiffContents } from "src/ui/ConflictResolutionModal";
import { getTextRemoteFile } from "src/helpers/getTextRemoteFile";




export class SyncService {
    
    private bitrixApi: Bitrix24Api;
    private mappingManager: MappingManager;
    private vault: Vault;
    public fileQueue: { action: string, data: {
      folder?:BitrixMapElement,
      localFolder?:TFolder,
      localFile?:TFile,
      file?: BitrixMapElement
      localMapping?:FileMapping,
      content?:string
      
      localAbstract?:TAbstractFile,
      oldPath?:string,
      newPath?:string
    }}[] = [];
    private lastSync=0;

    private bitrixMap:BitrixMap;

    bitrixController:BitrixController;
    localController:LocalController;
    
    private movedFiles:{
      file: TAbstractFile, oldPath:string, newPath:string
    }[]=[];

    public addMoveFile(file:TAbstractFile, oldPath:string, newPath:string){
      const doubleRecord=this.movedFiles.find(el=>el.newPath===oldPath);
      if (doubleRecord){
        doubleRecord.file=file;
        doubleRecord.newPath=newPath;
        return;
      }
      this.movedFiles.push({file, oldPath, newPath});
    }

    clearQueue(){
      this.fileQueue=[];
    }

    public isAwaitMoveByNewPath(newPath:string){
      const inMovedFiles=this.movedFiles.find(el=>el.newPath===newPath)!==undefined;
      if (inMovedFiles) return true;
      const inQueue=this.fileQueue.find(el=>el.data.localFolder?.path===newPath)!==undefined;
      return inQueue;
    }

    public clearMovedFiles(){
      this.movedFiles=[];
    }
    
    constructor(
        bitrixApi:Bitrix24Api,
        mappingManager:MappingManager,
        vault: Vault,
        private readonly app: App,
        lastSync: number
    ) {
        this.bitrixApi = bitrixApi;
        this.vault = vault;
        this.mappingManager = mappingManager
        this.lastSync=lastSync;
        this.localController=new LocalController(vault, mappingManager, bitrixApi);
        this.bitrixController=new BitrixController(mappingManager,  bitrixApi, vault);
    }

    setLastSync(lastSync:number){
      this.lastSync=lastSync;
    }

    async sync(bitrixMap:BitrixMap){

      this.bitrixMap=bitrixMap;
      this.bitrixController.setBitrixMap(bitrixMap);
      
      const obsidianFiles:TFile[] = [];
      const obsidianFolders: TFolder[] = [];

      this.vault.getAllLoadedFiles().forEach(f => {
        if (f instanceof TFile) {
            obsidianFiles.push(f);
        } else if (f instanceof TFolder) {
          obsidianFolders.push(f);
        }
      });

      await this.syncFolders(obsidianFolders);
      await this.syncFiles(obsidianFiles);
      this.movedFiles=[];
      await this.processFileQueue();
    }

    async processFileQueue(){
      for (const item of this.fileQueue) {
        try {
          switch (item.action) {
            //CREATE FOLDER
            case ACTION_LOCAL.CREATE_FOLDER:
              await this.localController.createFolder(item.data.folder as BitrixMapElement);
              break;
            case ACTION_BITRIX.CREATE_FOLDER:{
              await this.bitrixController.createFolder(item.data.localFolder as TFolder);
              break;
            }
          // CREATE FILE
            case ACTION_BITRIX.CREATE_FILE:
              await this.bitrixController.createFile(item.data.localFile as TFile);
              break;
            case ACTION_LOCAL.CREATE_FILE:
              await this.localController.createFile(item.data.file as BitrixMapElement);
              break;
            //UPDATE FILE
            case ACTION_BITRIX.UPDATE_FILE:
              await this.bitrixController.updateFile(item.data.localFile as TFile, item.data.file as BitrixMapElement);
              break;
            case ACTION_LOCAL.UPDATE_FILE:
              await this.localController.updateFile(item.data.localFile as TFile, item.data.file as BitrixMapElement);
              break;
            case ACTION_BITRIX.MOVE_FOLDER:
              await this.bitrixController.moveFolder(item.data.localFolder as TFolder, item.data.oldPath as string);
              break;
            case ACTION_LOCAL.MOVE_FOLDER:
              await this.localController.moveFolder(item.data.localFolder as TFolder, item.data.folder as BitrixMapElement, item.data.localMapping as FileMapping);
              break;
            case 'updateBitrixAndLocalFile':
              await this.bitrixController.updateFileByContent(item.data.file as BitrixMapElement, item.data.content||"");
              await this.localController.updateFileByContent(item.data.localFile as TFile, item.data.content||"", (item.data.file as BitrixMapElement).lastUpdate);
              break;
            case ACTION_LOCAL.MOVE_FILE:
              await this.localController.moveFile(item.data.localFile as TFile, item.data.file as BitrixMapElement, item.data.localMapping as FileMapping);
              break;
            case ACTION_BITRIX.MOVE_FILE:
              await this.bitrixController.moveFile(item.data.localFile as TFile, item.data.oldPath as string);
              break;
            case ACTION_LOCAL.DELETE_FOLDER:
              await this.localController.deleteFolder(item.data.localFolder as TFolder, item.data.localMapping as FileMapping);
              break;
            case ACTION_LOCAL.DELETE_FILE:
              await this.localController.deleteFile(item.data.localFile as TFile, item.data.localMapping as FileMapping);
              break;
            case ACTION_BITRIX.DELETE_FILE:
              this.bitrixController.deleteFile(item.data.file as BitrixMapElement, item.data.localMapping as FileMapping);
              break;
            case ACTION_BITRIX.DELETE_FOLDER:
              this.bitrixController.deleteFolder(item.data.folder as BitrixMapElement, item.data.localMapping as FileMapping);
              break;
            default:
            break;
        }
        } catch (error) {
          new Notice('Ошибка обработки очереди: '+error);
        }
      }
      console.log(this.fileQueue);
      this.fileQueue=[];
    }

    public async checkLocalFile(localFile:TFile, localMapping?:FileMapping, bitrixMapping?:BitrixMapElement):Promise<string[]>{ //TODO сделать проверку на игнор карты битрикс (если это событие а не полная синхронизация)
      const moved=this.movedFiles.find(el=>el.newPath===localFile.path);
      const changedFiles:string[]=[];
      if (moved){
        this.fileQueue.push({
          action:ACTION_BITRIX.MOVE_FILE,
          data:{
            localFile,
            oldPath:moved.oldPath,
            newPath:moved.newPath
          }
        })
        // this.bitrixController.moveFile(moved.file, moved.oldPath);
        return changedFiles;
      }

      if (!bitrixMapping&&!localMapping) {
        // Файл не существует в Битрикс.Диск, добавляем в очередь на создание
        this.fileQueue.push({
          action: ACTION_BITRIX.CREATE_FILE,
          data: { localFile: localFile }
        });
      }
      else if(!localMapping&&bitrixMapping){
        console.log('!mapping && bitrixMapping:'+localFile.path);
        await this.resolveConflict(localFile, bitrixMapping);
        console.log('resolved');
      }
      else if(bitrixMapping&&localMapping){
        changedFiles.push(bitrixMapping.id);
        if (
          localMapping.lastLocalMtime<localFile.stat.mtime //Обновление файла в ФС было позже чем в мапинге
          &&localMapping.lastUpdatBitrix>=bitrixMapping.lastUpdate //Обновление файла в битриксе не было
        ){
          this.fileQueue.push({
            action: ACTION_BITRIX.UPDATE_FILE,
            data: { localFile, file:bitrixMapping }
          });
        }

        if (
          localMapping.lastLocalMtime>=localFile.stat.mtime //В файловой системе не было обновления
          &&localMapping.lastUpdatBitrix<bitrixMapping.lastUpdate //В битриксе было обновление
        ){
          this.fileQueue.push({
            action: ACTION_LOCAL.UPDATE_FILE,
            data: { localFile, file:bitrixMapping }
          });
        }

        if (
          localMapping.lastLocalMtime<localFile.stat.mtime
          &&localMapping.lastUpdatBitrix<bitrixMapping.lastUpdate
        ){
          console.log('localMapping.lastLocalMtime<localFile.stat.mtime&&!mapping && bitrixMapping', localFile.path);
          await this.resolveConflict(localFile, bitrixMapping);
          console.log('resolved');
        }
      }
      if (localMapping&&!bitrixMapping){
        bitrixMapping=this.bitrixMap.map.find(el=>el.id===localMapping.id);
        if (bitrixMapping){//Файл перемещён в битриксе
          this.movedFiles.push({file:localFile, oldPath:localMapping.path, newPath:bitrixMapping.path});
          this.fileQueue.push({
            action: ACTION_LOCAL.MOVE_FILE,
            data: { localFile, file:bitrixMapping, localMapping}
          });
        }
        else{
          console.log('Файл удалён в битриксе.'+localMapping.path);
          this.fileQueue.push({
            action: ACTION_LOCAL.DELETE_FILE,
            data: { localFile, localMapping }
          });
        }
      }
      return changedFiles;
    }

    checkBitrixFile(bitrixFile:BitrixMapElement, localMap?:FileMapping, fileLocal?:TFile){
        const moved=this.movedFiles.find(el=>el.newPath===bitrixFile.path);
        if (moved) {
          console.log('Пропустил так как перемещён (bitrixFile.path)', bitrixFile.path);
          return;
        }

        if (!fileLocal&&!localMap) {
          // Файл существует только в Битрикс.Диск, удаляем
          this.fileQueue.push({
            action: ACTION_LOCAL.CREATE_FILE,
            data: { file: bitrixFile }
          });
        }
        else if(!fileLocal&&localMap){
          console.log('Файл удалён в ФС. Удаляем и в битриксе: '+bitrixFile.path);
          this.fileQueue.push({
            action: ACTION_BITRIX.DELETE_FILE,
            data: { file: bitrixFile, localMapping:localMap }
          });
        }

    }


    async syncFiles(localFiles:TFile[]){
      const filesMappings = this.mappingManager.mappings.filter(el => !el.isFolder);
      const bitrixFiles=this.bitrixMap.map.filter(el=>!el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      const changedFiles:string[]=[];

      for (const localFile of localFiles) {
        const localMapping = filesMappings.find(el=>el.path===localFile.path);
        const bitrixMap=bitrixFiles.find(el=>el.path===localMapping?.path);
        const changedFiles=await this.checkLocalFile(localFile, localMapping, bitrixMap);
        changedFiles.push(...changedFiles);
      }

      for (const bitrixFile of bitrixFiles) {
        if (changedFiles.includes(bitrixFile.id)) continue;
        const localMap=filesMappings.find(el=>el.path===bitrixFile.path);
        const localFile=localFiles.find(el=>el.path===localMap?.path);
        this.checkBitrixFile(bitrixFile, localMap, localFile);
      }
      return result;
    }

    private async resolveConflict(
      file: TFile, 
      bitrixMapping: BitrixMapElement
    ){
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve) => {
          const showContent=['md'].includes(file.extension);
          let localContent='';
          let remoteContent
          if (showContent) {
            localContent = await this.vault.read(file);
            remoteContent = await getTextRemoteFile(bitrixMapping.bitrixUrl);
          }

          if (localContent===remoteContent&&showContent){
            const mapping=this.mappingManager.getById(bitrixMapping.id);
            if (mapping){
              this.mappingManager.set(bitrixMapping.id, {
                lastLocalMtime: file.stat.mtime,
                lastUpdatBitrix: bitrixMapping.lastUpdate
              });
            }
            else{
              this.mappingManager.add({
                id: bitrixMapping.id,
                name: file.name,
                isFolder: bitrixMapping.isFolder,
                lastLocalMtime: file.stat.mtime,
                lastUpdatBitrix: bitrixMapping.lastUpdate,
                path: file.path
              });
            }
            resolve(true);
            return;
          }

          const conflict: DiffContents = {
            localContent,
            remoteContent:remoteContent||'',
            fileName: file.name,
            localTime: file.stat.mtime,
            remoteTime: bitrixMapping.lastUpdate,
            showContent: ['md'].includes(file.extension)
          };
          
          // Открываем модальное окно с выбором
          const modal = new ConflictResolutionModal(
            this.app,
            conflict,
            async (resolution, content) => {
              try {
                switch (resolution) {
                  case 'local':
                    this.fileQueue.push({
                      action: ACTION_BITRIX.UPDATE_FILE,
                      data: { localFile: file, file:bitrixMapping }
                    });
                    break;
                  case 'remote':
                    this.fileQueue.push({
                      action: ACTION_LOCAL.UPDATE_FILE,
                      data: { localFile: file, file:bitrixMapping }
                    });
                    break;
                  case 'merged':
                    this.fileQueue.push({
                      action:'updateBitrixAndLocalFile',
                      data:{localFile:file, file:bitrixMapping, content}
                    });
                    break;
                  default:
                    break;
                }
                new Notice(`Конфликт разрешен для файла: ${file.name}`);
                resolve (true);
              } catch (error) {
                console.error(`Error resolving conflict for file ${file.path}:`, error);
                new Notice(`Ошибка при разрешении конфликта: ${error.message}`);
                resolve(false);
              }
            }
          );
          modal.open();
        });
    }

    async checkLocalFolder(localFolder:TFolder, bitrixMapping?:BitrixMapElement, localMapping?:FileMapping){ //TODO сделать проверку на игнор карты битрикс (если это событие а не полная синхронизация)
      if (localFolder.path === '/') return;
      // Проверяем, существует ли маппинг для этой папки
      const moved=this.movedFiles.find(el=>el.newPath===localFolder.path);
      if (moved){
        this.fileQueue.push({
          action:ACTION_BITRIX.MOVE_FOLDER,
          data:{
            localFolder,
            oldPath:moved.oldPath,
            newPath:moved.newPath
          }
        })
        // this.bitrixController.moveFile(moved.file, moved.oldPath);
        return;
      }

      if (!bitrixMapping&&!localMapping) {
          this.fileQueue.push({
            action: ACTION_BITRIX.CREATE_FOLDER,
            data: { localFolder: localFolder }
          });
      }
      if (localMapping&&!bitrixMapping){
        bitrixMapping=this.bitrixMap.map.find(el=>el.id===localMapping.id);
        if (bitrixMapping){//Папка была перемещена в битриксе
          this.fileQueue.push({
            action: ACTION_LOCAL.MOVE_FOLDER,
            data:{localFolder, folder:bitrixMapping, localMapping}
          })
        }
        else{
          console.log('Папка была удалена в битрикс');
          this.fileQueue.push({
            action: ACTION_LOCAL.DELETE_FOLDER,
            data:{localFolder, localMapping}
          })
        }
      }
    }

    checkBitrixFolder(folderInBitrix:BitrixMapElement, folderMapping?:FileMapping, localFolder?:TFolder){
      const moved=this.movedFiles.find(el=>el.oldPath===folderInBitrix.path);
      if (moved){
        console.log('Пропустил ', moved.newPath, moved.oldPath);
        return;
      }
      
      if(!localFolder&&!folderMapping){
        this.fileQueue.push({
          action: ACTION_LOCAL.CREATE_FOLDER,
          data: { folder: folderInBitrix }
        });
      }
      else if(!localFolder&&folderMapping){
        console.log('Папка удалена в ФС, удаляем и в Битрикс - '+folderInBitrix.path);
        this.fileQueue.push({
          action: ACTION_BITRIX.DELETE_FOLDER,
          data: { folder: folderInBitrix, localMapping:folderMapping }
        });
      }
    }

    async syncFolders(localFolders: TFolder[]){
      const folderMappings = this.mappingManager.mappings.filter(el => el.isFolder);
      const bitrixFolders=this.bitrixMap.map.filter(el=>el.isFolder);

      for (const localFolder of localFolders) {
        const folderMap=folderMappings.find(el=>el.path===localFolder.path);
        const bitrixMap=bitrixFolders.find(el=>el.path===localFolder.path);
        await this.checkLocalFolder(localFolder, bitrixMap, folderMap);
      }

      for (const folderInBitrix of bitrixFolders) {
          // Проверяем, существует ли папка локально
          const folderMap=folderMappings.find(el=>el.path===folderInBitrix.path);
          const localFolder=localFolders.find(el=>el.path===folderInBitrix.path);
          this.checkBitrixFolder(folderInBitrix, folderMap, localFolder);
          
      }
    }

}