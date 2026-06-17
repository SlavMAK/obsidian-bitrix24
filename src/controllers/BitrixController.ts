import { Notice, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { FileMapping, MappingManager } from "src/models/MappingManager";
import { Logger } from "src/services/LoggerService";

export const ACTION={
  CREATE_FILE:'createFileInBitrix',
  UPDATE_FILE:'updateFileInBitrix',
  CREATE_FOLDER:'createFolderInBitrix',
  MOVE_FOLDER:'moveFolderInBitrix',
  MOVE_FILE:'moveFileInBitrix',
  DELETE_FILE:'deleteFileInBitrix',
  DELETE_FOLDER:'deleteFolderInBitrix',
}

export class BitrixController{

  bitrixMap!:BitrixMap;

  constructor(
    private mappingManager:MappingManager,
    private bitrixApi:Bitrix24Api,
    private vault:Vault,
    private clientWebSocketId:string,
    private logger:Logger
  ){}

  setBitrixMap(map:BitrixMap){
    this.bitrixMap=map;
  }

  async createFolder(folder:TFolder){
    const parentPath=folder.parent?.path||'/';
    const parent=this.mappingManager.getMappingByLocalPath(parentPath);
    if (!parent){
      this.logger.log('Не нашёл родителя для папки ', 'ERROR', folder.path);
      return;
    }
    const result=await this.bitrixApi.callBatch({
      createFolder:['disk.folder.addsubfolder', {
        id:parent.id,
        data:{
          NAME:folder?.name||''
        }
      }]
    });
    
    if (!result.createFolder.error()){
      this.mappingManager.add({
        id:result.createFolder.data().ID,
        path:folder.path,
        name:folder.name,
        isFolder:true,
        lastUpdatBitrix:new Date(result.createFolder.data().UPDATE_TIME).getTime(),
        lastLocalMtime:new Date().getTime()
      });
    }
  }

  async createFile(file:TFile){
    const base64File=await this.getFileAsBase64(this.vault, file);
    const parent=this.mappingManager.getMappingByLocalPath(file.parent?.path||"/");
    if (!parent){
      this.logger.log('Не нашёл родителя для папки ', 'ERROR', file);
      return
    }
    const result=await this.bitrixApi.callBatch({
      createFile:['disk.folder.uploadfile', {
        id:parent.id,
        data: {
            NAME: file.name
        },
        fileContent:[file.name, base64File||'IA==']
      }]
    });
    
    if (result.createFile.error()){
      const err=result.createFile.error();
      this.logger.log('Ошибка при создании файла в Битрикс', 'ERROR', {path: file.path, parent: parent.id, error: err});
      new Notice('Ошибка при создании файла '+err);
    }
    else {
      this.mappingManager.add({
        id:result.createFile.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.createFile.data().UPDATE_TIME).getTime(),
        lastLocalMtime: file.stat.ctime
      })
    }
  }

  async deleteFile(bitrixMap:BitrixMapElement, localMap:FileMapping){
    const result=await this.bitrixApi.callBatch({
      removeFile:['disk.file.markdeleted', {id:bitrixMap.id}]
    });
    
    if (result.removeFile.error()){
      const err=result.removeFile.error();
      this.logger.log('Ошибка удаления файла в Битрикс', 'ERROR', {path: bitrixMap.path, id: bitrixMap.id, error: err});
      new Notice('Ошибка удаления из битрикс файла  '+bitrixMap.path+' '+err);
      return;
    }
    this.mappingManager.remove(localMap.id);
  }

  async deleteFolder(bitrixMap:BitrixMapElement, localMap:FileMapping){
    const result=await this.bitrixApi.callBatch({
      deleteFolder:['disk.folder.markdeleted', {id:bitrixMap.id}]
    });
    
    if (result.deleteFolder.error()){
      const err=result.deleteFolder.error();
      this.logger.log('Ошибка удаления папки в Битрикс', 'ERROR', {path: bitrixMap.path, id: bitrixMap.id, error: err});
      new Notice('Ошибка удаления из битрикс папки  '+bitrixMap.path+' '+err);
      return;
    }
    this.mappingManager.remove(localMap.id);
  }

  async updateFile(file:TFile, bitrixMap:BitrixMapElement){
    const findedFile=this.vault.getFileByPath(file.path);
    if (!findedFile){
      this.logger.log('updateFile: не нашёл локальный файл', 'ERROR', {path: file.path, bitrixId: bitrixMap.id});
      new Notice('Не могу найти файл по пути '+file.path);
      return;
    }
    const base64File=await this.getFileAsBase64(this.vault, findedFile);
    const result=await this.bitrixApi.callBatch({
      updateFile:['disk.file.uploadversion', {id:bitrixMap.id, fileContent:[bitrixMap.name, base64File]}]
    });

    if (result.updateFile.error()){
      const err=result.updateFile.error();
      this.logger.log('Ошибка обновления файла в Битрикс', 'ERROR', {path: file.path, bitrixId: bitrixMap.id, error: err});
      new Notice('Ошибка при обработке файла '+err);
      return;
    }
    const mapping=this.mappingManager.getById(bitrixMap.id);
    if (mapping){
      this.mappingManager.set(bitrixMap.id, {
        lastLocalMtime:file.stat.mtime,
        lastUpdatBitrix:new Date(result.updateFile.data().UPDATE_TIME).getTime(),
      });
    }
    else{
      this.mappingManager.add({
        id:result.updateFile.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.updateFile.data().UPDATE_TIME).getTime(),
        lastLocalMtime:file.stat.mtime
      });
    }
  }

  async updateFileByContent(file:BitrixMapElement, content:string){
    const base64File=this.arrayBufferToBase64(new TextEncoder().encode(content));
    const result=await this.bitrixApi.callBatch({
      updateFile:['disk.file.uploadversion', {id:file.id, fileContent:[file.name, base64File]}]
    });
    
    if (result.updateFile.error()){
      const err=result.updateFile.error();
      this.logger.log('Ошибка обновления файла в Битрикс (by content)', 'ERROR', {path: file.path, bitrixId: file.id, error: err});
      new Notice('Ошибка при обработке файла '+err);
      return;
    }
    const mapping=this.mappingManager.getById(file.id);
    if (mapping){
      this.mappingManager.set(file.id, {
        lastUpdatBitrix:new Date(result.updateFile.data().UPDATE_TIME).getTime()
      });
    }
    else{
      this.mappingManager.add({
        id:result.updateFile.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.updateFile.data().UPDATE_TIME).getTime(),
        lastLocalMtime:new Date().getTime()
      });
    }
  }

  async moveFolder(folderAbstract:TAbstractFile, oldPath:string){
    const folder=this.vault.getFolderByPath(folderAbstract.path);
    if (!folder) {
      const msg='Не могу найти папку по пути '+ folderAbstract.path;
      this.logger.log(msg, 'ERROR', {oldPath, newPath: folderAbstract.path});
      new Notice(msg);
      return;
    }
    // Та же страховка, что и в moveFile: вложенная папка могла быть передвинута
    // как часть родительской папки — updateMappingAfterMoveFolder уже обновил
    // её путь, и oldPath в маппинге больше нет.
    const folderMappingAtNew=this.mappingManager.getMappingByLocalPath(folder.path);
    if (folderMappingAtNew && !this.mappingManager.getMappingByLocalPath(oldPath)){
      this.logger.log('moveFolder: папка уже перемещена в составе родителя, пропускаем', 'INFO', {oldPath, newPath: folder.path});
      return;
    }
    let mapping=this.mappingManager.getMappingByLocalPath(oldPath);
    if (!mapping){//Обработка ошибки отсутствия карты
      // Fallback на bitrixMap есть, только если он явно засеян (bulk-операции).
      // В event-driven flow его нет — просто создаём папку.
      const bitrixMapping=this?.bitrixMap?.map?.find(el=>el.path===oldPath);
      if (!bitrixMapping){
        await this.createFolder(folder);
        return;
      }
      else{
        mapping=this.mappingManager.getById(bitrixMapping.id);
        if (!mapping){
          this.mappingManager.add({
            id:bitrixMapping.id,
            path:folder.path,
            name:folder.name,
            isFolder:true,
            lastUpdatBitrix:bitrixMapping.lastUpdate,
            lastLocalMtime:new Date().getTime()
          });
          return;
        }
      }
    }

    const pathParent=folder.parent?.path||'/';
    const oldParentPath=mapping.path.split('/').slice(0, -1).join('/');
    if (oldParentPath!==pathParent){
      const newParent=this.mappingManager.getMappingByLocalPath(pathParent);
      if (!newParent){
        this.logger.log('moveFolder: не нашёл новую родительскую папку в маппинге', 'ERROR', {folder: folder.path, oldParentPath, pathParent});
        new Notice(`Ошибка перемещения папки. Не нашёл папку в ${pathParent} в битриксе`);
        return;
      }
      const result=await this.bitrixApi.callMethod('disk.folder.moveto', {id:mapping.id, targetFolderId:newParent.id});
      if (!result.error()){
        this.mappingManager.set(mapping.id,{
          name:folder.name,
          path:folder.path,
          lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        });
      }
    }

    if (mapping.name!==folder.name){
      const result=await this.bitrixApi.callMethod('disk.folder.rename', {id:mapping.id, newName:folder.name});
      this.mappingManager.set(mapping.id,{
        name:folder.name,
        path:folder.path,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
      });
    }

    this.mappingManager.updateMappingAfterMoveFolder(oldPath, folder.path);
  }

  async moveFile(fileAbstract:TAbstractFile, oldPath:string){
    const file=this.vault.getFileByPath(fileAbstract.path);
    if (!file) {
      const msg='Не могу найти файл по пути '+ fileAbstract.path;
      this.logger.log(msg, 'ERROR', {oldPath, newPath: fileAbstract.path});
      new Notice(msg);
      return;
    }
    // Если родительская папка была переименована/перемещена раньше нас,
    // updateMappingAfterMoveFolder уже сдвинул маппинг ребёнка на новый путь.
    // В этом случае ничего делать не нужно — Битрикс уже передвинул файл вместе с папкой.
    const mappingAtNewPath=this.mappingManager.getMappingByLocalPath(file.path);
    if (mappingAtNewPath && !this.mappingManager.getMappingByLocalPath(oldPath)){
      this.logger.log('moveFile: файл уже перемещён в составе родительской папки, пропускаем', 'INFO', {oldPath, newPath: file.path});
      return;
    }
    const mapping=this.mappingManager.getMappingByLocalPath(oldPath);
    if (!mapping){//Обработка ошибки отсутствия карты
      const bitrixMapping=(this?.bitrixMap?.map||[]).find(el=>el.path===oldPath);
      if (!bitrixMapping){
        this.logger.log('moveFile: ни маппинга по oldPath, ни по newPath — создаём', 'WARN', {oldPath, newPath: file.path});
        await this.createFile(file);
      }
      else{
        this.mappingManager.add({
          id:bitrixMapping.id,
          path:file.path,
          name:file.name,
          isFolder:false,
          lastUpdatBitrix:bitrixMapping.lastUpdate,
          lastLocalMtime:file.stat.mtime
          });
      }
      return;
    }

    const pathParent=file.parent?.path||'/';
    const oldParentPath=mapping.path.split('/').slice(0, -1).join('/');
    if (oldParentPath!==pathParent){
      const newParent=this.mappingManager.getMappingByLocalPath(pathParent);
      if (!newParent){
        this.logger.log('moveFile: не нашёл новую родительскую папку в маппинге', 'ERROR', {file: file.path, oldParentPath, pathParent});
        new Notice(`Ошибка перемещения файла. Не нашёл папку в ${pathParent} в битриксе`);
        return;
      }
      const result=await this.bitrixApi.callMethod('disk.file.moveto', {id:mapping.id, targetFolderId:newParent.id});
      if (!result.error()){
        this.mappingManager.set(mapping.id, {
          name:file.name,
          path:file.path,
          lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        })
      }
    }

    if (mapping.name!==file.name){
      const result=await this.bitrixApi.callMethod('disk.file.rename', {id:mapping.id, newName:file.name});
      if (result.error()){
        const err=result.error();
        this.logger.log('Ошибка переименования файла в Битрикс', 'ERROR', {file: file.path, oldName: mapping.name, newName: file.name, error: err});
        new Notice(`Ошибка переименования файла. ${err}`);
        return;
      }
      this.mappingManager.set(mapping.id,{
        name:file.name,
        path:file.path,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
      });
    }
  }

  /**
   * Получает строку base64 для файла
   */
  async getFileAsBase64(vault: Vault, file: TFile): Promise<string> {
    try {
      const arrayBuffer = await vault.readBinary(file);
      const base64 = this.arrayBufferToBase64(arrayBuffer);
      return base64;
    } catch (error) {
      this.logger.log(`Error getting base64 for file ${file.path}:`, 'ERROR', error);
      throw error;
    }
  }

  /**
   * Конвертирует ArrayBuffer в строку base64
   */
  arrayBufferToBase64(buffer: ArrayBuffer| Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}