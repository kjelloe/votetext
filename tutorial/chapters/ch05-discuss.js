'use strict';

// Chapter 5 — Joining the discussion (Clara): proposal anatomy → thread → her own comment (Appendix B).

const { sleep } = require('../lib/stage');

const COMMENT = 'I support this. Could we phase the increase in over two years for members on a tight budget?';

module.exports = {
    chapter: 5,
    persona: 'clara',
    title: 'Joining the discussion',
    beats: [
        async (stage, { page, docs }) => {
            await page.goto(`/#/documents/${docs.charter}`);
            await stage.click('.doc-sidebar .variant-card:has-text("Raise the annual fee")');
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
        async (stage, { page }) => {
            await stage.type('#comment-text', COMMENT);
            await stage.click('#post-comment-btn');
            await page.locator('.comment:has-text("phase the increase")').waitFor();
            await stage.spotlight('.comment:has-text("phase the increase")', 2200);
        },
    ],
};
