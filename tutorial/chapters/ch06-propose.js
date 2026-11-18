'use strict';

// Chapter 6 — Proposing a change (the proposer, on the open document; targets in t.propose). One function per [screen: …] cue,
// in the order of the script; the narration for each cue plays while the actions run.

const { sleep } = require('../lib/stage');

const lineSel = t => `#doc-lines-container .line-text:has-text("${t.propose.line}")`;

module.exports = {
    chapter: 6,
    persona: 'bjorn',
    title: 'Proposing a change',
    beats: [
        async (stage, { page, docs, t }) => {
            await page.goto(`/#/documents/${docs.open}`);
            await page.locator(lineSel(t)).waitFor();
            await sleep(1200);
            const len = await page.locator(lineSel(t)).evaluate(el => el.textContent.length);
            await stage.selectText(lineSel(t), 0, len);
            await page.locator('#selection-toolbar').waitFor({ state: 'visible' });
            await stage.spotlight('#selection-toolbar', 1400);
        },
        async (stage, { page }) => {
            await stage.click('#sel-propose-btn');
            await page.locator('#var-title').waitFor();
            await sleep(600);
            await stage.spotlight('#modal-box .form-group:has(#var-title)', 1000);
            await stage.spotlight('#new-text-group', 1000);
            await stage.spotlight('#modal-box .form-group:has(#var-rationale)', 1000);
        },
        async (stage, { page, t }) => {
            await stage.type('#var-title', t.propose.title);
            await stage.type('#new-text', t.propose.text, { clear: true });
            await stage.type('#var-rationale', t.propose.rationale);
            await sleep(400);
            await stage.click('#propose-submit');
            await page.locator('.toast .toast-link').waitFor();
            await stage.narrate();
            await stage.spotlight(lineSel(t), 2500);
            await stage.click('.toast .toast-link');
            await page.locator('#edit-variant-btn').waitFor();
            stage.vars.variantId = page.url().match(/#\/variants\/(\d+)/)[1];
        },
        async (stage, { page, t }) => {
            await sleep(800);
            await stage.click('#edit-variant-btn');
            await page.locator('#edit-title').waitFor();
            await stage.type('#edit-title', t.propose.editedTitle, { clear: true });
            await stage.click('#save-edit-btn');
            await page.locator('#modal-overlay').waitFor({ state: 'hidden' });
            await sleep(500);
            await stage.glide('#withdraw-variant-btn');
            await stage.spotlight('#withdraw-variant-btn', 1600);
        },
        async (stage, { page, t }) => {
            await stage.click('#back-to-doc-btn');
            await page.locator('.variant-card').last().waitFor();
            await sleep(600);
            await stage.spotlight(`.variant-card[data-id="${stage.vars.variantId}"]`, 1500);
            await stage.spotlight(lineSel(t), 1500);
        },
    ],
};
