'use strict';

// UC-16 in the browser: fork a proposal, see the "based on" link both ways.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

test('fork a proposal → new proposal links back to the original', async ({ page }) => {
    const docId = await createDoc('Fork doc', 'The original wording stands here.');
    const varId = await createVariant(docId, { char_start: 4, char_end: 12, new_text: 'initial', title: 'Fork me' });
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#fork-variant-btn').click();
    await expect(page.locator('#fork-title')).toHaveValue('Your variant of Fork me');
    await page.locator('#fork-text').fill('first');
    await page.locator('#fork-submit-btn').click();
    await expect(page).toHaveURL(new RegExp(`#/variants/(?!${varId}$)\\d+$`));
    await expect(page.locator('#variant-relations')).toContainText('based on #1 Fork me');

    await page.goto(`/#/variants/${varId}`);
    await expect(page.locator('#variant-relations')).toContainText('forked as #2');
});
