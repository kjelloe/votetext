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
