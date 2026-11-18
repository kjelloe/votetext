'use strict';

// Chapter 13 — Outro (back on the owner's document list).

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 13,
    persona: 'anna',
    title: 'Outro',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('.doc-card').nth(3).waitFor();
            await sleep(1200);
            for (let i = 0; i < 4; i++) await stage.hover(`.doc-card >> nth=${i}`, 1200);
            await stage.glide('.page-title');
            await stage.spotlight('#doc-list', 2500);
        },
    ],
};
