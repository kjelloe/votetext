'use strict';

// XSS guard rail — user-supplied content (document title, variant title,
// rationale, proposed text, comments) must render as inert text via esc(),
// never as live markup. Protects the innerHTML-template pattern through the
// visual design pass.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

const IMG_PAYLOAD = '<img src=x onerror="window.__xss=1">';
const SCRIPT_PAYLOAD = '<script>window.__xss = 2;</script>';

let docId, varId;

test.beforeAll(async () => {
    docId = await createDoc(`XSS doc ${IMG_PAYLOAD}`, 'Injection target line one.\nSecond line filler text.');
    varId = await createVariant(docId, {
        char_start: 0,
        char_end: 9,
        new_text: `replacement ${SCRIPT_PAYLOAD}`,
        title: `XSS variant ${IMG_PAYLOAD}`,
        rationale: `because ${SCRIPT_PAYLOAD}`,
    });
    await apireq('POST', `/variants/${varId}/comments`, {
        body: { text: `comment ${IMG_PAYLOAD} ${SCRIPT_PAYLOAD}` },
        cookie: aliceCookie(),
    });
});

test('document view renders a hostile title as text, not markup', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.doc-text-header h2')).toContainText(`XSS doc ${IMG_PAYLOAD}`);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('.doc-text-header img').count()).toBe(0);
});

test('variant page renders hostile title, rationale, diff and comment as text', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    await expect(page.getByText(`XSS variant ${IMG_PAYLOAD}`)).toBeVisible();
    await expect(page.getByText(`because ${SCRIPT_PAYLOAD}`)).toBeVisible();
    await expect(page.locator('.comment', { hasText: 'comment <img' })).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('.variant-layout img, .variant-layout script').count()).toBe(0);
});

test('document list renders the hostile title inertly', async ({ page }) => {
    await page.goto('/#/documents');
    await expect(page.locator('.doc-card', { hasText: 'XSS doc <img' }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
