import { normalizePath, Vault } from 'obsidian';
import pino from 'pino';
import { inspect } from 'util';

export class Logger {
  private logFilePath: string;
  private logDir: string;
  private vault: Vault;
  private pinoLogger: pino.Logger
  private inited:boolean;

  constructor(vault: Vault, ) {
    this.vault = vault;
    this.logFilePath = 'sync-log.txt';
    this.logDir='.obsidian/logs/'
    this.pinoLogger=pino({
      level:'debug',
      browser:{write:((o:{time:number, level:number, msg:string})=>{
        if (!this.inited) return;
        const logMessage = `${new Date(o.time).toLocaleString()} [${o.level}]:: ${o.msg}:\n`;
        this.vault.adapter.append(normalizePath(this.logDir+this.logFilePath), logMessage);
      })
    }});
    this.init();
  }

  async init(){
    try {
      const  existFolder=await this.vault.adapter.exists(this.logDir);
      if (!existFolder){
        await this.vault.adapter.mkdir(this.logDir);
      }

      const existFile=await this.vault.adapter.exists(this.logDir+this.logFilePath);
      if (!existFile){
        await this.vault.adapter.write(this.logDir+this.logFilePath, "");
      }
      this.vault.adapter.append(normalizePath(this.logDir+this.logFilePath), "=============================================\n");
      this.vault.adapter.append(normalizePath(this.logDir+this.logFilePath), "===================APP RESTARTED=============\n");
      this.vault.adapter.append(normalizePath(this.logDir+this.logFilePath), "=============================================\n");
      this.inited=true;
    } catch (error) {
      console.error(error);
    }
  }

  async log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', otherParams: any = {}) {
    // const timestamp = new Date().toLocaleDateString();
    const messageToLog=message+'\n'+inspect(otherParams, {depth:3})+"\n";
    switch(level){
      case 'INFO':
        this.pinoLogger.info(messageToLog);
        break;
      case 'WARN':
        this.pinoLogger.warn(messageToLog);
        break;
      case 'ERROR':
        this.pinoLogger.error(messageToLog);
        break;
      default:{
        this.pinoLogger.debug(messageToLog);
      }
    }
  }
}
