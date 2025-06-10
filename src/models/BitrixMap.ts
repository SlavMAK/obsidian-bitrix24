import { normalizePath, Notice } from "obsidian";
import { BatchHelper } from "src/api/BatchHelper";
import { Bitrix24Api } from "src/api/bitrix24-api";
import { CallResult } from "src/api/callResult";
import { BitrixDiskFile, BitrixDiskFolder } from "src/types/bitrix-disk";
import { FileMapping } from "./MappingManager";

export type BitrixMapElement = {
  id:string,
  path:string,
  name:string,
  isFolder:boolean,
  bitrixUrl:string,
  lastUpdate:number
}
export class BitrixMap{
  public map:BitrixMapElement[]=[];

  constructor(public bitrixApi:Bitrix24Api){}

  public clearMap(){
    this.map=[];
  }

  public getMap():BitrixMapElement[]{
    return this.map;
  }

  public addToMap(map:BitrixMapElement){
    this.map.push(map);
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
      const batchHelperMore50=new BatchHelper();
      for (const request in totalRess){
        const res=totalRess[request] as CallResult;
        if (res.error()){
          new Notice('Ошибка при синхронизации с битрикс24: '+res.error(),0);
        }
        if (res.total()>50){
          batchHelperMore50.getBatchForLength(res.query.method, request, res.total(), res.query.data); 
        }
        else{
          this.fillMappingByresult(res.data());
          folders.push(...res.data().filter((el:BitrixDiskFolder)=>el.TYPE==='folder').map((el:BitrixDiskFolder)=>({
            folderId:el.ID,
            folderName:el.NAME
          })));
        }
      }

      if (batchHelperMore50.getArrBatches().length>0){
        const totalBatch=await batchHelperMore50.runAll(this.bitrixApi);
        for (const request in totalBatch){
          const res=totalBatch[request] as CallResult;
          if (totalBatch[request].error()){
            new Notice('Ошибка при синхронизации с битрикс24: '+res.error(),0);
          }
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
      new Notice('Ошибка получения карты файлов из Битрикс24: ' + error, 0);
    }
  }

  fillMappingByresult(records:(BitrixDiskFile|BitrixDiskFolder)[]){
    for (const record of records) {
      const fileFolderId = record.PARENT_ID;
      const parent=this.map.find(el=>el.id===fileFolderId);
      let parentPath='';
      if (parent) parentPath=normalizePath(parent.path);
      this.map.push({
        bitrixUrl:(record as BitrixDiskFile)?.DOWNLOAD_URL,
        id:record.ID,
        isFolder:record?.TYPE==='file'?false:true,
        name:record.NAME,
        lastUpdate:new Date(record.UPDATE_TIME).getTime()||0,
        path:normalizePath(parentPath+'/'+record.NAME),
      });
    }
  }

  async getFileByMapId(id:string, mapping:FileMapping[]):Promise<BitrixMapElement|undefined>{
    const res=await this.bitrixApi.callMethod('disk.file.get', {id});
    if (res.error()) return undefined;
    const parent=mapping.find(el=>el.id===res.data().PARENT_ID);
    if (!parent){
      new Notice(`Ошибка синхронизации файла, не нашёл папку в которой он находится. Папка с id ${res.data().PARENT_NAME} не найдена`);
      return undefined;
    }
    return {
      bitrixUrl:res.data().DOWNLOAD_URL,
      id:res.data().ID,
      isFolder:false,
      name:res.data().NAME,
      lastUpdate:new Date(res.data().UPDATE_TIME).getTime()||0,
      path:normalizePath(parent.path+'/'+res.data().NAME),
    }
  }

  async getFolderByMapId(id:string, mapping:FileMapping[]):Promise<BitrixMapElement|undefined>{
    const res=await this.bitrixApi.callMethod('disk.folder.get', {id});
    if (res.error()) return undefined;
    const parent=mapping.find(el=>el.id===res.data().PARENT_ID);
    if (!parent){
      new Notice(`Ошибка синхронизации папки, не нашёл папку в которой он находится. Папка с id ${res.data().PARENT_NAME} не найдена`);
      return undefined;
    }
    return {
      bitrixUrl:res.data().DOWNLOAD_URL,
      id:res.data().ID,
      isFolder:false,
      name:res.data().NAME,
      lastUpdate:new Date(res.data().UPDATE_TIME).getTime()||0,
      path:normalizePath(parent.path+'/'+res.data().NAME),
    }
  }
}