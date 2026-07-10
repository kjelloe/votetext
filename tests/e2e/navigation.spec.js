'use strict';

// US-2 — Find and read a document

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, varId;

test.beforeAll(async () => {
    docId = await createDoc('US-2 Navigation doc', 'Alpha first line.\nBeta second line.\nGamma third line.');
    varId = await createVariant(docId, { char_start: 0, char_end: 5, new_text: 'Omega', title: 'US-2 proposal' });
});

test('document list shows title, status badge, and is clickable', async ({ page }) => {
    await page.goto('/#/documents');
    const card = page.locator('.doc-card', { hasText: 'US-2 Navigation doc' });
    await expect(card).toBeVisible();
    await expect(card.locator('.doc-card-meta')).toContainText(/open/i);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}$`));
    await expect(page.locator('#doc-lines-container')).toBeVisible();
});

test('lines covered by a proposal are highlighted', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.line-highlighted-pending').first()).toBeVisible();
});

test('sidebar filter toggles between All and On-page', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    const allBtn = page.locator('#filter-all-btn');
    const pageBtn = page.locator('#filter-page-btn');
    await expect(allBtn).toContainText('All 1');
    await pageBtn.click();
    await expect(pageBtn).toHaveClass(/btn-primary/);
    await expect(page.locator('.variant-card')).toHaveCount(1); // variant is on page 1
    await allBtn.click();
    await expect(allBtn).toHaveClass(/btn-primary/);
});

test('clicking a proposal card opens the proposal detail page', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await page.locator(`.variant-card[data-id="${varId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/variants/${varId}$`));
    await expect(page.getByText('US-2 proposal').first()).toBeVisible();
});

test('back-to-document button returns to the document view', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#back-to-doc-btn').click();
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}`));
    await expect(page.locator('#doc-lines-container')).toBeVisible();
});
