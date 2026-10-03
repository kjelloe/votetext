'use strict';

// Unit tests for the pure helpers in src/lib/text.js — no DB, no server.

const { test } = require('node:test');
const assert = require('node:assert');
const { applyVariantsToText, passesThreshold, VALID_THRESHOLDS, decideOutcomes, escapeHtml, importText } = require('../src/lib/text');

// ── applyVariantsToText ───────────────────────────────────────────────────────

const TEXT = 'The quick brown fox jumps over the lazy dog';
//            0123456789012345678901234567890123456789012345
//                      1111111111222222222233333333334444

test('apply: replace in the middle', () => {
    const out = applyVariantsToText(TEXT, [
        { char_start: 4, char_end: 9, operation: 'replace', new_text: 'slow' },
    ]);
    assert.equal(out, 'The slow brown fox jumps over the lazy dog');
});

test('apply: insert (char_start === char_end)', () => {
    const out = applyVariantsToText(TEXT, [
        { char_start: 4, char_end: 4, operation: 'insert', new_text: 'very ' },
    ]);
    assert.equal(out, 'The very quick brown fox jumps over the lazy dog');
});

test('apply: delete removes the range and inserts nothing', () => {
    const out = applyVariantsToText(TEXT, [
        { char_start: 3, char_end: 9, operation: 'delete', new_text: 'ignored' },
    ]);
    assert.equal(out, 'The brown fox jumps over the lazy dog');
});

test('apply: multiple non-overlapping variants applied in offset order regardless of input order', () => {
    const out = applyVariantsToText(TEXT, [
        { char_start: 35, char_end: 39, operation: 'replace', new_text: 'sleepy' },
        { char_start: 4, char_end: 9, operation: 'replace', new_text: 'slow' },
    ]);
    assert.equal(out, 'The slow brown fox jumps over the sleepy dog');
});

test('apply: overlapping variant is skipped (first by char_start wins)', () => {
    const out = applyVariantsToText(TEXT, [
        { char_start: 4, char_end: 15, operation: 'replace', new_text: 'slow red' },
        { char_start: 10, char_end: 19, operation: 'replace', new_text: 'green cat' },
    ]);
    assert.equal(out, 'The slow red fox jumps over the lazy dog');
});

test('apply: adjacent ranges (end == next start) both apply', () => {
    const out = applyVariantsToText('abcdef', [
        { char_start: 0, char_end: 2, operation: 'replace', new_text: 'XX' },
        { char_start: 2, char_end: 4, operation: 'replace', new_text: 'YY' },
    ]);
    assert.equal(out, 'XXYYef');
});

test('apply: variant spanning to end of text', () => {
    const out = applyVariantsToText('abcdef', [
        { char_start: 3, char_end: 6, operation: 'replace', new_text: 'DEF' },
    ]);
    assert.equal(out, 'abcDEF');
});

test('apply: empty variant list returns original text', () => {
    assert.equal(applyVariantsToText(TEXT, []), TEXT);
});

test('apply: multi-line text keeps newlines outside the range', () => {
    const out = applyVariantsToText('line one\nline two\nline three', [
        { char_start: 9, char_end: 17, operation: 'replace', new_text: 'LINE 2' },
    ]);
    assert.equal(out, 'line one\nLINE 2\nline three');
});

// ── passesThreshold ───────────────────────────────────────────────────────────

test('threshold simple: yes > no passes, tie fails', () => {
    assert.equal(passesThreshold(2, 1, 5, 'simple'), true);
    assert.equal(passesThreshold(2, 2, 0, 'simple'), false);
    assert.equal(passesThreshold(1, 2, 0, 'simple'), false);
});

test('threshold simple: abstain does not count in the denominator', () => {
    assert.equal(passesThreshold(1, 0, 100, 'simple'), true);
});

test('threshold absolute: yes must exceed half of ALL votes incl. abstain', () => {
    assert.equal(passesThreshold(6, 2, 3, 'absolute'), true);   // 6 of 11
    assert.equal(passesThreshold(5, 2, 3, 'absolute'), false);  // exactly half of 10 → fail
    assert.equal(passesThreshold(6, 2, 4, 'absolute'), false);  // exactly half of 12 → fail
});

test('threshold two_thirds: exact boundary passes (>= two thirds)', () => {
    assert.equal(passesThreshold(8, 2, 2, 'two_thirds'), true);   // 8/12 = exactly 2/3
    assert.equal(passesThreshold(7, 2, 2, 'two_thirds'), false);  // 7/11 < 2/3
    assert.equal(passesThreshold(2, 1, 0, 'two_thirds'), true);   // 2/3 exact
});

test('threshold three_quarters: exact boundary passes (>= three quarters)', () => {
    assert.equal(passesThreshold(9, 2, 1, 'three_quarters'), true);   // 9/12 = exactly 3/4
    assert.equal(passesThreshold(8, 2, 1, 'three_quarters'), false);  // 8/11 < 3/4
    assert.equal(passesThreshold(3, 1, 0, 'three_quarters'), true);   // 3/4 exact
});

test('threshold: zero votes always fails, null/undefined treated as 0', () => {
    for (const t of VALID_THRESHOLDS) {
        assert.equal(passesThreshold(0, 0, 0, t), false, `${t} with no votes`);
        assert.equal(passesThreshold(null, null, null, t), false, `${t} with nulls`);
    }
    assert.equal(passesThreshold(undefined, undefined, undefined, 'simple'), false);
    assert.equal(passesThreshold(1, null, undefined, 'simple'), true);
});

test('threshold: unknown threshold falls back to simple majority', () => {
    assert.equal(passesThreshold(2, 1, 0, 'bogus'), true);
    assert.equal(passesThreshold(1, 1, 0, 'bogus'), false);
});

// ── importText ────────────────────────────────────────────────────────────────

test('import: char offsets are contiguous accounting for newlines', () => {
    const rows = importText('ab\ncde\n\nf', 30);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(r => [r.char_offset_start, r.char_offset_end]),
        [[0, 2], [3, 6], [7, 7], [8, 9]]);
    assert.deepEqual(rows.map(r => r.original_text), ['ab', 'cde', '', 'f']);
});

test('import: page numbers roll over at linesPerPage', () => {
    const rows = importText('a\nb\nc\nd\ne', 2);
    assert.deepEqual(rows.map(r => r.page_num), [1, 1, 2, 2, 3]);
    assert.deepEqual(rows.map(r => r.line_num), [1, 2, 3, 4, 5]);
});

test('import: round-trip — joining rows reproduces the original text', () => {
    const text = 'first line\n\nthird line\nlast';
    const rows = importText(text, 3);
    assert.equal(rows.map(r => r.original_text).join('\n'), text);
});

test('import + apply round-trip: offsets from import are valid apply targets', () => {
    const text = 'alpha\nbeta\ngamma';
    const rows = importText(text, 30);
    const beta = rows[1];
    const out = applyVariantsToText(text, [
        { char_start: beta.char_offset_start, char_end: beta.char_offset_end, operation: 'replace', new_text: 'BETA' },
    ]);
    assert.equal(out, 'alpha\nBETA\ngamma');
});

// ── applyVariantsToText tie-break ─────────────────────────────────────────────

test('apply: insert at the start of a replaced range survives regardless of input order', () => {
    const replace = { char_start: 4, char_end: 9, operation: 'replace', new_text: 'slow' };
    const insert = { char_start: 4, char_end: 4, operation: 'insert', new_text: 'very ' };
    assert.equal(applyVariantsToText(TEXT, [replace, insert]), 'The very slow brown fox jumps over the lazy dog');
    assert.equal(applyVariantsToText(TEXT, [insert, replace]), 'The very slow brown fox jumps over the lazy dog');
});

test('apply: an insert proposed over a selected range keeps the selected text', () => {
    const insert = { char_start: 4, char_end: 9, operation: 'insert', new_text: 'very ' };
    assert.equal(applyVariantsToText(TEXT, [insert]), 'The very quick brown fox jumps over the lazy dog');
    const later = { char_start: 6, char_end: 9, operation: 'replace', new_text: 'IET' };
    assert.equal(applyVariantsToText(TEXT, [insert, later]), 'The very quIET brown fox jumps over the lazy dog', 'the selected range is not consumed, so a later change inside it still applies');
});

// ── decideOutcomes ────────────────────────────────────────────────────────────

const V = (id, cs, ce, yes, no, extra = {}) => ({ id, char_start: cs, char_end: ce, final_yes: yes, final_no: no, final_abstain: 0, parent_variant_id: null, majority_threshold: null, ...extra });

test('outcomes: tallied roots pass or fail by the document threshold', () => {
    const r = decideOutcomes([V(1, 0, 5, 3, 1), V(2, 10, 15, 1, 3)], 'simple');
    assert.deepEqual(r.outcomes, { 1: 'approved', 2: 'rejected' });
    assert.deepEqual(r.untallied, []);
    assert.deepEqual(r.overlaps, []);
});

test('outcomes: per-proposal threshold overrides the document default', () => {
    const r = decideOutcomes([V(1, 0, 5, 6, 4, { majority_threshold: 'two_thirds' }), V(2, 10, 15, 6, 4)], 'simple');
    assert.deepEqual(r.outcomes, { 1: 'rejected', 2: 'approved' });
});

test('outcomes: child is not_applicable when its parent passes, voted when the parent fails', () => {
    const passed = decideOutcomes([V(1, 0, 5, 3, 1), V(2, 0, 5, 9, 0, { parent_variant_id: 1 })], 'simple');
    assert.deepEqual(passed.outcomes, { 1: 'approved', 2: 'not_applicable' });
    const failed = decideOutcomes([V(1, 0, 5, 1, 3), V(2, 0, 5, 9, 0, { parent_variant_id: 1 })], 'simple');
    assert.deepEqual(failed.outcomes, { 1: 'rejected', 2: 'approved' });
});

test('outcomes: proposals without a tally are reported, except children of a passed parent', () => {
    const r = decideOutcomes([
        V(1, 0, 5, 3, 1), V(2, 0, 5, null, null, { parent_variant_id: 1 }),
        V(3, 10, 15, null, null),
        V(4, 20, 25, 1, 3), V(5, 20, 25, null, null, { parent_variant_id: 4 }),
    ], 'simple');
    assert.deepEqual(r.untallied, [3, 5]);
    assert.equal(r.outcomes[2], 'not_applicable');
});

test('outcomes: overlapping passing proposals are reported; touching ranges and failed ones are not', () => {
    const r = decideOutcomes([V(1, 0, 10, 3, 1), V(2, 6, 16, 3, 1), V(3, 16, 20, 3, 1), V(4, 0, 30, 1, 3)], 'simple');
    assert.deepEqual(r.overlaps, [[1, 2]]);
});

test('outcomes: an insert inside a passing range overlaps it; an insert at its edge does not', () => {
    const inside = decideOutcomes([V(1, 0, 10, 3, 1), V(2, 5, 5, 3, 1)], 'simple');
    assert.deepEqual(inside.overlaps, [[1, 2]]);
    const edge = decideOutcomes([V(1, 0, 10, 3, 1), V(2, 10, 10, 3, 1), V(3, 0, 0, 3, 1)], 'simple');
    assert.deepEqual(edge.overlaps, []);
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

test('escapeHtml: neutralises markup and quotes, tolerates null', () => {
    assert.equal(escapeHtml('<a href="x" onclick=\'y\'>A&B</a>'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;A&amp;B&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(42), '42');
});

test('outcomes: an insert counts as a point at char_start, whatever range was selected', () => {
    const insert = V(1, 4, 9, 3, 1, { operation: 'insert' });
    assert.deepEqual(decideOutcomes([insert, V(2, 6, 12, 3, 1)], 'simple').overlaps, [], 'a replace inside the selected range does not conflict');
    assert.deepEqual(decideOutcomes([insert, V(2, 0, 12, 3, 1)], 'simple').overlaps, [[1, 2]], 'a replace that spans the insertion point does');
});
