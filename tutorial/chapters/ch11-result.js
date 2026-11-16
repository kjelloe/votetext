'use strict';

// Chapter 11 — Reading the result (Clara, the resolved Tool Shed document).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 11,
    persona: 'clara',
    title: 'Reading the result',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('.doc-card:has-text("Tool Shed")').waitFor();
            await sleep(1200);
            await stage.click('.doc-card:has-text("Tool Shed")');
            await page.locator('.doc-text-header a:has-text("Resolved text")').waitFor();
            await sleep(700);
            await stage.click('.doc-text-header a:has-text("Resolved text")');
            await page.locator('.resolved-text-view').waitFor();
        },
        async (stage) => {
            await sleep(500);
            await stage.spotlight('.page-header .alert', 2000);
            await stage.spotlight('.resolved-text-view', 2500);
        },
        async (stage, { page }) => {
            const dl = page.waitForEvent('download').catch(() => null);
            await stage.click('.page-header button:has-text("Export Markdown")');
            await dl;
            await sleep(1500);
        },
    ],
};
