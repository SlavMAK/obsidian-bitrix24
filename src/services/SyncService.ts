import { FileMapping, MappingManager } from "src/models/MappingManager";
import { Bitrix24Api } from "../api/bitrix24-api";
import { normalizePath, Notice, TFile, TFolder, Vault } from "obsidian";
import { BitrixDiskFile } from "src/types/bitrix-disk";
import { universalDownloadFile } from "src/helpers/universalDownloadFile";
import { BitrixMap, BitrixMapElement} from "src/models/BitrixMap";
import { ACTION as ACTION_LOCAL, LocalController } from "src/controllers/LocalController";
import { ACTION as ACTION_BITRIX, BitrixController } from 'src/controllers/BitrixController';




export class SyncService {
    
    private bitrixApi: Bitrix24Api;
    private mappingManager: MappingManager;
    private vault: Vault;
    private fileQueue: { action: string, data: {
      folder?:BitrixMapElement,
      localFolder?:TFolder,
      localFile?:TFile,
      file?: BitrixMapElement
    }}[] = [];
    private lastSync=0;

    private bitrixMap:BitrixMap;

    bitrixController:BitrixController;
    localController:LocalController;
    

    
    constructor(
        bitrixApi:Bitrix24Api,
        mappingManager:MappingManager,
        vault: Vault,
        lastSync: number
    ) {
        this.bitrixApi = bitrixApi;
        this.vault = vault;
        this.mappingManager = mappingManager
        this.lastSync=lastSync;
        this.localController=new LocalController(vault);
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
      this.syncFiles(obsidianFiles);
      this.processFileQueue();
      console.log(this.fileQueue);
    }

    async processFileQueue(){
      for (const item of this.fileQueue) {
          switch (item.action) {
            case ACTION_LOCAL.CREATE_FOLDER:
              await this.localController.createFolder(item.data.folder as BitrixMapElement);
              break;
            case ACTION_BITRIX.CREATE_FOLDER:{
              await this.bitrixController.createFolder(item.data.localFolder as TFolder);
              break;
            }
            case ACTION_BITRIX.CREATE_FILE:
              await this.bitrixController.createFile(item.data.localFile as TFile);
              break;
            case ACTION_LOCAL.CREATE_FILE:
              await this.localController.createFile(item.data.file as BitrixMapElement);
              break;
            
            // case ACTION_DELETE_FILE_IN_BITRIX:{
            //   const file=item.data.file as FileMapping;
            //   const result=await this.bitrixApi.callMethod('disk.file.markdeleted', {id:file.id});
            //   if (result.error()){
            //     new Notice('Ошибка при обработке файла '+result.error());
            //   }
            //   break;
            // }
            // case ACTION_UPDATE_FILE_IN_BITRIX:{
            //   const file=item.data.file as FileMapping;
            //   const findedFile=this.vault.getAbstractFileByPath(file.path) as TFile;
            //   const base64File=await this.getFileAsBase64(this.vault, findedFile);
            //   const result=await this.bitrixApi.callMethod('disk.file.uploadversion', {id:item.data.file?.id, fileContent:[item?.data?.file?.name, base64File]});
            //   if (result.error()){
            //     new Notice('Ошибка при обработке файла '+result.error());
            //   }
            //   break;
            // }
            // case ACTION_UPDATE_FILE_IN_LOCAL:{
            //   universalDownloadFile(
            //     this.vault,
            //     item.data.file?.bitrixUrl||'',
            //     (item.data.file as FileMapping).path,
            //     {},
            //     {mtime:item.data.file?.lastUpdatBitrix||0});
            //   break;
            // }
            default:
            break;
        }
      }
    }


    async syncFiles(localFiles:TFile[]){
      const filesMappings = this.mappingManager.mappings.filter(el => !el.isFolder);
      const bitrixFiles=this.bitrixMap.map.filter(el=>!el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFile of localFiles) {
        
        const mapping = this.mappingManager.getMappingByLocalPath(localFile.path);
        const bitrixMapping = this.bitrixMap.map.find(el=>el.path===localFile.path);
        // const mtime=localFile.stat.mtime; //Нужно для сравнения и обновления

        if (!bitrixMapping&&!mapping) {
          // Файл не существует в Битрикс.Диск, добавляем в очередь на создание
          this.fileQueue.push({
            action: ACTION_BITRIX.CREATE_FILE,
            data: { localFile: localFile }
          });
          result.created++;
        }
        // else if (!mapping) {
        //   // Файл существует только в Битрикс.Диск, удаляем
        //   this.fileQueue.push({
        //     action: 'deleteLocalFile',
        //     data: { file: mapping }
        //   });
        //   result.deleted++;
        // }
      }

      for (const bitrixFile of bitrixFiles) {
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

        // else if(!fileExists){
        //   this.fileQueue.push({
        //     action: 'createLocalFile',
        //     data: { file: fileMapping }
        //   });
        //   result.created++;
        // }
        // else if (fileExists&&fileMapping&&fileMapping.lastUpdatBitrix>this.lastSync){
        //   this.fileQueue.push({
        //     action: 'updateLocalFile',
        //     data: { file: fileMapping }
        //   });
        // }
        // else if(fileExists&&fileMapping&&lastModified>fileMapping.lastUpdatBitrix){
        //     this.fileQueue.push({
        //       action: 'updateFileInBitrix',
        //       data: { file: fileMapping }
        //     });
        // }

      }
      return result;
    }

    syncFolders(localFolders: TFolder[]){
      const folderMappings = this.mappingManager.mappings.filter(el => el.isFolder);
      const bitrixFolders=this.bitrixMap.map.filter(el=>el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFolder of localFolders) {
        if (localFolder.path === '/') continue;
          // Проверяем, существует ли маппинг для этой папки
          const mapping = bitrixFolders.find(el=>el.path===localFolder.path);
          
          if (!mapping) {
            // Папка не существует в Битрикс.Диск, добавляем в очередь на создание
            this.fileQueue.push({
              action: ACTION_BITRIX.CREATE_FOLDER,
              data: { localFolder: localFolder }
            });
            result.created++;
            continue;
          }
          const bitrixMap=bitrixFolders.find(el=>el.id===mapping.id);
          if (!bitrixMap){
            // Папка была удалена в битрикс
          }
          else{//Папка была переименована/перемещена

          }
      }

      for (const folderInBitrix of bitrixFolders) {
          // Проверяем, существует ли папка локально
          const folderExists = localFolders.some(f => f.path === folderInBitrix.path);
          const folderMapping = folderMappings.find(el=>el.id===folderInBitrix.id);
          
          if(!folderExists&&!folderMapping){
            this.fileQueue.push({
              action: ACTION_LOCAL.CREATE_FOLDER,
              data: { folder: folderInBitrix }
            });
            result.created++;
          }
          // if (!folderExists&&folderMapping) {
          // //   // Папка существует только в Битрикс.Диск, удаляем
          //   this.fileQueue.push({
          //     action: 'deleteRemoteFolder',
          //     data: { folder: folderMapping }
          //   });
          //   result.deleted++;
          // }
      }
  
      return result;
    }

}