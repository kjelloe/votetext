'use strict';

// Chapter 7 — Voting (the voter on t.voteCard): For → Against → retract → tallies on the document.

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 7,
    persona: 'clara',
    title: 'Voting',
    beats: [
        async (stage, { page, docs, t }) => {
            await page.goto(`/#/documents/${docs.open}`);
            await stage.click(`.doc-sidebar .variant-card:has-text("${t.voteCard}")`);
            await page.locator('#vote-card .vote-btn').first().waitFor();
            await sleep(400);
            await stage.spotlight('#vote-card .vote-section', 2200);
        },
        async (stage, { page }) => {
            await stage.click('#vote-card .vote-btn >> nth=0');
            await page.locator('#vote-card .vote-btn.active-for').waitFor();
            await stage.spotlight('#vote-card .vote-btn.active-for', 2000);
        },
        async (stage, { page }) => {
            await stage.click('#vote-card .vote-btn >> nth=1');
            await page.locator('#vote-card .vote-btn.active-against').waitFor();
            await sleep(1400);
            await stage.click('#vote-card .vote-btn >> nth=1');
            await page.locator('#vote-card .vote-btn.active-against').waitFor({ state: 'detached' });
            await stage.spotlight('#vote-card .vote-section', 1500);
        },
        async (stage, { page }) => {
            await stage.click('#back-to-doc-btn');
            await page.locator('.doc-sidebar .variant-card .vote-mini').first().waitFor();
            await sleep(500);
            await stage.spotlight('.doc-sidebar .variant-card:nth-child(1) .vote-mini', 1500);
            await stage.spotlight('.doc-sidebar .variant-card:nth-child(2) .vote-mini', 1500);
        },
    ],
};
