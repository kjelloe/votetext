'use strict';

// US-3 — Read and comment on a proposal.
// Covered here: post, reply (indented), edit own comment within the window
// (UC-20 — edited marker asserted), delete own comment.

const { test, expect } = require('@playwright/test');
const path = require('path');
const { createDoc, createVariant, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let varId;

test.beforeAll(async () => {
    const docId = await createDoc('US-3 Comment doc', 'Comment on the first line.\nSecond line filler.');
    varId = await createVariant(docId, { char_start: 0, char_end: 7, new_text: 'Discuss', title: 'US-3 discussable' });
});

test('post a comment — appears with author name and "just now"', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    await page.locator('#comment-text').fill('First e2e comment');
    await page.locator('#post-comment-btn').click();
    const comment = page.locator('.comment', { hasText: 'First e2e comment' });
    await expect(comment).toBeVisible();
    await expect(comment.locator('.comment-author').first()).toContainText('Alice E2E');
    await expect(comment.locator('.comment-time').first()).toContainText('just now');
});

test('reply to a comment — appears indented beneath it', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    const comment = page.locator('.comment', { hasText: 'First e2e comment' });
    await comment.locator('.reply-btn').click();
    await comment.locator('textarea').fill('An indented reply');
    await comment.locator('.post-reply-btn').click();
    await expect(comment.locator('.comment-replies .reply', { hasText: 'An indented reply' })).toBeVisible();
});

test('edit own comment — text updates and the edited marker appears (UC-20)', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    const comment = page.locator('.comment', { hasText: 'First e2e comment' });
    await comment.locator('.comment-actions').first().locator('.edit-comment-btn').click();
    const form = comment.locator('[id^="edit-form-"]').first();
    await form.locator('textarea').fill('First e2e comment, now edited');
    await form.locator('.save-edit-comment-btn').click();
    const edited = page.locator('.comment', { hasText: 'First e2e comment, now edited' });
    await expect(edited).toBeVisible();
    await expect(edited.locator('.comment-time').first()).toContainText('edited');
});

test('delete own reply — removed from the thread', async ({ page }) => {
    await page.goto(`/#/variants/${varId}`);
    const reply = page.locator('.reply', { hasText: 'An indented reply' });
    await expect(reply).toBeVisible();
    page.on('dialog', d => d.accept());
    await reply.locator('.delete-comment-btn').click();
    await expect(page.locator('.reply', { hasText: 'An indented reply' })).toHaveCount(0);
});
