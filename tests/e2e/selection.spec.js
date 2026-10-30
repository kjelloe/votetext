'use strict';

// UC-24 — Selection toolbar: Propose / Variant floating on the text selection (desktop, mouse).
// The phone-sized, touch version of the same flows is in mobile.spec.js (Chromium project).

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

const TEXT = 'Select this passage please.\nAnother plain line.\nAnd a third one.';

// Select [from, to) inside the first line's text node and lift the mouse, as a reader would
async function selectWithMouse(page, from, to) {
    await page.evaluate(([a, b]) => {
        const span = document.querySelector('#doc-lines-container .line-text');
        const range = document.createRange();
        range.setStart(span.firstChild, a);
        range.setEnd(span.firstChild, b);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.querySelector('#doc-lines-container').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, [from, to]);
}

async function collapseSelection(page) {
    await page.evaluate(() => window.getSelection().removeAllRanges());
}

test('toolbar appears above a mouse selection; Propose opens the modal with the range; hides after submit', async ({ page }) => {
    const docId = await createDoc('UC-24 toolbar doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await expect(page.locator('#selection-toolbar')).toHaveCount(0);

    await selectWithMouse(page, 0, 6); // "Select"
    const bar = page.locator('#selection-toolbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-placement', 'above');
    await expect(bar.locator('#sel-variant-btn')).toHaveCount(0);
    const above = await page.evaluate(() => {
        const sel = window.getSelection().getRangeAt(0).getBoundingClientRect();
        const bar = document.getElementById('selection-toolbar').getBoundingClientRect();
        return bar.bottom <= sel.top;
    });
    expect(above).toBe(true);

    await bar.locator('#sel-propose-btn').click();
    await expect(bar).toBeHidden();
    await expect(page.getByText('Selected range: chars 0–6')).toBeVisible();
    await expect(page.locator('#propose-submit')).toBeEnabled();
    await page.locator('#new-text').fill('Choose');
    await page.locator('#var-title').fill('UC-24 from toolbar');
    await page.locator('#propose-submit').click();
    await expect(page).toHaveURL(/#\/variants\/\d+$/);
    await expect(page.getByText('UC-24 from toolbar').first()).toBeVisible();
    await expect(page.locator('#selection-toolbar')).toBeHidden();
});

test('collapsing the selection hides the toolbar; a selection outside the text panel shows none; the sidebar Propose button stays', async ({ page }) => {
    const docId = await createDoc('UC-24 collapse doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await selectWithMouse(page, 7, 11); // "this"
    await expect(page.locator('#selection-toolbar')).toBeVisible();
    await collapseSelection(page);
    await expect(page.locator('#selection-toolbar')).toBeHidden();
    await expect(page.locator('#propose-btn')).toBeVisible();

    // A later selection outside the text panel must not bring the bar back with the stale range
    await page.evaluate(() => {
        const header = document.querySelector('.doc-sidebar .sidebar-header');
        const range = document.createRange();
        range.selectNodeContents(header);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });
    await page.waitForTimeout(600);
    await expect(page.locator('#selection-toolbar')).toBeHidden();
});

test('a selection right under the sticky header flips the bar below it', async ({ page }) => {
    const docId = await createDoc('UC-24 flip doc', Array.from({ length: 60 }, (_, i) => `Filler line number ${i + 1} to make the page scroll.`).join('\n'));
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    // Scroll so the first line sits just below the header, leaving no room above it
    await page.evaluate(() => {
        const line = document.querySelector('#doc-lines-container .line-text');
        const headerBottom = document.getElementById('app-header').getBoundingClientRect().bottom;
        window.scrollBy(0, line.getBoundingClientRect().top - headerBottom - 4);
    });
    await selectWithMouse(page, 0, 6);
    const bar = page.locator('#selection-toolbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-placement', 'below');
    const clearOfHeader = await page.evaluate(() =>
        document.getElementById('selection-toolbar').getBoundingClientRect().top >= document.getElementById('app-header').getBoundingClientRect().bottom);
    expect(clearOfHeader).toBe(true);
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
});

test('selection over one pending proposal offers "Variant of #1" → fork modal → new proposal based on it', async ({ page }) => {
    const docId = await createDoc('UC-24 variant doc', TEXT);
    await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'UC-24 parent' });
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.line-highlighted-pending').first()).toBeVisible();

    await selectWithMouse(page, 2, 9); // overlaps chars 0–6
    const variantBtn = page.locator('#sel-variant-btn');
    await expect(variantBtn).toHaveText('Variant of #1');
    await variantBtn.click();
    await expect(page.locator('#fork-title')).toHaveValue('Your variant of UC-24 parent');
    await expect(page.locator('#fork-text')).toHaveValue('Pick');
    await page.locator('#fork-text').fill('Take');
    await page.locator('#fork-submit-btn').click();
    await expect(page).toHaveURL(/#\/variants\/\d+$/);
    await expect(page.locator('#variant-relations')).toContainText('based on #1 UC-24 parent');
});

test('selection over two pending proposals opens a chooser listing both', async ({ page }) => {
    const docId = await createDoc('UC-24 chooser doc', TEXT);
    await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'UC-24 first' });
    await createVariant(docId, { char_start: 7, char_end: 11, new_text: 'that', title: 'UC-24 second' });
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.line-highlighted-pending').first()).toBeVisible();

    await selectWithMouse(page, 3, 10); // overlaps both
    const variantBtn = page.locator('#sel-variant-btn');
    await expect(variantBtn).toHaveText('Variant…');
    await variantBtn.click();
    const choices = page.locator('.sel-variant-choice');
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toContainText('Variant of #1');
    await expect(choices.nth(1)).toContainText('UC-24 second');
    await choices.nth(1).click();
    await expect(page.locator('#fork-title')).toHaveValue('Your variant of UC-24 second');
    await expect(page.locator('#fork-text')).toHaveValue('that');
});

test('no toolbar on a resolved document (mirrors the hidden sidebar Propose button)', async ({ page }) => {
    const docId = await createDoc('UC-24 resolved doc', TEXT);
    const varId = await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'UC-24 resolved parent' });
    await setStatus(docId, 'voting');
    await setStatus(docId, 'final_voting');
    const cookie = aliceCookie();
    await apireq('PATCH', `/variants/${varId}/final-vote`, { body: { yes: 5, no: 1, abstain: 0 }, cookie });
    await apireq('PATCH', `/documents/${docId}/doc-vote`, { body: { yes: 10, no: 1, abstain: 0 }, cookie });
    await setStatus(docId, 'resolved');

    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await expect(page.locator('#propose-btn')).toHaveCount(0);
    await selectWithMouse(page, 0, 6);
    await page.waitForTimeout(500);
    await expect(page.locator('#selection-toolbar')).toBeHidden();
});
