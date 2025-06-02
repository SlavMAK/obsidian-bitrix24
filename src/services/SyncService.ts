import { FileMapping, MappingManager } from "src/models/MappingManager";
import { Bitrix24Api } from "../api/bitrix24-api";
import { normalizePath, Notice, TFile, TFolder, Vault } from "obsidian";
import { BitrixDiskFile, BitrixDiskFolder } from "src/types/bitrix-disk";
import { BatchHelper } from "src/api/BatchHelper";
import { CallResult } from "src/api/callResult";
import { universalDownloadFile } from "src/helpers/universalDownloadFile";

export class SyncService {
    
    private bitrixApi: Bitrix24Api;
    private mappingManager: MappingManager;
    private vault: Vault;
    private fileQueue: { action: string, data: {
      folder?:FileMapping,
      localFolder?:TFolder,
      localFile?:TFile,
      file?: FileMapping
    }}[] = [];
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

    setLastSync(lastSync:number){
      this.lastSync=lastSync;
    }

    fillMappingByresult(records:(BitrixDiskFile|BitrixDiskFolder)[]){
      for (const record of records) {
        const fileId = record.ID;
        const fileName = record.NAME;
        const fileFolderId = record.PARENT_ID;
        const parent=this.mappingManager.getById(fileFolderId);
        let parentPath='';
        if (parent) parentPath=normalizePath(parent.filePath+'/'+parent.fileName);
        this.mappingManager.add({
          fileId,
          filePath: parentPath,
          fileName: fileName,
          isFolder: record?.TYPE==='file'?false:true,
          bitrixUrl:(record as BitrixDiskFile)?.DOWNLOAD_URL,
          lastSyncTimestamp:0,
          lastUpdateTimestampBitrix:new Date(record.UPDATE_TIME).getTime()
        });
      }
    }

    async sync(){
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
            case 'createLocalFolder':{
              const path=normalizePath((item.data.folder?.filePath)+'/'+(item.data.folder?.fileName||''));
              if (!(await this.vault.adapter.exists(path))){
                await this.vault.createFolder(path);
                console.log('Создал папку path');
              }
              break;
            }
            case 'createLocalFile':{
              universalDownloadFile(
                this.vault,
                item.data.file?.bitrixUrl||'',
                (item.data.file?.filePath||'')+'/'+(item.data.file?.fileName||''),
                {},
                {mtime:item.data.file?.lastUpdateTimestampBitrix||0}
              );
              break;
            }
            case 'createFileInBitrix':{
              const file=item?.data?.localFile as TFile;
              const base64File=await this.getFileAsBase64(this.vault, file);
              const parent=this.mappingManager.getMappingByLocalPath('/'+file?.parent?.path||'');
              if (!parent){
                console.log('Не нашёл родителя для папки ', item.data.file?.filePath||'');
                break;
              }
              const result=await this.bitrixApi.callMethod('disk.folder.uploadfile', {
                id:parent.fileId,
                data: {
                    NAME: file.name
                },
                fileContent:[file.name, base64File]
              });
              if (!result.error){
                this.mappingManager.add({
                  fileId:result.data().ID,
                  filePath:parent.filePath+'/'+parent.fileName,
                  fileName:file.name,
                  isFolder:false,
                  lastSyncTimestamp:new Date().getTime(),
                  lastUpdateTimestampBitrix:new Date(result.data().UPDATE_TIME).getTime(),
                  bitrixUrl:(result.data() as BitrixDiskFile)?.DOWNLOAD_URL
                })
              }
              break;
            }
            case 'deleteFileInBitrix':{
              const file=item.data.file as FileMapping;
              const result=await this.bitrixApi.callMethod('disk.file.markdeleted', {id:file.fileId});
              if (result.error()){
                new Notice('Ошибка при обработке файла '+result.error());
              }
              break;
            }
            case 'updateFileInBitrix':{
              const file=item.data.file as FileMapping;
              const findedFile=this.vault.getAbstractFileByPath(normalizePath(file.filePath+'/'+file.fileName)) as TFile;
              const base64File=await this.getFileAsBase64(this.vault, findedFile);
              const result=await this.bitrixApi.callMethod('disk.file.uploadversion', {id:item.data.file?.fileId, fileContent:[item?.data?.file?.fileName, base64File]});
              if (result.error()){
                new Notice('Ошибка при обработке файла '+result.error());
              }
              break;
            }
            case 'updateLocalFile':{
              universalDownloadFile(
                this.vault,
                item.data.file?.bitrixUrl||'',
                (item.data.file?.filePath||'')+'/'+(item.data.file?.fileName||''),
                {},
                {mtime:item.data.file?.lastUpdateTimestampBitrix||0});
              break;
            }
            case 'createBitrixFolder':{
              const folder=item.data.localFolder;
              const parent=this.mappingManager.getMappingByLocalPath('/'+folder?.parent?.path||'');
              if (!parent){
                console.log('Не нашёл родителя для папки ', item.data.folder?.filePath||'');
                break;
              }
              const result=await this.bitrixApi.callMethod('disk.folder.addsubfolder', {
                id:parent.fileId,
                data:{
                  NAME:folder?.name||''
                }
              });
              if (!result.error()){
                this.mappingManager.add({
                  fileId:result.data().ID,
                  filePath:folder?.parent?.path||'',
                  fileName:folder?.name||'',
                  isFolder:true,
                  lastSyncTimestamp:new Date().getTime(),
                  bitrixUrl:'',
                  lastUpdateTimestampBitrix:new Date(result.data().UPDATE_TIME).getTime()
                });
              }
              break;
            }
            default:
            break;
        }
      }
    }


    async syncFiles(localFiles:TFile[]){
      const filesMappings = this.mappingManager.mappings.filter(el => !el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFile of localFiles) {
        const mapping = this.mappingManager.getMappingByLocalPath(localFile.path);
        const mtime=localFile.stat.mtime;
        if (!mapping&&mtime>this.lastSync) {
          // Файл не существует в Битрикс.Диск, добавляем в очередь на создание
          this.fileQueue.push({
            action: 'createFileInBitrix',
            data: { localFile: localFile }
          });
          result.created++;
        }
        else if (!mapping) {
          // Файл существует только в Битрикс.Диск, удаляем
          this.fileQueue.push({
            action: 'deleteLocalFile',
            data: { file: mapping }
          });
          result.deleted++;
        }
      }

      for (const fileMapping of filesMappings) {
        const fileExists = localFiles.some(f => f.path === normalizePath(fileMapping.filePath+'/'+fileMapping.fileName));
        let lastModified=0;
        if (fileExists){
          lastModified=localFiles.find(el=>el.path===fileMapping.filePath+'/'+fileMapping.fileName)?.stat.mtime||0;
        }

        if (!fileExists&&fileMapping.lastUpdateTimestampBitrix<this.lastSync) {
          // Файл существует только в Битрикс.Диск, удаляем
          this.fileQueue.push({
            action: 'deleteFileInBitrix',
            data: { file: fileMapping }
          });
          result.deleted++;
        }
        else if(!fileExists){
          this.fileQueue.push({
            action: 'createLocalFile',
            data: { file: fileMapping }
          });
          result.created++;
        }
        else if (fileExists&&fileMapping&&fileMapping.lastUpdateTimestampBitrix>this.lastSync){
          this.fileQueue.push({
            action: 'updateLocalFile',
            data: { file: fileMapping }
          });
        }
        else if(fileExists&&fileMapping&&lastModified>fileMapping.lastUpdateTimestampBitrix){
            this.fileQueue.push({
              action: 'updateFileInBitrix',
              data: { file: fileMapping }
            });
        }
      }
      return result;
    }

    syncFolders(localFolders: TFolder[]){
      const folderMappings = this.mappingManager.mappings.filter(el => el.isFolder);
      const result:{created:number, deleted:number, errors:string[]} = { created: 0, deleted: 0, errors: [] };

      for (const localFolder of localFolders) {
        if (localFolder.path === '/') continue;
          // Проверяем, существует ли маппинг для этой папки
          const mapping = this.mappingManager.getMappingByLocalPath('/'+localFolder.path);
          
          if (!mapping) {
            // Папка не существует в Битрикс.Диск, добавляем в очередь на создание
            this.fileQueue.push({
              action: 'createBitrixFolder',
              data: { localFolder: localFolder }
            });
            result.created++;
          }
      }

      for (const folderMapping of folderMappings) {
          // Проверяем, существует ли папка локально
          const folderExists = localFolders.some(f => f.path === normalizePath(folderMapping.filePath+'/'+folderMapping.fileName));
          
          if (!folderExists&&folderMapping.lastUpdateTimestampBitrix<this.lastSync) {
            // Папка существует только в Битрикс.Диск, удаляем
            this.fileQueue.push({
              action: 'deleteRemoteFolder',
              data: { folder: folderMapping }
            });
            result.deleted++;
          }
          else if(!folderExists){
            this.fileQueue.push({
              action: 'createLocalFolder',
              data: { folder: folderMapping }
            });
            result.created++;
          }
      }
  
      return result;
    }

    async getFileAsBase64(vault: Vault, file: TFile): Promise<string> {
      try {
        // Получаем содержимое файла как ArrayBuffer
        const arrayBuffer = await vault.readBinary(file);
        
        // Конвертируем ArrayBuffer в строку base64
        const base64 = this.arrayBufferToBase64(arrayBuffer);
        
        return base64;
      } catch (error) {
        console.error(`Error getting base64 for file ${file.path}:`, error);
        throw error;
      }
    }

    /**
     * Конвертирует ArrayBuffer в строку base64
     */
    arrayBufferToBase64(buffer: ArrayBuffer): string {
      // Преобразуем ArrayBuffer в бинарную строку
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      // Кодируем в base64
      return btoa(binary);
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
        const folders:{folderId:string, folderName:string}[]=[];
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
            folders.push(...res.data().filter((el:BitrixDiskFolder)=>el.TYPE==='folder').map((el:BitrixDiskFolder)=>({
              folderId:el.ID,
              folderName:el.NAME
            })));
          }
        }
        if (folders.length>0){
          await this.fillMapping(folders);
        }
      } catch (error) {
        console.error(error);
      }
    }
}