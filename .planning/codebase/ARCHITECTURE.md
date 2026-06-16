# Architecture

**Analysis Date:** 2026-06-16

## Pattern Overview

**Overall:** Obsidian Plugin with bidirectional sync engine

**Key Characteristics:**
- Event-driven on the Obsidian side (vault file events) and polling/periodic-pull on the Bitrix24 side
- Layered: UI (Settings/Modals) → Sync orchestration → Controllers → API/Persistence
- Stateful: file ID mappings persisted via Obsidian's plugin settings (`data.json`)
- Conflict-aware: timestamp-based reconciliation with explicit conflict modals
- Single-process: runs inside the Obsidian desktop runtime

## Layers

**UI Layer:**
- Purpose: Surface settings, OAuth flow, conflict resolution to the user
- Contains: Settings tab, conflict and diff modals
- Location: `src/ui/`
- Depends on: Obsidian Plugin API, sync services for triggering actions
- Used by: Plugin entry (`main.ts`) registers the settings tab and modals

**Sync Orchestration Layer:**
- Purpose: Decide what to sync, in which direction, and how to resolve conflicts
- Contains: `SyncService` (the core reconciliation engine)
- Location: `src/services/`
- Depends on: Controllers and Mapping models
- Used by: `main.ts` (periodic timers and on-demand triggers), `LocalEventController`

**Controller Layer:**
- Purpose: Execute concrete create/update/delete/rename file actions on each side
- Contains: `LocalController` (Obsidian vault ops), `BitrixController` (Bitrix24 disk ops), `LocalEventController` (Obsidian vault event hooks)
- Location: `src/controllers/`
- Depends on: Obsidian Vault API, Bitrix24 REST API client
- Used by: `SyncService`

**Data Access Layer:**
- Purpose: Talk to Bitrix24, persist mappings, model remote folder/file tree
- Contains: REST client, batch helper, mapping manager, remote tree model
- Location: `src/api/`, `src/models/`
- Depends on: Bitrix24 OAuth/REST endpoints, Obsidian's `saveData()` for persistence
- Used by: Controllers and the sync service

**Types/Helpers:**
- Purpose: Shared interfaces and small utilities (downloads, text fetch)
- Location: `src/types/`, `src/helpers/`
- Used by: All layers

## Data Flow

**Local → Remote (event-driven):**

1. User creates/modifies/renames/deletes a file in Obsidian
2. Vault emits an event handled by `LocalEventController` (`src/controllers/`)
3. Controller looks up the affected file's mapping in `MappingManager`
4. `SyncService` receives the change and decides on an action (push, conflict, ignore)
5. `BitrixController` performs the matching create/update/delete on Bitrix24 via `bitrix24-api.ts`
6. Mapping is updated and persisted

**Remote → Local (pull-based):**

1. Periodic timer (registered in `main.ts`) triggers a sync cycle
2. `BitrixMap` recursively downloads the remote folder tree from Bitrix24
3. `SyncService` walks the remote tree and compares against the local mapping
4. For each diverging file, it consults timestamps (`lastLocalMtime` vs remote `lastUpdate`) and produces actions
5. `LocalController` applies changes to the Obsidian vault
6. Conflicts surface a `ConflictModal` / `DiffModal` to the user

**State Management:**
- Plugin settings persisted via Obsidian's `saveData()` (`data.json` at plugin root)
- Mappings (local path ↔ Bitrix24 file ID) live in plugin settings via `MappingManager`
- OAuth tokens live in the same settings blob
- No external database; no in-memory cache that survives plugin reload

## Key Abstractions

**Sync Service:**
- Purpose: Single decision point for "what should happen to this file?"
- Examples: `src/services/SyncService.ts`
- Pattern: Orchestrator — owns reconciliation rules, delegates IO to controllers

**Controllers:**
- Purpose: Apply concrete actions on one side of the sync
- Examples: `src/controllers/LocalController.ts`, `src/controllers/BitrixController.ts`, `src/controllers/LocalEventController.ts`
- Pattern: Action enum + dispatch (`CREATE_FILE`, `UPDATE_FILE`, `DELETE_FILE`, `RENAME_FILE`)

**API client:**
- Purpose: Talk to Bitrix24 REST endpoints with auth, batching, retries
- Examples: `src/api/bitrix24-api.ts`, `src/api/BatchHelper.ts`, `src/api/CallResult.ts`
- Pattern: Wrapper class + result-object pattern (`CallResult`) instead of throwing on every API error

**Mapping Manager:**
- Purpose: Persist and look up local-path ↔ Bitrix24 file ID associations
- Examples: `src/models/MappingManager.ts`
- Pattern: Plain in-memory model serialized through plugin settings

**Bitrix Map:**
- Purpose: Mirror the remote folder tree for diffing
- Examples: `src/models/BitrixMap.ts`
- Pattern: Recursive tree builder

**Logger:**
- Purpose: Structured logging to file + console
- Examples: `src/services/LoggerService.ts` wrapping `pino`
- Pattern: Singleton-style service used across layers

## Entry Points

**Plugin entry (`main.ts`):**
- Location: `main.ts` (~8.6 KB, ~250 lines)
- Triggers: Obsidian loads the plugin at startup or after enabling it
- Responsibilities: Construct services, register the settings tab, hook vault events through `LocalEventController`, register commands, start periodic sync timers

**Settings tab:**
- Location: `src/ui/`
- Triggers: User opens plugin settings in Obsidian
- Responsibilities: Capture Bitrix24 portal URL and OAuth tokens, initiate sync, expose conflict UI

**Vault event listeners:**
- Location: `src/controllers/LocalEventController.ts`
- Triggers: Obsidian Vault `modify` / `delete` / `rename` (note: `create` may be intentionally disabled — see CONCERNS.md)
- Responsibilities: Translate vault events into sync actions

**Periodic timer:**
- Location: `main.ts`
- Triggers: `setInterval` (configurable in settings)
- Responsibilities: Kick off full-tree reconciliation

## Error Handling

**Strategy:** Result-object pattern at the API boundary, try/catch around UI-triggered actions, surface user-facing errors via Obsidian `Notice`.

**Patterns:**
- Bitrix24 calls return a `CallResult` containing either data or an error code (no raw throws from the API client)
- Sync-service decisions log warnings and skip the file rather than aborting the whole cycle
- File-system mutations (especially delete) are guarded with re-verification against the API before destructive operations
- Network/auth errors trigger `Notice` in UI flows

## Cross-Cutting Concerns

**Logging:**
- Custom `Logger` wraps `pino` (`src/services/LoggerService.ts`)
- Levels: INFO / WARN / ERROR
- Sink: `.obsidian/logs/sync-log.txt` plus console

**Auth:**
- OAuth 2.0 against the user's Bitrix24 portal
- Tokens persisted in plugin settings; refresh handled inside `bitrix24-api.ts`

**Concurrency:**
- Single-threaded JS event loop; sync cycles overlap with vault events — coordination is implicit and is a known fragility area (see CONCERNS.md)

**Validation:**
- TypeScript types at compile time; no runtime schema validation (no Zod/io-ts)

---

*Architecture analysis: 2026-06-16*
*Update when major patterns change*
