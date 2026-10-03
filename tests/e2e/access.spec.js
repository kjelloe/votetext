'use strict';

// UC-5 in the browser: invite by email, change a level, block, remove.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

test('manage access: invite → change level → block → remove', async ({ page }) => {
    const docId = await createDoc('Access doc', 'Who may do what.');
    const access = async () => (await apireq('GET', `/documents/${docId}/access`, { cookie: aliceCookie() })).access.find(r => r.email === 'bob@e2e.test');

    await page.goto(`/#/documents/${docId}`);
    await page.locator('#access-btn').click();
    await page.locator('#invite-search').fill('bob@e2e.test');
    await page.locator('#invite-level').selectOption('voter');
    await page.locator('#invite-submit').click();
    const row = page.locator('.access-row', { hasText: 'bob@e2e.test' });
    await expect(row).toBeVisible();
    expect((await access()).access_level).toBe('voter');

    await row.locator('.access-level-sel').selectOption('supervisor');
    await expect.poll(async () => (await access()).access_level).toBe('supervisor');

    await row.locator('button[data-block]').click();
    await expect(page.locator('.access-row-blocked', { hasText: 'bob@e2e.test' })).toBeVisible();
    expect((await access()).blocked).toBe(1);

    const rowAgain = page.locator('.access-row', { hasText: 'bob@e2e.test' });
    await rowAgain.locator('button[data-remove]').click();
    await rowAgain.locator('button[data-confirm-remove]').click();
    await expect(page.locator('.access-row', { hasText: 'bob@e2e.test' })).toHaveCount(0);
    expect(await access()).toBeUndefined();
});
