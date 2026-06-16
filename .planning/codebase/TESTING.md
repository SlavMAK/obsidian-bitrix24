# Testing

**Analysis Date:** 2026-06-16

## Status

**Test coverage: zero.**

- No `*.test.ts` or `*.spec.ts` files in `src/` or at the project root
- No `__tests__/` directory
- No test framework installed (no `jest`, `vitest`, `mocha`, or `@vitest/*` in `package.json`)
- No `jest.config.*`, `vitest.config.*`, or `.mocharc.*` configuration files
- No `test` / `test:watch` / `test:unit` scripts in `package.json` — only `dev`, `build`, and `version`
- No CI step running tests (`.gitlab-ci.yml` and `.github/` focus on build/release)

## Framework

None configured. Picking one is an open decision (see CONCERNS.md). Candidates that fit this stack:

- **Vitest** — closest to esbuild/TS toolchain, fast, good DX
- **Jest** — most common in the Obsidian plugin ecosystem; requires `ts-jest` or `babel-jest`

Obsidian-specific guidance: plugins typically mock the `obsidian` module (Vault, App, Plugin, Notice, Modal) because the real one is only available inside the Obsidian runtime.

## Mocking

No mocking framework present. When tests are added, expect to need mocks for:

- `obsidian` module — Vault, App, Plugin, Notice, Modal, Setting
- `src/api/bitrix24-api.ts` — Bitrix24 REST calls (avoid hitting a real portal in unit tests)
- `src/services/LoggerService.ts` — silence pino during tests
- File system (the universal download / hashing helpers in `src/helpers/`)

## Manual / Integration Testing

The plugin is currently validated through manual use inside Obsidian:

- Install into a vault's `.obsidian/plugins/` directory
- Configure a Bitrix24 portal in the settings tab
- Trigger sync, observe `.obsidian/logs/sync-log.txt`
- Exercise create / modify / rename / delete flows on both sides
- Verify conflict modals render and resolve correctly

This is fragile — regressions only surface during use and several recent commits (`b0876d8 fix: несколько багов`) suggest bugs slip through.

## Recommended Coverage Targets (when tests are added)

High-leverage code paths that currently have no automated coverage:

1. `src/services/SyncService.ts` — reconciliation rules, timestamp comparison, conflict detection
2. `src/api/BatchHelper.ts` — batching, dependency refs, error mapping
3. `src/api/bitrix24-api.ts` — OAuth refresh, error normalization to `CallResult`
4. `src/controllers/LocalEventController.ts` — event coalescing and dispatch
5. `src/models/MappingManager.ts` — mapping CRUD and persistence
6. `src/helpers/hash.ts` and `src/helpers/universalDownloadFile.ts` — pure utilities, cheap to cover

## Suggested Next Steps

- Add Vitest with `obsidian` module stubbed via path alias
- Start with `src/helpers/` (pure functions, no Obsidian dependency)
- Then add a test for `MappingManager` (in-memory + serialization round-trip)
- Then unit-test `SyncService` decision logic with stub controllers
- Add a single GitLab CI / GitHub Actions step running `npm test`

---

*Testing analysis: 2026-06-16*
*Update when a test framework is introduced*
