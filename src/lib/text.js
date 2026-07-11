'use strict';

// Pure text/vote helpers — no DB, no Express. Unit-tested in tests/unit.test.js.

// Apply approved variants to the original text by absolute char offsets.
// Variants are applied in char_start order; a variant overlapping an already-
// applied range (char_start < pos) is skipped.
function applyVariantsToText(originalText, approvedVariants) {
    const sorted = [...approvedVariants].sort((a, b) => a.char_start - b.char_start);
    let result = '';
    let pos = 0;
    for (const v of sorted) {
        if (v.char_start < pos) continue;
        result += originalText.slice(pos, v.char_start);
        if (v.operation !== 'delete') result += v.new_text;
        pos = v.char_end;
    }
    return result + originalText.slice(pos);
}

// NOTE: mirrored in public/review.js (no build step) — a contract test in
// tests/frontend.test.js asserts the two copies stay textually identical.
function passesThreshold(yes, no, abstain, threshold) {
    yes = yes || 0; no = no || 0; abstain = abstain || 0;
    const total = yes + no + abstain;
    if (total === 0) return false;
    switch (threshold) {
        case 'absolute':      return 2 * yes > total;
        case 'two_thirds':    return 3 * yes >= 2 * total;
        case 'three_quarters': return 4 * yes >= 3 * total;
        default:              return yes > no;
    }
}

const VALID_THRESHOLDS = new Set(['simple', 'absolute', 'two_thirds', 'three_quarters']);

// Split raw text into page/line/char-offset rows for document_lines.
function importText(text, linesPerPage) {
    const lines = text.split('\n');
    let charOffset = 0;
    return lines.map((lineText, i) => {
        const item = {
            page_num: Math.floor(i / linesPerPage) + 1,
            line_num: i + 1,
            original_text: lineText,
            char_offset_start: charOffset,
            char_offset_end: charOffset + lineText.length,
        };
        charOffset += lineText.length + 1; // +1 for \n
        return item;
    });
}

module.exports = { applyVariantsToText, passesThreshold, VALID_THRESHOLDS, importText };
