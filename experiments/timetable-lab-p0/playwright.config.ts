import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['json', { outputFile: '.artifacts/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4317', channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm run dev', url: 'http://127.0.0.1:4317', reuseExistingServer: true },
});
