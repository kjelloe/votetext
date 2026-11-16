'use strict';

// Chapter 1 — Signing in (Erik, a new account): email → code read from the tutorial database → profile → empty list.

const { sleep } = require('../lib/stage');

const EMAIL = 'erik@demo.votetext';

module.exports = {
    chapter: 1,
    persona: null,
    title: 'Signing in',
    beats: [
        async (stage, { page }) => {
            await page.goto('/#/login');
            await page.locator('#email-input').waitFor();
            await sleep(800);
            await stage.spotlight('.login-card', 1800);
        },
        async (stage, { page }) => {
            await stage.type('#email-input', EMAIL);
            await stage.click('#send-btn');
            await page.locator('#otp-input').waitFor({ state: 'visible' });
        },
        async (stage, { page, server }) => {
            await sleep(1200);
            const otp = server.latestOtp(EMAIL);
            if (!otp) throw new Error('No login code was stored for Erik');
            await stage.type('#otp-input', otp.code);
            await page.locator('#pm-name').waitFor();
        },
        async (stage) => {
            await sleep(600);
            await stage.spotlight('#modal-box', 2200);
        },
        async (stage, { page }) => {
            await stage.type('#pm-name', 'Erik Moen', { clear: true });
            await stage.type('#pm-org', 'Plot 7');
            await stage.click('#pm-save');
            await page.locator('#modal-overlay').waitFor({ state: 'hidden' });
        },
        async (stage, { page }) => {
            await page.locator('#doc-list').waitFor();
            await sleep(800);
            await stage.spotlight('#doc-list', 2500);
        },
    ],
};
