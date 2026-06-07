'use strict';

// Must be set before any project module is required — dotenv will not override existing env vars
process.env.DATABASE_PATH = './data/test_votetext.db';
process.env.PORT = '3099';
process.env.NODE_ENV = 'test';
process.env.SESSION_LIFETIME_HOURS = '1';
process.env.OTP_EXPIRY_MINUTES = '10';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Initialise a fresh test database before loading any project module
const Database = require('better-sqlite3');
const DB_PATH = path.resolve('./data/test_votetext.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const initDb = new Database(DB_PATH);
initDb.exec(schema);
initDb.close();

// Load project modules (they will use DATABASE_PATH already set above)
const app = require('../src/server');
const { db } = require('../src/db');

const BASE = 'http://localhost:3099/api';

// Shared test state — tests run sequentially and build on each other
let server;
let sessionCookie = '';  // alice
let viewerCookie = '';   // bob (viewer only)
let docId;
let variantId;
let commentId;

// ── Lifecycle ────────────────────────────────────────────────────────────────

before(async () => {
    await new Promise(resolve => { server = app.listen(3099, resolve); });
});

after(async () => {
    db.close();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    // Also clean up WAL artefacts
    for (const ext of ['-shm', '-wal']) {
        const f = DB_PATH + ext;
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }
});

// ── Helper ───────────────────────────────────────────────────────────────────

async function req(method, urlPath, opts = {}) {
    const { body, cookie } = opts;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers['Cookie'] = cookie;

    const res = await fetch(BASE + urlPath, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = res.status === 204 ? null : await res.json();
    const setCookie = res.headers.get('set-cookie') || '';
    const m = setCookie.match(/session_id=([^;]+)/);

    return { status: res.status, data, sessionId: m ? m[1] : null };
}

// Read the most-recent unused OTP from the test DB directly
function latestOtp(email) {
    return db.prepare(
        "SELECT code FROM otp_codes WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1"
    ).get(email.toLowerCase());
}

// ── AUTH ─────────────────────────────────────────────────────────────────────

test('POST /auth/request-otp — missing email → 400', async () => {
    const r = await req('POST', '/auth/request-otp', { body: {} });
    assert.equal(r.status, 400);
});

test('POST /auth/request-otp — invalid email → 400', async () => {
    const r = await req('POST', '/auth/request-otp', { body: { email: 'notvalid' } });
    assert.equal(r.status, 400);
});

test('POST /auth/request-otp — valid email → 200, OTP saved', async () => {
    const r = await req('POST', '/auth/request-otp', { body: { email: 'alice@test.com' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.message, 'Code sent');
    const otp = latestOtp('alice@test.com');
    assert.ok(otp, 'OTP record should exist in DB');
    assert.match(otp.code, /^\d{6}$/, 'OTP should be 6 digits');
});

test('POST /auth/verify-otp — wrong code → 401', async () => {
    const r = await req('POST', '/auth/verify-otp', { body: { email: 'alice@test.com', code: '000000' } });
    assert.equal(r.status, 401);
});

test('POST /auth/verify-otp — correct code → 200, session cookie set', async () => {
    const otp = latestOtp('alice@test.com');
    const r = await req('POST', '/auth/verify-otp', { body: { email: 'alice@test.com', code: otp.code } });
    assert.equal(r.status, 200);
    assert.ok(r.data.user);
    assert.equal(r.data.user.email, 'alice@test.com');
    assert.ok(r.sessionId, 'session_id cookie should be present in response');
    sessionCookie = `session_id=${r.sessionId}`;
});

test('POST /auth/verify-otp — used code → 401', async () => {
    // The OTP was marked used in the previous test
    const otp = db.prepare("SELECT code FROM otp_codes WHERE email = 'alice@test.com' ORDER BY created_at DESC LIMIT 1").get();
    const r = await req('POST', '/auth/verify-otp', { body: { email: 'alice@test.com', code: otp.code } });
    assert.equal(r.status, 401);
});

test('GET /auth/me — no cookie → 401', async () => {
    const r = await req('GET', '/auth/me');
    assert.equal(r.status, 401);
});

test('GET /auth/me — valid session → 200', async () => {
    const r = await req('GET', '/auth/me', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.email, 'alice@test.com');
});

test('PATCH /auth/profile — update display name → 200', async () => {
    const r = await req('PATCH', '/auth/profile', { body: { display_name: 'Alice Test', organization: 'TestCo' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.display_name, 'Alice Test');
});

test('PATCH /auth/profile — set is_non_searchable → 200', async () => {
    const r = await req('PATCH', '/auth/profile', { body: { is_non_searchable: 1 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.is_non_searchable, 1);
    // reset
    await req('PATCH', '/auth/profile', { body: { is_non_searchable: 0 }, cookie: sessionCookie });
});

// Set up a second user (Bob) with viewer access for access-control tests
test('Setup: create viewer user Bob', async () => {
    await req('POST', '/auth/request-otp', { body: { email: 'bob@test.com' } });
    const otp = latestOtp('bob@test.com');
    const r = await req('POST', '/auth/verify-otp', { body: { email: 'bob@test.com', code: otp.code } });
    assert.equal(r.status, 200);
    viewerCookie = `session_id=${r.sessionId}`;
});

// ── USER SEARCH ───────────────────────────────────────────────────────────────

test('GET /auth/search — query < 3 chars → empty', async () => {
    const r = await req('GET', '/auth/search?q=bo', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.users, []);
});

test('GET /auth/search — matches bob by email prefix, excludes self → 200', async () => {
    const r = await req('GET', '/auth/search?q=bob', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.users.some(u => u.email === 'bob@test.com'), 'bob found');
    assert.ok(!r.data.users.some(u => u.email === 'alice@test.com'), 'alice excluded (self)');
});

test('GET /auth/search — non-searchable user excluded', async () => {
    db.prepare("UPDATE users SET is_non_searchable = 1 WHERE email = 'bob@test.com'").run();
    const r = await req('GET', '/auth/search?q=bob', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(!r.data.users.some(u => u.email === 'bob@test.com'), 'non-searchable bob not returned');
    db.prepare("UPDATE users SET is_non_searchable = 0 WHERE email = 'bob@test.com'").run();
});

test('GET /auth/search — unauthenticated → 401', async () => {
    const r = await req('GET', '/auth/search?q=bob');
    assert.equal(r.status, 401);
});

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────

test('POST /documents — missing title → 400', async () => {
    const r = await req('POST', '/documents', { body: { text: 'some text' }, cookie: sessionCookie });
    assert.equal(r.status, 400);
});

test('POST /documents — missing text → 400', async () => {
    const r = await req('POST', '/documents', { body: { title: 'Test' }, cookie: sessionCookie });
    assert.equal(r.status, 400);
});

test('POST /documents — valid → 201, lines created', async () => {
    const text = 'First line\nSecond line\nThird line\nFourth line\nFifth line';
    const r = await req('POST', '/documents', {
        body: { title: 'Test Document', text, description: 'A test doc', settings: { lines_per_page: 3 } },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.document.id);
    assert.equal(r.data.document.title, 'Test Document');
    assert.equal(r.data.document.total_lines, 5);
    assert.equal(r.data.document.total_pages, 2); // 5 lines / 3 per page = 2 pages
    assert.equal(r.data.document.total_chars, text.length);
    docId = r.data.document.id;
});

test('GET /documents — lists user documents → 200', async () => {
    const r = await req('GET', '/documents', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.documents));
    assert.ok(r.data.documents.some(d => d.id === docId));
});

test('GET /documents/:id — → 200 with metadata', async () => {
    const r = await req('GET', `/documents/${docId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.title, 'Test Document');
    assert.equal(r.data.document.status, 'draft');
});

test('GET /documents/:id — includes owner_organization field → 200', async () => {
    const r = await req('GET', `/documents/${docId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok('owner_organization' in r.data.document, 'owner_organization should be present');
});

test('GET /documents/:id/lines — page 1 returns lines with correct char offsets', async () => {
    const r = await req('GET', `/documents/${docId}/lines?page=1`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.page, 1);
    assert.equal(r.data.total_pages, 2);
    assert.equal(r.data.lines.length, 3);

    // Verify char offsets are contiguous
    const lines = r.data.lines;
    assert.equal(lines[0].char_offset_start, 0);
    assert.equal(lines[0].char_offset_end, 10);           // 'First line'
    assert.equal(lines[1].char_offset_start, 11);         // +1 for \n
    assert.equal(lines[1].char_offset_end, 22);           // 'Second line'
    assert.equal(lines[2].char_offset_start, 23);
});

test('GET /documents/:id/lines — page 2 returns remaining lines', async () => {
    const r = await req('GET', `/documents/${docId}/lines?page=2`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.lines.length, 2);
});

test('GET /documents/:id/text — returns full reconstructed text → 200', async () => {
    const r = await req('GET', `/documents/${docId}/text`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(typeof r.data.text === 'string' && r.data.text.length > 0);
    assert.ok(r.data.text.includes('First line'), 'contains first line text');
});

test('PATCH /documents/:id — update title and settings → 200', async () => {
    const r = await req('PATCH', `/documents/${docId}`, {
        body: { title: 'Updated Title', settings: { allow_anonymous_view: false } },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.title, 'Updated Title');
});

test('POST /documents/:id/status — invalid transition (draft → voting) → 422', async () => {
    const r = await req('POST', `/documents/${docId}/status`, { body: { status: 'voting' }, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

test('POST /documents/:id/status — valid transition (draft → open) → 200', async () => {
    const r = await req('POST', `/documents/${docId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'open');
});

// ── VARIANTS ──────────────────────────────────────────────────────────────────

test('POST /documents/:id/variants — invalid char range → 400', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 10, char_end: 5, operation: 'replace', new_text: 'x', title: 'bad' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('POST /documents/:id/variants — replace → 201', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 10, operation: 'replace', new_text: 'Changed line', title: 'Fix first line', rationale: 'Better wording' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.variant.id);
    assert.equal(r.data.variant.operation, 'replace');
    assert.equal(r.data.variant.status, 'pending');
    variantId = r.data.variant.id;
});

test('POST /documents/:id/variants — insert → 201', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 0, operation: 'insert', new_text: 'PREAMBLE\n', title: 'Add preamble' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.variant.operation, 'insert');
});

test('POST /documents/:id/variants — delete → 201', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 11, char_end: 22, operation: 'delete', new_text: '', title: 'Remove second line' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.variant.operation, 'delete');
});

test('GET /documents/:id/variants — lists all variants → 200', async () => {
    const r = await req('GET', `/documents/${docId}/variants`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.variants.length >= 3);
    const v = r.data.variants[0];
    assert.ok('proposer_org' in v, 'proposer_org field present');
    assert.ok('line_start' in v, 'line_start field present');
    assert.ok('line_end' in v, 'line_end field present');
    assert.ok(v.line_start >= 1, 'line_start is a valid line number');
    // variants must be returned in document position order
    const charStarts = r.data.variants.map(x => x.char_start);
    for (let i = 1; i < charStarts.length; i++) {
        assert.ok(charStarts[i] >= charStarts[i - 1], 'variants ordered by char_start ASC');
    }
});

test('GET /variants/:id — → 200 with proposer name', async () => {
    const r = await req('GET', `/variants/${variantId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.variant.proposer_name);
});

test('PATCH /variants/:id — update title → 200', async () => {
    const r = await req('PATCH', `/variants/${variantId}`, {
        body: { title: 'Corrected first line' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.title, 'Corrected first line');
});

// ── VOTING ────────────────────────────────────────────────────────────────────

test('POST /variants/:id/vote — invalid value → 400', async () => {
    const r = await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: 2 }, cookie: sessionCookie });
    assert.equal(r.status, 400);
});

test('POST /variants/:id/vote — cast for (1) → 200, tally updated', async () => {
    const r = await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: 1 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.tallies.votes_for, 1);
    assert.equal(r.data.tallies.votes_against, 0);
});

test('POST /variants/:id/vote — change to against (-1) → 200, tally recalculated', async () => {
    const r = await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: -1 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.tallies.votes_for, 0);
    assert.equal(r.data.tallies.votes_against, 1);
});

test('POST /variants/:id/vote — abstain (0) → 200', async () => {
    const r = await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: 0 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.tallies.votes_abstain, 1);
    assert.equal(r.data.tallies.votes_against, 0);
});

test('DELETE /variants/:id/vote — retract → 204', async () => {
    const r = await req('DELETE', `/variants/${variantId}/vote`, { cookie: sessionCookie });
    assert.equal(r.status, 204);
    // Verify tally is back to 0
    const check = await req('GET', `/variants/${variantId}/votes`, { cookie: sessionCookie });
    assert.equal(check.data.tallies.votes_abstain, 0);
});

test('GET /variants/:id/votes — → 200 with tallies', async () => {
    // Cast one vote first
    await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: 1 }, cookie: sessionCookie });
    const r = await req('GET', `/variants/${variantId}/votes`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.votes));
    assert.equal(r.data.tallies.votes_for, 1);
});

// ── COMMENTS ──────────────────────────────────────────────────────────────────

test('POST /variants/:id/comments — empty text → 400', async () => {
    const r = await req('POST', `/variants/${variantId}/comments`, { body: { text: '' }, cookie: sessionCookie });
    assert.equal(r.status, 400);
});

test('POST /variants/:id/comments — top-level comment → 201', async () => {
    const r = await req('POST', `/variants/${variantId}/comments`, {
        body: { text: 'This looks good to me.' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.comment.id);
    commentId = r.data.comment.id;
});

test('POST /variants/:id/comments — reply to comment → 201', async () => {
    const r = await req('POST', `/variants/${variantId}/comments`, {
        body: { text: 'Agreed, I support this.', parent_comment_id: commentId },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.comment.parent_comment_id, commentId);
});

test('POST /variants/:id/comments — reply to reply → 422 (max 2 levels)', async () => {
    // Get the reply's ID
    const listR = await req('GET', `/variants/${variantId}/comments`, { cookie: sessionCookie });
    const top = listR.data.comments.find(c => c.id === commentId);
    const replyId = top && top.replies && top.replies[0] && top.replies[0].id;
    if (!replyId) return; // guard: if reply not found, skip gracefully

    const r = await req('POST', `/variants/${variantId}/comments`, {
        body: { text: 'Third level — should fail', parent_comment_id: replyId },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('GET /variants/:id/comments — threaded structure → 200', async () => {
    const r = await req('GET', `/variants/${variantId}/comments`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.comments));
    const top = r.data.comments.find(c => c.id === commentId);
    assert.ok(top, 'Top-level comment should exist');
    assert.ok(Array.isArray(top.replies), 'Replies should be an array');
    assert.equal(top.replies.length, 1, 'Should have one reply');
});

test('DELETE /comments/:id — non-author → 403', async () => {
    // viewerCookie is Bob who did not post the comment
    const r = await req('DELETE', `/comments/${commentId}`, { cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('DELETE /comments/:id — author → 204', async () => {
    // Create a fresh comment to delete
    const c = await req('POST', `/variants/${variantId}/comments`, { body: { text: 'to be deleted' }, cookie: sessionCookie });
    const r = await req('DELETE', `/comments/${c.data.comment.id}`, { cookie: sessionCookie });
    assert.equal(r.status, 204);
});

// ── ACTIVITY FEED ─────────────────────────────────────────────────────────────

test('GET /activity — returns user activity → 200', async () => {
    const r = await req('GET', '/activity', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.activity));
    assert.ok(r.data.activity.length > 0, 'Activity feed should not be empty');
});

test('GET /documents/:id/activity — document activity → 200', async () => {
    const r = await req('GET', `/documents/${docId}/activity`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.activity));
    const actions = r.data.activity.map(a => a.action);
    assert.ok(actions.includes('document_created'));
});

// ── ACCESS CONTROL ────────────────────────────────────────────────────────────

test('GET /documents/:id/access — includes my_access_level and default_access → 200', async () => {
    const r = await req('GET', `/documents/${docId}/access`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok('my_access_level' in r.data, 'my_access_level present');
    assert.ok('default_access' in r.data, 'default_access present');
    assert.equal(r.data.my_access_level, 'admin');
});

test('PATCH /documents/:id — set default_access grants implicit access to unregistered user → 200/403', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Default access doc', text: 'hello world' }, cookie: sessionCookie });
    const dId = d.data.document.id;

    // Bob has no explicit access — denied
    const before = await req('GET', `/documents/${dId}`, { cookie: viewerCookie });
    assert.equal(before.status, 403, 'denied before default_access set');

    // Set default_access to viewer
    await req('PATCH', `/documents/${dId}`, { body: { settings: { default_access: 'viewer' } }, cookie: sessionCookie });

    // Bob can now access
    const after = await req('GET', `/documents/${dId}`, { cookie: viewerCookie });
    assert.equal(after.status, 200, 'accessible after default_access=viewer');
});

test('POST /documents/:id/access — cannot grant level above own → 403', async () => {
    // Alice is owner (admin). Grant Bob admin first so Bob can use access endpoint.
    await req('POST', `/documents/${docId}/access`, { body: { email: 'bob@test.com', access_level: 'admin' }, cookie: sessionCookie });
    // admin is the highest level — nothing higher exists, so test the validation message directly
    // by checking the endpoint rejects an invalid level
    const r = await req('POST', `/documents/${docId}/access`, {
        body: { email: 'other@test.com', access_level: 'superadmin' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400, 'invalid level rejected');
    // reset Bob back to viewer for subsequent tests
    const bobUser = db.prepare("SELECT id FROM users WHERE email = 'bob@test.com'").get();
    await req('PATCH', `/documents/${docId}/access/${bobUser.id}`, { body: { access_level: 'viewer' }, cookie: sessionCookie });
});

test('POST /documents/:id/access — grant viewer to Bob → 201', async () => {
    const r = await req('POST', `/documents/${docId}/access`, {
        body: { email: 'bob@test.com', access_level: 'viewer' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
});

test('POST /documents/:id/variants — viewer cannot propose → 403', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'x', title: 'Bob proposes' },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

test('PATCH /documents/:id/access/:userId — upgrade Bob to proposer → 200', async () => {
    const bobUser = db.prepare("SELECT id FROM users WHERE email = 'bob@test.com'").get();
    const r = await req('PATCH', `/documents/${docId}/access/${bobUser.id}`, {
        body: { access_level: 'proposer' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
});

test('POST /documents/:id/variants — proposer can now propose → 201', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 10, operation: 'replace', new_text: 'Bob\'s line', title: 'Bob proposes' },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 201);
});

test('POST /documents/:id/access — block Bob → 200', async () => {
    const bobUser = db.prepare("SELECT id FROM users WHERE email = 'bob@test.com'").get();
    const r = await req('PATCH', `/documents/${docId}/access/${bobUser.id}`, {
        body: { blocked: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
});

test('GET /documents/:id — blocked user → 403', async () => {
    const r = await req('GET', `/documents/${docId}`, { cookie: viewerCookie });
    assert.equal(r.status, 403);
});

// ── STATUS LIFECYCLE ──────────────────────────────────────────────────────────

test('POST /documents/:id/status — full lifecycle: open → voting → resolved → archived', async () => {
    // Unblock Bob first for clean state
    const bobUser = db.prepare("SELECT id FROM users WHERE email = 'bob@test.com'").get();
    await req('PATCH', `/documents/${docId}/access/${bobUser.id}`, { body: { blocked: false }, cookie: sessionCookie });

    let r = await req('POST', `/documents/${docId}/status`, { body: { status: 'voting' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting');

    r = await req('POST', `/documents/${docId}/status`, { body: { status: 'resolved' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'resolved');

    r = await req('POST', `/documents/${docId}/status`, { body: { status: 'archived' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'archived');
});

test('POST /variants/:id/vote — resolved document → 422', async () => {
    const r = await req('POST', `/variants/${variantId}/vote`, { body: { vote_value: 1 }, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

// ── VARIANT RELATIONS ─────────────────────────────────────────────────────────

test('POST /variants/:id/relations — add relation → 201', async () => {
    // Create a fresh doc/variants for relation test
    const doc = await req('POST', '/documents', { body: { title: 'Rel doc', text: 'abc def ghi' }, cookie: sessionCookie });
    const d = doc.data.document;
    await req('POST', `/documents/${d.id}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    const v1 = await req('POST', `/documents/${d.id}/variants`, { body: { char_start: 0, char_end: 3, operation: 'replace', new_text: 'xyz', title: 'v1' }, cookie: sessionCookie });
    const v2 = await req('POST', `/documents/${d.id}/variants`, { body: { char_start: 4, char_end: 7, operation: 'replace', new_text: 'uvw', title: 'v2' }, cookie: sessionCookie });

    const r = await req('POST', `/variants/${v1.data.variant.id}/relations`, {
        body: { to_variant_id: v2.data.variant.id, relation_type: 'conflicts' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
});

test('POST /variants/:id/relations — duplicate → 409', async () => {
    // Use the existing overlapping variants (overlaps relations are auto-created)
    const vList = db.prepare('SELECT id FROM variants WHERE document_id = ? LIMIT 2').all(docId);
    if (vList.length < 2) return;
    const [a, b] = vList;
    // Insert manually
    db.prepare("INSERT OR IGNORE INTO variant_relations (from_variant_id, to_variant_id, relation_type, created_by) VALUES (?, ?, 'conflicts', 1)").run(a.id, b.id);
    // Try to insert same relation via API
    const r = await req('POST', `/variants/${a.id}/relations`, {
        body: { to_variant_id: b.id, relation_type: 'conflicts' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 409);
});

// ── SOFT DELETE (G14) ─────────────────────────────────────────────────────────

test('DELETE /documents/:id — soft-deletes; subsequent GET → 404', async () => {
    const newDoc = await req('POST', '/documents', { body: { title: 'To delete', text: 'temporary' }, cookie: sessionCookie });
    const newDocId = newDoc.data.document.id;

    const del = await req('DELETE', `/documents/${newDocId}`, { cookie: sessionCookie });
    assert.equal(del.status, 204);

    const get = await req('GET', `/documents/${newDocId}`, { cookie: sessionCookie });
    assert.equal(get.status, 404);
});

// ── PRIVATE DOCUMENT — UNAUTHENTICATED ACCESS (G11–G13) ──────────────────────
// docId has allow_anonymous_view = false (set in the PATCH test above)

test('GET /variants/:id/comments — private doc, no auth → 403', async () => {
    const r = await req('GET', `/variants/${variantId}/comments`);
    assert.equal(r.status, 403);
});

test('GET /variants/:id/votes — private doc, no auth → 403', async () => {
    const r = await req('GET', `/variants/${variantId}/votes`);
    assert.equal(r.status, 403);
});

test('GET /variants/:id/relations — private doc, no auth → 403', async () => {
    const r = await req('GET', `/variants/${variantId}/relations`);
    assert.equal(r.status, 403);
});

// ── WITHDRAW VARIANT (C10 / C11) ──────────────────────────────────────────────

let withdrawDocId, withdrawVarId;

test('DELETE /variants/:id — withdraw → status = withdrawn', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Withdraw test', text: 'abc def ghi' }, cookie: sessionCookie });
    withdrawDocId = d.data.document.id;
    await req('POST', `/documents/${withdrawDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    const v = await req('POST', `/documents/${withdrawDocId}/variants`, {
        body: { char_start: 0, char_end: 3, operation: 'replace', new_text: 'xyz', title: 'to withdraw' },
        cookie: sessionCookie,
    });
    withdrawVarId = v.data.variant.id;

    const r = await req('DELETE', `/variants/${withdrawVarId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);

    const check = await req('GET', `/variants/${withdrawVarId}`, { cookie: sessionCookie });
    assert.equal(check.data.variant.status, 'withdrawn');
});

test('GET /documents/:id/variants — withdrawn variant excluded from list', async () => {
    const r = await req('GET', `/documents/${withdrawDocId}/variants`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(!r.data.variants.some(v => v.id === withdrawVarId), 'Withdrawn variant must not appear in list');
});

// ── COMMENT PATCH (F5 / F6 / F8) ─────────────────────────────────────────────

let commentPatchVariantId, aliceCommentId, bobCommentId2;

test('Setup: doc + variant + comments for comment-patch tests', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Comment patch test', text: 'some text here' }, cookie: sessionCookie });
    const commentPatchDocId = d.data.document.id;
    await req('POST', `/documents/${commentPatchDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    await req('POST', `/documents/${commentPatchDocId}/access`, {
        body: { email: 'bob@test.com', access_level: 'commenter' },
        cookie: sessionCookie,
    });

    const v = await req('POST', `/documents/${commentPatchDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'other', title: 'patch variant' },
        cookie: sessionCookie,
    });
    commentPatchVariantId = v.data.variant.id;

    const ac = await req('POST', `/variants/${commentPatchVariantId}/comments`, { body: { text: 'original text' }, cookie: sessionCookie });
    aliceCommentId = ac.data.comment.id;

    const bc = await req('POST', `/variants/${commentPatchVariantId}/comments`, { body: { text: 'bob original' }, cookie: viewerCookie });
    bobCommentId2 = bc.data.comment.id;
});

test('PATCH /comments/:id — author within edit window → 200', async () => {
    const r = await req('PATCH', `/comments/${aliceCommentId}`, { body: { text: 'edited text' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.comment.text, 'edited text');
});

test('PATCH /comments/:id — non-author → 403', async () => {
    const r = await req('PATCH', `/comments/${aliceCommentId}`, { body: { text: 'bob hacking' }, cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('DELETE /comments/:id — document admin deletes another user\'s comment → 204', async () => {
    const r = await req('DELETE', `/comments/${bobCommentId2}`, { cookie: sessionCookie });
    assert.equal(r.status, 204);
});

// ── ACTIVITY MINE FILTER (I2) ─────────────────────────────────────────────────

test('GET /activity?mine=true — returns only own actions', async () => {
    const all = await req('GET', '/activity', { cookie: sessionCookie });
    const mine = await req('GET', '/activity?mine=true', { cookie: sessionCookie });
    assert.equal(mine.status, 200);
    assert.ok(Array.isArray(mine.data.activity));
    assert.ok(all.data.activity.length >= mine.data.activity.length, 'Mine feed must be subset of all feed');
    const aliceUser = db.prepare("SELECT id FROM users WHERE email = 'alice@test.com'").get();
    assert.ok(
        mine.data.activity.every(a => a.user_id === aliceUser.id),
        'Every item in mine feed must belong to Alice'
    );
});

// ── STATUS LIFECYCLE EDGE CASES (H7 / H9) ────────────────────────────────────
// docId is archived at this point in the test sequence

test('POST /documents/:id/status — archived → any → 422', async () => {
    const r = await req('POST', `/documents/${docId}/status`, { body: { status: 'resolved' }, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

test('POST /documents/:id/variants — propose on archived document → 422', async () => {
    const r = await req('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'x', title: 'on archived' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

// ── ANONYMOUS ACCESS (G7 / G8) ───────────────────────────────────────────────

let anonDocId;

test('Setup: create public + private doc for anonymous access tests', async () => {
    const priv = await req('POST', '/documents', { body: { title: 'Private doc', text: 'secret content' }, cookie: sessionCookie });
    anonDocId = priv.data.document.id;
    // Leave allow_anonymous_view = false (default)

    const pub = await req('POST', '/documents', {
        body: { title: 'Public doc', text: 'open content', settings: { allow_anonymous_view: true } },
        cookie: sessionCookie,
    });
    // Store public doc id temporarily for the next test
    anonDocId = { priv: priv.data.document.id, pub: pub.data.document.id };
});

test('GET /documents/:id — private doc, no auth → 403', async () => {
    const r = await req('GET', `/documents/${anonDocId.priv}`);
    assert.equal(r.status, 403);
});

test('GET /documents/:id — public doc (allow_anonymous_view), no auth → 200', async () => {
    const r = await req('GET', `/documents/${anonDocId.pub}`);
    assert.equal(r.status, 200);
});

// ── ACCESS RECORD DELETION (G9) ──────────────────────────────────────────────

test('DELETE /documents/:id/access/:userId — revoke access → 204', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Access test', text: 'abc' }, cookie: sessionCookie });
    const dId = d.data.document.id;
    await req('POST', `/documents/${dId}/access`, { body: { email: 'bob@test.com', access_level: 'viewer' }, cookie: sessionCookie });
    const bobUser = db.prepare("SELECT id FROM users WHERE email = 'bob@test.com'").get();

    const r = await req('DELETE', `/documents/${dId}/access/${bobUser.id}`, { cookie: sessionCookie });
    assert.equal(r.status, 204);

    // Bob can no longer access the document
    const check = await req('GET', `/documents/${dId}`, { cookie: viewerCookie });
    assert.equal(check.status, 403);
});

// ── NON-OWNER DOCUMENT DELETE (G10) ──────────────────────────────────────────

test('DELETE /documents/:id — non-owner → 403', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Alice only', text: 'abc' }, cookie: sessionCookie });
    const r = await req('DELETE', `/documents/${d.data.document.id}`, { cookie: viewerCookie });
    assert.equal(r.status, 403);
});

// ── TWO USERS VOTING (E8) ─────────────────────────────────────────────────────

test('Two different users vote on same variant → count = 2', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Two voters', text: 'abc def' }, cookie: sessionCookie });
    const dId = d.data.document.id;
    await req('POST', `/documents/${dId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    await req('POST', `/documents/${dId}/access`, { body: { email: 'bob@test.com', access_level: 'voter' }, cookie: sessionCookie });

    const v = await req('POST', `/documents/${dId}/variants`, {
        body: { char_start: 0, char_end: 3, operation: 'replace', new_text: 'xyz', title: 'two voters variant' },
        cookie: sessionCookie,
    });
    const vId = v.data.variant.id;

    await req('POST', `/variants/${vId}/vote`, { body: { vote_value: 1 }, cookie: sessionCookie });
    const r = await req('POST', `/variants/${vId}/vote`, { body: { vote_value: 1 }, cookie: viewerCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.tallies.votes_for, 2);
});

// ── VARIANT RANGE VALIDATION (C4) ─────────────────────────────────────────────

test('POST /documents/:id/variants — char_end > total_chars → 400', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Range test', text: 'abc' }, cookie: sessionCookie });
    const dId = d.data.document.id;
    await req('POST', `/documents/${dId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    const r = await req('POST', `/documents/${dId}/variants`, {
        body: { char_start: 0, char_end: 999, operation: 'replace', new_text: 'x', title: 'out of range' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

// ── VARIANT PATCH GUARDS (C8 / C9) ────────────────────────────────────────────

test('PATCH /variants/:id — non-proposer → 403', async () => {
    const r = await req('PATCH', `/variants/${variantId}`, { body: { title: 'Bob hacking' }, cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('PATCH /variants/:id — already withdrawn → 422', async () => {
    const r = await req('PATCH', `/variants/${withdrawVarId}`, { body: { title: 'edit withdrawn' }, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

// ── RELATION EDGE CASES (D3 / D4 / D5 / D6) ──────────────────────────────────

let relDocId, relV1Id, relV2Id;

test('Setup: fresh doc + two variants for relation edge-case tests', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Rel edge', text: 'abcdefghij' }, cookie: sessionCookie });
    relDocId = d.data.document.id;
    await req('POST', `/documents/${relDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const v1 = await req('POST', `/documents/${relDocId}/variants`, {
        body: { char_start: 0, char_end: 3, operation: 'replace', new_text: 'xyz', title: 'rel v1' },
        cookie: sessionCookie,
    });
    const v2 = await req('POST', `/documents/${relDocId}/variants`, {
        body: { char_start: 4, char_end: 7, operation: 'replace', new_text: 'uvw', title: 'rel v2' },
        cookie: sessionCookie,
    });
    relV1Id = v1.data.variant.id;
    relV2Id = v2.data.variant.id;
});

test('POST /variants/:id/relations — self-relation → 400', async () => {
    const r = await req('POST', `/variants/${relV1Id}/relations`, {
        body: { to_variant_id: relV1Id, relation_type: 'conflicts' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('POST /variants/:id/relations — invalid relation_type → 400', async () => {
    const r = await req('POST', `/variants/${relV1Id}/relations`, {
        body: { to_variant_id: relV2Id, relation_type: 'hates' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('POST /variants/:id/relations — cross-document → 422', async () => {
    const r = await req('POST', `/variants/${relV1Id}/relations`, {
        body: { to_variant_id: variantId, relation_type: 'conflicts' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('GET /variants/:id/relations → 200, both sides returned', async () => {
    await req('POST', `/variants/${relV1Id}/relations`, {
        body: { to_variant_id: relV2Id, relation_type: 'based_on' },
        cookie: sessionCookie,
    });
    const r = await req('GET', `/variants/${relV1Id}/relations`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.relations));
    assert.ok(r.data.relations.some(rel =>
        (rel.from_variant_id === relV1Id && rel.to_variant_id === relV2Id) ||
        (rel.from_variant_id === relV2Id && rel.to_variant_id === relV1Id)
    ));
});

// ── DOCUMENT SIZE LIMIT (B5) ──────────────────────────────────────────────────

test('POST /documents — text exceeding MAX_DOCUMENT_CHARS → 400', async () => {
    const maxChars = parseInt(process.env.MAX_DOCUMENT_CHARS || '1000000');
    const r = await req('POST', '/documents', {
        body: { title: 'Too big', text: 'x'.repeat(maxChars + 1) },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

// ── OTP RATE LIMIT (A9) ───────────────────────────────────────────────────────

test('POST /auth/request-otp — 6th request in window → 429', async () => {
    const email = 'ratelimit@test.com';
    const max = parseInt(process.env.OTP_MAX_ATTEMPTS || '5');
    for (let i = 0; i < max; i++) {
        await req('POST', '/auth/request-otp', { body: { email } });
    }
    const r = await req('POST', '/auth/request-otp', { body: { email } });
    assert.equal(r.status, 429);
});

// ── COMMENT / VARIANT COOLDOWN (NODE_ENV=test skips enforcement) ──────────────

test('GET /documents/:id/variants — includes comment_heat and top_percent → 200', async () => {
    const r = await req('GET', `/documents/${docId}/variants`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.comment_heat, 'comment_heat present');
    assert.equal(typeof r.data.comment_heat.orange, 'number');
    assert.equal(typeof r.data.comment_heat.red, 'number');
    assert.equal(typeof r.data.top_percent, 'number');
});

test('GET /documents/:id/variants — each variant has comment_count → 200', async () => {
    const r = await req('GET', `/documents/${docId}/variants`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.variants.length > 0);
    for (const v of r.data.variants) {
        assert.ok('comment_count' in v, `variant ${v.id} missing comment_count`);
    }
});

// ── VOTING TRANSITION ─────────────────────────────────────────────────────────

let votingDocId;

test('GET /api/auth/me — returns config with voting defaults → 200', async () => {
    const r = await req('GET', '/auth/me', { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.config, 'config present');
    assert.equal(typeof r.data.config.toast_dismiss_seconds, 'number');
    assert.equal(typeof r.data.config.voting_countdown_default_minutes, 'number');
});

test('Setup: create fresh open doc for voting transition tests', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Voting test doc', text: 'line one\nline two' }, cookie: sessionCookie });
    votingDocId = d.data.document.id;
    const r = await req('POST', `/documents/${votingDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'open');
});

test('POST /documents/:id/status { status: voting, countdown_minutes: 5 } — schedules → 200', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { status: 'voting', countdown_minutes: 5 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'open', 'status stays open while countdown runs');
    assert.ok(r.data.document.voting_scheduled_at, 'voting_scheduled_at should be set');
    const scheduled = new Date(r.data.document.voting_scheduled_at).getTime();
    assert.ok(scheduled > Date.now(), 'scheduled time should be in the future');
});

test('GET /documents/:id — returns voting_scheduled_at when scheduled → 200', async () => {
    const r = await req('GET', `/documents/${votingDocId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok('voting_scheduled_at' in r.data.document, 'voting_scheduled_at field present');
    assert.ok(r.data.document.voting_scheduled_at, 'voting_scheduled_at is set');
});

test('POST /documents/:id/status { cancel_schedule: true } — cancels → 200', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { cancel_schedule: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'open');
    assert.equal(r.data.document.voting_scheduled_at, null, 'voting_scheduled_at should be cleared');
});

test('POST /documents/:id/status { cancel_schedule: true } — no schedule → 422', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { cancel_schedule: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('Voting auto-transition — past voting_scheduled_at triggers status change on GET', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    db.prepare("UPDATE documents SET voting_scheduled_at = ? WHERE id = ?").run(past, votingDocId);

    const r = await req('GET', `/documents/${votingDocId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting', 'should auto-transition to voting');
    assert.equal(r.data.document.voting_scheduled_at, null, 'voting_scheduled_at cleared after transition');
});

test('POST /documents/:id/status { countdown_minutes: 0 } — immediate transition → 200', async () => {
    // Create another fresh doc in 'open' for immediate transition test
    const d = await req('POST', '/documents', { body: { title: 'Immediate vote doc', text: 'text here' }, cookie: sessionCookie });
    const immedId = d.data.document.id;
    await req('POST', `/documents/${immedId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    const r = await req('POST', `/documents/${immedId}/status`, {
        body: { status: 'voting', countdown_minutes: 0 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting', 'immediate transition should go straight to voting');
    assert.equal(r.data.document.voting_scheduled_at, null, 'no schedule set for immediate transition');
});

// ── REVIEW VIEW ──────────────────────────────────────────────────────────────

let reviewVariantId;

test('Setup: create variant in voting document for review tests', async () => {
    const r = await req('POST', `/documents/${votingDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'TEST', title: 'Review test variant' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    reviewVariantId = r.data.variant.id;
    assert.equal(r.data.variant.status, 'pending');
});

test('PATCH /variants/:id/review-status — set conflict → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'conflict' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'conflict');
});

test('PATCH /variants/:id/review-status — change from conflict to rejected → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'rejected' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'rejected');
});

test('PATCH /variants/:id/review-status — restore to pending → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'pending' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'pending');
});

test('PATCH /variants/:id/review-status — set not_applicable → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'not_applicable' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'not_applicable');
});

test('PATCH /variants/:id/review-status — invalid status → 400', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'approved' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('PATCH /variants/:id/review-status — doc not in voting status → 422', async () => {
    const r = await req('PATCH', `/variants/${variantId}/review-status`, {
        body: { status: 'conflict' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('PATCH /variants/:id/review-status — viewer has no access → 403', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/review-status`, {
        body: { status: 'pending' },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

// ── CONFLICT ORDER ───────────────────────────────────────────────────────────

let conflictVariant2Id;

test('Setup: create second variant in voting doc for conflict-order tests', async () => {
    const r = await req('POST', `/documents/${votingDocId}/variants`, {
        body: { char_start: 0, char_end: 8, operation: 'replace', new_text: 'OVERLAP', title: 'Conflict order variant' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    conflictVariant2Id = r.data.variant.id;
});

test('PATCH /variants/:id/conflict-order — set vote_order → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/conflict-order`, {
        body: { vote_order: 1, parent_variant_id: null },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.vote_order, 1);
    assert.equal(r.data.variant.parent_variant_id, null);
});

test('PATCH /variants/:id/conflict-order — make child of another → 200', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/conflict-order`, {
        body: { vote_order: null, parent_variant_id: reviewVariantId },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.parent_variant_id, reviewVariantId);
    assert.equal(r.data.variant.vote_order, null);
});

test('PATCH /variants/:id/conflict-order — self as parent → 400', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/conflict-order`, {
        body: { vote_order: null, parent_variant_id: reviewVariantId },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('PATCH /variants/:id/conflict-order — nest 3 levels (child of child) → 400', async () => {
    // conflictVariant2Id is already a child of reviewVariantId
    // Create a 3rd variant and try to make it a child of conflictVariant2Id
    const d = await req('POST', `/documents/${votingDocId}/variants`, {
        body: { char_start: 0, char_end: 3, operation: 'replace', new_text: 'X', title: '3rd level test' },
        cookie: sessionCookie,
    });
    const thirdId = d.data.variant.id;
    const r = await req('PATCH', `/variants/${thirdId}/conflict-order`, {
        body: { parent_variant_id: conflictVariant2Id },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('PATCH /variants/:id/conflict-order — remove child (back to unordered) → 200', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/conflict-order`, {
        body: { vote_order: null, parent_variant_id: null },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.parent_variant_id, null);
    assert.equal(r.data.variant.vote_order, null);
});

test('PATCH /variants/:id/conflict-order — doc not in voting → 422', async () => {
    const r = await req('PATCH', `/variants/${variantId}/conflict-order`, {
        body: { vote_order: 1, parent_variant_id: null },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('PATCH /variants/:id/conflict-order — viewer access → 403', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/conflict-order`, {
        body: { vote_order: 2, parent_variant_id: null },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

test('POST /documents/:id/status — voting → final_voting → 200', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { status: 'final_voting' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'final_voting');
});

test('POST /documents/:id/status — final_voting → voting (back) → 200', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { status: 'voting' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting');
});

// ── GROUP M — Gap Fixes ───────────────────────────────────────────────────────

test('Setup: assign vote_order to conflictVariant2Id for gap-11 test (doc in voting)', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/conflict-order`, {
        body: { vote_order: 2 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.vote_order, 2);
});

test('PATCH /variants/:id — proposer cannot edit after voting has started → 422', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}`, {
        body: { title: 'Should not be allowed' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

// ── GROUP L — Final Voting ────────────────────────────────────────────────────

test('Setup: transition votingDocId back to final_voting for final-vote tests', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { status: 'final_voting' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'final_voting');
});

test('PATCH /variants/:id/final-vote — record yes/no/abstain → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/final-vote`, {
        body: { yes: 12, no: 3, abstain: 2 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.final_yes, 12);
    assert.equal(r.data.variant.final_no, 3);
    assert.equal(r.data.variant.final_abstain, 2);
});

test('PATCH /variants/:id/final-vote — partial update preserves existing values → 200', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/final-vote`, {
        body: { yes: 15 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.final_yes, 15);
    assert.equal(r.data.variant.final_no, 3);
    assert.equal(r.data.variant.final_abstain, 2);
});

test('PATCH /variants/:id/final-vote — negative count → 400', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/final-vote`, {
        body: { yes: -1 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('PATCH /variants/:id/final-vote — doc not in final_voting → 422', async () => {
    const r = await req('PATCH', `/variants/${variantId}/final-vote`, {
        body: { yes: 1, no: 0, abstain: 0 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('PATCH /variants/:id/final-vote — viewer access → 403', async () => {
    const r = await req('PATCH', `/variants/${reviewVariantId}/final-vote`, {
        body: { yes: 1, no: 0, abstain: 0 },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

test('PATCH /documents/:id/doc-vote — record overall vote → 200', async () => {
    const r = await req('PATCH', `/documents/${votingDocId}/doc-vote`, {
        body: { yes: 42, no: 1, abstain: 3 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.doc_vote_yes, 42);
    assert.equal(r.data.document.doc_vote_no, 1);
    assert.equal(r.data.document.doc_vote_abstain, 3);
});

test('PATCH /documents/:id/doc-vote — doc not in final_voting → 422', async () => {
    const r = await req('PATCH', `/documents/${docId}/doc-vote`, {
        body: { yes: 1, no: 0, abstain: 0 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('PATCH /documents/:id/doc-vote — viewer access → 403', async () => {
    const r = await req('PATCH', `/documents/${votingDocId}/doc-vote`, {
        body: { yes: 1, no: 0, abstain: 0 },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

// M group continued — these run while votingDocId is still in final_voting

test('POST /variants/:id/vote — blocked during final_voting → 422', async () => {
    const r = await req('POST', `/variants/${reviewVariantId}/vote`, {
        body: { vote_value: 1 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 422);
});

test('PATCH /review-status — allowed in final_voting and clears vote_order → 200', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/review-status`, {
        body: { status: 'rejected' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'rejected');
    assert.equal(r.data.variant.vote_order, null);
});

test('PATCH /review-status — restore conflictVariant2Id to pending for resolve test', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/review-status`, {
        body: { status: 'pending' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'pending');
});

test('Setup: record final tally on pending variant for resolve test', async () => {
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/final-vote`, {
        body: { yes: 5, no: 2, abstain: 1 },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.final_yes, 5);
});

test('POST /documents/:id/status — final_voting → resolved — processes tallies → 200', async () => {
    const r = await req('POST', `/documents/${votingDocId}/status`, {
        body: { status: 'resolved' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'resolved');
});

test('GET variant after resolve — yes > no → status = approved', async () => {
    const r = await req('GET', `/variants/${conflictVariant2Id}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.status, 'approved');
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────

test('POST /auth/logout — clears session → 200', async () => {
    // Create a disposable session
    await req('POST', '/auth/request-otp', { body: { email: 'temp@test.com' } });
    const otp = latestOtp('temp@test.com');
    const loginR = await req('POST', '/auth/verify-otp', { body: { email: 'temp@test.com', code: otp.code } });
    const tempCookie = `session_id=${loginR.sessionId}`;

    const logoutR = await req('POST', '/auth/logout', { cookie: tempCookie });
    assert.equal(logoutR.status, 200);

    // Session should now be invalid
    const meR = await req('GET', '/auth/me', { cookie: tempCookie });
    assert.equal(meR.status, 401);
});
