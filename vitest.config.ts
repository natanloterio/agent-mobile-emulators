import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'daemon', environment: 'node', include: ['daemon/test/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'node', include: ['src/**/*.test.ts'] } },
      { test: { name: 'electron', environment: 'node', include: ['electron/**/*.test.ts'] } },
    ],
  },
});
