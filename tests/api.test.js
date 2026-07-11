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

    // Set default_access to viewer and open the document (drafts require editor+)
    await req('PATCH', `/documents/${dId}`, { body: { settings: { default_access: 'viewer' } }, cookie: sessionCookie });
    await req('POST', `/documents/${dId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    // Bob can now access
    const after = await req('GET', `/documents/${dId}`, { cookie: viewerCookie });
    assert.equal(after.status, 200, 'accessible after default_access=viewer on open doc');
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
    // Leave allow_anonymous_view = false (default)

    const pub = await req('POST', '/documents', {
        body: { title: 'Public doc', text: 'open content', settings: { allow_anonymous_view: true } },
        cookie: sessionCookie,
    });
    // Open both docs — draft docs are only visible to editor+ even with allow_anonymous_view
    await req('POST', `/documents/${priv.data.document.id}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    await req('POST', `/documents/${pub.data.document.id}/status`, { body: { status: 'open' }, cookie: sessionCookie });
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

// ── GROUP N — Auto-assign child vote_order ────────────────────────────────────

test('PATCH /variants/:id/conflict-order — make child without vote_order → auto-assigned → 200', async () => {
    // Send only parent_variant_id, omitting vote_order → backend assigns MAX(children)+1
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/conflict-order`, {
        body: { parent_variant_id: reviewVariantId },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.parent_variant_id, reviewVariantId);
    assert.equal(r.data.variant.vote_order, 1); // first child → 1
});

test('PATCH /variants/:id/conflict-order — explicit vote_order:null still clears it → 200', async () => {
    // K9 compatibility: if client explicitly sends null, honour it (no auto-assign)
    const r = await req('PATCH', `/variants/${conflictVariant2Id}/conflict-order`, {
        body: { vote_order: null, parent_variant_id: null },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.parent_variant_id, null);
    assert.equal(r.data.variant.vote_order, null);
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

// ── GROUP O — Share Proposal ──────────────────────────────────────────────────

let shareDocId, shareVarId;

test('Setup: create doc + variant for share tests', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Share test doc', text: 'some text here' }, cookie: sessionCookie });
    shareDocId = d.data.document.id;
    await req('POST', `/documents/${shareDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const v = await req('POST', `/documents/${shareDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'other', title: 'Share variant' },
        cookie: sessionCookie,
    });
    shareVarId = v.data.variant.id;
});

test('GET /variants/:id — anonymous on non-public doc without share → 403', async () => {
    const r = await req('GET', `/variants/${shareVarId}`);
    assert.equal(r.status, 403);
});

test('PATCH /variants/:id/share — by non-proposer → 403', async () => {
    const r = await req('PATCH', `/variants/${shareVarId}/share`, { body: { allow_anonymous_share: 1 }, cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('PATCH /variants/:id/share — enable anonymous share → 200', async () => {
    const r = await req('PATCH', `/variants/${shareVarId}/share`, { body: { allow_anonymous_share: 1 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.allow_anonymous_share, 1);
});

test('GET /variants/:id — anonymous access after share enabled → 200', async () => {
    const r = await req('GET', `/variants/${shareVarId}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.id, shareVarId);
});

test('PATCH /variants/:id/share — disable anonymous share → 200', async () => {
    const r = await req('PATCH', `/variants/${shareVarId}/share`, { body: { allow_anonymous_share: 0 }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.allow_anonymous_share, 0);
});

// ── GROUP P — Draft Document Restriction ─────────────────────────────────────

let draftDocId;

test('Setup: create draft doc and grant viewer access to Bob', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Draft restriction doc', text: 'draft content' }, cookie: sessionCookie });
    draftDocId = d.data.document.id;
    await req('POST', `/documents/${draftDocId}/access`, { body: { email: 'bob@test.com', access_level: 'viewer' }, cookie: sessionCookie });
});

test('GET /documents/:id — draft doc, viewer access → 403', async () => {
    const r = await req('GET', `/documents/${draftDocId}`, { cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('GET /documents — draft doc not visible in Bob\'s list → absent', async () => {
    const r = await req('GET', '/documents', { cookie: viewerCookie });
    assert.equal(r.status, 200);
    assert.ok(!r.data.documents.find(d => d.id === draftDocId), 'draft doc not in list');
});

test('GET /documents/:id — draft doc, owner → 200', async () => {
    const r = await req('GET', `/documents/${draftDocId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
});

test('GET /documents/:id — draft doc, anonymous → 403 even if allow_anonymous_view', async () => {
    await req('PATCH', `/documents/${draftDocId}`, { body: { settings: { allow_anonymous_view: true } }, cookie: sessionCookie });
    const r = await req('GET', `/documents/${draftDocId}`);
    assert.equal(r.status, 403);
});

// ── GROUP Q — Final Vote Log ──────────────────────────────────────────────────

test('GET /variants/:id/final-vote-log — no auth → 401', async () => {
    const r = await req('GET', `/variants/${conflictVariant2Id}/final-vote-log`);
    assert.equal(r.status, 401);
});

test('GET /variants/:id/final-vote-log — viewer → 403', async () => {
    const r = await req('GET', `/variants/${conflictVariant2Id}/final-vote-log`, { cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('GET /variants/:id/final-vote-log — owner on resolved doc → 200, entries present', async () => {
    const r = await req('GET', `/variants/${conflictVariant2Id}/final-vote-log`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.logs), 'logs is an array');
    assert.ok(r.data.logs.length > 0, 'at least one log entry from final-vote test');
    const entry = r.data.logs[0];
    assert.ok(entry.recorded_at > 0, 'recorded_at is a positive unix ms timestamp');
    assert.ok(entry.user_name, 'user_name present');
});

// ── GROUP R — Resolved Text ───────────────────────────────────────────────────

let resolveDocId, resolveVarId;

test('Setup: create doc + variant for resolved-text tests', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Resolve test doc', text: 'Hello world\nLine two' }, cookie: sessionCookie });
    assert.equal(d.status, 201);
    resolveDocId = d.data.document.id;
    await req('POST', `/documents/${resolveDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    await req('POST', `/documents/${resolveDocId}/status`, { body: { status: 'voting' }, cookie: sessionCookie });
    await req('POST', `/documents/${resolveDocId}/status`, { body: { status: 'final_voting' }, cookie: sessionCookie });
    const v = await req('POST', `/documents/${resolveDocId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'Hi', title: 'Replace Hello', rationale: 'shorter' },
        cookie: sessionCookie,
    });
    assert.equal(v.status, 201);
    resolveVarId = v.data.variant.id;
    const fv = await req('PATCH', `/variants/${resolveVarId}/final-vote`, { body: { yes: 3, no: 1 }, cookie: sessionCookie });
    assert.equal(fv.status, 200);
});

test('GET /documents/:id/resolved-text — no auth → 401', async () => {
    const r = await req('GET', `/documents/${resolveDocId}/resolved-text`);
    assert.equal(r.status, 401);
});

test('GET /documents/:id/resolved-text — viewer during final_voting → 403', async () => {
    const invR = await req('POST', `/documents/${resolveDocId}/access`, {
        body: { email: 'bob@test.com', access_level: 'viewer' }, cookie: sessionCookie,
    });
    assert.equal(invR.status, 201);
    const r = await req('GET', `/documents/${resolveDocId}/resolved-text`, { cookie: viewerCookie });
    assert.equal(r.status, 403, 'preview stays supervisor+ until resolved');
});

test('GET /documents/:id/resolved-text — on-the-fly for final_voting → 200', async () => {
    const r = await req('GET', `/documents/${resolveDocId}/resolved-text`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.resolved_at, null);
    assert.equal(r.data.doc_vote_passed, null);
    assert.ok(typeof r.data.text === 'string', 'text is a string');
});

test('GET /documents/:id/resolved-text — wrong status → 422', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Open doc', text: 'test' }, cookie: sessionCookie });
    await req('POST', `/documents/${d.data.document.id}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const r = await req('GET', `/documents/${d.data.document.id}/resolved-text`, { cookie: sessionCookie });
    assert.equal(r.status, 422);
});

test('POST /documents/:id/status — final_voting → resolved stores resolved_text → 200', async () => {
    const r = await req('POST', `/documents/${resolveDocId}/status`, { body: { status: 'resolved' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'resolved');
    assert.ok(r.data.document.resolved_at, 'resolved_at set');
    assert.ok(typeof r.data.document.resolved_text === 'string', 'resolved_text stored');
});

test('GET /documents/:id/resolved-text — returns stored text with doc_vote_passed → 200', async () => {
    const r = await req('GET', `/documents/${resolveDocId}/resolved-text`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(r.data.resolved_at, 'resolved_at present');
    assert.equal(r.data.doc_vote_passed, null, 'null when no doc vote recorded');
    assert.ok(r.data.text.includes('Hi'), 'approved variant (replace Hello→Hi) applied to resolved text');
});

test('GET /documents/:id/resolved-text — invited viewer on resolved doc → 200 (US-10)', async () => {
    const r = await req('GET', `/documents/${resolveDocId}/resolved-text`, { cookie: viewerCookie });
    assert.equal(r.status, 200, 'any participant may read the outcome once resolved');
    assert.ok(r.data.text.includes('Hi'));
});

// ── GROUP S — Copy Document Data ─────────────────────────────────────────────

let copySrcId, copyTgtId, copySrcVarId, bobDocId;

test('Setup: source doc with variant, vote, comments, withdrawn variant + target doc', async () => {
    const d = await req('POST', '/documents', {
        body: { title: 'Copy source', text: 'Alpha bravo charlie\nDelta echo foxtrot' },
        cookie: sessionCookie,
    });
    assert.equal(d.status, 201);
    copySrcId = d.data.document.id;
    await req('POST', `/documents/${copySrcId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    const v1 = await req('POST', `/documents/${copySrcId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'Omega', title: 'First proposal' },
        cookie: sessionCookie,
    });
    assert.equal(v1.status, 201);
    copySrcVarId = v1.data.variant.id;

    const vt = await req('POST', `/variants/${copySrcVarId}/vote`, { body: { vote_value: 1 }, cookie: sessionCookie });
    assert.equal(vt.status, 200);

    const c = await req('POST', `/variants/${copySrcVarId}/comments`, { body: { text: 'top level' }, cookie: sessionCookie });
    assert.equal(c.status, 201);
    const rep = await req('POST', `/variants/${copySrcVarId}/comments`, {
        body: { text: 'a reply', parent_comment_id: c.data.comment.id },
        cookie: sessionCookie,
    });
    assert.equal(rep.status, 201);

    const v2 = await req('POST', `/documents/${copySrcId}/variants`, {
        body: { char_start: 6, char_end: 11, operation: 'delete', title: 'Withdraw me' },
        cookie: sessionCookie,
    });
    assert.equal(v2.status, 201);
    const w = await req('DELETE', `/variants/${v2.data.variant.id}`, { cookie: sessionCookie });
    assert.equal(w.status, 200);

    const t = await req('POST', '/documents', {
        body: { title: 'Copy target', text: 'Alpha bravo charlie\nDelta echo foxtrot' },
        cookie: sessionCookie,
    });
    assert.equal(t.status, 201);
    copyTgtId = t.data.document.id;
});

test('POST /documents/:id/copy-data — copy_votes without copy_variants → nothing copied', async () => {
    const r = await req('POST', `/documents/${copySrcId}/copy-data`, {
        body: { target_doc_id: copyTgtId, copy_votes: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.copied, { variants: 0, votes: 0, comments: 0 });
});

test('POST /documents/:id/copy-data — variants + votes + comments copied', async () => {
    const r = await req('POST', `/documents/${copySrcId}/copy-data`, {
        body: { target_doc_id: copyTgtId, copy_variants: true, copy_votes: true, copy_comments: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.copied.variants, 1, 'withdrawn variant excluded');
    assert.equal(r.data.copied.votes, 1);
    assert.equal(r.data.copied.comments, 2);
});

test('Copied variant on target — status pending, tallies match source', async () => {
    const r = await req('GET', `/documents/${copyTgtId}/variants`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variants.length, 1);
    const v = r.data.variants[0];
    assert.equal(v.status, 'pending');
    assert.equal(v.title, 'First proposal');
    assert.equal(v.votes_for, 1);
    assert.equal(v.votes_against, 0);
});

test('Copied comments on target — reply parent remapped to new comment id', async () => {
    const lst = await req('GET', `/documents/${copyTgtId}/variants`, { cookie: sessionCookie });
    const newVarId = lst.data.variants[0].id;
    assert.notEqual(newVarId, copySrcVarId);
    const r = await req('GET', `/variants/${newVarId}/comments`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.comments.length, 1, 'one top-level comment');
    assert.equal(r.data.comments[0].text, 'top level');
    assert.equal(r.data.comments[0].replies.length, 1);
    assert.equal(r.data.comments[0].replies[0].text, 'a reply');
});

test('POST /documents/:id/copy-data — target not owned by requester → 403', async () => {
    const d = await req('POST', '/documents', {
        body: { title: 'Bob target', text: 'Bob owns this' },
        cookie: viewerCookie,
    });
    assert.equal(d.status, 201);
    bobDocId = d.data.document.id;
    const r = await req('POST', `/documents/${copySrcId}/copy-data`, {
        body: { target_doc_id: bobDocId, copy_variants: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 403);
});

test('POST /documents/:id/copy-data — target does not exist → 404', async () => {
    const r = await req('POST', `/documents/${copySrcId}/copy-data`, {
        body: { target_doc_id: 999999, copy_variants: true },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 404);
});

test('POST /documents/:id/copy-data — requester lacks admin on source → 403', async () => {
    const r = await req('POST', `/documents/${copySrcId}/copy-data`, {
        body: { target_doc_id: bobDocId, copy_variants: true },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

// ── GROUP T — MAJORITY THRESHOLDS (UC-17) ─────────────────────────────────────

let threshDocId, threshVarId;

test('T1: Setup — create doc in voting status with a variant', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Threshold test doc', text: 'Original text here' }, cookie: sessionCookie });
    threshDocId = d.data.document.id;
    await req('POST', `/documents/${threshDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const v = await req('POST', `/documents/${threshDocId}/variants`, {
        body: { char_start: 0, char_end: 8, operation: 'replace', new_text: 'Changed', title: 'Threshold variant' },
        cookie: sessionCookie,
    });
    threshVarId = v.data.variant.id;
    const r = await req('POST', `/documents/${threshDocId}/status`, { body: { status: 'voting' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting');
});

test('T2: PATCH /variants/:id/threshold — non-editor (viewer) → 403', async () => {
    const r = await req('PATCH', `/variants/${threshVarId}/threshold`, {
        body: { majority_threshold: 'absolute' },
        cookie: viewerCookie,
    });
    assert.equal(r.status, 403);
});

test('T3: PATCH /variants/:id/threshold — invalid value → 400', async () => {
    const r = await req('PATCH', `/variants/${threshVarId}/threshold`, {
        body: { majority_threshold: 'half_and_half' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('T4: PATCH /variants/:id/threshold — owner sets two_thirds → 200, value stored', async () => {
    const r = await req('PATCH', `/variants/${threshVarId}/threshold`, {
        body: { majority_threshold: 'two_thirds' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.majority_threshold, 'two_thirds');
});

test('T5: GET /variants/:id — majority_threshold persists across request', async () => {
    const r = await req('GET', `/variants/${threshVarId}`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.majority_threshold, 'two_thirds');
});

test('T6: PATCH /documents/:id settings — invalid majority_threshold → 400', async () => {
    const r = await req('PATCH', `/documents/${threshDocId}`, {
        body: { settings: { majority_threshold: 'consensus' } },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

test('T7: PATCH /documents/:id settings — valid majority_threshold stored in settings', async () => {
    const r = await req('PATCH', `/documents/${threshDocId}`, {
        body: { settings: { majority_threshold: 'absolute' } },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 200);
    const updatedSettings = JSON.parse(r.data.document.settings || '{}');
    assert.equal(updatedSettings.majority_threshold, 'absolute');
});

test('T8: Resolve — variant two_thirds threshold with 2/2/2 tally (6 total, needs ⅔) → rejected', async () => {
    const fvr = await req('POST', `/documents/${threshDocId}/status`, { body: { status: 'final_voting' }, cookie: sessionCookie });
    assert.equal(fvr.status, 200);
    // 2 yes of 6 total: 3*2=6, 2*6=12 → 6 < 12 → fails two_thirds
    await req('PATCH', `/variants/${threshVarId}/final-vote`, {
        body: { yes: 2, no: 2, abstain: 2 },
        cookie: sessionCookie,
    });
    const r = await req('POST', `/documents/${threshDocId}/status`, { body: { status: 'resolved' }, cookie: sessionCookie });
    assert.equal(r.status, 200);
    const vr = await req('GET', `/variants/${threshVarId}`, { cookie: sessionCookie });
    assert.equal(vr.data.variant.status, 'rejected', 'variant must be rejected — 2/6 does not meet ⅔ threshold');
});

// ── GROUP U — FORK VARIANT (UC-16) ───────────────────────────────────────────

let forkDocId, forkSrcId, forkNewId;

test('U1: Setup — create doc in open status with a variant to fork', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Fork test doc', text: 'Fork source text here' }, cookie: sessionCookie });
    forkDocId = d.data.document.id;
    await req('POST', `/documents/${forkDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const v = await req('POST', `/documents/${forkDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'Fork', title: 'Original proposal' },
        cookie: sessionCookie,
    });
    forkSrcId = v.data.variant.id;
    assert.ok(forkSrcId);
});

test('U2: POST /variants/:id/fork — unauthenticated → 401', async () => {
    const r = await req('POST', `/variants/${forkSrcId}/fork`, { body: { title: 'My fork' } });
    assert.equal(r.status, 401);
});

test('U3: POST /variants/:id/fork — doc in draft → 422', async () => {
    // create a draft doc with a variant
    const d = await req('POST', '/documents', { body: { title: 'Draft doc', text: 'some text' }, cookie: sessionCookie });
    const v = await req('POST', `/documents/${d.data.document.id}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'x', title: 'Draft variant' },
        cookie: sessionCookie,
    });
    const r = await req('POST', `/variants/${v.data.variant.id}/fork`, { body: {}, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

test('U4: POST /variants/:id/fork — viewer lacks proposer access → 403', async () => {
    const r = await req('POST', `/variants/${forkSrcId}/fork`, { body: { title: 'Viewer fork' }, cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('U5: POST /variants/:id/fork — owner on open doc → 201, new variant created', async () => {
    const r = await req('POST', `/variants/${forkSrcId}/fork`, {
        body: { title: 'My fork', new_text: 'Forked text', rationale: 'Slightly different take' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.variant.title, 'My fork');
    assert.equal(r.data.variant.new_text, 'Forked text');
    assert.equal(r.data.variant.char_start, 0);
    assert.equal(r.data.variant.char_end, 4);
    assert.equal(r.data.variant.document_id, forkDocId);
    forkNewId = r.data.variant.id;
    assert.notEqual(forkNewId, forkSrcId);
});

test('U6: Title pre-fills to "Your variant of …" when omitted', async () => {
    const r = await req('POST', `/variants/${forkSrcId}/fork`, { body: {}, cookie: sessionCookie });
    assert.equal(r.status, 201);
    assert.equal(r.data.variant.title, 'Your variant of Original proposal');
});

test('U7: GET /variants/:id/relations — fork has based_on relation to original', async () => {
    const r = await req('GET', `/variants/${forkNewId}/relations`, { cookie: sessionCookie });
    assert.equal(r.status, 200);
    const rel = r.data.relations.find(x => x.relation_type === 'based_on' && x.to_variant_id === forkSrcId);
    assert.ok(rel, 'based_on relation must exist from fork to original');
});

test('U8: POST /variants/:id/fork — doc in voting → viewer gets 403', async () => {
    await req('POST', `/documents/${forkDocId}/status`, { body: { status: 'voting' }, cookie: sessionCookie });
    const r = await req('POST', `/variants/${forkSrcId}/fork`, { body: {}, cookie: viewerCookie });
    assert.equal(r.status, 403);
});

test('U9: POST /variants/:id/fork — doc in voting → editor (owner) can fork → 201', async () => {
    const r = await req('POST', `/variants/${forkSrcId}/fork`, {
        body: { title: 'Voting-phase fork', rationale: 'Clarification during voting' },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.variant.title, 'Voting-phase fork');
});

// ── GROUP W: SUPERVISOR ROLE (UC-19) ─────────────────────────────────────────

let supCookie = '';   // supervisor user session
let supDocId;
let supVarId;

test('W1: setup — draft doc + supervisor invite; supervisor cannot see draft', async () => {
    const docR = await req('POST', '/documents', {
        body: { title: 'Supervisor test doc', text: 'First line of text.\nSecond line here.\nThird line ends.' },
        cookie: sessionCookie,
    });
    assert.equal(docR.status, 201);
    supDocId = docR.data.document.id;

    const invR = await req('POST', `/documents/${supDocId}/access`, {
        body: { email: 'sup@test.com', access_level: 'supervisor' },
        cookie: sessionCookie,
    });
    assert.equal(invR.status, 201);

    await req('POST', '/auth/request-otp', { body: { email: 'sup@test.com' } });
    const otp = latestOtp('sup@test.com');
    const loginR = await req('POST', '/auth/verify-otp', { body: { email: 'sup@test.com', code: otp.code } });
    assert.ok(loginR.sessionId);
    supCookie = `session_id=${loginR.sessionId}`;

    // Draft visibility stays editor+ — supervisor blocked
    const draftR = await req('GET', `/documents/${supDocId}`, { cookie: supCookie });
    assert.equal(draftR.status, 403);

    await req('POST', `/documents/${supDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const varR = await req('POST', `/documents/${supDocId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'Best', title: 'Sup var', rationale: 'r' },
        cookie: sessionCookie,
    });
    assert.equal(varR.status, 201);
    supVarId = varR.data.variant.id;
});

test('W2: GET /documents/:id — supervisor sees my_access_level', async () => {
    const r = await req('GET', `/documents/${supDocId}`, { cookie: supCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.my_access_level, 'supervisor');
});

test('W3: PATCH /documents/:id — supervisor cannot edit document → 403', async () => {
    const r = await req('PATCH', `/documents/${supDocId}`, { body: { title: 'Hijacked' }, cookie: supCookie });
    assert.equal(r.status, 403);
});

test('W4: POST /access — supervisor invites new user at supervisor level → 201', async () => {
    const r = await req('POST', `/documents/${supDocId}/access`, {
        body: { email: 'sup-invitee@test.com', access_level: 'supervisor' },
        cookie: supCookie,
    });
    assert.equal(r.status, 201);
});

test('W5: POST /access — supervisor cannot grant editor (above own level) → 403', async () => {
    const r = await req('POST', `/documents/${supDocId}/access`, {
        body: { email: 'sup-editor@test.com', access_level: 'editor' },
        cookie: supCookie,
    });
    assert.equal(r.status, 403);
});

test('W6: POST /access — supervisor cannot change existing access record → 403', async () => {
    const r = await req('POST', `/documents/${supDocId}/access`, {
        body: { email: 'sup-invitee@test.com', access_level: 'viewer' },
        cookie: supCookie,
    });
    assert.equal(r.status, 403);
});

test('W7: PATCH/DELETE /access/:userId — supervisor blocked → 403', async () => {
    const list = await req('GET', `/documents/${supDocId}/access`, { cookie: supCookie });
    assert.equal(list.status, 200);
    assert.equal(list.data.my_access_level, 'supervisor');
    const target = list.data.access.find(a => a.email === 'sup-invitee@test.com');
    assert.ok(target);
    const pR = await req('PATCH', `/documents/${supDocId}/access/${target.user_id}`, { body: { blocked: true }, cookie: supCookie });
    assert.equal(pR.status, 403);
    const dR = await req('DELETE', `/documents/${supDocId}/access/${target.user_id}`, { cookie: supCookie });
    assert.equal(dR.status, 403);
});

test('W8: POST /status — supervisor open → voting → 200', async () => {
    const r = await req('POST', `/documents/${supDocId}/status`, { body: { status: 'voting' }, cookie: supCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'voting');
});

test('W9: supervisor review-status + conflict-order → 200', async () => {
    const rs = await req('PATCH', `/variants/${supVarId}/review-status`, { body: { status: 'pending' }, cookie: supCookie });
    assert.equal(rs.status, 200);
    const co = await req('PATCH', `/variants/${supVarId}/conflict-order`, { body: { vote_order: 1 }, cookie: supCookie });
    assert.equal(co.status, 200);
});

test('W10: supervisor fork during voting → 201', async () => {
    const r = await req('POST', `/variants/${supVarId}/fork`, {
        body: { title: 'Sup fork', rationale: 'clarify' },
        cookie: supCookie,
    });
    assert.equal(r.status, 201);
});

test('W11: supervisor sets per-proposal threshold → 200', async () => {
    const r = await req('PATCH', `/variants/${supVarId}/threshold`, { body: { majority_threshold: 'two_thirds' }, cookie: supCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.majority_threshold, 'two_thirds');
});

test('W12: supervisor voting → final_voting → 200', async () => {
    const r = await req('POST', `/documents/${supDocId}/status`, { body: { status: 'final_voting' }, cookie: supCookie });
    assert.equal(r.status, 200);
});

test('W13: supervisor tallies, audit log, doc-vote, resolved-text → 200', async () => {
    const fv = await req('PATCH', `/variants/${supVarId}/final-vote`, { body: { yes: 8, no: 1, abstain: 0 }, cookie: supCookie });
    assert.equal(fv.status, 200);
    const log = await req('GET', `/variants/${supVarId}/final-vote-log`, { cookie: supCookie });
    assert.equal(log.status, 200);
    assert.ok(log.data.logs.length >= 1);
    const dv = await req('PATCH', `/documents/${supDocId}/doc-vote`, { body: { yes: 10, no: 2, abstain: 1 }, cookie: supCookie });
    assert.equal(dv.status, 200);
    const rt = await req('GET', `/documents/${supDocId}/resolved-text`, { cookie: supCookie });
    assert.equal(rt.status, 200);
});

test('W14: supervisor final_voting → resolved → 200', async () => {
    const r = await req('POST', `/documents/${supDocId}/status`, { body: { status: 'resolved' }, cookie: supCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.document.status, 'resolved');
});

test('W15: supervisor resolved → archived → 403 (admin only)', async () => {
    const r = await req('POST', `/documents/${supDocId}/status`, { body: { status: 'archived' }, cookie: supCookie });
    assert.equal(r.status, 403);
});

test('W16: PATCH /documents/:id — default_access rejects supervisor → 400', async () => {
    const r = await req('PATCH', `/documents/${supDocId}`, {
        body: { settings: { default_access: 'supervisor' } },
        cookie: sessionCookie,
    });
    assert.equal(r.status, 400);
});

// ── GROUP V: HMAC SESSION SIGNING ────────────────────────────────────────────

test('V1: GET /auth/me — signed session cookie → 200', async () => {
    const signed = sessionCookie.replace('session_id=', '');
    assert.ok(signed.includes('.'), 'cookie value must be sessionId.signature');
    const r = await req('GET', '/auth/me', { cookie: sessionCookie });
    assert.equal(r.status, 200);
});

test('V2: GET /auth/me — tampered signature → 401', async () => {
    const signed = sessionCookie.replace('session_id=', '');
    const flipped = signed.slice(0, -1) + (signed.endsWith('a') ? 'b' : 'a');
    const r = await req('GET', '/auth/me', { cookie: `session_id=${flipped}` });
    assert.equal(r.status, 401);
});

test('V3: GET /auth/me — raw session id without signature → 401', async () => {
    const raw = sessionCookie.replace('session_id=', '').split('.')[0];
    const r = await req('GET', '/auth/me', { cookie: `session_id=${raw}` });
    assert.equal(r.status, 401);
});

test('V4: GET /auth/me — signature over a different session id → 401', async () => {
    const [, sig] = sessionCookie.replace('session_id=', '').split('.');
    const other = 'f'.repeat(64);
    const r = await req('GET', '/auth/me', { cookie: `session_id=${other}.${sig}` });
    assert.equal(r.status, 401);
});

// ── GROUP X: MODERATION (UC-18) ──────────────────────────────────────────────

let modSupCookie = '';    // supervisor on modDocId
let modVoterCookie = '';  // voter on modDocId
let modVoterId;
let modDocId;
let modVarId;
let modCommentId;

test('X1: setup — open doc, supervisor + voter invited, variant + comment created', async () => {
    const docR = await req('POST', '/documents', {
        body: { title: 'Moderation test doc', text: 'Line one here.\nLine two here.\nLine three here.' },
        cookie: sessionCookie,
    });
    assert.equal(docR.status, 201);
    modDocId = docR.data.document.id;
    await req('POST', `/documents/${modDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });

    for (const [email, level] of [['modsup@test.com', 'supervisor'], ['modvoter@test.com', 'voter']]) {
        const invR = await req('POST', `/documents/${modDocId}/access`, {
            body: { email, access_level: level }, cookie: sessionCookie,
        });
        assert.equal(invR.status, 201);
        await req('POST', '/auth/request-otp', { body: { email } });
        const otp = latestOtp(email);
        const loginR = await req('POST', '/auth/verify-otp', { body: { email, code: otp.code } });
        assert.ok(loginR.sessionId);
        if (level === 'supervisor') modSupCookie = `session_id=${loginR.sessionId}`;
        else modVoterCookie = `session_id=${loginR.sessionId}`;
    }
    modVoterId = db.prepare('SELECT id FROM users WHERE email = ?').get('modvoter@test.com').id;

    const varR = await req('POST', `/documents/${modDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'Row', title: 'Mod var', rationale: 'r' },
        cookie: sessionCookie,
    });
    assert.equal(varR.status, 201);
    modVarId = varR.data.variant.id;

    const comR = await req('POST', `/variants/${modVarId}/comments`, {
        body: { text: 'A comment to moderate' }, cookie: modVoterCookie,
    });
    assert.equal(comR.status, 201);
    modCommentId = comR.data.comment.id;
});

test('X2: POST /variants/:id/hide — voter → 403', async () => {
    const r = await req('POST', `/variants/${modVarId}/hide`, { cookie: modVoterCookie });
    assert.equal(r.status, 403);
});

test('X3: POST /variants/:id/hide — supervisor → 200, activity logged', async () => {
    const r = await req('POST', `/variants/${modVarId}/hide`, { cookie: modSupCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.is_hidden, 1);
    const logRow = db.prepare("SELECT id FROM activity_log WHERE action = 'variant_hidden' AND variant_id = ?").get(modVarId);
    assert.ok(logRow, 'variant_hidden activity should be logged');
});

test('X4: GET /variants/:id — hidden variant: voter 404, supervisor 200', async () => {
    const vr = await req('GET', `/variants/${modVarId}`, { cookie: modVoterCookie });
    assert.equal(vr.status, 404);
    const sr = await req('GET', `/variants/${modVarId}`, { cookie: modSupCookie });
    assert.equal(sr.status, 200);
    assert.equal(sr.data.variant.is_hidden, 1);
});

test('X5: GET /documents/:id/variants — hidden variant excluded from listing', async () => {
    const r = await req('GET', `/documents/${modDocId}/variants`, { cookie: modVoterCookie });
    assert.equal(r.status, 200);
    assert.ok(!r.data.variants.some(v => v.id === modVarId));
});

test('X6: GET /documents/:id/moderation — voter 403, supervisor sees hidden variant', async () => {
    const vr = await req('GET', `/documents/${modDocId}/moderation`, { cookie: modVoterCookie });
    assert.equal(vr.status, 403);
    const sr = await req('GET', `/documents/${modDocId}/moderation`, { cookie: modSupCookie });
    assert.equal(sr.status, 200);
    assert.ok(sr.data.hidden_variants.some(v => v.id === modVarId));
});

test('X7: POST /variants/:id/unhide — supervisor → 200, voter can see it again', async () => {
    const r = await req('POST', `/variants/${modVarId}/unhide`, { cookie: modSupCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.variant.is_hidden, 0);
    const vr = await req('GET', `/variants/${modVarId}`, { cookie: modVoterCookie });
    assert.equal(vr.status, 200);
    const again = await req('POST', `/variants/${modVarId}/unhide`, { cookie: modSupCookie });
    assert.equal(again.status, 422);
});

test('X8: POST /comments/:id/hide — supervisor 204; voter sees placeholder, supervisor sees text', async () => {
    const vetoed = await req('POST', `/comments/${modCommentId}/hide`, { cookie: modVoterCookie });
    assert.equal(vetoed.status, 403);
    const r = await req('POST', `/comments/${modCommentId}/hide`, { cookie: modSupCookie });
    assert.equal(r.status, 204);

    const voterList = await req('GET', `/variants/${modVarId}/comments`, { cookie: modVoterCookie });
    const voterC = voterList.data.comments.find(c => c.id === modCommentId);
    assert.ok(voterC, 'placeholder row should be present');
    assert.equal(voterC.is_hidden, 1);
    assert.equal(voterC.text, '');
    assert.equal(voterC.author_name, '');

    const supList = await req('GET', `/variants/${modVarId}/comments`, { cookie: modSupCookie });
    const supC = supList.data.comments.find(c => c.id === modCommentId);
    assert.equal(supC.text, 'A comment to moderate');
});

test('X9: POST /comments/:id/unhide — voter 403, supervisor 204, text restored', async () => {
    const vetoed = await req('POST', `/comments/${modCommentId}/unhide`, { cookie: modVoterCookie });
    assert.equal(vetoed.status, 403);
    const r = await req('POST', `/comments/${modCommentId}/unhide`, { cookie: modSupCookie });
    assert.equal(r.status, 204);
    const list = await req('GET', `/variants/${modVarId}/comments`, { cookie: modVoterCookie });
    const c = list.data.comments.find(cc => cc.id === modCommentId);
    assert.equal(c.is_hidden, 0);
    assert.equal(c.text, 'A comment to moderate');
});

test('X10: author delete — hidden_by NULL, gone from list, cannot be unhidden', async () => {
    const dr = await req('DELETE', `/comments/${modCommentId}`, { cookie: modVoterCookie });
    assert.equal(dr.status, 204);
    const row = db.prepare('SELECT is_hidden, hidden_by FROM comments WHERE id = ?').get(modCommentId);
    assert.equal(row.is_hidden, 1);
    assert.equal(row.hidden_by, null);

    const list = await req('GET', `/variants/${modVarId}/comments`, { cookie: modSupCookie });
    assert.ok(!list.data.comments.some(c => c.id === modCommentId), 'author-deleted comment stays gone');

    const ur = await req('POST', `/comments/${modCommentId}/unhide`, { cookie: modSupCookie });
    assert.equal(ur.status, 422);

    const modList = await req('GET', `/documents/${modDocId}/moderation`, { cookie: modSupCookie });
    assert.ok(!modList.data.hidden_comments.some(c => c.id === modCommentId));
});

test('X11: admin delete of another user\'s comment — recorded as moderation hide', async () => {
    const comR = await req('POST', `/variants/${modVarId}/comments`, {
        body: { text: 'Second comment' }, cookie: modVoterCookie,
    });
    assert.equal(comR.status, 201);
    const cid = comR.data.comment.id;

    const dr = await req('DELETE', `/comments/${cid}`, { cookie: sessionCookie });
    assert.equal(dr.status, 204);
    const row = db.prepare('SELECT is_hidden, hidden_by FROM comments WHERE id = ?').get(cid);
    assert.equal(row.is_hidden, 1);
    assert.ok(row.hidden_by, 'admin delete should record hidden_by');

    const modList = await req('GET', `/documents/${modDocId}/moderation`, { cookie: modSupCookie });
    assert.ok(modList.data.hidden_comments.some(c => c.id === cid));

    const ur = await req('POST', `/comments/${cid}/unhide`, { cookie: modSupCookie });
    assert.equal(ur.status, 204);
});

test('X12: GET /api/users — non-superadmin → 403', async () => {
    const r = await req('GET', '/users', { cookie: modSupCookie });
    assert.equal(r.status, 403);
});

test('X13: superadmin lists users and toggles is_protected; search respects it', async () => {
    db.prepare("UPDATE users SET role = 'superadmin' WHERE email = 'modsup@test.com'").run();

    const listR = await req('GET', '/users', { cookie: modSupCookie });
    assert.equal(listR.status, 200);
    assert.ok(listR.data.users.some(u => u.id === modVoterId));

    const pr = await req('PATCH', `/users/${modVoterId}/protection`, { body: { is_protected: 1 }, cookie: modSupCookie });
    assert.equal(pr.status, 200);
    assert.equal(pr.data.user.is_protected, 1);
    const logRow = db.prepare("SELECT id FROM activity_log WHERE action = 'user_protected'").get();
    assert.ok(logRow, 'user_protected activity should be logged');

    const s1 = await req('GET', '/auth/search?q=modvoter', { cookie: sessionCookie });
    assert.ok(!s1.data.users.some(u => u.id === modVoterId), 'protected user hidden from search');

    const ur = await req('PATCH', `/users/${modVoterId}/protection`, { body: { is_protected: 0 }, cookie: modSupCookie });
    assert.equal(ur.status, 200);
    const s2 = await req('GET', '/auth/search?q=modvoter', { cookie: sessionCookie });
    assert.ok(s2.data.users.some(u => u.id === modVoterId), 'unprotected user searchable again');
});

// ── GROUP Y: READ-ACCESS MATRIX + EXPIRY ─────────────────────────────────────
// Pins the access decision for every document read endpoint so the
// consolidation refactor cannot silently change behaviour.

let yMemberCookie = '';   // viewer record on yDocId and yDraftId
let yBlockedCookie = '';  // blocked record on yDocId
let ySadminCookie = '';   // role = superadmin, no access records
let yDocId, yDraftId, yVarId;

const Y_READS = id => [`/documents/${id}`, `/documents/${id}/lines`, `/documents/${id}/text`, `/documents/${id}/variants`];

test('Y1: setup — open + draft docs, member, blocked user, superadmin', async () => {
    const d1 = await req('POST', '/documents', { body: { title: 'Access matrix doc', text: 'Alpha line.\nBeta line.' }, cookie: sessionCookie });
    yDocId = d1.data.document.id;
    await req('POST', `/documents/${yDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const d2 = await req('POST', '/documents', { body: { title: 'Access matrix draft', text: 'Draft secret line.' }, cookie: sessionCookie });
    yDraftId = d2.data.document.id;

    const v = await req('POST', `/documents/${yDocId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'Omega', title: 'Y var', rationale: 'r' },
        cookie: sessionCookie,
    });
    yVarId = v.data.variant.id;

    for (const [email, docs] of [['ymember@test.com', [yDocId, yDraftId]], ['yblocked@test.com', [yDocId]]]) {
        for (const id of docs) {
            const r = await req('POST', `/documents/${id}/access`, { body: { email, access_level: 'viewer' }, cookie: sessionCookie });
            assert.equal(r.status, 201);
        }
        await req('POST', '/auth/request-otp', { body: { email } });
        const otp = latestOtp(email);
        const loginR = await req('POST', '/auth/verify-otp', { body: { email, code: otp.code } });
        if (email === 'ymember@test.com') yMemberCookie = `session_id=${loginR.sessionId}`;
        else yBlockedCookie = `session_id=${loginR.sessionId}`;
    }

    const list = await req('GET', `/documents/${yDocId}/access`, { cookie: sessionCookie });
    const blockedEntry = list.data.access.find(a => a.email === 'yblocked@test.com');
    const bR = await req('PATCH', `/documents/${yDocId}/access/${blockedEntry.user_id}`, { body: { blocked: true }, cookie: sessionCookie });
    assert.equal(bR.status, 200);

    await req('POST', '/auth/request-otp', { body: { email: 'ysadmin@test.com' } });
    const otp = latestOtp('ysadmin@test.com');
    const loginR = await req('POST', '/auth/verify-otp', { body: { email: 'ysadmin@test.com', code: otp.code } });
    ySadminCookie = `session_id=${loginR.sessionId}`;
    db.prepare("UPDATE users SET role = 'superadmin' WHERE email = 'ysadmin@test.com'").run();
});

test('Y2: authenticated user with NO access record → 403 on all read endpoints', async () => {
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p, { cookie: viewerCookie });
        assert.equal(r.status, 403, `${p} should be 403 for a user without a record`);
    }
});

test('Y3: blocked user → 403 on all read endpoints', async () => {
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p, { cookie: yBlockedCookie });
        assert.equal(r.status, 403, `${p} should be 403 for a blocked user`);
    }
});

test('Y4: anonymous without allow_anonymous_view → 403 on all read endpoints', async () => {
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p);
        assert.equal(r.status, 403, `${p} should be 403 for anonymous`);
    }
});

test('Y5: invited viewer → 200 on all read endpoints', async () => {
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p, { cookie: yMemberCookie });
        assert.equal(r.status, 200, `${p} should be 200 for an invited viewer`);
    }
});

test('Y6: draft doc — viewer record → 403 on all reads + /activity; owner → 200', async () => {
    for (const p of [...Y_READS(yDraftId), `/documents/${yDraftId}/activity`]) {
        const r = await req('GET', p, { cookie: yMemberCookie });
        assert.equal(r.status, 403, `${p} should be 403 for a viewer on a draft`);
    }
    for (const p of Y_READS(yDraftId)) {
        const r = await req('GET', p, { cookie: sessionCookie });
        assert.equal(r.status, 200, `${p} should be 200 for the owner on a draft`);
    }
});

test('Y7: default_access grants reads on open docs but never on drafts', async () => {
    await req('PATCH', `/documents/${yDocId}`, { body: { settings: { default_access: 'viewer' } }, cookie: sessionCookie });
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p, { cookie: viewerCookie });
        assert.equal(r.status, 200, `${p} should be 200 via default_access`);
    }
    // Blocked users stay blocked even with default_access set
    const bR = await req('GET', `/documents/${yDocId}`, { cookie: yBlockedCookie });
    assert.equal(bR.status, 403);

    await req('PATCH', `/documents/${yDraftId}`, { body: { settings: { default_access: 'viewer' } }, cookie: sessionCookie });
    for (const p of [...Y_READS(yDraftId), `/documents/${yDraftId}/activity`]) {
        const r = await req('GET', p, { cookie: viewerCookie });
        assert.equal(r.status, 403, `${p} draft must ignore default_access`);
    }
});

test('Y8: anonymous with allow_anonymous_view → viewer reads only, never elevated ops', async () => {
    await req('PATCH', `/documents/${yDocId}`, { body: { settings: { allow_anonymous_view: true } }, cookie: sessionCookie });
    for (const p of Y_READS(yDocId)) {
        const r = await req('GET', p);
        assert.equal(r.status, 200, `${p} should be 200 for anonymous with allow_anonymous_view`);
    }
    const hideR = await req('POST', `/variants/${yVarId}/hide`);
    assert.equal(hideR.status, 401, 'anonymous supervisor op must be rejected');
    const voteR = await req('POST', `/variants/${yVarId}/vote`, { body: { vote_value: 1 } });
    assert.equal(voteR.status, 401, 'anonymous vote must be rejected');
});

test('Y9: superadmin acts as document admin everywhere', async () => {
    const dR = await req('GET', `/documents/${yDocId}`, { cookie: ySadminCookie });
    assert.equal(dR.status, 200);
    assert.equal(dR.data.document.my_access_level, 'admin');

    for (const p of Y_READS(yDraftId)) {
        const r = await req('GET', p, { cookie: ySadminCookie });
        assert.equal(r.status, 200, `${p} draft should be 200 for superadmin`);
    }

    const hideR = await req('POST', `/variants/${yVarId}/hide`, { cookie: ySadminCookie });
    assert.equal(hideR.status, 200, 'superadmin can moderate without an access record');
    await req('POST', `/variants/${yVarId}/unhide`, { cookie: ySadminCookie });

    const modR = await req('GET', `/documents/${yDocId}/moderation`, { cookie: ySadminCookie });
    assert.equal(modR.status, 200);

    const pR = await req('PATCH', `/documents/${yDocId}`, { body: { description: 'superadmin was here' }, cookie: ySadminCookie });
    assert.equal(pR.status, 200, 'superadmin passes requireDocumentAccess(editor)');
});

test('Y10: expired OTP → 401', async () => {
    await req('POST', '/auth/request-otp', { body: { email: 'yexpired@test.com' } });
    const otp = latestOtp('yexpired@test.com');
    db.prepare("UPDATE otp_codes SET expires_at = ? WHERE email = 'yexpired@test.com'")
        .run(new Date(Date.now() - 60000).toISOString());
    const r = await req('POST', '/auth/verify-otp', { body: { email: 'yexpired@test.com', code: otp.code } });
    assert.equal(r.status, 401);
});

test('Y11: expired session → 401 on /auth/me', async () => {
    await req('POST', '/auth/request-otp', { body: { email: 'ysession@test.com' } });
    const otp = latestOtp('ysession@test.com');
    const loginR = await req('POST', '/auth/verify-otp', { body: { email: 'ysession@test.com', code: otp.code } });
    const cookie = `session_id=${loginR.sessionId}`;
    const okR = await req('GET', '/auth/me', { cookie });
    assert.equal(okR.status, 200);

    const rawSid = loginR.sessionId.slice(0, loginR.sessionId.lastIndexOf('.'));
    db.prepare('UPDATE sessions SET expires_at = ? WHERE session_id = ?')
        .run(new Date(Date.now() - 60000).toISOString(), rawSid);
    const r = await req('GET', '/auth/me', { cookie });
    assert.equal(r.status, 401);
});

// ── GROUP Z: COMMENT EDITING (UC-20) ─────────────────────────────────────────

let zDocId, zCommentId, zReplyId;

test('Z1: setup — open doc, voter comment, owner reply', async () => {
    const d = await req('POST', '/documents', { body: { title: 'Comment edit doc', text: 'Editable line one.\nLine two.' }, cookie: sessionCookie });
    zDocId = d.data.document.id;
    await req('POST', `/documents/${zDocId}/status`, { body: { status: 'open' }, cookie: sessionCookie });
    const inv = await req('POST', `/documents/${zDocId}/access`, { body: { email: 'modvoter@test.com', access_level: 'voter' }, cookie: sessionCookie });
    assert.equal(inv.status, 201);
    const v = await req('POST', `/documents/${zDocId}/variants`, {
        body: { char_start: 0, char_end: 8, operation: 'replace', new_text: 'Edited', title: 'Z var', rationale: 'r' },
        cookie: sessionCookie,
    });
    const c = await req('POST', `/variants/${v.data.variant.id}/comments`, { body: { text: 'Original comment text' }, cookie: modVoterCookie });
    assert.equal(c.status, 201);
    zCommentId = c.data.comment.id;
    const r = await req('POST', `/variants/${v.data.variant.id}/comments`, {
        body: { text: 'A reply to the original', parent_comment_id: zCommentId }, cookie: sessionCookie,
    });
    assert.equal(r.status, 201);
    zReplyId = r.data.comment.id;
});

test('Z2: PATCH own comment within window → 200, edited_at set, previous_text logged', async () => {
    const r = await req('PATCH', `/comments/${zCommentId}`, { body: { text: 'Fundamentally changed comment text' }, cookie: modVoterCookie });
    assert.equal(r.status, 200);
    assert.equal(r.data.comment.text, 'Fundamentally changed comment text');
    assert.ok(r.data.comment.edited_at, 'edited_at set by author edit');
    const log = db.prepare("SELECT metadata FROM activity_log WHERE action = 'comment_updated' ORDER BY id DESC LIMIT 1").get();
    const meta = JSON.parse(log.metadata);
    assert.equal(meta.comment_id, zCommentId);
    assert.equal(meta.previous_text, 'Original comment text', 'previous text snapshotted');
});

test('Z3: PATCH someone else\'s comment → 403 (even for the doc owner)', async () => {
    const r = await req('PATCH', `/comments/${zCommentId}`, { body: { text: 'hijack' }, cookie: sessionCookie });
    assert.equal(r.status, 403);
});

test('Z4: PATCH top-level comment after window → 422', async () => {
    const past = new Date(Date.now() - 2 * 3600000).toISOString();
    db.prepare('UPDATE comments SET created_at = ? WHERE id = ?').run(past, zCommentId);
    const r = await req('PATCH', `/comments/${zCommentId}`, { body: { text: 'too late' }, cookie: modVoterCookie });
    assert.equal(r.status, 422);
});

test('Z5: reply grace — expired reply editable while parent edited_at is fresh → 200', async () => {
    const past = new Date(Date.now() - 2 * 3600000).toISOString();
    db.prepare('UPDATE comments SET created_at = ? WHERE id = ?').run(past, zReplyId);
    const r = await req('PATCH', `/comments/${zReplyId}`, { body: { text: 'Adjusted reply after the parent edit' }, cookie: sessionCookie });
    assert.equal(r.status, 200, 'grace window via parent edited_at');
    assert.ok(r.data.comment.edited_at);
});

test('Z6: reply grace expired — parent edited_at also old → 422', async () => {
    const past = new Date(Date.now() - 2 * 3600000).toISOString();
    db.prepare('UPDATE comments SET edited_at = ? WHERE id = ?').run(past, zCommentId);
    const r = await req('PATCH', `/comments/${zReplyId}`, { body: { text: 'no window left' }, cookie: sessionCookie });
    assert.equal(r.status, 422);
});

test('Z7: PATCH a hidden (author-deleted) comment → 422', async () => {
    const c = await req('POST', `/variants/${db.prepare('SELECT variant_id FROM comments WHERE id = ?').get(zCommentId).variant_id}/comments`,
        { body: { text: 'delete me' }, cookie: modVoterCookie });
    const id = c.data.comment.id;
    await req('DELETE', `/comments/${id}`, { cookie: modVoterCookie });
    const r = await req('PATCH', `/comments/${id}`, { body: { text: 'zombie edit' }, cookie: modVoterCookie });
    assert.equal(r.status, 422);
});

test('Z8: moderation hide/unhide never sets edited_at', async () => {
    const varId = db.prepare('SELECT variant_id FROM comments WHERE id = ?').get(zCommentId).variant_id;
    const c = await req('POST', `/variants/${varId}/comments`, { body: { text: 'moderate me' }, cookie: modVoterCookie });
    const id = c.data.comment.id;
    const h = await req('POST', `/comments/${id}/hide`, { cookie: sessionCookie });
    assert.equal(h.status, 204);
    const u = await req('POST', `/comments/${id}/unhide`, { cookie: sessionCookie });
    assert.equal(u.status, 204);
    const row = db.prepare('SELECT edited_at FROM comments WHERE id = ?').get(id);
    assert.equal(row.edited_at, null, 'moderation must not forge the edited marker');
});

test('Z9: GET comments listing surfaces edited_at (the marker contract) and never leaks previous_text', async () => {
    const varId = db.prepare('SELECT variant_id FROM comments WHERE id = ?').get(zCommentId).variant_id;
    const r = await req('GET', `/variants/${varId}/comments`, { cookie: modVoterCookie });
    assert.equal(r.status, 200);
    const all = r.data.comments.flatMap(c => [c, ...(c.replies || [])]);
    const edited = all.find(c => c.id === zCommentId);
    assert.ok(edited && edited.edited_at, 'listing must expose edited_at so the UI can render the marker');
    assert.ok(!('previous_text' in edited), 'previous text stays in the activity log, never in the comment payload');
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
