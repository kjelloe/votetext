'use strict';

// UC-23: automatic page detection on import (creators and superadmins).

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, rootCookie, AUTH_DIR } = require('./helpers');

const PAGED = [
    '*Page 1 - full screen picture*', '', '---', '*Page 2*', '', '## Innhold', '## Kapittel 1 ....', '', '---',
    '*Page 3*', '', '#   1  Kapittel 1: Mulighetenes by', '  2  Den handler om', '  3  Tre', '  4  Fire', '  5  Fem', '  6  ', '', '---',
    '*Page 4*', '', '##  7  2.1 Barnehagen', '  8  Åtte', '  9  Ni', ' 10  Ti', ' 11  Elleve', '',
].join('\n');

test('superadmin: paged markdown preselects Auto, keeps source page numbers and shows empty title pages', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'root.json') });
    const page = await ctx.newPage();
    await page.goto('/#/documents');
    await page.locator('#create-doc-btn').click();
    await page.locator('#new-doc-title').fill('Paged import');
    await page.locator('#new-doc-text').fill(PAGED);
    await expect(page.locator('#new-doc-format-label')).toHaveText('Page breaks detected — 4 pages, 11 numbered lines, 2 unnumbered lines skipped');
    await expect(page.locator('#new-doc-lpp')).toHaveValue('auto');
    await expect(page.locator('#new-doc-keep-label')).toBeVisible();
    await page.locator('#create-doc-submit').click();
    await expect(page).toHaveURL(/#\/documents\/\d+$/);
    await expect(page.locator('.pagination-info')).toHaveText('Page 1 of 4');
    await expect(page.locator('.empty-page-note')).toBeVisible();
    await page.locator('#doc-pagination button[data-page="2"]').click();
    await expect(page.locator('.empty-page-note')).toBeVisible();
    await page.locator('#doc-pagination button[data-page="3"]').click();
    await expect(page.locator('.pagination-info')).toHaveText('Page 3 of 4');
    await expect(page.locator('.line-num').first()).toHaveText('1');
    await expect(page.locator('.line-text').first()).toHaveText('# Kapittel 1: Mulighetenes by');
    await page.locator('#doc-pagination button[data-page="4"]').click();
    await expect(page.locator('.line-num').first()).toHaveText('7');
    await expect(page.locator('.line-num').last()).toHaveText('11');
    await ctx.close();
});

test('creator: Auto is offered and preselected for paged markdown as well', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
    const page = await ctx.newPage();
    await page.goto('/#/documents');
    await page.locator('#create-doc-btn').click();
    await expect(page.locator('#new-doc-lpp')).toHaveValue('30');
    await page.locator('#new-doc-text').fill(PAGED);
    await expect(page.locator('#new-doc-lpp')).toHaveValue('auto');
    await expect(page.locator('#new-doc-format-label')).toContainText('4 pages, 11 numbered lines');
    await page.locator('#new-doc-title').fill('Creator paged import');
    await page.locator('#create-doc-submit').click();
    await expect(page).toHaveURL(/#\/documents\/\d+$/);
    await expect(page.locator('.pagination-info')).toHaveText('Page 1 of 4');
    await ctx.close();
});

test('superadmin: the page link on a proposal names the printed page, and Copy re-imports the same pages', async ({ browser }) => {
    const cookie = rootCookie();
    const created = await apireq('POST', '/documents', { body: { title: 'Paged source', text: PAGED, settings: { lines_per_page: 'auto' } }, cookie });
    const docId = created.document.id;
    await apireq('POST', `/documents/${docId}/status`, { body: { status: 'open' }, cookie });
    const text = (await apireq('GET', `/documents/${docId}/text`, { cookie })).text;
    const start = text.indexOf('Ni');
    await apireq('POST', `/documents/${docId}/variants`, { body: { char_start: start, char_end: start + 2, operation: 'replace', new_text: 'Nine', title: 'On page four' }, cookie });

    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'root.json') });
    const page = await ctx.newPage();
    await page.goto(`/#/documents/${docId}`);
    const card = page.locator('.variant-card', { hasText: 'On page four' });
    await expect(card).toContainText('line 9');
    await card.hover();
    await expect(card.locator('.goto-link')).toHaveText('↗ p.4');
    await card.locator('.goto-link').click();
    await expect(page.locator('.pagination-info')).toHaveText('Page 4 of 4');
    await expect(page.locator('.line-text.has-variant')).toHaveText('Ni');

    await page.locator('#doc-copy-btn').click();
    await expect(page.locator('#new-doc-title')).toHaveValue('Paged source (copy)');
    await expect(page.locator('#new-doc-text')).toHaveValue(/^\*Page 1\*\n---\n\*Page 2\*\n---\n\*Page 3\*\n1  # Kapittel 1/);
    await expect(page.locator('#new-doc-lpp')).toHaveValue('auto');
    await page.locator('#copy-proposals').check();
    await page.locator('#create-doc-submit').click();
    await expect(page).toHaveURL(new RegExp(`#/documents/(?!${docId}$)\\d+$`));
    await expect(page.locator('.pagination-info')).toHaveText('Page 1 of 4');
    await expect(page.locator('.variant-card', { hasText: 'On page four' })).toContainText('line 9');
    await page.locator('#doc-pagination button[data-page="2"]').click();
    await page.locator('#doc-pagination button[data-page="3"]').click();
    await expect(page.locator('.pagination-info')).toHaveText('Page 3 of 4');
    await expect(page.locator('.line-num').first()).toHaveText('1');
    await ctx.close();
});
