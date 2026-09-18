require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    video: 'on', // Grabar video para ver los clicks automáticos
    launchOptions: {
      slowMo: 500, // Hacer que vaya más lento para que se vean los clicks
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
  webServer: {
    command: 'npx cross-env TEST_MODE=true PORT=3001 node server/server.js',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
