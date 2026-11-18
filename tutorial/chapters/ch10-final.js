'use strict';

// Chapter 10 — Recording the final vote (the supervisor, the document in final voting).

const { sleep } = require('../lib/stage');

const card = text => `.fv-card:has-text("${text}")`;

module.exports = {
    chapter: 10,
    persona: 'david',
    title: 'Recording the final vote',
    beats: [
        async (stage, { page, docs }) => {
            await page.goto(`/#/documents/${docs.final}/review`);
            await page.locator('.review-toolbar a:has-text("Voting walkthrough")').waitFor();
            await sleep(1500);
            await stage.spotlight('.review-final-badge', 1200);
            await stage.click('.review-toolbar a:has-text("Voting walkthrough")');
            await page.locator('.fv-card').first().waitFor();
            await sleep(500);
            await stage.spotlight('.fv-list', 1500);
        },
        async (stage, { t }) => {
            const passed = card(t.passedCard);
            await stage.glide(`${passed} .fv-inputs`);
            await stage.spotlight(`${passed} .fv-inputs`, 1500);
            await stage.spotlight(`${passed} .fv-majority`, 2200);
        },
        async (stage, { t }) => {
            await stage.select(`${card(t.thresholdCard)} .fv-threshold-sel`, 'two_thirds');
            await stage.spotlight(`${card(t.thresholdCard)} .fv-threshold`, 2500);
        },
        async (stage, { page, t }) => {
            const root = card(t.rootCard);
            await stage.type(`${root} input[name="yes"]`, '12');
            await stage.type(`${root} input[name="no"]`, '3');
            await stage.type(`${root} input[name="abstain"]`, '1');
            await stage.click(`${root} .fv-save-btn`);
            await page.locator('.fv-card-child-skipped').waitFor();
            await stage.spotlight('.fv-card-child-skipped', 2500);
        },
        async (stage, { page, t }) => {
            const passed = card(t.passedCard);
            const csv = page.waitForEvent('download').catch(() => null);
            await stage.click('.page-header button:has-text("Export CSV")');
            await csv;
            await sleep(900);
            await stage.click('.page-header button:has-text("Print HTML")');
            await sleep(1200);
            await stage.glide(`${passed} .fv-audit-btn`);
            await stage.click(`${passed} .fv-audit-btn`);
            await page.locator(`${passed} .fv-audit-entry`).first().waitFor();
            await stage.spotlight(`${passed} .fv-audit-list`, 2500);
        },
    ],
};
