'use strict';

// Phase K — every modal is a keyboard-reachable dialog: focus moves in, Escape cancels, Tab wraps, focus returns.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

const TEXT = 'Select this passage please.\nAnother plain line.';

test('opening a modal moves focus into it and announces it as a dialog; Escape closes and returns focus to the opener', async ({ page }) => {
    const docId = await createDoc('Phase K focus doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    const propose = page.locator('#propose-btn');
    await propose.focus();
    await page.keyboard.press('Enter');
    const box = page.locator('#modal-box');
    await expect(box).toHaveAttribute('role', 'dialog');
    await expect(box).toHaveAttribute('aria-modal', 'true');
    await expect(box).toHaveAttribute('aria-labelledby', 'modal-title');
    await expect(page.locator('#modal-title')).toHaveText('Propose variant');
    await expect(page.locator('#op-type')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(propose).toBeFocused();
});

test('Tab and Shift+Tab stay inside the dialog', async ({ page }) => {
    const docId = await createDoc('Phase K trap doc', TEXT);
    const varId = await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'Phase K parent' });
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#fork-variant-btn').click();
    await expect(page.locator('#fork-title')).toBeFocused();

    // Forward from the last control (Cancel) wraps to the × close button, the first focusable in the box
    await page.locator('#modal-box .modal-cancel').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#modal-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#modal-box .modal-cancel')).toBeFocused();

    // Closing with the × returns focus to the button that opened the dialog
    await page.locator('#modal-close').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#fork-variant-btn')).toBeFocused();
});

test('a dialog whose content is loaded later keeps its title label; Escape works from a non-field', async ({ page }) => {
    const docId = await createDoc('Phase K late doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    await page.locator('#access-btn').click();
    await expect(page.locator('#invite-search')).toBeVisible();
    await expect(page.locator('#modal-box')).toHaveAttribute('aria-labelledby', 'modal-title');
    await expect(page.locator('#modal-title')).toHaveText('Manage access');
    await page.locator('#invite-level').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#access-btn')).toBeFocused();
});
