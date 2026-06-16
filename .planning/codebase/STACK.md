# Technology Stack

**Analysis Date:** 2026-06-16

## Languages

**Primary:**
- TypeScript 4.7.4 - All plugin source code, type-safe development
- JavaScript - Build tooling and configuration

## Runtime

**Environment:**
- Node.js 18.x - Development and build environment (GitHub Actions)
- Obsidian Plugin API (latest) - Plugin runtime on Obsidian desktop/web app
- Browser WebSocket API - Real-time communication with Bitrix24

**Package Manager:**
- npm 8.x+ (via Node.js)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Obsidian Plugin API (latest) - Framework for building Obsidian plugins
  - Provides: `Plugin`, `App`, `Vault`, `TFile`, `TFolder`, `PluginSettingTab`, `Notice`, `request`, `requestUrl`
  - Location: Main plugin class `Bitrix24Sync` extends `Plugin` in `main.ts`

**Build/Dev:**
- esbuild 0.17.3 - JavaScript/TypeScript bundler (`esbuild.config.mjs`)
- TypeScript 4.7.4 - Transpilation and type checking
- ESLint + TypeScript ESLint - Code linting (`.eslintrc`)

## Key Dependencies

**Runtime Dependencies:**
- `lodash` 4.17.21 - Utility library for array/object manipulation
- `pino` 9.7.0 - Structured JSON logging (browser-compatible configuration in `src/services/LoggerService.ts`)

**Dev Dependencies:**
- `@typescript-eslint/eslint-plugin` 5.29.0 - TypeScript linting rules
- `@typescript-eslint/parser` 5.29.0 - ESLint parser for TypeScript
- `@types/node` 16.11.6 - Node.js type definitions
- `builtin-modules` 3.3.0 - Node.js built-in module list for bundler
- `tslib` 2.4.0 - TypeScript helper runtime library

## Configuration

**TypeScript:**
- File: `tsconfig.json`
- Target: ES6
- Module: ESNext
- Key settings: `inlineSourceMap: true`, `strictNullChecks: true`, `noImplicitAny: true`

**Build:**
- File: `esbuild.config.mjs`
- Entry: `main.ts`
- Output: `main.js` (single bundled file)
- Externals: Obsidian API and CodeMirror libraries (not bundled)
- Features: Tree-shaking, inline sourcemaps (dev), minification (production)

**Linting:**
- File: `.eslintrc`
- Extends: `eslint:recommended` + TypeScript plugin
- Key rules: Unused vars error, TS ban-comment off, no-empty-function off

**Development:**
- `.editorconfig` - Editor settings
- `.npmrc` - NPM configuration (private)
- `.gitignore` - Standard Node.js + Obsidian plugin gitignore

## Platform Requirements

**Development:**
- Node.js 18.x or later
- npm 8.x or later
- Git (for version control)

**Production:**
- Obsidian 0.15.0 or later (`minAppVersion` in `manifest.json`)
- No external server required - plugin runs locally within Obsidian

**External APIs Required:**
- Bitrix24 server with OAuth endpoint: `https://oauth.bitrix.info/oauth/token`
- Bitrix24 REST API endpoint (client-specific domain, e.g., `https://d-clouds.bitrix24.ru/rest/`)
- WebSocket support for real-time sync via Bitrix24 pull API

## Build Output

**Distribution Artifacts:**
- `main.js` - Bundled plugin code (77.5 KB as of last build)
- `manifest.json` - Plugin metadata
- `styles.css` - Plugin UI styles
- Released via GitHub Actions to GitHub Releases

---

*Stack analysis: 2026-06-16*
