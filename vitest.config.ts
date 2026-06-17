import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      // Obsidian API is only available at runtime inside the Electron host.
      // Tests get a minimal shim that mirrors the surface we actually use.
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
      // src/ alias used by the plugin source itself (mirrors tsconfig baseUrl='.').
      src: path.resolve(__dirname, 'src'),
    },
  },
});
