# Conventions

**Analysis Date:** 2026-06-16

## Language & Tooling

- TypeScript 4.7 targeting ES6, module ESNext, `noImplicitAny: true`, `strictNullChecks: true` (`tsconfig.json`)
- Path alias: `src/...` via `baseUrl: "."` in `tsconfig.json`
- ESLint with `@typescript-eslint/recommended` (`.eslintrc`)
- `@typescript-eslint/ban-ts-comment` is **off** — `@ts-ignore` is allowed
- `@typescript-eslint/no-unused-vars` is **error** with `args: "none"` (unused function params are tolerated)
- No Prettier config; formatting follows `.editorconfig` (tab indentation)
- `npm run dev` / `npm run build` via `esbuild.config.mjs`

## File & Symbol Naming

- **Class files:** PascalCase matching the class — `SyncService.ts`, `BitrixController.ts`, `ConflictResolutionModal.ts`
- **Utility / API modules:** kebab- or camelCase — `bitrix24-api.ts`, `universalDownloadFile.ts`, `getTextRemoteFile.ts`
- **Type files:** camelCase, file name matches primary type — `bitrixAuthType.ts`, `bitrix-disk.ts`, `batchElement.ts`
- **Constants:** UPPER_SNAKE_CASE for action enums (`CREATE_FILE`, `UPDATE_FILE`, `DELETE_FILE`, `RENAME_FILE`) declared near the controller that handles them
- **Interfaces:** `Bitrix24SyncSettings` style (no `I` prefix)

## Imports

Typical order observed across `src/`:

1. Obsidian API (`import { Plugin, Notice, ... } from "obsidian"`)
2. `src/` aliased absolute imports (`import { Bitrix24Api } from "src/api/bitrix24-api"`)
3. Third-party (`pino`, `lodash`) — used sparingly
4. Relative imports (rare; most cross-module imports use the `src/` alias)

## Async & Control Flow

- API calls are `async`/`await` throughout; raw `.then()` chains are uncommon
- Bitrix24 calls return a `CallResult` (`src/api/callResult.ts`) instead of throwing — callers branch on `.error` / `.data`
- File-system mutations in `LocalController` / `BitrixController` are guarded with re-checks before destructive ops (esp. delete)
- `try/catch` is reserved for outer command handlers and event-handler boundaries; inner functions prefer `CallResult`

## Error Handling

- API boundary: `CallResult.error()` / `CallResult.ok()` pattern — explicit, type-safe
- UI boundary: `new Notice("...")` shows user-facing messages
- Logging: every non-trivial branch hits `this.logger.log(...)` with INFO/WARN/ERROR
- Sync cycle: errors on a single file log a warning and continue; the cycle does not abort
- Destructive ops verify the remote state again before deleting locally

## Logging

- Custom `Logger` (`src/services/LoggerService.ts`) wraps `pino`
- Three levels: `INFO`, `WARN`, `ERROR`
- Sinks: file (`.obsidian/logs/sync-log.txt`) and console
- Many log messages are in Russian (matches comment language)

## Comments

- Inline comments are primarily in **Russian** and explain *why*, not *what*
- Prefixes seen in code: `// КРИТИЧНО:` (critical), `// Исправление:` (fix), `// TODO:`
- JSDoc is sparse; types do most of the documentation
- Commit messages are in Russian (e.g., `fix: несколько багов`)

## Type Discipline

- Strong typing across controllers and services
- API layer (`src/api/`) has pockets of `any` for raw Bitrix24 responses — values are narrowed once they reach controllers/services
- No runtime schema validation (no Zod / io-ts / class-validator)

## UI Conventions

- Settings: extend Obsidian's `PluginSettingTab`, build with `new Setting(containerEl)…`
- Modals: extend Obsidian's `Modal`, mount custom DOM
- User feedback: `new Notice("...")` for short-lived messages
- No external UI framework

## Build / Release

- Build: `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`
- Version bump: `npm run version` runs `version-bump.mjs`, then `git add manifest.json versions.json`
- CI: `.gitlab-ci.yml` and `.github/` workflows exist for release/publish

## Misc

- Indentation: tabs (`.editorconfig`)
- Line endings: LF
- License: MIT
- `data.json` is the runtime settings file Obsidian writes — never hand-edit in production

---

*Conventions analysis: 2026-06-16*
*Update when style rules change*
