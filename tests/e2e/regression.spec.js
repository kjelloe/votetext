'use strict';

// Regressions found in the 2026-10-02 frontend audit. Each test stays on one
// page across several actions — the bugs only showed after the first action.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.describe('signed in', () => {
    test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

    test('Reply still opens after the comment thread has been re-rendered', async ({ page }) => {
        const docId = await createDoc('Regression comments', 'A line to discuss at length.');
        const varId = await createVariant(docId, { char_start: 2, char_end: 6, new_text: 'row', title: 'Regression thread' });
        await page.goto(`/#/variants/${varId}`);
        await page.locator('#comment-text').fill('Thread starter');
        await page.locator('#post-comment-btn').click();
        const comment = page.locator('.comment', { hasText: 'Thread starter' });
        await expect(comment).toBeVisible();

        await comment.locator('.reply-btn').click();
        await expect(comment.locator('textarea')).toBeVisible();
        await comment.locator('.reply-btn').click();
        await expect(comment.locator('textarea')).toHaveCount(0);
    });

    test('Change status acts only on the document it was opened for', async ({ page }) => {
        const first = await createDoc('Regression status A', 'First document text.');
        const second = await createDoc('Regression status B', 'Second document text.');

        await page.goto(`/#/documents/${first}`);
        await page.locator('#doc-status-btn').click();
        await expect(page.locator('#modal-content button[data-status="draft"]')).toBeVisible();
        await page.locator('#modal-close').click();

        await page.goto(`/#/documents/${second}`);
        await expect(page.getByText('Second document text.')).toBeVisible();
        await page.locator('#doc-status-btn').click();
        await page.locator('#modal-content button[data-status="draft"]').click();
        const status = async id => (await apireq('GET', `/documents/${id}`, { cookie: aliceCookie() })).document.status;
        await expect.poll(() => status(second)).toBe('draft');
        expect(await status(first)).toBe('open');
    });

    test('a document without overlapping proposals can still move to final voting', async ({ page }) => {
        const docId = await createDoc('Regression no conflicts', 'One two three four five six seven.');
        await createVariant(docId, { char_start: 0, char_end: 3, new_text: 'Uno', title: 'No-conflict first' });
        await createVariant(docId, { char_start: 14, char_end: 18, new_text: 'vier', title: 'No-conflict second' });
        await setStatus(docId, 'voting');

        await page.goto(`/#/documents/${docId}/conflicts`);
        await expect(page.getByText('No conflicts to resolve')).toBeVisible();
        await page.getByRole('button', { name: /ready for final voting/i }).click();
        await expect(page).toHaveURL(new RegExp(`#/documents/${docId}$`));

        const d = await apireq('GET', `/documents/${docId}`, { cookie: aliceCookie() });
        expect(d.document.status).toBe('final_voting');
    });

    test('selecting text inside a highlighted line does not navigate away', async ({ page }) => {
        const docId = await createDoc('Regression select', 'Pick a phrase inside this highlighted line.');
        await createVariant(docId, { char_start: 0, char_end: 4, new_text: 'Take', title: 'Existing on the line' });
        await page.goto(`/#/documents/${docId}`);
        const line = page.locator('.line-text[data-variant-id]').first();
        await expect(line).toBeVisible();

        await line.evaluate(node => {
            const range = document.createRange();
            range.setStart(node.firstChild, 7);
            range.setEnd(node.firstChild, 13);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await expect(page).toHaveURL(new RegExp(`#/documents/${docId}$`));
    });
});

test('login: "Use different email" gives a working Send code button again', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('#email-input, input[type=email]').first().fill('regression-back@e2e.test');
    await page.locator('#send-btn').click();
    await expect(page.locator('#step-otp')).toBeVisible();
    await page.locator('#back-btn').click();
    await expect(page.locator('#send-btn')).toBeEnabled();
    await expect(page.locator('#send-btn')).toHaveText('Send code');
});
