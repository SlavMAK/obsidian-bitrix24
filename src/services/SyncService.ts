import { MappingManager } from "src/models/MappingManager";
import { Bitrix24Api } from "../api/bitrix24-api";
import { Notice, TFile, TFolder, Vault } from "obsidian";
import { BitrixDiskFile, BitrixDiskFolder } from "src/types/bitrix-disk";
import { BatchHelper } from "src/api/BatchHelper";
import { CallResult } from "src/api/callResult";

export class SyncService {
    
    private bitrixApi: Bitrix24Api;
    private mappingManager: MappingManager;
    private vault: Vault;
    private fileQueue: { action: string, data: any }[] = [];
    private lastSync=0;
    
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
    }

    fillMappingByresult(records:(BitrixDiskFile|BitrixDiskFolder)[]){
      for (const record of records) {
        const fileId = record.ID;
        const fileName = record.NAME;
        const fileFolderId = record.PARENT_ID;
        const parent=this.mappingManager.getById(fileFolderId);
        let parentPath='./';
        if (parent) parentPath=parent.filePath+parent.fileName;
        this.mappingManager.add({
          fileId,
          filePath: parentPath,
          fileName: fileName,
          isFolder: record?.TYPE==='file'?false:true,
          bitrixUrl:(record as BitrixDiskFile)?.DOWNLOAD_URL,
          lastSyncTimestamp:0,
          lastSyncTimestampBitrix:new Date(record.UPDATE_TIME).getTime()
        });
      }
    }

    async sync(){
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

      console.log(this.fileQueue);
    }

    async syncFolders(localFolders: TFolder[]){
      const folderMappings = this.mappingManager.mappings.filter(el => el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFolder of localFolders) {
        // Игнорируем корневую папку
        if (localFolder.path === '/') continue;
        
        try {
          // Проверяем, существует ли маппинг для этой папки
          const mapping = this.mappingManager.getMappingByLocalPath(localFolder.path);
          
          if (!mapping) {
            // Папка не существует в Битрикс.Диск, добавляем в очередь на создание
            this.fileQueue.push({
              action: 'createFolder',
              data: { folder: localFolder }
            });
            result.created++;
          }
        } catch (error) {
          const errorMessage = `Error processing local folder ${localFolder.path}: ${error.message || 'Unknown error'}`;
          console.error(errorMessage, error);
          result.errors.push(errorMessage);
        }
      }

      for (const folderMapping of folderMappings) {
        try {
          // Проверяем, существует ли папка локально
          const folderExists = localFolders.some(f => f.path === folderMapping.filePath+folderMapping.fileName);
          
          if (!folderExistt) {
            // Папка существует только в Битрикс.Диск, удаляем
            this.fileQueue.push({
              action: 'deleteFolder',
              data: { mapping: folderMapping }
            });
            result.deleted++;
          }
        } catch (error) {
          const errorMessage = `Error processing remote folder ${folderMapping.filePath+folderMapping.fileName}: ${error.message || 'Unknown error'}`;
          console.error(errorMessage, error);
          result.errors.push(errorMessage);
        }
      }
  
      return result;
    }

    async fillMapping(arrParents:{folderId:string, folderName: string}[]){
      try {
        const batchHelper = new BatchHelper();
        for (const parent of arrParents){
          const params={
            id:parent.folderId
          };
          batchHelper.addToBatch({[`getByParent_${parent.folderId}`]:['disk.folder.getchildren', params]});
        }
        const totalRess=await batchHelper.runAll(this.bitrixApi);
        for (const request in totalRess){
          const res=totalRess[request] as CallResult;
          if (totalRess[request].error()){
            new Notice('Ошибка при синхронизации с битрикс24: '+res.error(),0);
          }
          if (res.total()>50){
            console.warn('TODO добавить чанки загрузки');
          }
          else{
            this.fillMappingByresult(res.data());
          }
        }
      } catch (error) {
        console.error(error);
      }
    }
}