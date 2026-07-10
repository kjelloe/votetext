'use strict';

// US-4 — Propose a text change (selection → modal → submit)
// US-5 — Edit or withdraw a proposal

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId;

test.beforeAll(async () => {
    docId = await createDoc('US-4 Propose doc', 'Select this passage please.\nAnother plain line.\nAnd a third one.');
});

async function selectFirstWords(page, chars) {
    await page.evaluate((n) => {
        const span = document.querySelector('#doc-lines-container .line-text');
        const range = document.createRange();
        range.setStart(span.firstChild, 0);
        range.setEnd(span.firstChild, n);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.querySelector('#doc-lines-container').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, chars);
}

test('US-4: select text → propose modal → submit → proposal appears', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();

    await selectFirstWords(page, 6); // "Select"
    await page.locator('#propose-btn').click();

    await expect(page.locator('#propose-submit')).toBeEnabled();
    await expect(page.getByText('Selected range: chars 0–6')).toBeVisible();
    await page.locator('#new-text').fill('Choose');
    await page.locator('#var-title').fill('US-4 proposed change');
    await page.locator('#var-rationale').fill('Clearer verb');
    await page.locator('#propose-submit').click();

    // Success navigates to the new proposal detail page
    await expect(page).toHaveURL(/#\/variants\/\d+$/);
    await expect(page.getByText('US-4 proposed change').first()).toBeVisible();

    // Back on the document, the sidebar shows the new card and the line is amber
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.variant-card', { hasText: 'US-4 proposed change' })).toBeVisible();
    await expect(page.locator('.line-highlighted-pending').first()).toBeVisible();
});

test('US-4: propose modal without selection keeps submit disabled', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await page.locator('#propose-btn').click();
    await expect(page.locator('#propose-submit')).toBeDisabled();
    await expect(page.getByText(/No text selected/)).toBeVisible();
});

test('US-5: edit own proposal — title and rationale update', async ({ page }) => {
    const varId = await createVariant(docId, {
        char_start: 28, char_end: 35, new_text: 'Different', title: 'US-5 original title',
    });
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#edit-variant-btn').click();
    await page.locator('#edit-title').fill('US-5 refined title');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('US-5 refined title').first()).toBeVisible();
});

test('US-5: withdraw own proposal — confirms and disappears from sidebar', async ({ page }) => {
    const varId = await createVariant(docId, {
        char_start: 45, char_end: 50, new_text: 'Gone', title: 'US-5 withdraw me',
    });
    await page.goto(`/#/variants/${varId}`);
    page.on('dialog', d => d.accept());
    await page.locator('#withdraw-variant-btn').click();
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}`));
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await expect(page.locator('.variant-card', { hasText: 'US-5 withdraw me' })).toHaveCount(0);
});
