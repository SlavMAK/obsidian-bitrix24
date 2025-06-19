import { Notice, request } from "obsidian";
import { BitrixAuthType } from "src/types/bitrixAuthType";
import { CallResult } from "./callResult";
import { batchCmdElement } from "src/types/batchElement";

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export class Bitrix24Api {
    refreshToken:string;
    accessToken:string;
    expiresIn:number;
    clientEndpoint:string;
    clientId:string;
    clientSecret:string;
    webSocketClient:WebSocket|undefined;
    cbOnRequest?:(params:{refreshToken:string, accessToken:string, expiresIn:number})=>void

    
    constructor(auth:BitrixAuthType, cb?:(params:{refreshToken:string, accessToken:string, expiresIn:number})=>void){
        this.refreshToken = auth.refresh_token;
        this.accessToken = auth.access_token;
        this.expiresIn = auth.expires_in;
        this.clientId = auth.client_id;
        this.clientSecret = auth.client_secret;
        this.clientEndpoint = auth.client_endpoint;
        this.cbOnRequest=cb;
    }

    async makeRequest<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
      try {
          const requestOptions: any = {
            url: url,
            method: options.method || 'GET',
            headers: {
              ...options.headers
            }
          };
          
          // Добавляем Content-Type для запросов с телом, если не указан
          if (options.body && !requestOptions.headers['Content-Type']) {
            requestOptions.headers['Content-Type'] = 'application/json';
          }
          
          // Добавляем body для не-GET запросов
          if (options.method !== 'GET' && options.body) {
            requestOptions.body = typeof options.body === 'string' 
              ? options.body 
              : JSON.stringify(options.body);
          }
          
          // Добавляем таймаут если указан
          if (options.timeout) {
            requestOptions.timeout = options.timeout;
          }
          
          const response = await request(requestOptions);
          
          try {
            return JSON.parse(response) as T;
          } catch (e) {
            // Если ответ не в формате JSON, возвращаем как есть
            return response as unknown as T;
          }
      } catch (error) {
        console.error('Error in HTTP request:', error, {
          url,
          options
        });
        throw error;
      }
    }

    async callMethod(method:string, params:any={}){
      if (this.expiresIn<(new Date().getTime()/1000+300)){
        await this.requestToKen();
      }
      const url=`${this.clientEndpoint}${method}?auth=${this.accessToken}`;
      try {
        const response=await this.makeRequest<any>(url,{method:'POST',body:params});
        if (response?.error){
          return new CallResult({error_description:String(response?.error)}, {
              data:params,
              method
          },this, 500);
        }
        return new CallResult(response, {
          method,
          data:params,
        }, this, 200);
      } catch (error) {
        return new CallResult({error_description:String(error)}, {
            data:params,
            method
        },this, 500);
      }
    }
    
    getHttpString(value:any, prefix=''):string{
      if (value instanceof Date){
          return prefix+'='+encodeURIComponent(value.toISOString());
      }
      else if (typeof value=='object'){
          const resultObj=[];
          for (const field in value){
              resultObj.push(this.getHttpString(value[field], prefix+`${prefix!=''?'[':""}${field}${prefix!=''?']':''}`));
          }
          return resultObj.join('&');
      }
      else if (prefix!=''){
          return encodeURIComponent(prefix)+'='+encodeURIComponent(value);
      }
      return encodeURIComponent(value);
  }

    async callBatch<T extends batchCmdElement>(cmd:T, haltOnError?:boolean):Promise<{[key in keyof T]:CallResult}>
    async callBatch<T extends batchCmdElement>(
        cmd:T,
        haltOnError=false
    ):Promise<{[key in keyof T]:CallResult}>{
      if (this.expiresIn<(new Date().getTime()/1000+300)){
        await this.requestToKen();
      }
      const comands:Partial<{
          [key in keyof T]:string
      }>={};
      let cnt=0;
      
      for(const idx in cmd){
        const row=cmd[idx];
        const method=Array.isArray(row)?row[0]:row.method;
        const params=Array.isArray(row)?row[1]:row.params;

        if(method)
        {
            cnt++;
            comands[idx] = `${method}?${this.getHttpString(params)}`;
        }
      }

      if (cnt>0){
      const url=`${this.clientEndpoint}batch.json?auth=${this.accessToken}`;
      const params={
        cmd:comands as {
          [key in keyof T]:string
        },
        halt:haltOnError?1:0
      };
        const tempRes=await this.makeRequest(url, {method:'POST', body:params});
        return this.formatResultForBatch(new CallResult(tempRes, {
          data:params,
          method:'batch',
        }, this, 200), cmd);
        
      }
      return {} as {[key in keyof T]:CallResult};
    }

    formatResultForBatch<T extends CallResult, R extends batchCmdElement>(
      res:T, 
      calls:R,
      callback?:(params:any)=>void)
      :{[key in keyof R]:CallResult}
    {
        const data = res.data();

        const result:Partial<{[key in keyof R]:CallResult}>={};
        for(const idx in calls){
            const cmd=calls[idx];
            if (data?.result?.[idx]!==undefined|| data?.result_error?.[idx]!==undefined){
                result[idx]=new CallResult({
                    result: data.result?.[idx]||{},
                    error:data.result_error[idx]||undefined,
                    total:data.result_total[idx],
                    time:data.result_time[idx],
                    next: data.result_next[idx]
                }, {
                    method:Array.isArray(cmd)?cmd[0]:cmd?.method,
                    data: Array.isArray(cmd)?cmd[1]:cmd?.params,
                    callback:callback
                }, this, res.status)
            }
            else{
                result[idx]={
                    data:()=>({}),
                    total:()=>0,
                    error_description:()=>JSON.stringify(res),
                    answer:data?.result?.[idx],
                    query: {
                        method:Array.isArray(cmd)?cmd[0]:cmd?.method,
                        data: Array.isArray(cmd)?cmd[1]:cmd?.params,
                        callback:callback
                    },
                    bx24:this,
                    time:()=>({}),
                    status:res.status,
                    more:()=>false,
                    error:()=>JSON.stringify(res)
                };
            }
        }
        
        return result as { [key in keyof R]: CallResult; };
    }

    async requestToKen(){
        if (!this.refreshToken) return;
        const oauthBitrixUrl='https://oauth.bitrix.info/oauth/token?';
        const data = new URLSearchParams();
        data.append('client_id', this.clientId);
        data.append('client_secret', this.clientSecret);
        data.append('grant_type', 'refresh_token');
        data.append('refresh_token', this.refreshToken);
        try {
            const response = await this.makeRequest(oauthBitrixUrl+data.toString(), {method:'GET'});
            if (typeof response !== 'object') {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.accessToken = response.access_token;
            this.refreshToken = response.refresh_token;
            this.expiresIn = response.expires_in;
            this.clientEndpoint = response.client_endpoint;
            return this;
        } catch (error) {
            console.error('Error fetching token from oauth.bitrix.info:', error);
        }
    }

    async webSocketDisconnect(){
      if (!this.webSocketClient) return;
      this.webSocketClient.close();
      this.webSocketClient=undefined;
    }

    async getWebSocketClient(){
      try {
        const result=await this.callMethod('pull.application.config.get', {});
        if (result.error()){
          new Notice(`Ошибка получения конфигурации websocket от Bitrix24: ${result.error_description()}`);
          return;
        }
        const sharedChanel=result.data()?.channels?.shared;
        const server=result.data()?.server;
        if (!sharedChanel||!server){
          new Notice(`Ошибка получения конфигурации websocket от Bitrix24: ${JSON.stringify(result.data())}`);
          return;
        }
        let urlConnection=`${server.websocket_secure}?CHANNEL_ID=${sharedChanel.id}`;
        if (server?.clientId){
          urlConnection+=`&clientId=${server.clientId}`;
        }
        this.webSocketClient = new WebSocket(urlConnection);
        this.webSocketClient.onopen = function(e) {
          console.log("[open] Соединение установлено");
        };

        return this.webSocketClient;
      } catch (error) {
        new Notice(`Ошибка получения конфигурации websocket от Bitrix24: ${String(error)}`);
      }
      
    }
}