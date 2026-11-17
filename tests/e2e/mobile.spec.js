'use strict';

// UC-24 on a phone: Chromium "mobile" project only (375 px, touch). Playwright cannot drag native
// selection handles, so the selection is made programmatically and the finger lift is dispatched.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

const TEXT = 'Select this passage please.\nAnother plain line.\nAnd a third one.';

async function selectWithTouch(page, from, to) {
    await page.evaluate(([a, b]) => {
        const span = document.querySelector('#doc-lines-container .line-text');
        const range = document.createRange();
        range.setStart(span.firstChild, a);
        range.setEnd(span.firstChild, b);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.querySelector('#doc-lines-container').dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    }, [from, to]);
}

test('phone: the header keeps logo, account controls and the theme toggle inside the viewport', async ({ page }) => {
    await page.goto('/#/documents');
    await expect(page.locator('#theme-toggle')).toBeVisible();
    const r = await page.evaluate(() => {
        const bad = [...document.querySelectorAll('#app-header *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1);
        return { bad: bad.length, scroll: document.documentElement.scrollWidth, w: window.innerWidth };
    });
    expect(r.bad).toBe(0);
    expect(r.scroll).toBe(r.w);
});

test('phone: toolbar appears below the selection, inside the viewport; Propose opens the modal', async ({ page }) => {
    const docId = await createDoc('UC-24 phone doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();

    // The sidebar (with #propose-btn) stacks below the text on phones — the toolbar is the near path
    const sidebarBelowText = await page.evaluate(() =>
        document.querySelector('.doc-sidebar').getBoundingClientRect().top >= document.querySelector('.doc-text-panel').getBoundingClientRect().bottom);
    expect(sidebarBelowText).toBe(true);

    await selectWithTouch(page, 0, 6);
    const bar = page.locator('#selection-toolbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-placement', 'below');
    const geometry = await page.evaluate(() => {
        const sel = window.getSelection().getRangeAt(0).getBoundingClientRect();
        const bar = document.getElementById('selection-toolbar').getBoundingClientRect();
        return { below: bar.top >= sel.bottom, inside: bar.left >= 0 && bar.right <= window.innerWidth && bar.bottom <= window.innerHeight };
    });
    expect(geometry).toEqual({ below: true, inside: true });

    await bar.locator('#sel-propose-btn').tap();
    await expect(bar).toBeHidden();
    await expect(page.getByText('Selected range: chars 0–6')).toBeVisible();
    await expect(page.locator('#propose-submit')).toBeEnabled();
});

test('phone: "Variant of #1" on a touch selection opens the fork modal', async ({ page }) => {
    const docId = await createDoc('UC-24 phone variant doc', TEXT);
    await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'UC-24 phone parent' });
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.line-highlighted-pending').first()).toBeVisible();

    await selectWithTouch(page, 2, 9);
    const variantBtn = page.locator('#sel-variant-btn');
    await expect(variantBtn).toHaveText('Variant of #1');
    await variantBtn.tap();
    await expect(page.locator('#fork-title')).toHaveValue('Your variant of UC-24 phone parent');
});

test('phone: the modal is a bottom sheet; submitting stays on the document with a toast above the bottom bar', async ({ page }) => {
    const docId = await createDoc('UC-24 phone sheet doc', TEXT);
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();
    await selectWithTouch(page, 0, 6);
    await page.locator('#sel-propose-btn').tap();

    const sheet = await page.evaluate(() => {
        const box = document.getElementById('modal-box').getBoundingClientRect();
        return { anchoredBottom: Math.abs(box.bottom - window.innerHeight) < 2, fullWidth: box.width >= window.innerWidth - 2, rounded: parseFloat(getComputedStyle(document.getElementById('modal-box')).borderTopLeftRadius) > 0 };
    });
    expect(sheet).toEqual({ anchoredBottom: true, fullWidth: true, rounded: true });
    await expect(page.locator('.line-text.line-selected')).toHaveCount(1);
    // The sheet itself takes focus, so the on-screen keyboard does not open before the reader has seen it
    await expect(page.locator('#modal-box')).toBeFocused();

    await page.locator('#new-text').fill('Choose');
    await page.locator('#var-title').fill('UC-24 phone proposal');
    await page.locator('#propose-submit').tap();
    await expect(page).toHaveURL(new RegExp(`#/documents/${docId}$`));
    await expect(page.locator('.toast', { hasText: 'Proposal #1 added' })).toBeVisible();
    await expect(page.locator('#bottom-proposals-btn')).toHaveText('1 proposal');
    const toastAboveBar = await page.evaluate(() =>
        document.querySelector('.toast').getBoundingClientRect().bottom <= document.getElementById('doc-bottom-bar').getBoundingClientRect().top);
    expect(toastAboveBar).toBe(true);
});

test('phone: sticky bottom bar opens the proposal list as a sheet; a card opens the proposal; Propose works from the bar', async ({ page }) => {
    const docId = await createDoc('UC-25 phone list doc', TEXT);
    await createVariant(docId, { char_start: 0, char_end: 6, new_text: 'Pick', title: 'UC-25 phone first' });
    const second = await createVariant(docId, { char_start: 7, char_end: 11, new_text: 'that', title: 'UC-25 phone second' });
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('#doc-lines-container')).toBeVisible();

    const bar = page.locator('#doc-bottom-bar');
    await expect(bar).toBeVisible();
    const fixedAtBottom = await page.evaluate(() => Math.abs(document.getElementById('doc-bottom-bar').getBoundingClientRect().bottom - window.innerHeight) < 2);
    expect(fixedAtBottom).toBe(true);
    await expect(page.locator('#bottom-proposals-btn')).toHaveText('2 proposals');

    await page.locator('#bottom-proposals-btn').tap();
    await expect(page.locator('#variants-list-sheet .variant-card')).toHaveCount(2);
    await page.locator('#modal-content .proposal-sort').selectOption('newest');
    await expect(page.locator('#variants-list-sheet .variant-card').first()).toContainText('UC-25 phone second');
    await page.locator(`#variants-list-sheet .variant-card[data-id="${second}"]`).tap();
    await expect(page).toHaveURL(new RegExp(`#/variants/${second}$`));
    await expect(page.locator('#modal-overlay')).toBeHidden();

    await page.goto(`/#/documents/${docId}`);
    await page.locator('#bottom-propose-btn').tap();
    await expect(page.getByText(/No text selected/)).toBeVisible();
});
