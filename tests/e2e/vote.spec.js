'use strict';

// US-6 — Vote on proposals (cast, change, retract)

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, varId;

test.beforeAll(async () => {
    docId = await createDoc('US-6 Vote doc', 'Vote on the first line.\nSecond line stays.');
    varId = await createVariant(docId, { char_start: 0, char_end: 4, new_text: 'Ballot', title: 'US-6 votable' });
});

test('cast, change, and retract a vote — counts update live', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);

    const forBtn = page.locator('.vote-btn[data-value="1"]');
    const againstBtn = page.locator('.vote-btn[data-value="-1"]');
    const abstainBtn = page.locator('.vote-btn[data-value="0"]');
    await expect(forBtn).toContainText('0');

    // Cast For
    await forBtn.click();
    await expect(forBtn).toContainText('1');
    await expect(forBtn).toHaveClass(/active-for/);

    // Change to Against
    await againstBtn.click();
    await expect(forBtn).toContainText('0');
    await expect(againstBtn).toContainText('1');
    await expect(againstBtn).toHaveClass(/active-against/);
    await expect(forBtn).not.toHaveClass(/active-for/);

    // Click Against again → retract entirely
    await againstBtn.click();
    await expect(againstBtn).toContainText('0');
    await expect(againstBtn).not.toHaveClass(/active-against/);

    // Abstain works too
    await abstainBtn.click();
    await expect(abstainBtn).toContainText('1');
    await expect(abstainBtn).toHaveClass(/active-abstain/);
});

test('sidebar card shows the running tally', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    const card = page.locator(`.variant-card[data-id="${varId}"]`);
    await expect(card.locator('.vote-mini-abstain')).toContainText('1');
});
