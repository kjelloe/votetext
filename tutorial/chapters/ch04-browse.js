'use strict';

// Chapter 4 — Finding and reading a document (Bjørn): list → charter → scroll → highlighted lines → list controls → jump link.

const { sleep } = require('../lib/stage');

const FEE_CARD = '.doc-sidebar .variant-card:has-text("Raise the annual fee")';
const DOG_CARD = '.doc-sidebar .variant-card:has-text("Clarify the dog rule")';

module.exports = {
    chapter: 4,
    persona: 'bjorn',
    title: 'Finding and reading a document',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('.doc-card:has-text("Community Garden Charter")').waitFor();
            await sleep(1500);
            await stage.hover('.doc-card:has-text("Community Garden Charter")', 600);
            await stage.spotlight('.doc-card:has-text("Community Garden Charter") .status-badge', 1200);
            await stage.click('.doc-card:has-text("Community Garden Charter")');
            await page.locator('#doc-lines-container .line-text').first().waitFor();
        },
        async (stage) => {
            await sleep(600);
            await stage.spotlight('.doc-text-panel', 1200);
            await stage.spotlight('.doc-sidebar .sidebar-section:nth-child(2)', 1200);
            await stage.glide('#doc-lines-container .line-text >> nth=4');
            await stage.scroll(420, 2200);
            await sleep(600);
            await stage.scroll(-420, 1400);
        },
        async (stage) => {
            await stage.hover('.line-text.has-variant >> nth=0', 1600);
            await stage.hover(FEE_CARD, 400);
            await stage.spotlight('.line-text.hover-highlight', 2000);
        },
        async (stage) => {
            await stage.select('.doc-sidebar .proposal-filter', 'page');
            await sleep(900);
            await stage.select('.doc-sidebar .proposal-filter', 'all');
            await sleep(600);
            await stage.select('.doc-sidebar .proposal-sort', 'voted');
            await sleep(1200);
            await stage.select('.doc-sidebar .proposal-sort', 'doc');
        },
        async (stage, { page }) => {
            await stage.hover(DOG_CARD, 700);
            await page.locator(`${DOG_CARD} .goto-link`).waitFor({ state: 'visible' });
            await stage.spotlight(`${DOG_CARD} .goto-link`, 1200);
            await stage.click(`${DOG_CARD} .goto-link`);
            await page.locator('#doc-lines-container .line-text:has-text("4.3 Dogs")').waitFor();
            await stage.spotlight('#doc-lines-container .line-text:has-text("4.3 Dogs")', 1500);
            await stage.click(DOG_CARD);
            await page.locator('.proposal-heading').waitFor();
            await sleep(800);
        },
    ],
};
