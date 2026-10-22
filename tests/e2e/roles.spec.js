'use strict';

// Site roles: a plain user cannot create documents; a creator can.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'bob.json') });

test('a plain user sees the participation notice and no "New document" button', async ({ page }) => {
    await page.goto('/#/documents');
    await expect(page.locator('#creator-notice')).toBeVisible();
    await expect(page.locator('#create-doc-btn')).toHaveCount(0);
});

test('a creator sees the "New document" button and no notice', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
    const page = await ctx.newPage();
    await page.goto('/#/documents');
    await expect(page.locator('#create-doc-btn')).toBeVisible();
    await expect(page.locator('#creator-notice')).toHaveCount(0);
    await ctx.close();
});
