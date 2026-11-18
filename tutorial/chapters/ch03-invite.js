'use strict';

// Chapter 3 — Inviting participants (the owner invites the chapter 1 newcomer, created here through the OTP flow).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 3,
    persona: 'anna',
    title: 'Inviting participants',
    beats: [
        async (stage, { page, docs, server, t }) => {
            await server.signUp(t.inviteEmail);
            await page.goto(`/#/documents/${docs.open}`);
            await page.locator('#access-btn').waitFor();
            await sleep(1000);
            await stage.glide('#access-btn');
            await stage.spotlight('#access-btn', 1200);
            await stage.click('#access-btn');
            await page.locator('#invite-search').waitFor();
        },
        async (stage, { page, t }) => {
            await sleep(600);
            await stage.spotlight('#invite-level', 1500);
            await stage.type('#invite-search', t.inviteEmail);
            await stage.click('#invite-search-btn');
            await page.locator('.user-search-result').first().waitFor();
            await stage.click('.user-search-result');
            await stage.select('#invite-level', 'proposer');
            await stage.click('#invite-submit');
            await page.locator(`.access-row:has-text("${t.inviteEmail}")`).waitFor();
            await stage.spotlight(`.access-row:has-text("${t.inviteEmail}")`, 2000);
        },
        async (stage) => {
            await stage.glide('#default-access-select');
            await stage.spotlight('#default-access-select', 3000);
        },
    ],
};
