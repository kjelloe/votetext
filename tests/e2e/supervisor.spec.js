'use strict';

// UC-19 in the browser: a supervisor who does not own the document runs the
// whole voting cycle — start voting, order conflicts (keyboard controls),
// record tallies, resolve. Bob is the supervisor; alice owns the documents.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, bobCookie, createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'bob.json') });

const status = async id => (await apireq('GET', `/documents/${id}`, { cookie: bobCookie() })).document.status;

async function docWithSupervisor(title, text) {
    const docId = await createDoc(title, text);
    await apireq('POST', `/documents/${docId}/access`, { body: { email: 'bob@e2e.test', access_level: 'supervisor' }, cookie: aliceCookie() });
    return docId;
}

test.describe('supervisor voting cycle', () => {
    let docId;

    test.beforeAll(async () => {
        docId = await docWithSupervisor('Supervisor cycle', 'First sentence here.\nSecond sentence there.\nThird one.');
        await createVariant(docId, { char_start: 0, char_end: 5, new_text: 'Prime', title: 'Cycle A' });
        await createVariant(docId, { char_start: 21, char_end: 27, new_text: 'Next', title: 'Cycle B' });
    });

    test('starts voting from the document page', async ({ page }) => {
        await page.goto(`/#/documents/${docId}`);
        await expect(page.locator('#doc-status-btn')).toBeVisible();
        await expect(page.locator('#doc-settings-btn')).toHaveCount(0);
        await page.locator('#doc-status-btn').click();
        await page.locator('#voting-transition-btn').click();
        await page.locator('#countdown-input').fill('0');
        await page.locator('#schedule-voting-btn').click();
        await expect.poll(() => status(docId)).toBe('voting');
    });

    test('moves to final voting and records tallies until the blocker banner clears', async ({ page }) => {
        await page.goto(`/#/documents/${docId}/conflicts`);
        await page.getByRole('button', { name: /ready for final voting/i }).click();
        await expect.poll(() => status(docId)).toBe('final_voting');

        await page.goto(`/#/documents/${docId}/final-vote`);
        await expect(page.locator('.fv-card')).toHaveCount(2);
        await expect(page.locator('#fv-progress')).toHaveText('0 of 2 proposals recorded');
        await expect(page.locator('#fv-blockers')).toContainText('no tally yet');
        for (const card of await page.locator('.fv-card').all()) {
            await card.locator('[name=yes]').fill('7');
            await card.locator('[name=no]').fill('2');
            await card.locator('.fv-save-btn').click();
            await expect(card.locator('.fv-saved-indicator')).toBeVisible();
        }
        await expect(page.locator('#fv-progress')).toHaveText('2 of 2 proposals recorded');
        await expect(page.locator('#fv-blockers')).toBeHidden();
    });

    test('resolves the document; with no overall vote the banner says RESOLVED', async ({ page }) => {
        // Self-contained: its own final_voting document with tallies, so it does not depend on the tests above
        const own = await docWithSupervisor('Supervisor resolve', 'Alpha beta gamma.');
        const v = await createVariant(own, { char_start: 0, char_end: 5, new_text: 'Prime', title: 'Resolve me' });
        await apireq('POST', `/documents/${own}/status`, { body: { status: 'voting' }, cookie: aliceCookie() });
        await apireq('POST', `/documents/${own}/status`, { body: { status: 'final_voting' }, cookie: aliceCookie() });
        await apireq('PATCH', `/variants/${v}/final-vote`, { body: { yes: 4, no: 1, abstain: 0 }, cookie: bobCookie() });

        await page.goto(`/#/documents/${own}/resolved-text`);
        await expect(page.locator('.resolved-text-view')).toBeVisible();
        const dialogs = [];
        page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
        const response = page.waitForResponse(r => r.url().endsWith(`/documents/${own}/status`) && r.request().method() === 'POST');
        await page.getByRole('button', { name: /mark as resolved/i }).click();
        expect((await response).status(), dialogs.join(' | ')).toBe(200);
        await expect.poll(() => status(own)).toBe('resolved');
        await expect(page.locator('.alert-neutral')).toContainText('RESOLVED');
        await expect(page.locator('.resolved-text-view')).toContainText('Prime');
    });
});

test('conflicts can be ordered without drag-and-drop', async ({ page }) => {
    const docId = await docWithSupervisor('Keyboard ordering', 'Overlapping proposals live on this line.');
    await createVariant(docId, { char_start: 0, char_end: 11, new_text: 'Clashing', title: 'KB first' });
    await createVariant(docId, { char_start: 5, char_end: 20, new_text: 'Colliding', title: 'KB second' });
    await apireq('POST', `/documents/${docId}/status`, { body: { status: 'voting' }, cookie: aliceCookie() });

    await page.goto(`/#/documents/${docId}/conflicts`);
    await expect(page.locator('.conflict-badge-warn')).toBeVisible();
    await page.getByRole('button', { name: '+ root' }).first().click();
    await expect(page.locator('.conflict-order-badge')).toHaveCount(1);
    await page.locator('.conflict-card-unordered select').selectOption({ index: 1 });
    await expect(page.locator('.conflict-card-child')).toHaveCount(1);
    await expect(page.locator('.conflict-badge-ok')).toBeVisible();
    await expect(page.locator('.conflict-ready-btn')).toHaveClass(/btn-success/);
});

test('a voter sees no supervisor controls and the review page refuses', async ({ page }) => {
    const docId = await createDoc('Voter view', 'Nothing to run here.');
    await apireq('POST', `/documents/${docId}/access`, { body: { email: 'bob@e2e.test', access_level: 'voter' }, cookie: aliceCookie() });
    await apireq('POST', `/documents/${docId}/status`, { body: { status: 'voting' }, cookie: aliceCookie() });
    await page.goto(`/#/documents/${docId}`);
    await expect(page.getByText('Nothing to run here.')).toBeVisible();
    await expect(page.locator('#doc-status-btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review' })).toHaveCount(0);
    await page.goto(`/#/documents/${docId}/review`);
    await expect(page.getByText(/supervisor access or higher is required/i)).toBeVisible();
});
