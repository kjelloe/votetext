'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { db, run, getOne, transaction } = require('../src/db');

const SAMPLE_TEXT = `Article 1 — General Principles

1.1 This document establishes the governance rules for the VoteText working group.

1.2 All members shall participate in good faith and treat each other with respect.

1.3 Decisions shall be made through the voting mechanisms defined herein.

Article 2 — Membership

2.1 Membership is open to any individual who agrees to these terms.

2.2 Members may be removed by a supermajority vote of the existing members.

2.3 New members must be sponsored by an existing member in good standing.

Article 3 — Voting Procedures

3.1 Each member shall have one vote on each proposal.

3.2 Proposals shall be open for voting for a minimum of seven days.

3.3 A simple majority is required for standard proposals.

3.4 Amendments to this document require a two-thirds supermajority.

Article 4 — Amendments

4.1 Any member may propose an amendment to this document.

4.2 Amendments must be submitted in writing and include a rationale.

4.3 The working group shall review all proposed amendments within 30 days.`;

console.log('Seeding database…');

transaction(() => {
    // Create users
    const alice = getOne('SELECT id FROM users WHERE email = ?', ['alice@example.com']) ||
        (() => {
            run("INSERT INTO users (email, display_name, organization) VALUES ('alice@example.com', 'Alice Smith', 'Acme Corp')");
            return getOne("SELECT id FROM users WHERE email = 'alice@example.com'");
        })();

    const bob = getOne('SELECT id FROM users WHERE email = ?', ['bob@example.com']) ||
        (() => {
            run("INSERT INTO users (email, display_name, organization) VALUES ('bob@example.com', 'Bob Jones', 'Global Corp')");
            return getOne("SELECT id FROM users WHERE email = 'bob@example.com'");
        })();

    const carol = getOne('SELECT id FROM users WHERE email = ?', ['carol@example.com']) ||
        (() => {
            run("INSERT INTO users (email, display_name, organization) VALUES ('carol@example.com', 'Carol Williams', 'Startup Inc')");
            return getOne("SELECT id FROM users WHERE email = 'carol@example.com'");
        })();

    // Create sessions for quick dev login (expire in 30 days)
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    for (const user of [alice, bob, carol]) {
        const sid = crypto.randomBytes(32).toString('hex');
        run('INSERT OR IGNORE INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)', [sid, user.id, expiresAt]);
        if (user.id === alice.id) {
            console.log(`Alice session cookie: ${sid}`);
            console.log('  → Set in browser: document.cookie = "session_id=' + sid + '; path=/"');
        }
    }

    // Create document
    const lines = SAMPLE_TEXT.split('\n');
    let charOffset = 0;
    const lineItems = lines.map((text, i) => {
        const item = { page_num: Math.floor(i / 30) + 1, line_num: i + 1, original_text: text, char_offset_start: charOffset, char_offset_end: charOffset + text.length };
        charOffset += text.length + 1;
        return item;
    });

    const totalPages = Math.max(1, Math.ceil(lines.length / 30));
    const r = run(
        'INSERT INTO documents (title, description, owner_id, status, total_pages, total_lines, total_chars, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Working Group Governance Rules', 'Sample governance document for testing', alice.id, 'open', totalPages, lines.length, SAMPLE_TEXT.length, JSON.stringify({ allow_anonymous_view: false, lines_per_page: 30 })]
    );
    const docId = r.lastInsertRowid;

    const insertLine = db.prepare('INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lineItems) insertLine.run(docId, l.page_num, l.line_num, l.original_text, l.char_offset_start, l.char_offset_end);

    // Give all users access
    run("INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, 'admin', ?)", [alice.id, docId, alice.id]);
    run("INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, 'voter', ?)", [bob.id, docId, alice.id]);
    run("INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, 'proposer', ?)", [carol.id, docId, alice.id]);

    // Create a sample variant
    const line3 = lineItems.find(l => l.line_num === 3); // "1.2 All members shall participate..."
    if (line3) {
        const vr = run(
            "INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title, rationale) VALUES (?, ?, ?, ?, 'replace', ?, ?, ?)",
            [docId, bob.id, line3.char_offset_start, line3.char_offset_end,
             '1.2 All members shall participate actively in good faith, treating each other with mutual respect.',
             'Strengthen participation requirement',
             'The current wording is too vague. Adding "actively" and "mutual" makes the obligation clearer.']
        );
        const variantId = vr.lastInsertRowid;

        // Add a vote
        run('INSERT INTO votes (variant_id, user_id, vote_value) VALUES (?, ?, 1)', [variantId, alice.id]);
        run("UPDATE variants SET votes_for = 1 WHERE id = ?", [variantId]);

        // Add a comment
        run('INSERT INTO comments (variant_id, user_id, text) VALUES (?, ?, ?)', [variantId, carol.id, 'I support this change. The original wording left too much room for interpretation.']);
    }

    console.log(`\nSeeded document ID: ${docId}`);
    console.log(`Users: alice@example.com, bob@example.com, carol@example.com`);
    console.log('\nTo log in as Alice: use the OTP flow or set the session cookie shown above.');
});

console.log('Done.');
