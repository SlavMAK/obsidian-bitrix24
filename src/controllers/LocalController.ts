import { Vault } from "obsidian";
import { universalDownloadFile } from "src/helpers/universalDownloadFile";
import { BitrixMapElement } from "src/models/BitrixMap";

export const ACTION={
  CREATE_FILE:'createFileInLocal',
  UPDATE_FILE:'updateFileInLocal',
  CREATE_FOLDER:'createFolderInLocal',
  DELETE_FILE:'deleteFileInLocal',
  DELETE_FOLDER:'deleteFolderInLocal'
};


export class LocalController{
  constructor(
    private vault:Vault
  ){}

  public async createFolder(folder:BitrixMapElement){
    if (!(await this.vault.adapter.exists(folder.path))){
      await this.vault.createFolder(folder.path);
      console.log('Создал папку '+folder.path);
    }
  }


  public async createFile(file:BitrixMapElement){
    universalDownloadFile(
      this.vault,
      file.bitrixUrl,
      file.path,
      {},
      {mtime:file.lastUpdate}
    );
  }

}