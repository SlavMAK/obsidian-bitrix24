# External Integrations

**Analysis Date:** 2026-06-16

## APIs & External Services

**Bitrix24 REST API:**
- Service: Bitrix24 CRM/Collaboration Platform (REST API)
- What it's used for: Sync file system between Obsidian vault and Bitrix24 Disk
- SDK/Client: Custom HTTP client wrapper (`src/api/bitrix24-api.ts`)
- Auth: OAuth 2.0 refresh token flow
- Base URLs:
  - OAuth endpoint: `https://oauth.bitrix.info/oauth/token?`
  - REST API: Client-specific (e.g., `https://d-clouds.bitrix24.ru/rest/`)

**Bitrix24 Disk API Methods (REST endpoints):**
- `disk.storage.getlist` - List available storage (user, group, common)
- `disk.storage.getchildren` - Get folder contents from specific storage
- `disk.folder.get` - Retrieve folder metadata
- `disk.folder.getchildren` - List items in folder
- `disk.folder.addsubfolder` - Create new subfolder
- `disk.folder.uploadfile` - Upload file to folder
- `disk.folder.moveto` - Move folder to new parent
- `disk.folder.rename` - Rename folder
- `disk.folder.markdeleted` - Delete folder (soft delete)
- `disk.file.get` - Retrieve file metadata
- `disk.file.uploadversion` - Upload new file version
- `disk.file.moveto` - Move file to new folder
- `disk.file.rename` - Rename file
- `disk.file.markdeleted` - Delete file (soft delete)
- `profile` - Get current user profile info
- `pull.application.config.get` - Get WebSocket configuration for real-time updates
- `batch.json` - Batch processing endpoint for multiple requests in one call

**Request Details:**
- Protocol: HTTPS POST
- Headers: `Content-Type: application/json`
- Authentication: Query parameter `auth={accessToken}`
- Response format: JSON with `result`, `result_error`, `result_total`, `result_next` fields
- Location: `src/api/bitrix24-api.ts` - Methods `callMethod()`, `callBatch()`, `makeRequest()`

## Data Storage

**Vault Storage:**
- Type: Obsidian Vault (local filesystem via Obsidian API)
- Client: Obsidian `Vault` API
- Location: User's Obsidian vault directory (typically `.obsidian/` subdirectories)
- Persists:
  - Plugin settings: via `saveData()` / `loadData()` (Obsidian plugin storage)
  - Sync logs: `.obsidian/logs/sync-log.txt` (created by Logger)
  - File mappings: Stored in plugin settings as JSON serialized `MappingManager`

**Local Storage:**
- No external database or caching service
- Runtime state: In-memory (`FileMapping[]`, `BitrixMapElement[]`)
- Temp ignore list: `tempIgnoreFile` Set in `src/services/SyncService.ts`

## Authentication & Identity

**Auth Provider:**
- Service: Bitrix24 OAuth 2.0
- Implementation: OAuth 2.0 refresh token flow
- Token storage: Plugin settings (`data.json` via Obsidian plugin data store)
- Token refresh: Automatic refresh when `expiresIn < currentTime + 300 seconds`
- Credentials location: `src/api/bitrix24-api.ts` hardcoded (app credentials)
  - `clientId='app.6852f7fce097f5.55195369'` - App ID registered with Bitrix24
  - `clientSecret='A3yMqlIZnAvZuvOZ1ljztkc9mUL1r0tVfmJ5WkdH80bSkFgNmu'` - App secret
- Token callback: Automatic settings save on token refresh via `cbOnRequest` callback

**Settings Schema (Bitrix24SyncSettings in main.ts):**
- `client_endpoint: string` - Bitrix24 server endpoint
- `refresh_token: string` - OAuth refresh token
- `access_token: string` - OAuth access token
- `expires_in: number` - Token expiration timestamp
- `currentUserId: number` - Logged-in user ID
- `currentUserName: string` - Logged-in user name
- `storageId: number` - Selected Bitrix24 storage ID
- `folderId: number` - Selected Bitrix24 folder ID for sync root

## Webhooks & Callbacks

**Incoming WebSocket (Bitrix24 → Plugin):**
- Type: WebSocket push notifications
- Source: Bitrix24 pull.application.config.get API
- Connection: Established via `getWebSocketClient()` method in `src/api/bitrix24-api.ts`
- URL format: `wss://[bitrix24-server]/bitrix/components/bitrix/pull/pull.js?CHANNEL_ID=[id]`
- Payload parsing: Handles special Bitrix24 nginx wrapper format `#!NGINXNMS!#...#!NGINXNME!#`
- Message handler: `parseEventWebSocket()` in `src/services/SyncService.ts`
- Updates local sync state when remote changes detected on Bitrix24 Disk

**Outgoing Events:**
- Local file system watcher events (Obsidian API):
  - `vault.on('rename')` - File/folder renamed
  - `vault.on('modify')` - File content modified
  - `vault.on('delete')` - File/folder deleted
  - `vault.on('create')` - File/folder created (partially commented out)
- Handlers: `src/controllers/LocalEventController.ts`
- Synced to Bitrix24 via REST API calls

## Monitoring & Observability

**Error Tracking:**
- No external error tracking service
- Errors logged locally and shown to user via `Notice()` (Obsidian toast notifications)

**Logs:**
- Approach: Structured logging via Pino + local file append
- Destination: `.obsidian/logs/sync-log.txt`
- Implementation: `src/services/LoggerService.ts`
- Levels: INFO, WARN, ERROR
- Format: Timestamp + level + message + JSON-stringified context

**Console Logging:**
- Direct `console.error()` and `console.log()` calls for debugging
- Locations: API error handling, WebSocket state changes

## CI/CD & Deployment

**Repository:**
- Primary: GitLab (with master branch as default)
- Mirror: GitHub (SlavMAK/obsidian-bitrix24)
- Sync: Automated via `.gitlab-ci.yml` - GitLab syncs to GitHub on master push

**CI/CD Pipelines:**

**GitHub Actions (Release):**
- File: `.github/workflows/release.yml`
- Trigger: Push to master branch
- Steps:
  1. Checkout code
  2. Setup Node.js 18.x
  3. Install dependencies + build: `npm install && npm run build`
  4. Create GitHub release with artifacts:
     - `main.js` - Bundled plugin
     - `manifest.json` - Plugin metadata
     - `styles.css` - Styles
- Tag format: Version tags trigger release creation
- Status: Draft release (manual publish required)

**GitLab CI:**
- File: `.gitlab-ci.yml`
- Stage: `sync`
- Purpose: Mirror master branch to GitHub
- Image: `alpine:latest`
- Script: Git push to GitHub using `$GITHUB_TOKEN` secret
- Trigger: Only on CI_DEFAULT_BRANCH (master)

**Build Process:**
```bash
npm install        # Install dependencies
npm run build      # tsc + esbuild (production mode)
npm run dev        # tsc + esbuild (watch mode with inline sourcemaps)
npm run version    # Bump version via version-bump.mjs
```

## Environment Configuration

**Required Environment Variables:**
- Development: None explicitly required (uses hardcoded app credentials)
- Deployment: `GITHUB_TOKEN` (for GitHub release automation)

**Installation & Setup:**
- Plugin installed via Obsidian Community Plugins or manual folder placement
- First-time setup: User clicks "Connect to Bitrix24" in plugin settings
- OAuth flow: Browser redirect to Bitrix24 OAuth, user authorizes, credentials stored locally
- Configuration: User selects storage and folder to sync

**Secrets Location:**
- OAuth tokens stored in: Obsidian plugin data store (`data.json`)
- App credentials: Hardcoded in `main.ts` (embedded in source)
- GitHub token: GitHub Actions secret (environment variable)
- GitLab token: GitLab CI/CD variable (environment variable)

**CAUTION - Security Notes:**
- OAuth credentials stored in plaintext in plugin data directory (Obsidian limitation)
- App secret hardcoded in source code - app is public/not sensitive secret
- Recommend: Store user tokens in OS keychain when possible (future improvement)

## Version Management

**Version Format:**
- Semantic versioning (e.g., 1.0.2)
- Location: `manifest.json`, `versions.json`
- Bumped via: `npm run version` script using `version-bump.mjs`

**Minimum Obsidian Version:**
- Required: 0.15.0 or later
- Specified in: `manifest.json` - `minAppVersion: "0.15.0"`

---

*Integration audit: 2026-06-16*
