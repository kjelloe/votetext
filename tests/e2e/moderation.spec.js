'use strict';

// UC-18 in the browser: hide a comment and a proposal, see them on the
// moderation page, restore them. Alice owns the document; bob commented.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, bobCookie, createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, varId;

test.beforeAll(async () => {
    docId = await createDoc('Moderation doc', 'A line that attracts spam comments.');
    varId = await createVariant(docId, { char_start: 2, char_end: 6, new_text: 'row', title: 'Moderated proposal' });
    await apireq('POST', `/documents/${docId}/access`, { body: { email: 'bob@e2e.test', access_level: 'voter' }, cookie: aliceCookie() });
    await apireq('POST', `/variants/${varId}/comments`, { body: { text: 'Buy garden gnomes here' }, cookie: bobCookie() });
});

test('hide a comment, see it on the moderation page, unhide it', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    const comment = page.locator('.comment', { hasText: 'Buy garden gnomes here' });
    page.once('dialog', d => d.accept());
    await comment.locator('.hide-comment-btn').click();
    await expect(page.getByText('Comment hidden by moderator')).toBeVisible();

    await page.goto(`/#/documents/${docId}/moderation`);
    await expect(page.locator('#mod-comment-list')).toContainText('Buy garden gnomes here');
    await page.locator('.mod-unhide-comment').click();
    await expect(page.locator('#mod-comment-list')).toContainText('No moderator-hidden comments');
});

test('hide a proposal and restore it', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    page.once('dialog', d => d.accept());
    await page.locator('#mod-hide-btn').click();
    await expect(page.getByText(/hidden by moderator — participants cannot see/i)).toBeVisible();
    const list = await apireq('GET', `/documents/${docId}/variants`, { cookie: bobCookie() });
    expect(list.variants.some(v => v.id === varId)).toBe(false);

    await page.goto(`/#/documents/${docId}/moderation`);
    await expect(page.locator('#mod-variant-list')).toContainText('Moderated proposal');
    await page.locator('.mod-unhide-variant').click();
    await expect(page.locator('#mod-variant-list')).toContainText('No hidden proposals');
});
