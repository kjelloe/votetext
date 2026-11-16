'use strict';

// Chapter 6 — Proposing a change (Bjørn, Community Garden Charter). One function per [screen: …] cue,
// in the order of the script; the narration for each cue plays while the actions run.

const { sleep } = require('../lib/stage');

const GUEST_LINE = '#doc-lines-container .line-text:has-text("2.4 Guests")';
const TITLE = 'Let guests visit without an escort';
const NEW_TEXT = "2.4 Guests are welcome during opening hours; children's guests must be accompanied by a member.";
const RATIONALE = "Requiring an escort for every adult guest is impractical, members' partners and neighbours visit all the time. Keeping the rule only for children's guests covers the actual concern.";

module.exports = {
    chapter: 6,
    persona: 'bjorn',
    title: 'Proposing a change',
    beats: [
        async (stage, { page, docs }) => {
            await page.goto(`/#/documents/${docs.charter}`);
            await page.locator(GUEST_LINE).waitFor();
            await sleep(1200);
            const len = await page.locator(GUEST_LINE).evaluate(el => el.textContent.length);
            await stage.selectText(GUEST_LINE, 0, len);
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
        async (stage, { page }) => {
            await stage.type('#var-title', TITLE);
            await stage.type('#new-text', NEW_TEXT, { clear: true });
            await stage.type('#var-rationale', RATIONALE);
            await sleep(400);
            await stage.click('#propose-submit');
            await page.locator('.toast .toast-link').waitFor();
            await stage.narrate();
            await stage.spotlight(GUEST_LINE, 2500);
            await stage.click('.toast .toast-link');
            await page.locator('#edit-variant-btn').waitFor();
            stage.vars.variantId = page.url().match(/#\/variants\/(\d+)/)[1];
        },
        async (stage, { page }) => {
            await sleep(800);
            await stage.click('#edit-variant-btn');
            await page.locator('#edit-title').waitFor();
            await stage.type('#edit-title', 'Let adult guests visit without an escort', { clear: true });
            await stage.click('#save-edit-btn');
            await page.locator('#modal-overlay').waitFor({ state: 'hidden' });
            await sleep(500);
            await stage.glide('#withdraw-variant-btn');
            await stage.spotlight('#withdraw-variant-btn', 1600);
        },
        async (stage, { page }) => {
            await stage.click('#back-to-doc-btn');
            await page.locator('.variant-card').last().waitFor();
            await sleep(600);
            await stage.spotlight(`.variant-card[data-id="${stage.vars.variantId}"]`, 1500);
            await stage.spotlight(GUEST_LINE, 1500);
        },
    ],
};
