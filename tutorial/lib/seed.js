'use strict';

// Data-driven seeding of a tutorial scenario (tutorial/scenarios/*.js): the cast, one document per lifecycle
// stage with its proposals, votes, comments, tallies and resolved text, and a session per persona. Prints the
// cookies and document ids in the format tutorial/lib/server.js parses. Runs against whatever database
// src/db.js opens (DATABASE_PATH), so it is also what npm run seed-demo does on the dev database.

const crypto = require('crypto');
const { db, run, getOne, transaction } = require('../../src/db');
const { signSessionId } = require('../../src/middleware/auth');
const { applyVariantsToText, importText, importPagedText } = require('../../src/lib/text');

function createUser(u) {
    run('INSERT INTO users (email, display_name, organization, role) VALUES (?, ?, ?, ?)', [u.email, u.name, u.org, u.role || 'user']);
    return getOne('SELECT id FROM users WHERE email = ?', [u.email]).id;
}

function createDoc(d, ownerId) {
    const auto = d.linesPerPage === 'auto';
    const imported = auto ? importPagedText(d.text) : null;
    if (imported && imported.error) throw new Error(`${d.title}: ${imported.error}`);
    const lineItems = auto ? imported.lines : importText(d.text, d.linesPerPage);
    const totalPages = auto ? imported.total_pages : Math.max(1, Math.ceil(lineItems.length / d.linesPerPage));
    const text = auto ? imported.text : d.text;
    const r = run(
        'INSERT INTO documents (title, description, owner_id, status, total_pages, total_lines, total_chars, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [d.title, d.description, ownerId, d.status, totalPages, lineItems.length, text.length, JSON.stringify({ lines_per_page: d.linesPerPage, ...(d.settings || {}) })]
    );
    const docId = r.lastInsertRowid;
    const insertLine = db.prepare('INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lineItems) insertLine.run(docId, l.page_num, l.line_num, l.original_text, l.char_offset_start, l.char_offset_end);
    return { docId, lineItems, text };
}

function lineRange(lineItems, prefix, title) {
    const l = lineItems.find(x => x.original_text.startsWith(prefix));
    if (!l) throw new Error(`Seed error: no line starting with "${prefix}" (document "${title}")`);
    return { start: l.char_offset_start, end: l.char_offset_end };
}

function addComment(variantId, userId, text, parentId = null) {
    return run('INSERT INTO comments (variant_id, user_id, parent_comment_id, text) VALUES (?, ?, ?, ?)', [variantId, userId, parentId, text]).lastInsertRowid;
}

function seedScenario(data) {
    const ownerEmail = data.users[data.owner].email;
    if (getOne('SELECT id FROM users WHERE email = ?', [ownerEmail])) {
        console.log(`Demo data already seeded (${ownerEmail} exists). Run npm run clean-db first for a fresh take.`);
        return false;
    }
    console.log(`Seeding tutorial scenario "${data.name}"…`);
    transaction(() => {
        const ids = {};
        for (const [key, u] of Object.entries(data.users)) ids[key] = createUser(u);
        const docs = [];
        for (const d of data.documents) {
            const doc = createDoc(d, ids[data.owner]);
            run('INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, ?, ?)', [ids[data.owner], doc.docId, 'admin', ids[data.owner]]);
            for (const [key, level] of Object.entries(d.access || {})) {
                run('INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, ?, ?)', [ids[key], doc.docId, level, ids[data.owner]]);
            }
            const variantIds = {};
            for (const v of d.variants || []) {
                const range = lineRange(doc.lineItems, v.line, d.title);
                const r = run(
                    `INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title, rationale,
                        status, vote_order, parent_variant_id, final_yes, final_no, final_abstain, majority_threshold)
                     VALUES (?, ?, ?, ?, 'replace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [doc.docId, ids[v.by], range.start, range.end, v.newText, v.title, v.rationale,
                     v.status || 'pending', v.vote_order ?? null, v.parent ? variantIds[v.parent] : null,
                     v.final ? v.final.yes : null, v.final ? v.final.no : null, v.final ? v.final.abstain : null, v.threshold ?? null]
                );
                const vid = r.lastInsertRowid;
                variantIds[v.key] = vid;
                let vf = 0, va = 0, vb = 0;
                for (const [who, value] of v.votes || []) {
                    run('INSERT INTO votes (variant_id, user_id, vote_value) VALUES (?, ?, ?)', [vid, ids[who], value]);
                    if (value === 1) vf++; else if (value === -1) va++; else vb++;
                }
                if (v.votes) run('UPDATE variants SET votes_for = ?, votes_against = ?, votes_abstain = ? WHERE id = ?', [vf, va, vb, vid]);
                for (const c of v.comments || []) {
                    const cid = addComment(vid, ids[c.by], c.text);
                    for (const reply of c.replies || []) addComment(vid, ids[reply.by], reply.text, cid);
                }
                if (v.final) {
                    run('INSERT INTO final_vote_log (variant_id, user_id, final_yes, final_no, final_abstain, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
                        [vid, ids[v.final.by || 'david'], v.final.yes, v.final.no, v.final.abstain, Date.now() - (v.final.ago || 0)]);
                }
            }
            if (d.resolve) {
                const approved = (d.variants || []).filter(v => v.status === 'approved').map(v => getOne('SELECT * FROM variants WHERE id = ?', [variantIds[v.key]]));
                const resolvedText = applyVariantsToText(doc.text, approved);
                run('UPDATE documents SET resolved_text = ?, resolved_at = ?, doc_vote_yes = ?, doc_vote_no = ?, doc_vote_abstain = ? WHERE id = ?',
                    [resolvedText, new Date(Date.now() - (d.resolve.ago || 0)).toISOString(), d.resolve.docVote.yes, d.resolve.docVote.no, d.resolve.docVote.abstain, doc.docId]);
            }
            docs.push({ ...d, id: doc.docId });
        }

        const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
        console.log('\nSession cookies (set with: document.cookie = "session_id=<value>; path=/"):\n');
        for (const [key, u] of Object.entries(data.users)) {
            const sid = crypto.randomBytes(32).toString('hex');
            run('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)', [sid, ids[key], expiresAt]);
            console.log(`  ${u.label.padEnd(20)} ${signSessionId(sid)}`);
        }
        console.log('\nDocuments:');
        for (const d of docs) console.log(`  #${d.id}  ${d.title.padEnd(30)} (${d.status.padEnd(12)}) — ${d.note || ''}`);
    });
    return true;
}

function loadScenario(name) {
    try { return require(`../scenarios/${name}`); } catch (e) { throw new Error(`Unknown tutorial scenario "${name}" (tutorial/scenarios/): ${e.message}`); }
}

module.exports = { seedScenario, loadScenario };
