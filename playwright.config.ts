import { defineConfig, devices } from '@playwright/test';
const webPort = process.env.DESKTWIN_TEST_PORT ?? '5173';
const apiPort = process.env.DESKTWIN_TEST_API_PORT ?? '4318';
const baseURL = `http://127.0.0.1:${webPort}`;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    // Optional preinstalled Chromium for offline CI; the normal Playwright browser stays default.
    launchOptions: process.env.DESKTWIN_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.DESKTWIN_CHROMIUM_EXECUTABLE,
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1448, height: 1086 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    // Own the test server: never reuse a user's dev server with an unknown API key.
    reuseExistingServer: false,
    env: { MODEL_API_KEY: '', DESKTWIN_WEB_PORT: webPort, PORT: apiPort },
    timeout: 30000,
  },
});
