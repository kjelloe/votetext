'use strict';

// Chapter 3 — Inviting participants (Anna invites Erik, who signed up in chapter 1).

const { sleep } = require('../lib/stage');

const EMAIL = 'erik@demo.votetext';

module.exports = {
    chapter: 3,
    persona: 'anna',
    title: 'Inviting participants',
    beats: [
        async (stage, { page, docs, server }) => {
            await server.signUp(EMAIL);
            await page.goto(`/#/documents/${docs.charter}`);
            await page.locator('#access-btn').waitFor();
            await sleep(1000);
            await stage.glide('#access-btn');
            await stage.spotlight('#access-btn', 1200);
            await stage.click('#access-btn');
            await page.locator('#invite-search').waitFor();
        },
        async (stage, { page }) => {
            await sleep(600);
            await stage.spotlight('#invite-level', 1500);
            await stage.type('#invite-search', EMAIL);
            await stage.click('#invite-search-btn');
            await page.locator('.user-search-result').first().waitFor();
            await stage.click('.user-search-result');
            await stage.select('#invite-level', 'proposer');
            await stage.click('#invite-submit');
            await page.locator(`.access-row:has-text("${EMAIL}")`).waitFor();
            await stage.spotlight(`.access-row:has-text("${EMAIL}")`, 2000);
        },
        async (stage) => {
            await stage.glide('#default-access-select');
            await stage.spotlight('#default-access-select', 3000);
        },
    ],
};
