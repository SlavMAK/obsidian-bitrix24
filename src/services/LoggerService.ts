import { normalizePath, Notice, Vault } from 'obsidian';
import pino from 'pino';
import { inspect } from 'util';

export class Logger {
  private logFilePath: string;
  private logDir: string;
  private vault: Vault;
  private pinoLogger: pino.Logger;
  private inited = false;
  private initFailed = false;
  private buffer: string[] = [];
  private readonly maxBufferSize = 1000;

  constructor(vault: Vault) {
    this.vault = vault;
    this.logFilePath = 'sync-log.txt';
    this.logDir = '.obsidian/logs/';
    this.pinoLogger = pino({
      level: 'debug',
      browser: {
        write: ((o: { time: number; level: number; msg: string }) => {
          const logMessage = `${new Date(o.time).toLocaleString()} [${o.level}]:: ${o.msg}:\n`;
          if (this.inited) {
            this.appendToFile(logMessage);
            return;
          }
          // init didn't finish (or failed). Buffer until we know.
          if (this.initFailed) return;
          if (this.buffer.length < this.maxBufferSize) {
            this.buffer.push(logMessage);
          }
        }),
      },
    });
    this.init();
  }

  private appendToFile(text: string) {
    // Fire-and-forget, but surface failures so we don't drop logs silently.
    this.vault.adapter
      .append(normalizePath(this.logDir + this.logFilePath), text)
      .catch((error) => {
        console.error('[Bitrix24Sync Logger] append failed:', error, text);
      });
  }

  async init() {
    try {
      const existFolder = await this.vault.adapter.exists(this.logDir);
      if (!existFolder) {
        await this.vault.adapter.mkdir(this.logDir);
      }
      const existFile = await this.vault.adapter.exists(this.logDir + this.logFilePath);
      if (!existFile) {
        await this.vault.adapter.write(this.logDir + this.logFilePath, '');
      }
      await this.vault.adapter.append(
        normalizePath(this.logDir + this.logFilePath),
        '=============================================\n' +
          '===================APP RESTARTED=============\n' +
          '=============================================\n',
      );
      this.inited = true;
      // Drain anything that arrived before init completed.
      const pending = this.buffer.splice(0);
      for (const msg of pending) {
        this.appendToFile(msg);
      }
    } catch (error) {
      this.initFailed = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[Bitrix24Sync Logger] init failed — log file unavailable:', error);
      new Notice(
        `Не удалось открыть файл лога Bitrix24Sync (${this.logDir}${this.logFilePath}). ` +
          `Проверьте права доступа на файл. Логи будут только в DevTools console. ` +
          `Подробности: ${detail}`,
        0,
      );
      // Flush buffered messages to console so they're not lost on failure.
      for (const msg of this.buffer) {
        console.warn('[Bitrix24Sync log buffered]', msg);
      }
      this.buffer = [];
    }
  }

  async log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', otherParams: any = {}) {
    const messageToLog = message + '\n' + inspect(otherParams, { depth: 3 }) + '\n';
    switch (level) {
      case 'INFO':
        this.pinoLogger.info(messageToLog);
        break;
      case 'WARN':
        this.pinoLogger.warn(messageToLog);
        break;
      case 'ERROR':
        this.pinoLogger.error(messageToLog);
        // Safety net: ERROR is always visible in DevTools console, even if the
        // log file is unavailable. Keeps debugging viable when init fails.
        console.error('[Bitrix24Sync]', messageToLog);
        break;
      default: {
        this.pinoLogger.debug(messageToLog);
      }
    }
  }
}
