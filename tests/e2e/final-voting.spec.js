'use strict';

// US-9 — Supervisor: run the final vote and record results

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, parentVar, childVar, soloVar;

test.beforeAll(async () => {
    docId = await createDoc('US-9 Final vote doc', 'Parent target words.\nAnother separate line.\nA final line.');
    parentVar = await createVariant(docId, { char_start: 0, char_end: 13, new_text: 'PPP', title: 'US-9 parent' });
    childVar  = await createVariant(docId, { char_start: 7, char_end: 19, new_text: 'ccc', title: 'US-9 child' });
    soloVar   = await createVariant(docId, { char_start: 21, char_end: 28, new_text: 'sss', title: 'US-9 solo' });
    await setStatus(docId, 'voting');
    const cookie = aliceCookie();
    await apireq('PATCH', `/variants/${parentVar}/conflict-order`, { body: { vote_order: 1 }, cookie });
    await apireq('PATCH', `/variants/${childVar}/conflict-order`, { body: { parent_variant_id: parentVar }, cookie });
    await setStatus(docId, 'final_voting');
});

test('walkthrough renders in document order with progress at zero', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    await expect(page.locator('.fv-list')).toBeVisible();
    await expect(page.locator('#fv-progress')).toContainText('0 of 3');
    // Child indented beneath its parent
    await expect(page.getByText(/child of/i).first()).toBeVisible();
});

test('recording a tally saves, shows majority, and advances progress', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    const soloCard = page.locator('.fv-card', { hasText: 'US-9 solo' }).first();

    await soloCard.locator('input[name="yes"]').fill('7');
    await soloCard.locator('input[name="no"]').fill('3');
    await soloCard.locator('input[name="abstain"]').fill('1');
    await soloCard.locator('.fv-save-btn').click();

    await expect(soloCard.locator('.fv-saved-indicator')).toBeVisible();
    await expect(soloCard.locator('.fv-majority')).toContainText('70% yes'); // 7/(7+3) simple
    await expect(soloCard.locator('.fv-majority')).toHaveClass(/fv-majority-pass/);
    await expect(page.locator('#fv-progress')).toContainText('1 of 3');

    // Values persist on reload
    await page.reload();
    const reloaded = page.locator('.fv-card', { hasText: 'US-9 solo' }).first();
    await expect(reloaded.locator('input[name="yes"]')).toHaveValue('7');
});

test('threshold dropdown recalculates the majority label immediately', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    const soloCard = page.locator('.fv-card', { hasText: 'US-9 solo' }).first();

    await soloCard.locator('.fv-threshold-sel').selectOption('two_thirds');
    // Denominator becomes 7+3+1=11 → 64%, and 3×7=21 < 2×11=22 → fails ⅔
    await expect(soloCard.locator('.fv-majority')).toContainText('64% yes — needs ⅔ majority');
    await expect(soloCard.locator('.fv-majority')).toHaveClass(/fv-majority-fail/);

    // Back to doc default → simple again
    await soloCard.locator('.fv-threshold-sel').selectOption('');
    await expect(soloCard.locator('.fv-majority')).toContainText('70% yes');
});

test('child proposal greys out when its parent passes', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    const parentCard = page.locator('.fv-card', { hasText: 'US-9 parent' }).first();

    await parentCard.locator('input[name="yes"]').fill('9');
    await parentCard.locator('input[name="no"]').fill('2');
    await parentCard.locator('input[name="abstain"]').fill('0');
    await parentCard.locator('.fv-save-btn').click();

    await expect(parentCard.getByText(/passed/i).first()).toBeVisible();
    await expect(page.locator('.fv-card-child-skipped')).toHaveCount(1);
    await expect(page.getByText(/parent passed/i).first()).toBeVisible();
});

test('audit trail expands with the recorded save', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    const soloCard = page.locator('.fv-card', { hasText: 'US-9 solo' }).first();
    await soloCard.locator('.fv-audit-btn').click();
    await expect(soloCard.locator('.fv-audit-entry').first()).toContainText('yes=7');
});

test('overall document vote saves and persists', async ({ page }) => {
    await page.goto(`/#/documents/${docId}/final-vote`);
    await page.locator('#dv-yes').fill('40');
    await page.locator('#dv-no').fill('5');
    await page.locator('#dv-abstain').fill('2');
    await page.locator('#dv-save').click();
    await expect(page.locator('#dv-saved')).toBeVisible();

    await page.reload();
    await expect(page.locator('#dv-yes')).toHaveValue('40');
});
