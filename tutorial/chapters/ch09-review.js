'use strict';

// Chapter 9 — Running the vote (the supervisor): voting document → Review → conflict marks → ordering by drag → final voting.

const { sleep } = require('../lib/stage');

const has = text => `:has-text("${text}")`;

module.exports = {
    chapter: 9,
    persona: 'david',
    title: 'Running the vote: review and conflicts',
    beats: [
        async (stage, { page, t }) => {
            await page.goto('/#/documents');
            await page.locator(`.doc-card${has(t.votingDoc)}`).waitFor();
            await sleep(1200);
            await stage.click(`.doc-card${has(t.votingDoc)}`);
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
        async (stage, { t }) => {
            const A = has(t.conflictA), B = has(t.conflictB);
            await stage.glide(`.review-card${A} .review-overlap-badge`);
            await stage.spotlight(`.review-card${A} .review-overlap-badge`, 1500);
            await stage.spotlight(`.review-card${B} .review-overlap-badge`, 1500);
        },
        async (stage, { page, t }) => {
            const A = has(t.conflictA), B = has(t.conflictB);
            await stage.click(`.review-card${A} .review-btn[data-action="conflict"]`);
            await page.locator(`.review-card${A} .review-btn-conflict.review-btn-active`).waitFor();
            await stage.click(`.review-card${B} .review-btn[data-action="conflict"]`);
            await page.locator(`.review-card${B} .review-btn-conflict.review-btn-active`).waitFor();
            await sleep(700);
            await stage.click('.review-toolbar a:has-text("Resolve conflicts")');
            await page.locator('.conflict-group').waitFor();
        },
        async (stage, { page, t }) => {
            const A = has(t.conflictA), B = has(t.conflictB);
            await sleep(700);
            await stage.drag(`.conflict-card${A}`, '.conflict-dropzone >> nth=0');
            await page.locator(`.conflict-card${A} .conflict-order-badge`).waitFor();
            await stage.spotlight(`.conflict-card${A} .conflict-order-badge`, 1200);
            await stage.drag(`.conflict-card${B}`, `.conflict-card${A}`);
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
