import { Notice, TFile, Vault } from "obsidian";
import { universalDownloadFile } from "src/helpers/universalDownloadFile";
import { BitrixMapElement } from "src/models/BitrixMap";
import { FileMapping, MappingManager } from "src/models/MappingManager";

export const ACTION={
  CREATE_FILE:'createFileInLocal',
  UPDATE_FILE:'updateFileInLocal',
  CREATE_FOLDER:'createFolderInLocal',
  DELETE_FILE:'deleteFileInLocal',
  DELETE_FOLDER:'deleteFolderInLocal',
  MOVE_FILE:'moveFileInLocal',
};


export class LocalController{
  constructor(
    private vault:Vault,
    private mappingManager:MappingManager,
  ){}

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
        lastLocalMtime:bitrixMap.lastUpdate,
        lastUpdatBitrix:bitrixMap.lastUpdate,
      });
    }
    else{
      this.mappingManager.add({
        id:bitrixMap.id,
        name:bitrixMap.name,
        path:bitrixMap.path,
        isFolder:false,
        lastLocalMtime:bitrixMap.lastUpdate,
        lastUpdatBitrix:bitrixMap.lastUpdate,
      });
    }
  }

  public async moveFile(file:TFile, bitrixMap:BitrixMapElement, mapping:FileMapping){
    await this.vault.rename(file, bitrixMap.path);
    if (!mapping) {
      throw new Error('mapping not found and required!');
    }
    const abstractFile=this.vault.getAbstractFileByPath(bitrixMap.path);
    if (!abstractFile){
      throw new Error(`abstractFile not found by path ${bitrixMap.path}`);
    }
    mapping.path=bitrixMap.path;
    mapping.name=abstractFile.name;
    mapping.lastUpdatBitrix=bitrixMap.lastUpdate;
  }

  public async updateFileByContent(file:TFile, content:string , time: number){
    console.log(time, new Date(time));
    await this.vault.adapter.write(file.path, content, {mtime:time});
    const mapping=this.mappingManager.getMappingByLocalPath(file.path);
    if (!mapping) return;
    this.mappingManager.set(mapping?.id, {
      lastLocalMtime:time,
    });
  }
}