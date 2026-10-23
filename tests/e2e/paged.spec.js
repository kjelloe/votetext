'use strict';

// UC-23: automatic page detection on import — superadmin only.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { AUTH_DIR } = require('./helpers');

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

test('creator: no Auto option — paged markdown falls back to a fixed detected page size', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
    const page = await ctx.newPage();
    await page.goto('/#/documents');
    await page.locator('#create-doc-btn').click();
    await expect(page.locator('#new-doc-lpp option[value="auto"]')).toHaveCount(0);
    await page.locator('#new-doc-text').fill(PAGED);
    await expect(page.locator('#new-doc-format-label')).toHaveText('Page breaks detected — 5 lines/page');
    await expect(page.locator('#new-doc-keep-label')).toBeHidden();
    await ctx.close();
});
