'use strict';

const { defineConfig } = require('@playwright/test');

const viewports = [
  { name: 'portrait-320x568', width: 320, height: 568 },
  { name: 'portrait-402x874', width: 402, height: 874 },
  { name: 'landscape-667x375', width: 667, height: 375 },
  { name: 'landscape-874x402', width: 874, height: 402 }
];

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: viewports.map(({ name, width, height }) => ({
    name,
    use: { viewport: { width, height } }
  })),
  webServer: {
    command: 'node scripts/test-server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
