'use strict';

// Demo data for recording the tutorial video (specs/tutorial-video-script.md).
// Creates four demo users and four documents, one per lifecycle stage, so every
// chapter of the video can be recorded independently and re-recorded from the
// same state. Run on a fresh or dev database: node scripts/seed-demo.js

require('dotenv').config();
const crypto = require('crypto');
const { db, run, getOne, transaction } = require('../src/db');
const { signSessionId } = require('../src/middleware/auth');
const { applyVariantsToText, importText } = require('../src/lib/text');

if (getOne("SELECT id FROM users WHERE email = 'anna@demo.votetext'")) {
    console.log('Demo data already seeded (anna@demo.votetext exists). Run npm run clean-db first for a fresh take.');
    process.exit(0);
}

const CHARTER_TEXT = [
    'Community Garden Charter',
    '',
    'Section 1 — Purpose',
    '',
    '1.1 The community garden exists to give every resident access to a plot of soil, sunlight, and good company.',
    '1.2 The garden is maintained collectively, and every member shares responsibility for the common areas.',
    '1.3 Decisions about the garden are made openly, with every member entitled to propose changes and vote.',
    '',
    'Section 2 — Membership',
    '',
    '2.1 Membership is open to all residents of the neighbourhood on payment of the annual fee.',
    '2.2 The annual fee is 250 kroner, payable before the first of April.',
    '2.3 Members who do not tend their plot for a full season may lose it to the waiting list.',
    '2.4 Guests are welcome during opening hours when accompanied by a member.',
    '',
    'Section 3 — Plots and Common Areas',
    '',
    '3.1 Each membership includes one plot of ten square metres.',
    '3.2 Plots must be kept free of invasive species and tall structures.',
    '3.3 The tool shed, compost bins, and water taps are shared by all members.',
    '3.4 The rose bed by the gate is maintained by volunteers and funded from the common budget.',
    '',
    'Section 4 — Conduct',
    '',
    '4.1 Members shall treat each other, and each other’s plots, with respect.',
    '4.2 Radios and speakers may not be used in the garden.',
    '4.3 Dogs must be kept on a leash at all times.',
    '4.4 Disputes between members are brought to the garden committee before anything else.',
    '',
    'Section 5 — Meetings and Decisions',
    '',
    '5.1 The garden assembly meets twice a year, in March and September.',
    '5.2 Proposals to change this charter are published at least two weeks before the assembly.',
    '5.3 Changes to this charter require a simple majority of the votes cast.',
    '5.4 The committee may adopt temporary rules between assemblies, valid until the next meeting.',
].join('\n');

const BUDGET_TEXT = [
    'Garden Budget Priorities 2027',
    '',
    '1. The common budget for 2027 is 18,000 kroner, carried by membership fees and the autumn plant sale.',
    '2. The largest single expense is water, estimated at 6,000 kroner for the season.',
    '3. The committee proposes to spend 4,000 kroner on new hand tools for the shared shed.',
    '4. The remaining funds are reserved for compost, seeds for the common beds, and small repairs.',
    '5. Any surplus at the end of the season is carried over to the next year.',
].join('\n');

const WATERING_TEXT = [
    'Watering Schedule Amendment',
    '',
    '1. Watering is permitted on weekday evenings between six and nine.',
    '2. Weekend watering is permitted in the morning between eight and eleven.',
    '3. Sprinklers may only be used on the common beds.',
    '4. During drought restrictions, the committee posts a reduced schedule at the gate.',
].join('\n');

const SHED_TEXT = [
    'Tool Shed Rules 2026',
    '',
    '1. The shed is open whenever the garden is open.',
    '2. Tools are returned clean and dry the same day they are borrowed.',
    '3. Power tools may be borrowed for up to two days with a note in the logbook.',
    '4. Broken tools are reported to the committee, not returned quietly to the rack.',
].join('\n');

function createUser(email, name, org) {
    run('INSERT INTO users (email, display_name, organization) VALUES (?, ?, ?)', [email, name, org]);
    return getOne('SELECT id FROM users WHERE email = ?', [email]);
}

function createDoc(title, description, ownerId, status, text, linesPerPage, settings = {}) {
    const lineItems = importText(text, linesPerPage);
    const totalPages = Math.max(1, Math.ceil(lineItems.length / linesPerPage));
    const r = run(
        'INSERT INTO documents (title, description, owner_id, status, total_pages, total_lines, total_chars, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [title, description, ownerId, status, totalPages, lineItems.length, text.length, JSON.stringify({ lines_per_page: linesPerPage, ...settings })]
    );
    const docId = r.lastInsertRowid;
    const insertLine = db.prepare('INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lineItems) insertLine.run(docId, l.page_num, l.line_num, l.original_text, l.char_offset_start, l.char_offset_end);
    return { docId, lineItems };
}

// Find the char range of a line by its text prefix
function lineRange(lineItems, prefix) {
    const l = lineItems.find(x => x.original_text.startsWith(prefix));
    if (!l) throw new Error(`Seed error: no line starting with "${prefix}"`);
    return { start: l.char_offset_start, end: l.char_offset_end };
}

function grant(userId, docId, level, invitedBy) {
    run('INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, ?, ?)', [userId, docId, level, invitedBy]);
}

function addVariant(docId, byId, range, newText, title, rationale, extra = {}) {
    const r = run(
        `INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title, rationale,
            status, vote_order, parent_variant_id, final_yes, final_no, final_abstain, majority_threshold)
         VALUES (?, ?, ?, ?, 'replace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [docId, byId, range.start, range.end, newText, title, rationale,
         extra.status || 'pending', extra.vote_order ?? null, extra.parent_variant_id ?? null,
         extra.final_yes ?? null, extra.final_no ?? null, extra.final_abstain ?? null, extra.majority_threshold ?? null]
    );
    return r.lastInsertRowid;
}

function addVotes(variantId, votes) {
    let vf = 0, va = 0, vb = 0;
    for (const [userId, value] of votes) {
        run('INSERT INTO votes (variant_id, user_id, vote_value) VALUES (?, ?, ?)', [variantId, userId, value]);
        if (value === 1) vf++; else if (value === -1) va++; else vb++;
    }
    run('UPDATE variants SET votes_for = ?, votes_against = ?, votes_abstain = ? WHERE id = ?', [vf, va, vb, variantId]);
}

console.log('Seeding tutorial demo data…');

transaction(() => {
    // ── Cast ──────────────────────────────────────────────────────────────────
    const anna  = createUser('anna@demo.votetext',  'Anna Berg',  'Garden Committee');   // chair — owns all docs
    const bjorn = createUser('bjorn@demo.votetext', 'Bjørn Dahl', 'Plot 14');            // proposer
    const clara = createUser('clara@demo.votetext', 'Clara Foss', 'Plot 3');             // voter/commenter
    const david = createUser('david@demo.votetext', 'David Lie',  'Garden Committee');   // supervisor

    // ── Doc 1: OPEN — main stage for reading/commenting/proposing/voting ─────
    const charter = createDoc(
        'Community Garden Charter',
        'The rules we garden by — annual revision',
        anna.id, 'open', CHARTER_TEXT, 20
    );
    grant(anna.id,  charter.docId, 'admin',      anna.id);
    grant(bjorn.id, charter.docId, 'proposer',   anna.id);
    grant(clara.id, charter.docId, 'voter',      anna.id);
    grant(david.id, charter.docId, 'supervisor', anna.id);

    const feeVar = addVariant(charter.docId, bjorn.id,
        lineRange(charter.lineItems, '2.2 The annual fee is 250'),
        '2.2 The annual fee is 300 kroner, payable before the first of April.',
        'Raise the annual fee to 300 kroner',
        'Water costs have gone up two years in a row. A modest increase keeps the budget balanced without cutting the common beds.');
    addVotes(feeVar, [[anna.id, 1], [clara.id, 1]]);
    const c1 = run('INSERT INTO comments (variant_id, user_id, text) VALUES (?, ?, ?)',
        [feeVar, clara.id, 'Reasonable. Could we also mention what the extra 50 kroner is earmarked for?']);
    run('INSERT INTO comments (variant_id, user_id, parent_comment_id, text) VALUES (?, ?, ?, ?)',
        [feeVar, bjorn.id, c1.lastInsertRowid, 'Good idea — the rationale now says it: water costs. I can add it to the text if others agree.']);

    const dogVar = addVariant(charter.docId, clara.id,
        lineRange(charter.lineItems, '4.3 Dogs must be kept'),
        '4.3 Dogs are welcome on a leash; they must never be left unattended in the garden.',
        'Clarify the dog rule',
        'The current wording sounds unfriendly. We love dogs — we just don’t want them digging up the carrots alone.');
    addVotes(dogVar, [[bjorn.id, 1], [anna.id, 0]]);

    // Off-topic comment for the moderation chapter
    run('INSERT INTO comments (variant_id, user_id, text) VALUES (?, ?, ?)',
        [dogVar, clara.id, 'By the way — my cousin sells discount garden gnomes, message me for the catalogue!']);

    // ── Doc 2: VOTING — review + conflict resolution demo (overlaps intact) ──
    const budget = createDoc(
        'Garden Budget Priorities 2027',
        'How we spend the common budget next season',
        anna.id, 'voting', BUDGET_TEXT, 30
    );
    grant(anna.id,  budget.docId, 'admin',      anna.id);
    grant(bjorn.id, budget.docId, 'voter',      anna.id);
    grant(clara.id, budget.docId, 'voter',      anna.id);
    grant(david.id, budget.docId, 'supervisor', anna.id);

    const toolsLine = lineRange(budget.lineItems, '3. The committee proposes to spend 4,000');
    const bTools1 = addVariant(budget.docId, bjorn.id, toolsLine,
        '3. The committee proposes to spend 4,000 kroner on a shared battery-driven hedge trimmer and loppers.',
        'Spend the tool budget on a hedge trimmer',
        'The hedges along the north fence take four weekends by hand. One good trimmer saves us all that time.');
    addVotes(bTools1, [[clara.id, 1], [anna.id, 1]]);
    const bTools2 = addVariant(budget.docId, clara.id, toolsLine,
        '3. The committee proposes to spend 2,000 kroner on hand tools and 2,000 kroner on a repair fund for what we already own.',
        'Split the tool budget: half new tools, half repairs',
        'Half our "broken" tools just need new handles. A repair fund stretches the budget further than buying new.');
    addVotes(bTools2, [[bjorn.id, 1], [anna.id, -1]]);
    const bWater = addVariant(budget.docId, bjorn.id,
        lineRange(budget.lineItems, '2. The largest single expense is water'),
        '2. The largest single expense is water, estimated at 6,000 kroner; the committee will obtain a rain barrel quote before the season starts.',
        'Investigate rain barrels to cut the water bill',
        'A one-time investment in rain barrels could cut the recurring water cost from next year on.');
    addVotes(bWater, [[clara.id, 1], [anna.id, 1], [david.id, 1]]);

    // ── Doc 3: FINAL_VOTING — conflicts resolved, one tally pre-recorded ─────
    const watering = createDoc(
        'Watering Schedule Amendment',
        'Adjusting watering hours after last summer’s drought',
        anna.id, 'final_voting', WATERING_TEXT, 30
    );
    grant(anna.id,  watering.docId, 'admin',      anna.id);
    grant(bjorn.id, watering.docId, 'voter',      anna.id);
    grant(clara.id, watering.docId, 'voter',      anna.id);
    grant(david.id, watering.docId, 'supervisor', anna.id);

    const eveningLine = lineRange(watering.lineItems, '1. Watering is permitted on weekday evenings');
    const wRoot = addVariant(watering.docId, bjorn.id, eveningLine,
        '1. Watering is permitted on weekday evenings between seven and ten.',
        'Shift evening watering one hour later',
        'Most members are not home from work by six. Seven to ten matches when people actually garden.',
        { status: 'conflict', vote_order: 1 });
    addVotes(wRoot, [[clara.id, 1], [anna.id, 1]]);
    const wChild = addVariant(watering.docId, clara.id, eveningLine,
        '1. Watering is permitted on weekday evenings between six and ten.',
        'Extend evening watering instead of shifting it',
        'Fallback if the shift fails: keep six o’clock for the early birds and simply add the extra hour.',
        { status: 'conflict', parent_variant_id: wRoot, vote_order: 1 });
    const wSprinkler = addVariant(watering.docId, bjorn.id,
        lineRange(watering.lineItems, '3. Sprinklers may only be used'),
        '3. Sprinklers may only be used on the common beds, and never during drought restrictions.',
        'Ban sprinklers during drought restrictions',
        'Obvious in spirit, but it should be written down before the next dry summer.',
        { final_yes: 11, final_no: 1, final_abstain: 2 });
    run('INSERT INTO final_vote_log (variant_id, user_id, final_yes, final_no, final_abstain, recorded_at) VALUES (?, ?, 11, 1, 2, ?)',
        [wSprinkler, david.id, Date.now() - 3600000]);
    addVariant(watering.docId, clara.id,
        lineRange(watering.lineItems, '2. Weekend watering is permitted'),
        '2. Weekend watering is permitted in the morning between seven and eleven.',
        'Open weekend watering an hour earlier',
        'Summer mornings are cooler at seven — better for the plants and the gardeners.');

    // ── Doc 4: RESOLVED — finished vote with stored resolved text ─────────────
    const shed = createDoc(
        'Tool Shed Rules 2026',
        'Adopted at the spring assembly',
        anna.id, 'resolved', SHED_TEXT, 30
    );
    grant(anna.id,  shed.docId, 'admin',      anna.id);
    grant(bjorn.id, shed.docId, 'voter',      anna.id);
    grant(clara.id, shed.docId, 'voter',      anna.id);
    grant(david.id, shed.docId, 'supervisor', anna.id);

    const sPower = addVariant(shed.docId, bjorn.id,
        lineRange(shed.lineItems, '3. Power tools may be borrowed'),
        '3. Power tools may be borrowed for up to four days with a note in the logbook.',
        'Extend power tool loans to four days',
        'Two days is too short for a fence project. Four days still keeps tools circulating.',
        { status: 'approved', final_yes: 14, final_no: 3, final_abstain: 1 });
    const sBroken = addVariant(shed.docId, clara.id,
        lineRange(shed.lineItems, '4. Broken tools are reported'),
        '4. Broken tools are reported to the committee within a day, not returned quietly to the rack.',
        'Add a deadline for reporting broken tools',
        'A deadline makes the rule enforceable instead of aspirational.',
        { status: 'rejected', final_yes: 6, final_no: 9, final_abstain: 3 });
    run('INSERT INTO final_vote_log (variant_id, user_id, final_yes, final_no, final_abstain, recorded_at) VALUES (?, ?, 14, 3, 1, ?)', [sPower, david.id, Date.now() - 86400000]);
    run('INSERT INTO final_vote_log (variant_id, user_id, final_yes, final_no, final_abstain, recorded_at) VALUES (?, ?, 6, 9, 3, ?)', [sBroken, david.id, Date.now() - 86400000]);

    const approved = [getOne('SELECT * FROM variants WHERE id = ?', [sPower])];
    const resolvedText = applyVariantsToText(SHED_TEXT, approved);
    run("UPDATE documents SET resolved_text = ?, resolved_at = ?, doc_vote_yes = 15, doc_vote_no = 2, doc_vote_abstain = 1 WHERE id = ?",
        [resolvedText, new Date(Date.now() - 86400000).toISOString(), shed.docId]);

    // ── Sessions (30 days) — one browser profile per persona ─────────────────
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    console.log('\nSession cookies (set with: document.cookie = "session_id=<value>; path=/"):\n');
    for (const [label, user] of [['Anna (chair/owner)', anna], ['Bjørn (proposer)', bjorn], ['Clara (voter)', clara], ['David (supervisor)', david]]) {
        const sid = crypto.randomBytes(32).toString('hex');
        run('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)', [sid, user.id, expiresAt]);
        console.log(`  ${label.padEnd(20)} ${signSessionId(sid)}`);
    }

    console.log(`\nDocuments:`);
    console.log(`  #${charter.docId}  Community Garden Charter      (open)          — chapters 4–8, 12`);
    console.log(`  #${budget.docId}  Garden Budget Priorities 2027 (voting)        — chapter 9`);
    console.log(`  #${watering.docId}  Watering Schedule Amendment   (final_voting)  — chapter 10`);
    console.log(`  #${shed.docId}  Tool Shed Rules 2026          (resolved)      — chapter 11`);
});

console.log('\nDone. See specs/tutorial-video-script.md for the recording script.');
