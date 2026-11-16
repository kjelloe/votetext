'use strict';

// Chapter 10 — Recording the final vote (David, Watering document in final voting).

const { sleep } = require('../lib/stage');

const SPRINKLER = '.fv-card:has-text("Ban sprinklers")';
const WEEKEND = '.fv-card:has-text("Open weekend watering")';
const SHIFT = '.fv-card:has-text("Shift evening watering")';

module.exports = {
    chapter: 10,
    persona: 'david',
    title: 'Recording the final vote',
    beats: [
        async (stage, { page, docs }) => {
            await page.goto(`/#/documents/${docs.watering}/review`);
            await page.locator('.review-toolbar a:has-text("Voting walkthrough")').waitFor();
            await sleep(1500);
            await stage.spotlight('.review-final-badge', 1200);
            await stage.click('.review-toolbar a:has-text("Voting walkthrough")');
            await page.locator('.fv-card').first().waitFor();
            await sleep(500);
            await stage.spotlight('.fv-list', 1500);
        },
        async (stage) => {
            await stage.glide(`${SPRINKLER} .fv-inputs`);
            await stage.spotlight(`${SPRINKLER} .fv-inputs`, 1500);
            await stage.spotlight(`${SPRINKLER} .fv-majority`, 2200);
        },
        async (stage) => {
            await stage.select(`${WEEKEND} .fv-threshold-sel`, 'two_thirds');
            await stage.spotlight(`${WEEKEND} .fv-threshold`, 2500);
        },
        async (stage, { page }) => {
            await stage.type(`${SHIFT} input[name="yes"]`, '12');
            await stage.type(`${SHIFT} input[name="no"]`, '3');
            await stage.type(`${SHIFT} input[name="abstain"]`, '1');
            await stage.click(`${SHIFT} .fv-save-btn`);
            await page.locator('.fv-card-child-skipped').waitFor();
            await stage.spotlight('.fv-card-child-skipped', 2500);
        },
        async (stage, { page }) => {
            const csv = page.waitForEvent('download').catch(() => null);
            await stage.click('.page-header button:has-text("Export CSV")');
            await csv;
            await sleep(900);
            await stage.click('.page-header button:has-text("Print HTML")');
            await sleep(1200);
            await stage.glide(`${SPRINKLER} .fv-audit-btn`);
            await stage.click(`${SPRINKLER} .fv-audit-btn`);
            await page.locator(`${SPRINKLER} .fv-audit-entry`).first().waitFor();
            await stage.spotlight(`${SPRINKLER} .fv-audit-list`, 2500);
        },
    ],
};
