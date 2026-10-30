'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: { timeout: 5000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL: 'http://localhost:3001',
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: /mobile\.spec\.js/ },
        // Phone-sized Chromium with touch, for the selection toolbar and sheets (Firefox cannot emulate touch)
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }, testMatch: /mobile\.spec\.js/ },
    ],
    globalSetup: './tests/e2e/global-setup.js',
    globalTeardown: './tests/e2e/global-teardown.js',
});
