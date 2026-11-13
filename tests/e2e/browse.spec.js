'use strict';

// UC-25 — Browse proposals in an order of your choice: sort, filter, Previous/Next (Phase M.3)

const { test, expect } = require('@playwright/test');
const path = require('path');
const { apireq, aliceCookie, createDoc, createVariant, setStatus, AUTH_DIR } = require('./helpers');

test.use({ storageState: path.join(AUTH_DIR, 'alice.json') });

let docId, first, second, third;

test.beforeAll(async () => {
    docId = await createDoc('UC-25 browse doc', 'Alpha first line.\nBeta second line.\nGamma third line.');
    first = await createVariant(docId, { char_start: 0, char_end: 5, new_text: 'Omega', title: 'UC-25 first' });
    second = await createVariant(docId, { char_start: 18, char_end: 22, new_text: 'Delta', title: 'UC-25 second' });
    third = await createVariant(docId, { char_start: 36, char_end: 41, new_text: 'Sigma', title: 'UC-25 third' });
    const cookie = aliceCookie();
    await apireq('POST', `/variants/${second}/vote`, { body: { vote_value: 1 }, cookie });
    await apireq('POST', `/variants/${third}/comments`, { body: { text: 'A remark' }, cookie });
});

const cardTitles = page => page.locator('.doc-sidebar .variant-card .variant-card-title').allInnerTexts();

test('sort: document order, most voted, most discussed, newest', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await expect(page.locator('.doc-sidebar .variant-card')).toHaveCount(3);
    expect(await cardTitles(page)).toEqual(['#1 UC-25 first', '#2 UC-25 second', '#3 UC-25 third']);

    const sort = () => page.locator('.doc-sidebar .proposal-sort');
    await sort().focus();
    await sort().selectOption('voted');
    expect((await cardTitles(page))[0]).toBe('#2 UC-25 second');
    // The list re-renders the controls; keyboard focus must stay on the selector
    await expect(sort()).toBeFocused();
    await sort().selectOption('discussed');
    expect((await cardTitles(page))[0]).toBe('#3 UC-25 third');
    await sort().selectOption('newest');
    expect(await cardTitles(page)).toEqual(['#3 UC-25 third', '#2 UC-25 second', '#1 UC-25 first']);

    // Remembered on this device
    await page.reload();
    await expect(page.locator('.doc-sidebar .proposal-sort')).toHaveValue('newest');
    expect(await cardTitles(page)).toEqual(['#3 UC-25 third', '#2 UC-25 second', '#1 UC-25 first']);
    await page.locator('.doc-sidebar .proposal-sort').selectOption('doc');
});

test('filter "Not yet voted by me" hides the proposal I voted on', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    const filter = page.locator('.doc-sidebar .proposal-filter');
    await expect(filter.locator('option[value="unvoted"]')).toHaveText('Not yet voted by me (2)');
    await filter.selectOption('unvoted');
    await expect(page.locator('.doc-sidebar .variant-card')).toHaveCount(2);
    await expect(page.locator('.doc-sidebar .variant-card', { hasText: 'UC-25 second' })).toHaveCount(0);
    await page.locator('.doc-sidebar .proposal-filter').selectOption('all');
    await expect(page.locator('.doc-sidebar .variant-card')).toHaveCount(3);
});

test('Previous/Next on the proposal page follow the chosen order and skip voted ones under the filter', async ({ page }) => {
    await page.goto(`/#/documents/${docId}`);
    await page.locator('.doc-sidebar .proposal-sort').selectOption('newest');
    await page.goto(`/#/variants/${third}`);
    const next = page.locator('.variant-nav-arrow', { hasText: 'Next' });
    await expect(next).toHaveAttribute('data-nav-id', String(second));
    await next.click();
    await expect(page).toHaveURL(new RegExp(`#/variants/${second}$`));
    await expect(page.locator('.variant-nav-arrow', { hasText: 'Prev' })).toHaveAttribute('data-nav-id', String(third));

    // With "Not yet voted by me", Next from #3 skips the voted #2 and lands on #1
    await page.goto(`/#/documents/${docId}`);
    await page.locator('.doc-sidebar .proposal-filter').selectOption('unvoted');
    await page.goto(`/#/variants/${third}`);
    await expect(page.locator('.variant-nav-arrow', { hasText: 'Next' })).toHaveAttribute('data-nav-id', String(first));

    await page.goto(`/#/documents/${docId}`);
    await page.locator('.doc-sidebar .proposal-filter').selectOption('all');
    await page.locator('.doc-sidebar .proposal-sort').selectOption('doc');
});

test('"Not yet voted by me" is offered only while the document takes votes', async ({ page }) => {
    const closedDoc = await createDoc('UC-25 closed doc', 'Alpha first line.\nBeta second line.');
    await createVariant(closedDoc, { char_start: 0, char_end: 5, new_text: 'Omega', title: 'UC-25 closed' });
    await page.goto(`/#/documents/${closedDoc}`);
    await page.locator('.doc-sidebar .proposal-filter').selectOption('unvoted');
    await expect(page.locator('.doc-sidebar .variant-card')).toHaveCount(1);

    // Final voting: the server refuses ballots, so the filter goes away and the stored choice falls back to All
    await setStatus(closedDoc, 'voting');
    await setStatus(closedDoc, 'final_voting');
    await page.reload();
    await expect(page.locator('.doc-sidebar .variant-card')).toHaveCount(1);
    await expect(page.locator('.doc-sidebar .proposal-filter option[value="unvoted"]')).toHaveCount(0);
    await expect(page.locator('.doc-sidebar .proposal-filter')).toHaveValue('all');
});
