'use strict';

// Chapter 12 — A word on moderation (the supervisor hides the off-topic comment t.modComment; the voter sees the placeholder; the moderation page).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 12,
    persona: 'david',
    title: 'A word on moderation',
    beats: [
        async (stage, { page, docs, t }) => {
            const offTopic = `.comment:has-text("${t.modComment}")`;
            await page.goto(`/#/documents/${docs.open}`);
            await stage.click(`.doc-sidebar .variant-card:has-text("${t.modCard}")`);
            await page.locator(offTopic).waitFor();
            await page.locator(offTopic).scrollIntoViewIfNeeded();
            await stage.spotlight(offTopic, 1800);
            page.once('dialog', d => d.accept());
            await stage.click(`${offTopic} .hide-comment-btn`);
            await page.locator('.comment-text:has-text("hidden by moderator")').waitFor();
        },
        async (stage, { page, signIn }) => {
            await signIn('clara');
            await page.reload();
            await page.locator('.comment-text:has-text("Comment hidden by moderator")').waitFor();
            await page.locator('.comment-text:has-text("Comment hidden by moderator")').scrollIntoViewIfNeeded();
            await sleep(500);
            await stage.spotlight('.comment-text:has-text("Comment hidden by moderator")', 2500);
        },
        async (stage, { page, signIn }) => {
            await signIn('david');
            await page.reload();
            await page.locator('#back-to-doc-btn').waitFor();
            await stage.click('#back-to-doc-btn');
            await page.locator('.doc-sidebar a:has-text("Moderation")').waitFor();
            await stage.click('.doc-sidebar a:has-text("Moderation")');
            await page.locator('#mod-comment-list .mod-unhide-comment').waitFor();
            await stage.spotlight('#mod-comment-list', 1800);
            await stage.glide('#mod-comment-list .mod-unhide-comment');
            await stage.spotlight('#mod-comment-list .mod-unhide-comment', 1500);
        },
    ],
};
