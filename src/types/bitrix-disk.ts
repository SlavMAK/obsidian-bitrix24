// src/models/bitrix-disk.ts
export interface BitrixDiskFile {
  ID: string;
  NAME: string;
  CODE: string|null;
  STORAGE_ID: string;
  TYPE:"file",
  PARENT_ID:string,
  DELETED_TYPE:string,
  CREATE_TIME:string,
  UPDATE_TIME:string,
  DELETE_TIME:string|null
  CREATED_BY:string,
  UPDATED_BY:string,
  DELETED_BY:string|null,
  DETAIL_URL:string,
  DOWNLOAD_URL:string
}

export interface BitrixDiskFolder {
  ID: string;
  NAME: string;
  CODE: string|null;
  STORAGE_ID: string;
  TYPE:"folder",
  PARENT_ID:string,
  DELETED_TYPE:string,
  CREATE_TIME:string,
  UPDATE_TIME:string,
  DELETE_TIME:string|null
  CREATED_BY:string,
  UPDATED_BY:string,
  DELETED_BY:string|null,
  DETAIL_URL:string,
}