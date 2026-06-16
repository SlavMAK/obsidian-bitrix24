# Structure

**Analysis Date:** 2026-06-16

## Directory Layout

```
bitrix24Sync/
├── main.ts                       # Plugin entry — Plugin class, settings, event wiring
├── main.js                       # Compiled bundle (esbuild output, committed)
├── manifest.json                 # Obsidian plugin manifest (id, version, minAppVersion)
├── versions.json                 # Plugin version compatibility map
├── package.json                  # npm metadata, scripts (dev/build/version)
├── tsconfig.json                 # TS compiler config (target ES6, strictNullChecks)
├── esbuild.config.mjs            # Bundler entry — dev (watch) and production builds
├── version-bump.mjs              # Helper for the `npm run version` script
├── .eslintrc                     # ESLint with @typescript-eslint/recommended
├── .eslintignore                 # Lint exclusions
├── .editorconfig                 # Editor settings (tabs)
├── .npmrc                        # npm config
├── .gitignore                    # VCS ignores
├── .gitlab-ci.yml                # GitLab CI pipeline (release/publish)
├── .github/                      # GitHub workflows (if any)
├── data.json                     # Runtime plugin settings (created by Obsidian)
├── styles.css                    # Plugin stylesheet
├── README.md                     # Project README (sparse)
├── LICENSE                       # MIT
├── .planning/                    # GSD planning artifacts (created here)
└── src/
    ├── api/
    │   ├── bitrix24-api.ts        # REST client, OAuth refresh, request helpers
    │   ├── BatchHelper.ts         # Batches up to 50 calls with dependency refs
    │   └── callResult.ts          # Result-object pattern (data | error)
    ├── controllers/
    │   ├── LocalController.ts          # Vault create/update/delete/rename ops
    │   ├── BitrixController.ts         # Bitrix24 disk create/update/delete/rename
    │   └── LocalEventController.ts     # Hooks Obsidian vault events into sync
    ├── helpers/
    │   ├── universalDownloadFile.ts    # Cross-platform file download helper
    │   ├── getTextRemoteFile.ts        # Fetch remote file as text
    │   └── hash.ts                     # Content hashing helper
    ├── models/
    │   ├── MappingManager.ts           # Local-path ↔ Bitrix24 file-ID mappings
    │   └── BitrixMap.ts                # Recursive model of remote folder tree
    ├── services/
    │   ├── SyncService.ts              # Core reconciliation engine
    │   └── LoggerService.ts            # `Logger` wrapping pino, file + console sinks
    ├── types/
    │   ├── bitrixAuthType.ts           # OAuth token / portal types
    │   ├── bitrix-disk.ts              # Bitrix24 disk entity types (folder/file)
    │   └── batchElement.ts             # Batch request envelope type
    └── ui/
        ├── Bitrix24SyncSettingTab.ts   # Settings tab + OAuth flow
        ├── ConflictResolutionModal.ts  # User-facing conflict picker
        └── DiffViewModal.ts            # Text-diff modal for conflicts
```

## Key Locations

| Need to… | Look at |
|----------|---------|
| Find plugin entry / lifecycle | `main.ts` |
| Change sync algorithm | `src/services/SyncService.ts` |
| Add a Bitrix24 endpoint | `src/api/bitrix24-api.ts` |
| Add a new vault event hook | `src/controllers/LocalEventController.ts` |
| Add a new local file operation | `src/controllers/LocalController.ts` |
| Add a new remote file operation | `src/controllers/BitrixController.ts` |
| Adjust batching behavior | `src/api/BatchHelper.ts` |
| Persist new settings | `Bitrix24SyncSettings` in `main.ts` + Settings tab |
| Add/modify settings UI | `src/ui/Bitrix24SyncSettingTab.ts` |
| Tweak logging | `src/services/LoggerService.ts` |
| Add a remote/local type | `src/types/` |
| Change the build | `esbuild.config.mjs`, `tsconfig.json` |
| Change CI / release | `.gitlab-ci.yml`, `.github/` |

## Naming Conventions

- **Classes/files containing a class:** PascalCase — `SyncService.ts`, `BitrixController.ts`, `ConflictResolutionModal.ts`
- **Utility modules:** kebab-case or camelCase — `bitrix24-api.ts`, `bitrix-disk.ts`, `universalDownloadFile.ts`, `getTextRemoteFile.ts`
- **Types:** camelCase filename matching the primary exported type — `bitrixAuthType.ts`, `batchElement.ts`
- **TS path alias:** `src/...` (configured via `tsconfig.json` `baseUrl: "."`)
- **Action enums** live with the controller they belong to (`CREATE_FILE`, `UPDATE_FILE`, `DELETE_FILE`, `RENAME_FILE`)

## Where to Add Code

| New thing | Goes in |
|-----------|---------|
| New Bitrix24 entity type | `src/types/bitrix-<entity>.ts` |
| New REST method | Extend `src/api/bitrix24-api.ts` |
| New sync action | Extend the action enum + corresponding branch in `SyncService` and the relevant Controller |
| New conflict-resolution UI | New modal in `src/ui/`, wired from `SyncService` |
| New helper that doesn't fit elsewhere | `src/helpers/` |
| New persistent setting | Extend `Bitrix24SyncSettings` in `main.ts`, plumb through Settings tab |

## Build / Output

- Source roots: `main.ts` + `src/**/*.ts`
- Bundler: `esbuild.config.mjs` produces a single `main.js` next to `manifest.json`
- Both `main.js` and `main.ts` are tracked in git (Obsidian community plugins load `main.js`)

---

*Structure analysis: 2026-06-16*
*Update when directory layout changes*
