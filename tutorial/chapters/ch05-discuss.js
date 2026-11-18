'use strict';

// Chapter 5 — Joining the discussion (the voter): proposal anatomy → thread → her own comment (t.comment).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 5,
    persona: 'clara',
    title: 'Joining the discussion',
    beats: [
        async (stage, { page, docs, t }) => {
            await page.goto(`/#/documents/${docs.open}`);
            await stage.click(`.doc-sidebar .variant-card:has-text("${t.discussCard}")`);
            await page.locator('.proposal-heading').waitFor();
            await sleep(500);
            await stage.spotlight('.proposal-heading', 1000);
            await stage.spotlight('blockquote, .rationale, .diff-block', 1200);
            await stage.spotlight('.diff-block', 2200);
        },
        async (stage, { page }) => {
            await page.locator('#comment-thread').scrollIntoViewIfNeeded();
            await stage.glide('#comment-thread');
            await stage.spotlight('.comment-replies', 2400);
        },
        async (stage, { page, t }) => {
            await stage.type('#comment-text', t.comment);
            await stage.click('#post-comment-btn');
            await page.locator(`.comment:has-text("${t.commentMatch}")`).waitFor();
            await stage.spotlight(`.comment:has-text("${t.commentMatch}")`, 2200);
        },
    ],
};
