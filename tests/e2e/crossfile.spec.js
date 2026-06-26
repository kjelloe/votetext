'use strict';

// Cross-file route smoke tests — verify that routes handled by auth.js and
// review.js load correctly (i.e. the split-file globals wiring works in a
// real browser, not just in vm.Script).

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.resolve('tests/e2e/.auth');

function fixtures() {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'fixtures.json'), 'utf8'));
}

// ── auth.js routes ────────────────────────────────────────────────────────────

test.describe('auth.js routes', () => {
    test('login page renders (viewLogin — auth.js)', async ({ page }) => {
        await page.goto('/#/login');
        await expect(page.locator('input[type=email], input[placeholder*=email i]').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /send code/i })).toBeVisible();
    });

    test('profile page renders for logged-in user (viewProfile — auth.js)', async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, 'alice.json') });
        const page = await ctx.newPage();
        await page.goto('/#/profile');
        await expect(page.getByText(/display name/i)).toBeVisible();
        await expect(page.locator('input[value="Alice E2E"]')).toBeVisible();
        await ctx.close();
    });

    test('unauthenticated profile redirects to login (auth.js guard)', async ({ page }) => {
        await page.goto('/#/profile');
        await expect(page.locator('input[type=email], input[placeholder*=email i]').first()).toBeVisible();
    });
});

// ── review.js routes ──────────────────────────────────────────────────────────

test.describe('review.js routes', () => {
    test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

    test('document review renders (viewDocumentReview — review.js)', async ({ page }) => {
        const { votingDocId } = fixtures();
        await page.goto(`/#/documents/${votingDocId}/review`);
        await expect(page.locator('.review-layout')).toBeVisible();
        await expect(page.getByText('Proposals')).toBeVisible();
    });

    test('conflict resolution renders (viewConflictResolution — review.js)', async ({ page }) => {
        const { votingDocId } = fixtures();
        await page.goto(`/#/documents/${votingDocId}/conflicts`);
        // No conflicts in this doc — expect the "ready" or "no conflicts" state
        await expect(page.locator('.conflict-view, .page-container')).toBeVisible();
    });

    test('final voting walkthrough renders (viewFinalVoting — review.js)', async ({ page }) => {
        const { fvDocId } = fixtures();
        await page.goto(`/#/documents/${fvDocId}/final-vote`);
        await expect(page.locator('.fv-list')).toBeVisible();
        await expect(page.getByText(/Final voting/i).first()).toBeVisible();
    });

    test('resolved text page renders for final_voting doc (viewResolvedText — review.js)', async ({ page }) => {
        const { fvDocId } = fixtures();
        await page.goto(`/#/documents/${fvDocId}/resolved-text`);
        await expect(page.locator('.resolved-text-view, .page-container')).toBeVisible();
        await expect(page.getByRole('button', { name: /export markdown/i })).toBeVisible();
    });
});

// ── Full login flow (US-1) ────────────────────────────────────────────────────

test.describe('US-1: sign-in flow', () => {
    test('complete OTP login lands on document list', async ({ page, request }) => {
        const email = 'playwright-login@e2e.test';

        // Request OTP
        await page.goto('/#/login');
        await page.locator('input[type=email], input[placeholder*=email i]').first().fill(email);
        await page.getByRole('button', { name: /send code/i }).click();
        await expect(page.getByText(/enter.*code|code.*sent/i)).toBeVisible();

        // Get OTP from DB via test helper (the server logs it to console in test mode)
        const otpRes = await request.get(`http://localhost:3001/api/auth/test-otp?email=${encodeURIComponent(email)}`);
        // Fallback: read directly from DB via a small inline fetch to a debug route.
        // If no debug route, skip and document as a known limitation.
        test.skip(!otpRes.ok(), 'OTP debug endpoint not available — see tests/e2e/README.md');

        const { code } = await otpRes.json();
        await page.locator('input[name=code], input[placeholder*=code i]').first().fill(code);
        await page.getByRole('button', { name: /verify/i }).click();

        // Profile modal may appear for first-time user
        const skipBtn = page.getByRole('button', { name: /skip/i });
        if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await skipBtn.click();
        }

        // Should land on document list
        await expect(page).toHaveURL(/#\/(documents)?$/);
        await expect(page.locator('.doc-list, .document-list, h1')).toBeVisible();
    });
});
