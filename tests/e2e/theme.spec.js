'use strict';

// Phase D: the header's theme toggle, for signed-in and signed-out visitors alike.

const { test, expect } = require('@playwright/test');

test('theme toggle: follows the system until clicked, then the stored choice wins and survives a reload', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/#/login');
    const btn = page.locator('#theme-toggle');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', 'Switch to dark mode');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(canvas);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('vt_theme'))).toBe('light');

    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(btn).toHaveAttribute('aria-label', 'Switch to light mode');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(canvas);
    await ctx.close();
});

test('theme toggle: a light system stays light with nothing stored; the toggle sits at the right edge of the header', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');
    const pos = await page.evaluate(() => {
        const b = document.getElementById('theme-toggle').getBoundingClientRect();
        const h = document.querySelector('.header-inner').getBoundingClientRect();
        return { gap: h.right - b.right, inside: b.right <= window.innerWidth };
    });
    expect(pos.gap).toBeLessThan(40);
    expect(pos.inside).toBe(true);
});
