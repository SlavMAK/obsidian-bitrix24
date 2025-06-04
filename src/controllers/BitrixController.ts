import { Notice, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";

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

  bitrixMap:BitrixMap;

  constructor(
    private mappingManager:MappingManager,
    private bitrixApi:Bitrix24Api,
    private vault:Vault
  ){}

  setBitrixMap(map:BitrixMap){
    this.bitrixMap=map;
  }

  async createFolder(folder:TFolder){
    const parent=this.bitrixMap.map.find(el=>el.path===folder.parent?.path);
    if (!parent){
      console.log('Не нашёл родителя для папки ', folder.path);
      return;
    }
    const result=await this.bitrixApi.callMethod('disk.folder.addsubfolder', {
      id:parent.id,
      data:{
        NAME:folder?.name||''
      }
    });
    if (!result.error()){
      this.mappingManager.add({
        id:result.data().ID,
        path:folder.path,
        name:folder.name,
        isFolder:true,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        lastLocalMtime:new Date().getTime()
      });
    }
  }

  async createFile(file:TFile){
    const base64File=await this.getFileAsBase64(this.vault, file);
    const parent=this.mappingManager.getMappingByLocalPath(file.parent?.path||"/");
    if (!parent){
      console.log('Не нашёл родителя для папки ', file.path||'');
      return
    }
    const result=await this.bitrixApi.callMethod('disk.folder.uploadfile', {
      id:parent.id,
      data: {
          NAME: file.name
      },
      fileContent:[file.name, base64File]
    });
    if (!result.error){
      this.mappingManager.add({
        id:result.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        lastLocalMtime: file.stat.ctime
      })
    }
  }

  async updateFile(file:TFile, bitrixMap:BitrixMapElement){
    const findedFile=this.vault.getFileByPath(file.path);
    if (!findedFile){
      new Notice('Не могу найти файл по пути '+file.path);
      return;
    }
    const base64File=await this.getFileAsBase64(this.vault, findedFile);
    const result=await this.bitrixApi.callMethod('disk.file.uploadversion', {id:bitrixMap.id, fileContent:[bitrixMap.name, base64File]});
    if (result.error()){
      new Notice('Ошибка при обработке файла '+result.error());
      return;
    }
    const mapping=this.mappingManager.getById(bitrixMap.id);
    if (mapping){
      this.mappingManager.set(bitrixMap.id, {
        lastLocalMtime:file.stat.mtime,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
      });
    }
    else{
      this.mappingManager.add({
        id:result.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        lastLocalMtime:file.stat.mtime
      });
    }
  }

  async updateFileByContent(file:BitrixMapElement, content:string){
    const base64File=this.arrayBufferToBase64(new TextEncoder().encode(content));
    const result=await this.bitrixApi.callMethod('disk.file.uploadversion', {id:file.id, fileContent:[file.name, base64File]});
    if (result.error()){
      new Notice('Ошибка при обработке файла '+result.error());
      return;
    }
    const mapping=this.mappingManager.getById(file.id);
    if (mapping){
      this.mappingManager.set(file.id, {
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime()
      });
    }
    else{
      this.mappingManager.add({
        id:result.data().ID,
        path:file.path,
        name:file.name,
        isFolder:false,
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        lastLocalMtime:new Date().getTime()
      });
    }
  }

  async moveFolder(folderAbstract:TAbstractFile, oldPath:string){
    const folder=this.vault.getFolderByPath(folderAbstract.path);
    if (!folder) {
      new Notice('Не могу найти папку по пути '+ folderAbstract.path);
      return;
    }
    const mapping=this.mappingManager.getMappingByLocalPath(oldPath);
    if (!mapping){//Обработка ошибки отсутствия карты
      const bitrixMapping=this.bitrixMap.map.find(el=>el.path===oldPath);
      if (!bitrixMapping){
        await this.createFolder(folder);
      }
      else{
        this.mappingManager.add({
          id:bitrixMapping.id,
          path:folder.path,
          name:folder.name,
          isFolder:true,
          lastUpdatBitrix:bitrixMapping.lastUpdate,
          lastLocalMtime:bitrixMapping.lastUpdate
        });
      }
      return;
    }

    const pathParent=folder.parent?.path||'/';
    const oldParentPath=mapping.path.split('/').slice(0, -1).join('/');
    if (oldParentPath!==pathParent){
      const newParent=this.bitrixMap.map.find(el=>el.path===pathParent);
      if (!newParent){
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
      new Notice('Не могу найти файл по пути '+ fileAbstract.path);
      return;
    }
    const mapping=this.mappingManager.getMappingByLocalPath(oldPath);
    if (!mapping){//Обработка ошибки отсутствия карты
      const bitrixMapping=this.bitrixMap.map.find(el=>el.path===oldPath);
      if (!bitrixMapping){
        await this.createFile(file);
      }
      else{
        this.mappingManager.add({
          id:bitrixMapping.id,
          path:file.path,
          name:file.name,
          isFolder:false,
          lastUpdatBitrix:bitrixMapping.lastUpdate,
          lastLocalMtime:bitrixMapping.lastUpdate
          });
      }
      return;
    }

    const pathParent=file.parent?.path||'/';
    const oldParentPath=mapping.path.split('/').slice(0, -1).join('/');
    if (oldParentPath!==pathParent){
      const newParent=this.bitrixMap.map.find(el=>el.path===pathParent);
      if (!newParent){
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
        new Notice(`Ошибка переименования файла. ${result.error()}`);
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
      console.error(`Error getting base64 for file ${file.path}:`, error);
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