import { TFile, Vault } from "obsidian";

export async function fileHash(file: TFile, vault: Vault): Promise<string> {
    if (file.stat.size < 1024 * 1024) { // Меньше 1MB
      const buffer = await vault.readBinary(file);
      return crc32(buffer);
    }
    const buffer = await vault.readBinary(file);
    const partHash = partialHash(buffer);
    const metaStr = `${file.path}|${file.stat.size}|${file.stat.mtime}`;
    const metaHash = simpleHash(metaStr).toString(16);
    return `${partHash}-${metaHash}`;
}

function crc32(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const crcTable: number[] = [];
  let c: number;
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }
  crc = (crc ^ (-1)) >>> 0; // Конвертируем в беззнаковое число
  return crc.toString(16);
}

function partialHash(buffer: ArrayBuffer, maxBytes = 10240): string {
  const data = new Uint8Array(buffer);
  let result = 0;
  const chunkSize = Math.min(Math.floor(maxBytes / 3), data.length / 3);
  for (let i = 0; i < chunkSize; i++) {
    result = ((result << 5) - result) + data[i];
  }
  if (data.length > chunkSize * 2) {
    const midStart = Math.floor(data.length / 2) - Math.floor(chunkSize / 2);
    for (let i = 0; i < chunkSize; i++) {
      result = ((result << 5) - result) + data[midStart + i];
    }
  }
  if (data.length > chunkSize) {
    const endStart = data.length - chunkSize;
    for (let i = 0; i < chunkSize; i++) {
      result = ((result << 5) - result) + data[endStart + i];
    }
  }
  result = ((result << 5) - result) + data.length;
  return result.toString(16);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Преобразует в 32-битное целое
  }
  return hash >>> 0; // Преобразует в беззнаковое число
}