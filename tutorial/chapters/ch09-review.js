'use strict';

// Chapter 9 — Running the vote (David): Budget document → Review → conflict marks → ordering by drag → final voting.

const { sleep } = require('../lib/stage');

const TRIMMER = ':has-text("hedge trimmer")';
const SPLIT = ':has-text("Split the tool budget")';

module.exports = {
    chapter: 9,
    persona: 'david',
    title: 'Running the vote: review and conflicts',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('.doc-card:has-text("Garden Budget")').waitFor();
            await sleep(1200);
            await stage.click('.doc-card:has-text("Garden Budget")');
            await page.locator('.doc-text-header a:has-text("Review")').waitFor();
            await sleep(900);
            await stage.spotlight('.doc-text-header .status-badge', 1200);
            await stage.click('.doc-text-header a:has-text("Review")');
            await page.locator('#review-list .review-card').first().waitFor();
        },
        async (stage) => {
            await sleep(600);
            await stage.spotlight('.review-text-panel', 1200);
            await stage.spotlight('#review-list', 1200);
            await stage.spotlight('#review-list .review-card:nth-child(1) .review-actions', 2200);
        },
        async (stage) => {
            await stage.glide(`.review-card${TRIMMER} .review-overlap-badge`);
            await stage.spotlight(`.review-card${TRIMMER} .review-overlap-badge`, 1500);
            await stage.spotlight(`.review-card${SPLIT} .review-overlap-badge`, 1500);
        },
        async (stage, { page }) => {
            await stage.click(`.review-card${TRIMMER} .review-btn[data-action="conflict"]`);
            await page.locator(`.review-card${TRIMMER} .review-btn-conflict.review-btn-active`).waitFor();
            await stage.click(`.review-card${SPLIT} .review-btn[data-action="conflict"]`);
            await page.locator(`.review-card${SPLIT} .review-btn-conflict.review-btn-active`).waitFor();
            await sleep(700);
            await stage.click('.review-toolbar a:has-text("Resolve conflicts")');
            await page.locator('.conflict-group').waitFor();
        },
        async (stage, { page }) => {
            await sleep(700);
            await stage.drag(`.conflict-card${TRIMMER}`, '.conflict-dropzone >> nth=0');
            await page.locator(`.conflict-card${TRIMMER} .conflict-order-badge`).waitFor();
            await stage.spotlight(`.conflict-card${TRIMMER} .conflict-order-badge`, 1200);
            await stage.drag(`.conflict-card${SPLIT}`, `.conflict-card${TRIMMER}`);
            await page.locator('.conflict-card-child').waitFor();
            await stage.spotlight('.conflict-card-child .conflict-child-badge', 1500);
        },
        async (stage, { page }) => {
            await page.locator('.conflict-ready-btn.btn-success').waitFor();
            await stage.glide('.conflict-ready-btn');
            await stage.spotlight('.conflict-ready-btn', 1500);
            await stage.click('.conflict-ready-btn');
            await page.locator('.doc-text-header .status-badge:has-text("final voting")').waitFor();
            await sleep(400);
            await stage.spotlight('.doc-text-header .status-badge', 2000);
        },
    ],
};
