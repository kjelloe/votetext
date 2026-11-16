'use strict';

// Chapter 8 — Sharing with an outsider (Bjørn shares his fee proposal; the last beat is the signed-out view).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 8,
    persona: 'bjorn',
    title: 'Sharing with an outsider',
    beats: [
        async (stage, { page, docs }) => {
            await page.goto(`/#/documents/${docs.charter}`);
            await stage.click('.doc-sidebar .variant-card:has-text("Raise the annual fee")');
            await page.locator('#share-variant-btn').waitFor();
            await sleep(600);
            await stage.click('#share-variant-btn');
            await page.locator('#share-url').waitFor();
            await stage.spotlight('#share-url', 1800);
        },
        async (stage, { page }) => {
            await stage.click('#share-anon-cb');
            await sleep(900);
            await stage.click('#share-copy-btn');
            await page.locator('.toast').waitFor();
        },
        async (stage, { page, signIn }) => {
            await signIn(null);
            await page.reload();
            await page.locator('.page-container .card h1').waitFor();
            await page.locator('#login-btn').waitFor({ state: 'visible' });
            await sleep(600);
            await stage.spotlight('.page-container .card', 1800);
            await stage.glide('#login-btn');
            await stage.spotlight('#login-btn', 2000);
        },
    ],
};
