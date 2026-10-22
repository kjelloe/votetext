'use strict';

// Site roles: a plain user cannot create documents; a creator can; a superadmin grants the role in Users.

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

test('a superadmin grants and revokes creator from the Users page', async ({ browser }) => {
    const root = await browser.newContext({ storageState: path.join(AUTH_DIR, 'root.json') });
    const admin = await root.newPage();
    await admin.goto('/#/admin/users');
    const carolRow = admin.locator('.user-admin-row', { hasText: 'carol@e2e.test' });
    await expect(carolRow.locator('.role-select')).toHaveValue('user');
    await expect(admin.locator('.user-admin-row', { hasText: 'root@e2e.test' }).locator('.role-select')).toHaveCount(0);

    await carolRow.locator('.role-select').selectOption('creator');
    await expect(admin.locator('.user-admin-row', { hasText: 'carol@e2e.test' }).locator('.role-select')).toHaveValue('creator');

    const carolCtx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'carol.json') });
    const carol = await carolCtx.newPage();
    await carol.goto('/#/documents');
    await expect(carol.locator('#create-doc-btn')).toBeVisible();
    await expect(carol.locator('#creator-notice')).toHaveCount(0);

    await admin.locator('.user-admin-row', { hasText: 'carol@e2e.test' }).locator('.role-select').selectOption('user');
    await expect(admin.locator('.user-admin-row', { hasText: 'carol@e2e.test' }).locator('.role-select')).toHaveValue('user');
    await carol.reload();
    await expect(carol.locator('#creator-notice')).toBeVisible();
    await expect(carol.locator('#create-doc-btn')).toHaveCount(0);

    await carolCtx.close();
    await root.close();
});
