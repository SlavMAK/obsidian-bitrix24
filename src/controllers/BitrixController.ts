import { TFile, TFolder, Vault } from "obsidian";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { BitrixMap } from "src/models/BitrixMap";
import { MappingManager } from "src/models/MappingManager";
import { BitrixDiskFile } from "src/types/bitrix-disk";

export const ACTION={
  CREATE_FILE:'createFileInBitrix',
  UPDATE_FILE:'updateFileInBitrix',
  CREATE_FOLDER:'createFolderInBitrix',
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
        bitrixUrl:'',
        lastUpdatBitrix:new Date(result.data().UPDATE_TIME).getTime(),
        lastLocalMtime:new Date().getTime(),
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
        lastLocalMtime: file.stat.ctime,
        bitrixUrl:(result.data() as BitrixDiskFile)?.DOWNLOAD_URL
      })
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
  arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}