'use strict';

// Pure text/vote helpers — no DB, no Express. Unit-tested in tests/unit.test.js.

// An insert adds text at char_start and removes nothing, whatever range was
// selected when it was proposed; replace and delete consume [char_start, char_end).
function consumedEnd(v) {
    return v.operation === 'insert' ? v.char_start : v.char_end;
}

// Apply approved variants to the original text by absolute char offsets, in
// char_start order (ties: the shorter range first). A variant that starts
// inside an already-consumed range is skipped.
function applyVariantsToText(originalText, approvedVariants) {
    const sorted = [...approvedVariants].sort((a, b) => a.char_start - b.char_start || consumedEnd(a) - consumedEnd(b));
    let result = '';
    let pos = 0;
    for (const v of sorted) {
        if (v.char_start < pos) continue;
        result += originalText.slice(pos, v.char_start);
        if (v.operation !== 'delete') result += v.new_text;
        pos = consumedEnd(v);
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

// Decide every voteable proposal from its recorded final tally. Children are
// not_applicable when their parent passes. Returns the outcome per variant id,
// the ids that still lack a tally, and pairs of passing proposals whose ranges
// overlap — the last two block resolution.
function decideOutcomes(voteable, docThreshold) {
    const outcomes = {};
    const untallied = [];
    const tallied = v => v.final_yes != null || v.final_no != null;
    const decide = v => passesThreshold(v.final_yes, v.final_no, v.final_abstain, v.majority_threshold || docThreshold) ? 'approved' : 'rejected';

    for (const v of voteable.filter(v => v.parent_variant_id == null)) {
        if (tallied(v)) outcomes[v.id] = decide(v);
        else untallied.push(v.id);
    }
    for (const v of voteable.filter(v => v.parent_variant_id != null)) {
        if (outcomes[v.parent_variant_id] === 'approved') outcomes[v.id] = 'not_applicable';
        else if (tallied(v)) outcomes[v.id] = decide(v);
        else untallied.push(v.id);
    }

    const approved = voteable.filter(v => outcomes[v.id] === 'approved');
    const overlaps = [];
    for (let i = 0; i < approved.length; i++) {
        for (let j = i + 1; j < approved.length; j++) {
            const a = approved[i], b = approved[j];
            if (a.char_start < consumedEnd(b) && b.char_start < consumedEnd(a)) overlaps.push([a.id, b.id]);
        }
    }
    return { outcomes, untallied, overlaps };
}

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

// Paged markdown as written by pdf2md.py: "*Page N*" markers, "---" separators and
// lines of the form "[# |## ]<number>  <text>". Pages keep the source page number so
// VoteText's pages match the printed document; line numbers are sequential over the
// kept lines, which equals the source numbering when it is continuous from 1.
const PAGE_MARKER = /^\*Page (\d+)\b/;
const NUMBERED_LINE = /^(#{1,6} )?\s*(\d+)(?:\s{2,}(.*))?$/;

function importPagedText(text, { keepUnnumbered = false } = {}) {
    let page = 1, sawMarker = false, skipped = 0;
    const kept = [];
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const trimmed = line.trim();
        const marker = trimmed.match(PAGE_MARKER);
        if (marker) { page = Number(marker[1]); sawMarker = true; continue; }
        if (trimmed === '' || trimmed === '---') continue;
        const m = line.match(NUMBERED_LINE);
        if (m) {
            kept.push({ page_num: page, original_text: `${m[1] || ''}${(m[3] || '').trim()}`, source_num: Number(m[2]) });
        } else if (keepUnnumbered) {
            kept.push({ page_num: page, original_text: trimmed, source_num: null });
        } else {
            skipped++;
        }
    }
    if (!sawMarker) return { error: 'No page markers (*Page N*) found — choose a fixed number of lines per page' };
    if (!kept.length) return { error: 'No numbered lines found — choose a fixed number of lines per page' };

    let charOffset = 0, renumbered = 0;
    const lines = kept.map((item, i) => {
        if (item.source_num !== i + 1) renumbered++;
        const out = {
            page_num: item.page_num,
            line_num: i + 1,
            original_text: item.original_text,
            char_offset_start: charOffset,
            char_offset_end: charOffset + item.original_text.length,
        };
        charOffset += item.original_text.length + 1;
        return out;
    });
    return {
        text: lines.map(l => l.original_text).join('\n'),
        lines,
        total_pages: Math.max(...lines.map(l => l.page_num)),
        skipped_unnumbered: skipped,
        renumbered,
    };
}

// The inverse of importPagedText for a stored document: one "*Page N*" section per
// page (empty pages included), each line as "<line_num>  <text>". Re-importing the
// result reproduces the same lines, pages and character offsets.
function exportPagedText(lines, totalPages) {
    const byPage = new Map();
    for (const l of lines) {
        if (!byPage.has(l.page_num)) byPage.set(l.page_num, []);
        byPage.get(l.page_num).push(l);
    }
    const parts = [];
    for (let p = 1; p <= totalPages; p++) {
        parts.push(`*Page ${p}*`);
        for (const l of byPage.get(p) || []) parts.push(`${l.line_num}  ${l.original_text}`);
        parts.push('---');
    }
    return parts.join('\n');
}

module.exports = { applyVariantsToText, passesThreshold, VALID_THRESHOLDS, decideOutcomes, escapeHtml, importText, importPagedText, exportPagedText };
