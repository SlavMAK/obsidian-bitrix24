import { Notice, TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { universalDownloadFile } from "src/helpers/universalDownloadFile";
import { BitrixMap, BitrixMapElement } from "src/models/BitrixMap";
import { FileMapping, MappingManager } from "src/models/MappingManager";

export const ACTION={
  CREATE_FILE:'createFileInLocal',
  CREATE_FOLDER:'createFolderInLocal',

  UPDATE_FILE:'updateFileInLocal',
  
  DELETE_FILE:'deleteFileInLocal',
  DELETE_FOLDER:'deleteFolderInLocal',

  MOVE_FILE:'moveFileInLocal',
  MOVE_FOLDER:'moveFolderInLocal'
};


export class LocalController{
  constructor(
    private vault:Vault,
    private mappingManager:MappingManager,
    private bitrixApi:Bitrix24Api
  ){}


  async parseEventWebSocket(event:{command:string, params:any}){
    const bitrixFileId=event.params.fileId;
    const bitrixMap=(new BitrixMap(this.bitrixApi)).getMap()
  }

  public async createFolder(folder:BitrixMapElement){
    if (!(await this.vault.adapter.exists(folder.path))){
      await this.vault.createFolder(folder.path);
      console.log('Создал папку '+folder.path);
      this.mappingManager.add({
        id:folder.id,
        name:folder.name,
        path:folder.path,
        isFolder:true,
        lastLocalMtime:new Date().getTime(),
        lastUpdatBitrix:folder.lastUpdate,
      });
    }
  }


  public async createFile(file:BitrixMapElement){
    await universalDownloadFile(
      this.vault,
      file.bitrixUrl,
      file.path,
      {},
      {mtime:file.lastUpdate}
    );
    const localFile=await this.vault.getFileByPath(file.path);
    if (!localFile){
      new Notice(`Не удалось создать файл ${file.name}`);
      return;
    }
    this.mappingManager.add({
      id:file.id,
      name:file.name,
      path:file.path,
      isFolder:false,
      lastLocalMtime:localFile.stat.mtime,
      lastUpdatBitrix:file.lastUpdate,
    });
  }

  public async updateFile(file:TFile, bitrixMap:BitrixMapElement){
    await universalDownloadFile(
      this.vault,
      bitrixMap.bitrixUrl,
      file.path,
      {},
      {mtime:bitrixMap.lastUpdate}
    );
    const mapping=this.mappingManager.getMappingByLocalPath(file.path);
    if (mapping){
      this.mappingManager.set(mapping.id, {
        lastUpdatBitrix:bitrixMap.lastUpdate,
      });
    }
    else{
      this.mappingManager.add({
        id:bitrixMap.id,
        name:bitrixMap.name,
        path:bitrixMap.path,
        isFolder:false,
        lastLocalMtime:file.stat.mtime,
        lastUpdatBitrix:bitrixMap.lastUpdate,
      });
    }
  }

  public async moveFolder(folder:TFolder, bitrixMap:BitrixMapElement, localMap:FileMapping){
    const oldPath=folder.path;
    if (!localMap){
      throw new Error('localMap not found and required '+folder.path);
    }
    await this.vault.rename(folder, bitrixMap.path);
    const abstractFile=this.vault.getAbstractFileByPath(bitrixMap.path);
    if (!abstractFile){
      throw new Error(`abstractFile not found by path ${bitrixMap.path}`);
    }
    localMap.path=bitrixMap.path;
    localMap.name=bitrixMap.name;
    localMap.lastUpdatBitrix=bitrixMap.lastUpdate;

    this.mappingManager.updateMappingAfterMoveFolder(oldPath, bitrixMap.path);
  }

  public async moveFile(file:TFile, bitrixMap:BitrixMapElement, localMap:FileMapping){
    await this.vault.rename(file, bitrixMap.path);
    if (!localMap) {
      throw new Error('mapping not found and required!');
    }
    const abstractFile=this.vault.getAbstractFileByPath(bitrixMap.path);
    if (!abstractFile){
      throw new Error(`abstractFile not found by path ${bitrixMap.path}`);
    }
    localMap.path=bitrixMap.path;
    localMap.name=abstractFile.name;
    localMap.lastUpdatBitrix=bitrixMap.lastUpdate;
  }

  public async updateFileByContent(file:TFile, content:string , time: number){
    console.log(time, new Date(time));
    await this.vault.adapter.write(file.path, content, {mtime:time});
    const localMap=this.mappingManager.getMappingByLocalPath(file.path);
    if (!localMap) return;
    this.mappingManager.set(localMap?.id, {
      lastLocalMtime:time,
    });
  }

  public async deleteFolder(folder:TFolder, localMap:FileMapping){
    await this.vault.trash(folder, false);
    const idxLocalMap=this.mappingManager.mappings.findIndex(el=>el.id===localMap.id);
    if (idxLocalMap===-1) return;
    this.mappingManager.mappings.splice(idxLocalMap,1);
  }

  public async deleteFile(file:TFile, localMap:FileMapping){
    await this.vault.trash(file, false);
    const idxLocalMap=this.mappingManager.mappings.findIndex(el=>el.id===localMap.id);
    if (idxLocalMap===-1) return;
    this.mappingManager.mappings.splice(idxLocalMap,1);
  }
}