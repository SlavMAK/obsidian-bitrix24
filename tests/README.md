# Test automation

Two layers, run independently.

## Layer 1 — Vitest (unit / integration)

Pure-logic tests for `EventQueue`, `MappingManager`, etc. No network, no UI.

```bash
npm test            # one-shot
npm run test:watch  # watch mode
npm run test:ui     # browser UI for filtering & debugging
```

Coverage today:

| File | Plan section |
|---|---|
| `tests/unit/EventQueue.test.ts` | 2.3 (dedup), 8.4 (queue lifecycle) |
| `tests/unit/MappingManager.test.ts` | 10 (persistence), 2.2.3 (folder rename) |

The `obsidian` module is shimmed in `tests/mocks/obsidian.ts` — add to it
when a new test needs another part of the Obsidian API.

## Layer 2 — Playwright (E2E against live Obsidian + Bitrix24)

Drives the real Electron Obsidian against the configured test folder. Mutates
real data in Bitrix24. Single worker, serial mode.

```bash
npm run bitrix:reset    # wipe contents of the Bitrix test folder
npm run e2e             # headless E2E run (calls reset via globalSetup)
npm run e2e:headed      # same, with Obsidian window visible
```

### Prerequisites

1. **Close any running Obsidian** before invoking `npm run e2e` — the test
   launches its own instance with an isolated `--user-data-dir`. Two
   Electrons fighting over the vault gives flaky failures.
2. The plugin's `data.json` must already contain valid `refresh_token`,
   `client_endpoint`, and `folderId` (i.e. you've connected to Bitrix24
   through the plugin UI at least once).
3. **`folderId` must point at a throwaway folder.** The reset script
   `disk.folder.deletetree`s every child without confirmation.

### Environment overrides

| Variable | Purpose |
|---|---|
| `OBSIDIAN_BIN` | Override path to the Obsidian binary |
| `OBSIDIAN_VAULT` | Override vault path (default `/home/muxaujl/dev-obsidian`) |
| `BITRIX24_DATA_JSON` | Override path to plugin `data.json` |
| `BITRIX24_FOLDER_ID` | Override target folder id (one-off reset against a different folder) |
| `BITRIX24_CLIENT_ID` / `_SECRET` | Override the OAuth app credentials baked into `main.ts` |

### Adding tests

E2E tests should:

- Generate unique filenames (e.g. `smoke-${Date.now()}.md`) so a failed run
  doesn't poison the next.
- Clean up in a `finally` block — `globalSetup` only runs once per suite, not
  per test.
- Drive Obsidian by writing to the vault on disk when possible — the watcher
  is what we're actually testing, and DOM-driving Obsidian's command palette
  is brittle across versions.
- Verify on the Bitrix side via `tests/e2e/helpers/bitrix.ts` (poll-based,
  not event-based — Bitrix has no push notification we can subscribe to).

## What's NOT automated yet

Per the test plan (`.claude/event-driven-sync/plan-test.md`), these still need
manual coverage:

- Section 7 (ConflictResolutionModal) — modal interaction; needs Playwright
  selectors against the modal's DOM.
- Section 11 (Settings UI) — multi-step dropdown flow.
- Section 14 (perf smoke) — separate harness; not unit-testable.
- Section 4 (startup catch-up scenarios) — feasible via Playwright but each
  test would need a custom pre-state in Bitrix; deferred until smoke is
  stable.

Pick these up incrementally once the smoke layer is reliable.
