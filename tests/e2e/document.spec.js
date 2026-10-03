'use strict';

// UC-1, UC-6, UC-8 and document deletion in the browser.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

test('new document: numbered lines are detected and stripped', async ({ page }) => {
    await page.goto('/#/documents');
    await page.locator('#create-doc-btn').click();
    await page.locator('#new-doc-title').fill('Numbered import');
    await page.locator('#new-doc-text').fill('1 Alpha line\n2 Beta line\n3 Gamma line\n4 Delta line');
    await expect(page.locator('#new-doc-format-notice')).toBeVisible();
    await expect(page.locator('#new-doc-format-label')).toHaveText('Numbered lines detected');
    await page.locator('#create-doc-submit').click();
    await expect(page).toHaveURL(/#\/documents\/\d+$/);
    const first = page.locator('.line-text').first();
    await expect(first).toHaveText('Alpha line');
});

test('copy: the new-document modal is prefilled from the source', async ({ page }) => {
    const docId = await createDoc('Source for copy', 'Copy me verbatim.\nSecond copied line.');
    await page.goto(`/#/documents/${docId}`);
    await page.locator('#doc-copy-btn').click();
    await expect(page.locator('#new-doc-title')).toHaveValue('Source for copy (copy)');
    await expect(page.locator('#new-doc-text')).toHaveValue('Copy me verbatim.\nSecond copied line.');
    await page.locator('#create-doc-submit').click();
    await expect(page).toHaveURL(new RegExp(`#/documents/(?!${docId}$)\\d+$`));
    await expect(page.getByRole('heading', { name: 'Source for copy (copy)' })).toBeVisible();
});

test('schedule voting shows the countdown banner; cancel removes it', async ({ page }) => {
    const docId = await createDoc('Countdown doc', 'Soon to be voted on.');
    await page.goto(`/#/documents/${docId}`);
    await page.locator('#doc-status-btn').click();
    await page.locator('#voting-transition-btn').click();
    await page.locator('#countdown-input').fill('5');
    await page.locator('#schedule-voting-btn').click();
    await expect(page.locator('#voting-banner')).toContainText('Voting opens in');
    await page.locator('#voting-banner-cancel').click();
    await expect(page.locator('#voting-banner')).toHaveCount(0);
    const d = await apireq('GET', `/documents/${docId}`, { cookie: aliceCookie() });
    expect(d.document.status).toBe('open');
    expect(d.document.voting_scheduled_at).toBeNull();
});

test('delete document from the settings modal', async ({ page }) => {
    const docId = await createDoc('Doomed doc', 'Going away.');
    await page.goto(`/#/documents/${docId}`);
    await page.locator('#doc-settings-btn').click();
    await page.locator('#delete-doc-btn').click();
    await page.locator('#delete-doc-ok').click();
    await expect(page).toHaveURL(/#\/documents$/);
    await expect(page.locator('.doc-card').first()).toBeVisible();
    await expect(page.locator('.doc-card', { hasText: 'Doomed doc' })).toHaveCount(0);
    const list = await apireq('GET', '/documents', { cookie: aliceCookie() });
    expect(list.documents.some(d => d.id === docId)).toBe(false);
});
