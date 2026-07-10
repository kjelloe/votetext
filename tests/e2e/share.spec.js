'use strict';

// US-7 — Share a proposal with an outsider (anonymous access via direct link)

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

let varId;

test.beforeAll(async () => {
    const docId = await createDoc('US-7 Share doc', 'Shareable first line.\nSecond line here.');
    varId = await createVariant(docId, { char_start: 0, char_end: 9, new_text: 'Public', title: 'US-7 shared proposal' });
});

test('proposer enables anonymous access from the share modal', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
    const page = await ctx.newPage();
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#share-variant-btn').click();

    await expect(page.locator('#share-url')).toHaveValue(new RegExp(`#/variants/${varId}`));
    const cb = page.locator('#share-anon-cb');
    await expect(cb).toBeVisible();
    await cb.check();
    // Give the PATCH a moment to land, then verify it persisted
    await page.waitForTimeout(300);
    await page.reload();
    await page.locator('#share-variant-btn').click();
    await expect(page.locator('#share-anon-cb')).toBeChecked();
    await ctx.close();
});

test('anonymous visitor sees the shared proposal read-only with a login link', async ({ browser }) => {
    const ctx = await browser.newContext(); // no storageState — logged out
    const page = await ctx.newPage();
    await page.goto(`/#/variants/${varId}`);

    await expect(page.getByText('US-7 shared proposal').first()).toBeVisible();
    // Read-only: no vote buttons, no comment form
    await expect(page.locator('.vote-btn')).toHaveCount(0);
    await expect(page.locator('#comment-text')).toHaveCount(0);
    // Invitation to log in
    await expect(page.getByRole('banner').getByRole('button', { name: /log in/i })).toBeVisible();
    await ctx.close();
});

test('anonymous visitor is blocked once sharing is disabled', async ({ browser }) => {
    const aliceCtx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
    const alicePage = await aliceCtx.newPage();
    await alicePage.goto(`/#/variants/${varId}`);
    await alicePage.locator('#share-variant-btn').click();
    await alicePage.locator('#share-anon-cb').uncheck();
    await alicePage.waitForTimeout(300);
    await aliceCtx.close();

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`/#/variants/${varId}`);
    await expect(anonPage.getByText(/US-7 shared proposal/)).toHaveCount(0);
    await anonCtx.close();
});
