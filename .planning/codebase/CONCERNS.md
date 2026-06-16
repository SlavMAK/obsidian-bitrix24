# Concerns

**Analysis Date:** 2026-06-16

Catalogue of technical debt, known issues, and fragile areas surfaced by reading the codebase, git history, and recent fix commits.

## Severity Legend

- 🔴 **Critical** — security or data-loss risk; address immediately
- 🟠 **High** — functional bugs or large gaps that affect users today
- 🟡 **Medium** — fragility / friction; should be tackled in the next iteration
- 🟢 **Low** — polish, modernization, ergonomics

---

## 🔴 Critical

### C1. Hardcoded OAuth credentials in source

`main.ts:13-14` declares two top-level `const`s — a `clientId` and a `clientSecret` — both with literal string values baked into the source (values intentionally not reproduced here; see `main.ts:13-14`).

- The client secret is bundled into `main.js` (which is committed) — anyone with the plugin can read it
- Rotating the secret requires shipping a new plugin release
- The repo is public-ready (MIT license, README, GitHub/GitLab CI) — this almost certainly leaked already

**Mitigation:**
1. Rotate the Bitrix24 OAuth app credentials immediately
2. Move client credentials out of source — either ship a development-only fallback, require the user to register their own Bitrix24 OAuth app, or proxy through a backend
3. Add a check that fails the build if these constants are non-empty

---

## 🟠 High

### H1. `create` vault event handler is commented out

`main.ts` (around lines ~114-126 per prior agent analysis): the handler that pushes newly-created local files to Bitrix24 is disabled.

- Newly created files in Obsidian do not appear in Bitrix24 until the next full reconciliation cycle
- Users likely perceive this as "sync is broken for new files"

**Mitigation:** Re-enable with the correct debounce/coalescing strategy, or document explicitly that creates flow only through the periodic cycle.

### H2. Zero automated test coverage on sync logic

`SyncService` (~1000 LOC), the batch helper, mapping persistence, and event coalescing have no tests (see TESTING.md). Recent commit `b0876d8 fix: несколько багов` (=“fix: several bugs”) hints that bugs are caught in production.

**Mitigation:** Introduce Vitest, start with pure helpers and `MappingManager` round-trip, then `SyncService` decisions with stub controllers (see TESTING.md).

### H3. Race conditions in the sync state machine

Identified concerns:

- Local vault events (modify/delete/rename) can fire while a remote-pull cycle is mid-flight, mutating the same mapping
- File move tracking lives in memory; a plugin reload mid-move loses the move and may lead to delete+recreate
- Mapping persistence is not transactional — a crash between mapping update and `saveData()` leaves stale state
- No mutex / single-flight around an in-progress sync cycle

**Mitigation:** Introduce an explicit sync state (idle / syncing / blocked), single-flight the cycle, debounce vault events into a queue with deduplication, and persist mappings atomically.

### H4. Silent token-refresh failures

`bitrix24-api.ts` refreshes the OAuth token on expiry; on failure, the error is logged but the calling cycle continues with an invalid token, causing every subsequent request to fail without a clear user-facing signal.

**Mitigation:** Surface refresh failures with `Notice` + halt the sync cycle, and force re-auth via the settings tab.

### H5. Hanging Conflict Resolution modal

`ConflictResolutionModal` (and `DiffViewModal`) wait on user input with no timeout and no cancellation path. If the user dismisses Obsidian or ignores the modal, the sync cycle stays parked.

**Mitigation:** Add a default action (`keep-local` / `keep-remote`) on timeout or modal close, and a way for the next cycle to inherit pending conflicts.

---

## 🟡 Medium

### M1. Public mutable `MappingManager.mappings`

The mapping array is exposed publicly and mutated from multiple call sites. Any future feature that touches mappings will need to know to call `save()` afterwards. Easy to forget.

**Mitigation:** Encapsulate behind `add`/`update`/`remove`/`lookup` methods that also schedule persistence (debounced).

### M2. No request batching for routine operations

Files are processed sequentially with one API call each in several paths, even though `BatchHelper` exists (up to 50 calls per batch). Sync of a large vault is slower than it could be and burns API quota.

**Mitigation:** Route bulk reconciliation through `BatchHelper`; reserve single-call paths for interactive UI actions.

### M3. Repeated `BitrixMap` instantiation

Each periodic cycle rebuilds the remote tree from scratch. For a large Bitrix24 disk, this is expensive and rate-limited.

**Mitigation:** Cache the tree with a TTL and incrementally update via change tokens (if Bitrix24 supports them) or per-folder timestamps.

### M4. Unbounded queues / timers

- Vault-event queue has no max length
- "Ignore" timers (used to dedupe self-induced events) accumulate; if their teardown is missed they linger
- No cap on retries

**Mitigation:** Bounded queues with drop/coalesce policy; structured retry with backoff and a max-attempt cap.

### M5. Use of `any` in the API layer

`src/api/` widens raw Bitrix24 responses to `any`. Errors in field names or response shape changes only surface at runtime.

**Mitigation:** Define typed response shapes per endpoint (or run a generator over the Bitrix24 schema), then narrow inside the API layer instead of the call site.

### M6. Russian-only logs, comments, commits

Logging and inline commentary are mostly Russian. This is fine for the current author but raises onboarding cost for any contributor who doesn't read Russian. Mixed languages are also harder to grep.

**Mitigation:** Pick one language (English is standard for OSS Obsidian plugins) and migrate over time; at minimum, English commit message titles.

### M7. `main.js` committed alongside `main.ts`

Both source and the bundled output are tracked. Diffs are noisier than they need to be, and there's no enforcement that `main.js` matches the current source.

**Mitigation:** Either keep the convention (Obsidian community plugins do require `main.js` to ship), and add a CI step that re-bundles and diffs to catch mismatches, or move `main.js` to a release-only artifact.

---

## 🟢 Low

### L1. Sparse README and docs

`README.md` is ~620 bytes. There's no troubleshooting, no architecture sketch, and no contribution guide.

### L2. Dev dependency drift

`@types/node` is pinned to `^16.x` while Obsidian targets Node 18+; TypeScript is 4.7.4 (LTS-ish, but TS 5.x has been out for years). Worth a coordinated bump.

### L3. Inconsistent file/casing in `src/types`

`bitrix-disk.ts` is kebab-case; `bitrixAuthType.ts` and `batchElement.ts` are camelCase. Pick one and rename.

### L4. `@ts-ignore` allowed (`ban-ts-comment: off`)

Allowed today; without grep discipline, suppressions can spread. Worth turning back on with `ts-expect-error` and a description.

### L5. Open TODOs

Russian TODOs were found in `SyncService.ts` (~line 516) and `LocalEventController.ts` (~line 61) per prior analysis. Confirm and either close or convert into tracked issues.

---

## Recent Bug Fix Trail

Recent commits suggest a stream of small fixes:

- `55e821e relize` (release)
- `bb931ed Update versions.json`
- `5bec6e2 Update manifest.json`
- `b0876d8 fix: несколько багов` (= "fix: several bugs")
- `c703dec Merge remote-tracking branch 'origin/dev'`

The "several bugs" commit confirms that regressions reach production. Pair this with the testing gap (H2) — adding even a thin unit-test layer around `SyncService` will pay back quickly.

---

## Suggested Order of Attack

1. **C1** Rotate and remove hardcoded OAuth credentials (security, blocks open-sourcing)
2. **H1** Re-enable or document the `create` event path (functional regression)
3. **H4** Surface OAuth refresh failures (blast-radius: every Bitrix24 call)
4. **H2** Introduce Vitest + first tests against `SyncService` decisions
5. **H3** Add single-flight + queue around the sync cycle
6. **H5** Default action / timeout on conflict modals
7. Tackle the **Medium** band as part of the next refactor

---

*Concerns analysis: 2026-06-16*
*Update after each significant fix or refactor — keep this catalogue alive*
