'use strict';

// Chapter 0 — Intro (the owner's document list). One function per [screen: …] cue.

const { sleep } = require('../lib/stage');

module.exports = {
    chapter: 0,
    persona: 'anna',
    title: 'Intro',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/documents');
            await page.locator('.doc-card').nth(3).waitFor();
            await sleep(1500);
            for (let i = 0; i < 4; i++) {
                await stage.hover(`.doc-card >> nth=${i}`, 700);
                await stage.spotlight(`.doc-card:nth-child(${i + 1}) .status-badge`, 1700);
            }
        },
    ],
};
