# План: переход на событийную модель + команды массового импорта/экспорта

**Дата:** 2026-06-16
**Контекст:** Bitrix24 Sync (Obsidian-плагин)
**Master-система:** Bitrix24
**Принцип:** заменить периодическое сравнение сущностей событиями; добавить две явные команды массового обмена.

---

## Решения пользователя (подтверждены)

| Развилка | Выбор |
|---|---|
| Конфликт двусторонних правок | Оставляем существующую модалку выбора (`ConflictResolutionModal`) |
| Команда «Выгрузить всё в Битрикс24» с лишними удалёнными | Спрашивать перед удалением каждого «лишнего» (список с чекбоксами) |
| Команда «Загрузить всё из Битрикс24» с лишними локальными | Спрашивать перед удалением каждого «лишнего» (список с чекбоксами) |
| Поведение при недоступности WS (например, Obsidian был закрыт) | При старте — подтянуть изменения из Битрикса; по каждому удалению спрашивать |

---

## 1. Обзор текущей реализации

### Что работает
- OAuth + автообновление токена — `src/api/bitrix24-api.ts:212`.
- Батчинг до 50 вызовов в одном запросе — `src/api/BatchHelper.ts`.
- WebSocket-канал от Битрикса (`pull.application.config.get`) с парсингом конверта `#!NGINXNMS!#…`.
- Локальные vault-события `rename` / `modify` / `delete` — `main.ts:69`.
- Конфликт-модалка с диффом для md — `src/ui/ConflictResolutionModal.ts`, `src/ui/DiffViewModal.ts`.
- Маппинг локальный путь ↔ ID файла в Битриксе персистится через `data.json`.

### Где смешаны модели (ради чего идёт рефакторинг)

| Слой | Что делает сегодня | Проблема |
|---|---|---|
| `main.ts:227 addPeriodicSync` + `syncWithBitrix` | Каждые N минут строит `BitrixMap` рекурсивным обходом, потом сравнивает с vault + маппингом | Сравнение сущностей — уходит. Дорогая операция, конкурирует с локальными событиями. |
| `SyncService.checkLocalFile/checkBitrixFile/checkLocalFolder/checkBitrixFolder` | Решают action на основе сравнения trio (localFile, localMapping, bitrixMapping) | Это «диффер», а не обработчик событий. Уезжает из горячего пути в команды массового обмена. |
| `LocalEventController` | На каждое локальное событие лезет в Битрикс за `getFileByMapId` и строит `BitrixMap`, чтобы потом отдать в `checkLocalFile` | Лишний REST round-trip на каждое локальное изменение. После перехода — не нужно. |
| `SyncService.parseEventWebSocket` | На каждое WS-событие создаёт `new BitrixMap()`, дёргает `getFileByMapId`, идёт в `checkLocalFile/checkBitrixFile` | Тот же паттерн «событие → сравнение». Должно стать «событие → прямой applier». |
| WS-команды | `FILE_CREATE/UPDATE/DELETE`, `FOLDER_*` рассылаются самим плагином через `pull.application.event.add`; чужие клиенты различаются по `clientWebsocketId` | Самодельный протокол: правки из web-UI Битрикса напрямую такого события могут не дать. Нативные Bitrix Disk pull-команды (`disk_folder`/`disk_file`) — отдельная подписка (см. A7). |

### Найденные риски

- 🔴 **C1.** `clientId` / `clientSecret` хардкодом в `main.ts:13` — оба попадают в `main.js` бандл.
- 🟠 **H1.** `create`-handler в `main.ts:114` закомментирован — новые файлы синкаются только массовым циклом, который удаляется.
- 🟠 **H3.** Гонки: одно глобальное `isSyncing` + локальные события без очереди/дебаунса. После перехода на полностью событийную модель — это горячий путь, single-flight + очередь обязательны.
- 🟠 **H4.** Тихие сбои refresh-token — `bitrix24-api.ts:230` (`console.error` без Notice, без прерывания цикла).
- 🟡 **M1.** `MappingManager.mappings` публичное мутабельное поле; вне `add/set/getById` мутируется напрямую (`SyncService.ts:127`, `BitrixController.ts:147`, и др.).
- 🟡 **H5.** Модалка конфликта блокирует pump очереди (`SyncService.processFileQueue` ждёт `await this.resolveConflict`).

---

## 2. План изменений

### Слой A. Переход на события (Bitrix-master)

#### A1. Очередь и single-flight для событий (фундамент)
- Новый класс `EventQueue` (файл `src/services/EventQueue.ts`).
- FIFO с дедупликацией по `{type, path|id}`: последнее `modify` побеждает; `rename` → `modify` коалесцируется в одно.
- Pump очереди — единственный воркёр (`isProcessing` мьютекс).
- При падении обработчика — лог + `Notice`, очередь не останавливается.
- Локальные события и WS-события — два продьюсера, очередь общая.
- Интеграция: `SyncService` владеет очередью; `LocalEventController` + WS-handler пишут в неё.

#### A2. Прямые appliers вместо `checkLocal*` / `checkBitrix*`
**Локальные события → Bitrix:**
- `local:create:file` → `BitrixController.createFile` (без проверки `bitrixMapping`).
- `local:modify:file` → `BitrixController.updateFile` (если маппинг есть; если нет — `createFile`).
- `local:rename` → `BitrixController.moveFile` / `moveFolder` (если в маппинге другой путь).
- `local:delete` → `BitrixController.deleteFile` / `deleteFolder` (если есть маппинг).

**WS-события → Obsidian:**
- `FILE_CREATE` / `FOLDER_CREATE` → `LocalController.createFile` / `createFolder` (через `disk.file.get` для скачивания).
- `FILE_UPDATE` → `LocalController.updateFile` (скачать заново).
- `FILE_DELETE` / `FOLDER_DELETE` → `LocalController.deleteFile` / `deleteFolder` **с подтверждением** через единый `BulkDeleteConfirmModal` (можно с опцией «применять для всех на эту сессию»).
- `FILE_RENAME` / `FOLDER_RENAME` → `LocalController.moveFile` / `moveFolder`.

Методы `checkLocalFile` / `checkBitrixFile` / `checkLocalFolder` / `checkBitrixFolder` **переезжают** из горячего пути в `PushAllService` / `PullAllService` (см. слой B) и в `CatchUpService` (A6) — там сравнение оправдано.

#### A3. Конфликт только когда обе стороны изменились
- В `FileMapping` добавить `inflightOp: 'pushing' | 'pulling' | null`.
- Если локальный `modify` прилетел, а в маппинге `lastUpdatBitrix` уже новее (значит WS-апдейт прилетел между чтением и записью) → открываем `ConflictResolutionModal`.
- Модалка **не блокирует** очередь: помечаем элемент `pendingUser`, пропускаем дальше, при ответе пользователя — пушим отдельную задачу обратно в очередь.

#### A4. Восстановление `create`-handler
- В `main.ts:114` раскомментировать с дебаунсом.
- `.tmp` файлы Obsidian → отбрасываем.
- Игнор-список (`tempIgnoreFile`) уже есть — переиспользуем.

#### A5. Удалить периодическую полную синхронизацию
- `main.ts: addPeriodicSync` → удалить.
- `syncInterval` в настройках → удалить (или переименовать в `wsReconnectInterval`).
- Команду «Sync with Bitrix.Disk» (`main.ts:214`) → заменить на новые команды (см. слой B).

#### A6. Startup catch-up
WS-события за время простоя плагина потеряны; нужен догон.

При `onload()` после инициализации WS:
1. Достать `lastSync` из настроек.
2. Через `BitrixMap` собрать состояние нужной папки. Если Bitrix REST умеет фильтр по `UPDATE_TIME` — использовать; иначе полный обход (только для catch-up, не периодически).
3. Для каждого изменения с `lastUpdate > lastSync` применить через applier из A2.
4. Для удалений (файл есть в маппинге, нет в Битриксе) → `BulkDeleteConfirmModal` со списком и чекбоксами «удалить локально?».

Файл: `src/services/CatchUpService.ts`.

#### A7. Нативные Bitrix Disk pull-команды (опционально)
- Помимо собственного `pull.application.event.add` (`BitrixController` уже шлёт) — подписаться в `parseEventWebSocket` на нативные `disk_folder` / `disk_file` события, чтобы ловить правки из веб-UI Битрикса.
- Без этого: правки из web-UI Битрикса пользователь увидит только при следующем catch-up / рестарте.
- **Требуется подтверждение перед стартом** — берём в эту волну?

#### A8. Сопутствующие фиксы (без них слой A не стабилен)
- `MappingManager.mappings` → приватный; все мутации через `add/set/remove` + автосейв (debounced 1s).
- `requestToKen` (`bitrix24-api.ts:212`) → при ошибке `Notice` + остановка обработки очереди до повторного логина.
- `ConflictResolutionModal` — добавить таймаут / fallback по умолчанию (`keep-local` или сделать конфигурируемым; не блокирует переход, но желательно).

---

### Слой B. Команды массового импорта/экспорта

#### B1. Команда «Выгрузить всё в Битрикс24» (push-all)
Source of truth = локальный vault.

Алгоритм:
1. Построить полный `BitrixMap` (как сейчас в `syncWithBitrix`).
2. Пройти `vault.getAllLoadedFiles()`:
   - Если файла нет в Битриксе → `BitrixController.createFile` / `createFolder` (батчим через `BatchHelper`).
   - Если есть и `lastLocalMtime > lastUpdatBitrix` → `updateFile`.
3. Собрать «лишние» в Битриксе (есть в `BitrixMap`, нет локально) → открыть `BulkDeleteConfirmModal` со списком + чекбоксами.
4. Отмеченные удалить через `BitrixController.deleteFile/deleteFolder`.

Файл: `src/services/PushAllService.ts` (использует `BitrixController` + `BatchHelper`).

#### B2. Команда «Загрузить всё из Битрикс24» (pull-all)
Source of truth = Битрикс.

Симметрично B1:
1. Полный `BitrixMap`.
2. Для каждого файла в Битриксе:
   - Нет локально → `LocalController.createFile` / `createFolder`.
   - Есть и `lastUpdate > lastLocalMtime` → `updateFile`.
3. «Лишние» локально → `BulkDeleteConfirmModal` → удалить через `LocalController.deleteFile/deleteFolder` (через `vault.trash(...)`, чтобы можно было откатить).

Файл: `src/services/PullAllService.ts`.

#### B3. Модалка `BulkDeleteConfirmModal`
Новый компонент в `src/ui/`.

Содержимое:
- Список путей с чекбоксом на каждом.
- Кнопки «Выделить всё» / «Снять всё».
- Кнопки «Удалить отмеченное» / «Отмена».

Используется в трёх местах: catch-up (A6), push-all (B1), pull-all (B2). Резолвится промисом с массивом путей к удалению — единый API.

#### B4. Регистрация команд (`main.ts:212 addCommands`)
Заменить:
- старую `sync-with-bitrix-disk` → удалить (или оставить как алиас catch-up на первое время),
- добавить `push-all-to-bitrix` («Выгрузить всё в Битрикс24»),
- добавить `pull-all-from-bitrix` («Загрузить всё из Битрикс24»),
- старую `clear-mapping` оставить (полезна для отладки),
- добавить `catch-up-from-bitrix` («Догнать изменения из Битрикса») — ручной запуск catch-up из A6.

---

### Слой C (опционально, но рекомендуется в этой же серии)

#### C1. Вынести `clientSecret` из исходников
Поскольку мы и так трогаем `main.ts`, эта правка дешевле в той же серии: запрашивать секрет у пользователя в настройках или поставлять только через app-registration на портале (т.е. вообще убрать из бандла).

Без этого любой `main.js` из релиза = доступ от имени приложения.

**Требуется подтверждение** — берём сейчас или отдельной задачей?

#### C2. Тонкий тест-слой (Vitest)
На `MappingManager` round-trip, `EventQueue` дедупликацию, `PushAllService` / `PullAllService` против стаб-контроллеров.

---

## 3. Порядок исполнения

| # | Шаг | Зависимости |
|---|---|---|
| 1 | **A1** EventQueue + single-flight (фундамент) | — |
| 2 | **A8** MappingManager incapsulate + atomic save | предусловие для A2 |
| 3 | **A2** Прямые appliers + удаление comparison-веток из горячего пути | A1, A8 |
| 4 | **A4** Restore `create` event | A1, A2 |
| 5 | **A5** Удалить периодику | A1–A4 (иначе сломается синк) |
| 6 | **A6** Startup catch-up + **B3** BulkDeleteConfirmModal (модалка общая) | A2 |
| 7 | **B1** Push-all command | B3 |
| 8 | **B2** Pull-all command | B3 |
| 9 | **A3** Conflict path non-blocking | A1, A2 |
| 10 | **A7** Subscribe to native Bitrix pull events | A2 (после подтверждения) |
| 11 | **C1** Move clientSecret out of source | независимо |

Шаги 1–5 — логически связаны, один PR/коммит-серия (разделять = поломать). Шаги 6–8 — отдельные. C1 — отдельный коммит безопасности.

---

## 4. Файлы — что меняется

### Новые
- `src/services/EventQueue.ts` — A1
- `src/services/CatchUpService.ts` — A6
- `src/services/PushAllService.ts` — B1
- `src/services/PullAllService.ts` — B2
- `src/ui/BulkDeleteConfirmModal.ts` — B3

### Меняются существенно
- `main.ts` — A4 (restore create), A5 (удалить периодику), B4 (новые команды), C1 (опционально)
- `src/services/SyncService.ts` — A1, A2, A3 (удалить горячие comparison-ветки)
- `src/controllers/LocalEventController.ts` — A2 (упростить — просто пишем в EventQueue)
- `src/models/MappingManager.ts` — A8 (приватизация, автосейв)
- `src/api/bitrix24-api.ts` — A8 (refresh-token error → Notice + stop)
- `src/ui/ConflictResolutionModal.ts` — A3 (non-blocking semantics)

### Подсветка зависимостей в существующем коде
- Прямые обращения к `mappingManager.mappings.splice/find` — нужно переписать (A8):
  - `src/services/SyncService.ts:127`
  - `src/controllers/BitrixController.ts:147` (`deleteFile`)
  - `src/controllers/BitrixController.ts:170` (`deleteFolder`)
  - `src/controllers/LocalController.ts:139,146` (`deleteFolder/deleteFile`)

---

## 5. Что прошу подтвердить перед стартом

1. **A7** (нативные `disk_*` pull-события от Битрикса) — берём в эту волну или живём с тем, что правки из веб-UI Битрикса прилетают только при следующем catch-up / рестарте?
2. **C1** (вынос `clientSecret` из исходников) — делаем сейчас или отдельной задачей? Если сейчас: запрашивать у пользователя при первом входе, либо плагин остаётся только для одного зарегистрированного приложения на портале.
3. **A8 → MappingManager** — менять публичный API (приватизировать `mappings`, заменить прямые `mappings.splice/find` по коду) — правка ~5 файлов. Согласны на breaking-change в этой ветке?
4. **A7 / C1** взяли в текущий план как опциональные. Если оба «да» — добавить их в основной таблицу порядка.
