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
    private fileQueue: { action: string, data: {
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
        this.localController=new LocalController(vault, mappingManager);
        this.bitrixController=new BitrixController(mappingManager,  bitrixApi, vault);
    }

    setLastSync(lastSync:number){
      this.lastSync=lastSync;
    }



    async sync(bitrixMap:BitrixMap){

      this.bitrixMap=bitrixMap;
      this.bitrixController.setBitrixMap(bitrixMap);
      
      this.fileQueue=[];
      const obsidianFiles:TFile[] = [];
      const obsidianFolders: TFolder[] = [];

      this.vault.getAllLoadedFiles().forEach(f => {
        if (f instanceof TFile) {
            obsidianFiles.push(f);
        } else if (f instanceof TFolder) {
          obsidianFolders.push(f);
        }
      });

      this.syncFolders(obsidianFolders);
      await this.syncFiles(obsidianFiles);
      this.movedFiles=[];
      this.processFileQueue();
      console.log(this.fileQueue);
    }

    async processFileQueue(){
      for (const item of this.fileQueue) {
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
              await this.bitrixController.moveFolder(item.data.localAbstract as TAbstractFile, item.data.oldPath as string);
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
            default:
            break;
        }
      }
    }

    public async checkLocalFile(localFile:TFile){
      const moved=this.movedFiles.find(el=>el.newPath===localFile.path);
      const result:{created:number, deleted:number, errors:string[], changedFiles:string[]} = { created: 0, deleted: 0, errors: [], changedFiles:[] };
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
        return result;
      }
      const mapping = this.mappingManager.getMappingByLocalPath(localFile.path);
      let bitrixMapping = this.bitrixMap.map.find(el=>el.path===localFile.path);
      // const mtime=localFile.stat.mtime; //Нужно для сравнения и обновления

      if (!bitrixMapping&&!mapping) {
        // Файл не существует в Битрикс.Диск, добавляем в очередь на создание
        this.fileQueue.push({
          action: ACTION_BITRIX.CREATE_FILE,
          data: { localFile: localFile }
        });
        result.created++;
      }
      else if(!mapping&&bitrixMapping){
        console.log('!mapping && bitrixMapping');
        await this.resolveConflict(localFile, bitrixMapping);
        console.log('resolved');
      }
      else if(bitrixMapping&&mapping){
        result.changedFiles.push(bitrixMapping.id);
        if (
          mapping.lastLocalMtime<localFile.stat.mtime //Обновление файла в ФС было позже чем в мапинге
          &&mapping.lastUpdatBitrix>=bitrixMapping.lastUpdate //Обновление файла в битриксе не было
        ){
          this.fileQueue.push({
            action: ACTION_BITRIX.UPDATE_FILE,
            data: { localFile, file:bitrixMapping }
          });
        }

        if (
          mapping.lastLocalMtime>=localFile.stat.mtime //В файловой системе не было обновления
          &&mapping.lastUpdatBitrix<bitrixMapping.lastUpdate //В битриксе было обновление
        ){
          this.fileQueue.push({
            action: ACTION_LOCAL.UPDATE_FILE,
            data: { localFile, file:bitrixMapping }
          });
        }

        if (
          mapping.lastLocalMtime<localFile.stat.mtime
          &&mapping.lastUpdatBitrix<bitrixMapping.lastUpdate
        ){
          console.log('!mapping && bitrixMapping');
          await this.resolveConflict(localFile, bitrixMapping);
          console.log('resolved');
        }
      }
      if (mapping&&!bitrixMapping){
        bitrixMapping=this.bitrixMap.map.find(el=>el.id===mapping.id);
        if (bitrixMapping){//Файл перемещён в битриксе
          this.movedFiles.push({file:localFile, oldPath:mapping.path, newPath:bitrixMapping.path});
          this.fileQueue.push({
            action: ACTION_LOCAL.MOVE_FILE,
            data: { localFile, file:bitrixMapping, localMapping:mapping}
          });
        }
      }
      return result
    }


    async syncFiles(localFiles:TFile[]){
      const filesMappings = this.mappingManager.mappings.filter(el => !el.isFolder);
      const bitrixFiles=this.bitrixMap.map.filter(el=>!el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      const changedFiles:string[]=[];

      for (const localFile of localFiles) {
        const tempResult=await this.checkLocalFile(localFile);
        result.created+=tempResult.created;
        result.deleted+=tempResult.deleted;
        result.errors.push(...tempResult.errors);
        changedFiles.push(...tempResult.changedFiles);
      }

      for (const bitrixFile of bitrixFiles) {
        if (changedFiles.includes(bitrixFile.id)) continue;
        const moved=this.movedFiles.find(el=>el.newPath===bitrixFile.path);
        if (moved) {
          console.log('Пропустил так как перемещён (bitrixFile.path)', bitrixFile.path);
          continue;
        }

        const fileLocal=this.vault.getAbstractFileByPath(bitrixFile.path) as TFile;
        const fileMapping=filesMappings.find(el=>el.id===bitrixFile.id);

        if (!fileLocal&&!fileMapping) {
          // Файл существует только в Битрикс.Диск, удаляем
          this.fileQueue.push({
            action: ACTION_LOCAL.CREATE_FILE,
            data: { file: bitrixFile }
          });
          result.deleted++;
        }
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

    syncFolders(localFolders: TFolder[]){
      const folderMappings = this.mappingManager.mappings.filter(el => el.isFolder);
      const bitrixFolders=this.bitrixMap.map.filter(el=>el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFolder of localFolders) {
        if (localFolder.path === '/') continue;
        // Проверяем, существует ли маппинг для этой папки
        const mapping = bitrixFolders.find(el=>el.path===localFolder.path);
        const localMap= folderMappings.find(el=>el.path===localFolder.path);
        
        if (!mapping&&!localMap) {  //Не существует в мапингах - значит создана в обсидиан. НО ВОЗМОЖНО ПЕРЕМЕЩЕНА. TODO: ПРОВЕРИТЬ
          const moved=this.movedFiles.find(el=>el.newPath===localFolder.path);
          if(!moved){
            this.fileQueue.push({
              action: ACTION_BITRIX.CREATE_FOLDER,
              data: { localFolder: localFolder }
            });
            result.created++;
          }
          else{
            this.fileQueue.push({
              action: ACTION_BITRIX.MOVE_FOLDER,
              data: { localAbstract: moved.file, oldPath: moved.oldPath }
            });
            result.created++;
          }
          
        }
      }

      for (const folderInBitrix of bitrixFolders) {
          // Проверяем, существует ли папка локально
          const folderExists = localFolders.some(f => f.path === folderInBitrix.path);
          const folderMapping = folderMappings.find(el=>el.id===folderInBitrix.id);
          const moved=this.movedFiles.find(el=>el.oldPath===folderInBitrix.path);
          if (moved){
            console.log('Пропустил ', moved.newPath, moved.oldPath);
            continue;
          }
          
          if(!folderExists&&!folderMapping){
            this.fileQueue.push({
              action: ACTION_LOCAL.CREATE_FOLDER,
              data: { folder: folderInBitrix }
            });
            result.created++;
          }
      }
  
      return result;
    }

}