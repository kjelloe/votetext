'use strict';

// Chapter 4 — Finding and reading a document (the proposer): list → document → scroll → highlighted lines → list controls → jump link.

const { sleep } = require('../lib/stage');

const card = text => `.doc-sidebar .variant-card:has-text("${text}")`;

module.exports = {
    chapter: 4,
    persona: 'bjorn',
    title: 'Finding and reading a document',
    beats: [
        async (stage, { page, t }) => {
            const doc = `.doc-card:has-text("${t.readDoc}")`;
            await page.goto('/#/documents');
            await page.locator(doc).waitFor();
            await sleep(1500);
            await stage.hover(doc, 600);
            await stage.spotlight(`${doc} .status-badge`, 1200);
            await stage.click(doc);
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
        async (stage, { t }) => {
            await stage.hover('.line-text.has-variant >> nth=0', 1600);
            await stage.hover(card(t.firstCard), 400);
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
        async (stage, { page, t }) => {
            const jump = card(t.jumpCard);
            const line = `#doc-lines-container .line-text:has-text("${t.jumpLine}")`;
            await stage.hover(jump, 700);
            await page.locator(`${jump} .goto-link`).waitFor({ state: 'visible' });
            await stage.spotlight(`${jump} .goto-link`, 1200);
            await stage.click(`${jump} .goto-link`);
            await page.locator(line).waitFor();
            await stage.spotlight(line, 1500);
            await stage.click(jump);
            await page.locator('.proposal-heading').waitFor();
            await sleep(800);
        },
    ],
};
