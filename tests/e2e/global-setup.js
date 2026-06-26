'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve('data/e2e_votetext.db');
const BASE = 'http://localhost:3001/api';
const schema = fs.readFileSync(path.resolve('schema.sql'), 'utf8');
const AUTH_DIR = path.resolve('tests/e2e/.auth');

async function apireq(method, endpoint, opts = {}) {
    const res = await fetch(`${BASE}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const m = setCookie.match(/session_id=([^;]+)/);
    return {
        status: res.status,
        data: await res.json().catch(() => ({})),
        sessionId: m ? m[1] : null,
    };
}

function latestOtp(email) {
    const db = new Database(DB_PATH);
    const row = db.prepare("SELECT * FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1").get(email);
    db.close();
    return row;
}

function storageState(sessionId) {
    return {
        cookies: [{
            name: 'session_id',
            value: sessionId,
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }],
        origins: [],
    };
}

async function waitForServer(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url);
            if (r.status < 500) return;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Server did not start within ${timeoutMs}ms`);
}

async function login(email) {
    await apireq('POST', '/auth/request-otp', { body: { email } });
    const otp = latestOtp(email);
    if (!otp) throw new Error(`No OTP found for ${email}`);
    const r = await apireq('POST', '/auth/verify-otp', { body: { email, code: otp.code } });
    if (!r.sessionId) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.data)}`);
    return r.sessionId;
}

module.exports = async function globalSetup() {
    // 1. Fresh DB from schema (before server starts so db.js opens correct file)
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    const db = new Database(DB_PATH);
    db.exec(schema);
    db.close();

    fs.mkdirSync(AUTH_DIR, { recursive: true });

    // 2. Start server with the e2e DB
    const server = spawn('node', ['src/server.js'], {
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_PATH: DB_PATH,
            PORT: '3001',
            SESSION_SECRET: 'e2e-test-secret',
        },
        stdio: 'pipe',
    });
    server.stderr.on('data', d => process.stderr.write(d));

    // Save PID for teardown
    fs.writeFileSync(path.join(AUTH_DIR, 'server.pid'), String(server.pid));

    await waitForServer('http://localhost:3001/api/auth/me');

    // 3. Create and log in alice (owner / editor)
    const aliceSession = await login('alice@e2e.test');
    fs.writeFileSync(path.join(AUTH_DIR, 'alice.json'), JSON.stringify(storageState(aliceSession)));

    // Set alice display name
    const aliceCookie = `session_id=${aliceSession}`;
    await apireq('PATCH', '/auth/profile', {
        body: { display_name: 'Alice E2E', organization: 'Test Org' },
        cookie: aliceCookie,
    });

    // Create bob (for access tests)
    const bobSession = await login('bob@e2e.test');
    fs.writeFileSync(path.join(AUTH_DIR, 'bob.json'), JSON.stringify(storageState(bobSession)));

    // 4. Create an 'open' document with a variant
    const docR = await apireq('POST', '/documents', {
        body: { title: 'E2E Test Document', text: 'Line one text.\nLine two text.\nLine three text.' },
        cookie: aliceCookie,
    });
    const docId = docR.data.document.id;
    await apireq('POST', `/documents/${docId}/status`, { body: { status: 'open' }, cookie: aliceCookie });

    const varR = await apireq('POST', `/documents/${docId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'Changed', title: 'E2E variant', rationale: 'For testing' },
        cookie: aliceCookie,
    });
    const varId = varR.data.variant.id;

    // 5. Create a 'voting' document for review page tests
    const votingDocR = await apireq('POST', '/documents', {
        body: { title: 'E2E Voting Document', text: 'Vote on this.\nSecond line.\nThird line.' },
        cookie: aliceCookie,
    });
    const votingDocId = votingDocR.data.document.id;
    await apireq('POST', `/documents/${votingDocId}/status`, { body: { status: 'open' }, cookie: aliceCookie });
    await apireq('POST', `/documents/${votingDocId}/variants`, {
        body: { char_start: 0, char_end: 4, operation: 'replace', new_text: 'Voted', title: 'Voting variant', rationale: 'Test' },
        cookie: aliceCookie,
    });
    await apireq('POST', `/documents/${votingDocId}/status`, { body: { status: 'voting' }, cookie: aliceCookie });

    // 6. Create a 'final_voting' document for final-vote page tests
    const fvDocR = await apireq('POST', '/documents', {
        body: { title: 'E2E Final Voting Document', text: 'Final vote text.\nSecond line.' },
        cookie: aliceCookie,
    });
    const fvDocId = fvDocR.data.document.id;
    await apireq('POST', `/documents/${fvDocId}/status`, { body: { status: 'open' }, cookie: aliceCookie });
    await apireq('POST', `/documents/${fvDocId}/variants`, {
        body: { char_start: 0, char_end: 5, operation: 'replace', new_text: 'Voted', title: 'FV variant', rationale: 'Test' },
        cookie: aliceCookie,
    });
    await apireq('POST', `/documents/${fvDocId}/status`, { body: { status: 'voting' }, cookie: aliceCookie });
    await apireq('POST', `/documents/${fvDocId}/status`, { body: { status: 'final_voting' }, cookie: aliceCookie });

    // 7. Persist fixture IDs for tests to consume
    fs.writeFileSync(path.join(AUTH_DIR, 'fixtures.json'), JSON.stringify({
        docId, varId, votingDocId, fvDocId,
    }));
};
