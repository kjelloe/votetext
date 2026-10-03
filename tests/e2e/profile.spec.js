'use strict';

// US-1 (extension) — First-time profile completion modal (UC-13).
// New accounts get the email prefix as display_name; the modal shows after OTP
// verify while the name is empty or still equals that prefix, so a brand-new
// email is enough to trigger it.

const { test, expect } = require('@playwright/test');


async function loginViaUi(page, request, email) {
    await page.goto('/#/login');
    await page.locator('input[type=email]').fill(email);
    await page.getByRole('button', { name: /send code/i }).click();
    await expect(page.getByText(/code sent to/i)).toBeVisible();
    const otpRes = await request.get(`http://localhost:3001/api/auth/test-otp?email=${encodeURIComponent(email)}`);
    const { code } = await otpRes.json();
    await page.locator('#otp-input').fill(code); // auto-submits at 6 digits
}

test('profile modal: Save and continue stores name and updates header', async ({ page, request }) => {
    const email = 'profile-save@e2e.test';
    await loginViaUi(page, request, email);

    await expect(page.locator('#pm-name')).toBeVisible();
    await page.locator('#pm-name').fill('Saved Name');
    await page.locator('#pm-org').fill('E2E Org');
    await page.locator('#pm-save').click();

    await expect(page).toHaveURL(/#\/documents$/);
    await expect(page.getByRole('banner')).toContainText('Saved Name');
});

test('profile modal: Skip proceeds without a name', async ({ page, request }) => {
    const email = 'profile-skip@e2e.test';
    await loginViaUi(page, request, email);

    await expect(page.locator('#pm-skip')).toBeVisible();
    await page.locator('#pm-skip').click();

    await expect(page).toHaveURL(/#\/documents$/);
    await expect(page.locator('#pm-name')).toHaveCount(0);
});
