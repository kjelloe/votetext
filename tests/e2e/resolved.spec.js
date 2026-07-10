'use strict';

// US-10 — Read the resolved document (banner, exports, Mark as Resolved)

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

async function docReadyToResolve(title) {
    const docId = await createDoc(title, 'Original leading words.\nA second sentence line.');
    const varId = await createVariant(docId, { char_start: 0, char_end: 8, new_text: 'Improved', title: `${title} variant` });
    await setStatus(docId, 'voting');
    await setStatus(docId, 'final_voting');
    const cookie = aliceCookie();
    await apireq('PATCH', `/variants/${varId}/final-vote`, { body: { yes: 5, no: 1, abstain: 0 }, cookie });
    await apireq('PATCH', `/documents/${docId}/doc-vote`, { body: { yes: 10, no: 1, abstain: 0 }, cookie });
    return docId;
}

test('Mark as Resolved from the UI → PASSED banner with timestamp', async ({ page }) => {
    const docId = await docReadyToResolve('US-10 UI resolve');
    await page.goto(`/#/documents/${docId}/resolved-text`);
    await expect(page.locator('.resolved-text-view')).toBeVisible();

    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: /mark as resolved/i }).click();

    await expect(page.getByText('PASSED').first()).toBeVisible();
    // Resolved text contains the applied variant
    await expect(page.locator('.resolved-text-view')).toContainText('Improved');
});

test('Export Markdown downloads a .md file', async ({ page }) => {
    const docId = await docReadyToResolve('US-10 export doc');
    await setStatus(docId, 'resolved');
    await page.goto(`/#/documents/${docId}/resolved-text`);
    await expect(page.locator('.resolved-text-view')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export markdown/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
});

test('Print HTML opens a printable tab with the resolved text', async ({ page }) => {
    const docId = await docReadyToResolve('US-10 print doc');
    await setStatus(docId, 'resolved');
    await page.goto(`/#/documents/${docId}/resolved-text`);
    await expect(page.locator('.resolved-text-view')).toBeVisible();

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: /print html/i }).click();
    const popup = await popupPromise;
    await expect(popup.getByText('Improved').first()).toBeVisible();
});

test('resolved doc shows Resolved text button in the document toolbar', async ({ page }) => {
    const docId = await docReadyToResolve('US-10 toolbar doc');
    await setStatus(docId, 'resolved');
    await page.goto(`/#/documents/${docId}`);
    await expect(page.getByRole('link', { name: /resolved text/i }).or(page.getByRole('button', { name: /resolved text/i })).first()).toBeVisible();
});
