'use strict';

// Chapter 2 — Creating a document (Anna): New document → paste Appendix A → Draft → Open.

const { sleep } = require('../lib/stage');

const TITLE = 'Spring Planting Plan 2027';
const TEXT = [
    'Spring Planting Plan 2027',
    '',
    '1. The common beds are planted on the last weekend of April.',
    "2. This year's theme crops are squash, sugar peas, and dahlias.",
    '3. Seedlings are raised in the greenhouse from mid-March; sign-up sheet on the door.',
    '4. Each member contributes two hours to the planting weekend or one tray of seedlings.',
    '5. The plan is evaluated at the September assembly.',
].join('\n');

module.exports = {
    chapter: 2,
    persona: 'anna',
    title: 'Creating a document',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('#create-doc-btn').waitFor();
            await sleep(1200);
            await stage.glide('#create-doc-btn');
            await stage.spotlight('#create-doc-btn', 1500);
            await sleep(9000);
            await stage.click('#create-doc-btn');
            await page.locator('#new-doc-title').waitFor();
        },
        async (stage) => {
            await sleep(500);
            await stage.type('#new-doc-title', TITLE);
            await stage.paste('#new-doc-text', TEXT);
            await stage.spotlight('#new-doc-text', 1200);
        },
        async (stage, { page }) => {
            await stage.click('#create-doc-submit');
            await page.locator('.doc-text-header .status-badge').waitFor();
            await sleep(600);
            await stage.spotlight('.doc-text-header .status-badge', 2500);
        },
        async (stage, { page }) => {
            await stage.click('#doc-status-btn');
            await page.locator('[data-status="open"]').waitFor();
            await sleep(900);
            await stage.click('[data-status="open"]');
            await page.locator('.doc-text-header .status-badge:has-text("open")').waitFor();
            await sleep(500);
            await stage.spotlight('.doc-text-header .status-badge', 2000);
        },
    ],
};
