'use strict';

// US-8 — Supervisor: review proposals and resolve conflicts.
// Drag-and-drop ordering uses HTML5 DnD (flaky under automation), so ordering
// is set via the API and the UI is asserted to reflect it.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, varA, varB, varC;

test.beforeAll(async () => {
    docId = await createDoc('US-8 Review doc', 'Overlapping target text.\nAn unrelated second line.\nA third line.');
    // varA and varB overlap (chars 0–11 vs 5–15); varC is separate
    varA = await createVariant(docId, { char_start: 0, char_end: 11, new_text: 'AAA', title: 'US-8 overlap A' });
    varB = await createVariant(docId, { char_start: 5, char_end: 15, new_text: 'BBB', title: 'US-8 overlap B' });
    varC = await createVariant(docId, { char_start: 25, char_end: 27, new_text: 'CC', title: 'US-8 standalone C' });
    await setStatus(docId, 'voting');
});

test('review view lists proposals with action buttons and overlap badge', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/review`);
    await expect(page.locator('.review-layout')).toBeVisible();
    const cardA = page.locator('.review-card', { hasText: 'US-8 overlap A' }).first();
    await expect(cardA).toBeVisible();
    await expect(page.locator('.review-overlap-badge').first()).toBeVisible();
    await expect(cardA.locator('.review-btn-conflict')).toBeVisible();
});

test('CONFLICT and NOT VOTING buttons update proposal status', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/review`);

    // Mark both overlapping proposals as CONFLICT
    for (const title of ['US-8 overlap A', 'US-8 overlap B']) {
        const card = page.locator('.review-card', { hasText: title }).first();
        await card.locator('.review-btn-conflict').click();
        await expect(card.locator('.review-btn-conflict')).toHaveClass(/review-btn-active/);
    }

    // Mark the standalone proposal NOT VOTING
    const cardC = page.locator('.review-card', { hasText: 'US-8 standalone C' }).first();
    await cardC.locator('.review-btn-danger', { hasText: 'NOT VOTING' }).click();
    await expect(cardC.locator('.review-btn-danger', { hasText: 'NOT VOTING' })).toHaveClass(/review-btn-active/);
});

test('conflict resolution view shows the unresolved group; Ready is gated', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/conflicts`);
    await expect(page.locator('.conflict-group').first()).toBeVisible();
    await expect(page.locator('.conflict-badge-warn').first()).toBeVisible();

    const readyBtn = page.locator('.conflict-ready-btn');
    await expect(readyBtn).toHaveClass(/btn-warning/);
    page.once('dialog', d => d.accept());
    await readyBtn.click(); // refuses with an alert while unresolved
    // Still in voting: conflicts view stays put
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}/conflicts`));
});

test('ordered group turns Ready green; clicking transitions to final voting', async ({ page }) => {
    // Order the group via API (drag-equivalent): A root #1, B child of A
    await apireq('PATCH', `/variants/${varA}/conflict-order`, { body: { vote_order: 1 }, cookie: aliceCookie() });
    await apireq('PATCH', `/variants/${varB}/conflict-order`, { body: { parent_variant_id: varA }, cookie: aliceCookie() });

    await page.goto(`/#/documents/${docId}/conflicts`);
    await expect(page.locator('.conflict-badge-ok')).toBeVisible();
    await expect(page.locator('.conflict-order-badge').first()).toHaveText('1');
    await expect(page.locator('.conflict-child-badge')).toContainText(`child of`);

    const readyBtn = page.locator('.conflict-ready-btn');
    await expect(readyBtn).toHaveClass(/btn-success/);
    await readyBtn.click();
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}$`));

    // Review toolbar now shows the final-voting state
    await page.goto(`/#/documents/${docId}/review`);
    await expect(page.getByText(/final voting/i).first()).toBeVisible();
});
