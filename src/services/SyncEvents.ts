/**
 * Дискриминированный union событий, проходящих через единую EventQueue.
 *
 * Конвенция dedupKey:
 *  - local:<path>          — для local:create / modify / delete (последнее побеждает на пути).
 *  - local:<newPath>       — для local:rename (rename → modify на новом пути коалесцируется).
 *  - bitrix:<bitrixId>     — для всех bitrix:* событий.
 *
 * Семантика «один путь — один dedupKey» намеренная: delete-после-create на одном пути
 * схлопывается в последний пришедший event.
 */
export type SyncEvent =
  | { kind: 'local:create'; dedupKey: string; path: string; isFolder: boolean }
  | { kind: 'local:modify'; dedupKey: string; path: string }
  | { kind: 'local:rename'; dedupKey: string; oldPath: string; newPath: string; isFolder: boolean }
  | { kind: 'local:delete'; dedupKey: string; path: string; isFolder: boolean }
  | { kind: 'bitrix:create'; dedupKey: string; bitrixId: string; path: string; isFolder: boolean }
  | { kind: 'bitrix:update'; dedupKey: string; bitrixId: string; path: string }
  | { kind: 'bitrix:rename'; dedupKey: string; bitrixId: string; newPath: string; isFolder: boolean }
  | { kind: 'bitrix:delete'; dedupKey: string; bitrixId: string; path: string; isFolder: boolean };

/**
 * Универсальный билдёр dedupKey.
 *  - 'local'  → ключ строится по пути (новому в случае rename — см. конвенцию выше).
 *  - 'bitrix' → ключ строится по id записи в Битриксе.
 */
export function dedupKeyFor(side: 'local' | 'bitrix', idOrPath: string): string {
  return `${side}:${idOrPath}`;
}
