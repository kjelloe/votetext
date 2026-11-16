'use strict';

// Boots src/server.js on its own port against its own database, seeded with the tutorial cast.
// Mirrors tests/e2e/global-setup.js; nothing here touches the dev or e2e databases.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const PORT = 3002;
const DB_PATH = path.join(ROOT, 'data', 'tutorial_votetext.db');
const ENV = { ...process.env, NODE_ENV: 'development', DATABASE_PATH: DB_PATH, PORT: String(PORT), SESSION_SECRET: 'tutorial-secret', RESEND_API_KEY: '', SIGNUP_MODE: 'open', VARIANT_COOLDOWN_SECONDS: '0', COMMENT_COOLDOWN_SECONDS: '0' };

function runNode(script) {
    return new Promise((resolve, reject) => {
        const p = spawn('node', [script], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', d => { out += d; });
        p.on('exit', code => code === 0 ? resolve(out) : reject(new Error(`${script} exited with ${code}`)));
    });
}

function parseSeed(out) {
    const cookies = {};
    for (const [key, label] of [['anna', 'Anna'], ['bjorn', 'Bjørn'], ['clara', 'Clara'], ['david', 'David']]) {
        const m = out.match(new RegExp(`^\\s+${label} \\([^)]*\\)\\s+(\\S+)$`, 'm'));
        if (!m) throw new Error(`seed-demo output has no session for ${label}`);
        cookies[key] = m[1];
    }
    const docs = {};
    for (const [key, title] of [['charter', 'Community Garden Charter'], ['budget', 'Garden Budget Priorities 2027'], ['watering', 'Watering Schedule Amendment'], ['shed', 'Tool Shed Rules 2026']]) {
        const m = out.match(new RegExp(`#(\\d+)\\s+${title}`));
        if (!m) throw new Error(`seed-demo output has no id for ${title}`);
        docs[key] = parseInt(m[1]);
    }
    return { cookies, docs };
}

async function waitFor(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const r = await fetch(url); if (r.status < 500) return; } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Server did not answer on ${url} within ${timeoutMs} ms`);
}

async function startServer() {
    const busy = await fetch(`http://localhost:${PORT}/healthz`).then(() => true).catch(() => false);
    if (busy) throw new Error(`Port ${PORT} is already in use — a previous recording left its server running (pkill -f "src/server.js")`);
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
    db.close();
    const seed = parseSeed(await runNode('scripts/seed-demo.js'));

    const proc = spawn('node', ['src/server.js'], { cwd: ROOT, env: ENV, stdio: ['ignore', 'ignore', 'inherit'] });
    try {
        await waitFor(`http://localhost:${PORT}/healthz`);
    } catch (err) {
        proc.kill();
        throw err;
    }
    const baseUrl = `http://localhost:${PORT}`;
    // The newest code for an address, read from the database as the e2e setup does (no mail is sent in development)
    const latestOtp = email => {
        const rdb = new Database(DB_PATH, { readonly: true });
        try { return rdb.prepare('SELECT code FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1').get(email.toLowerCase()); } finally { rdb.close(); }
    };
    // Creates an account through the real OTP flow (chapter 3 invites a user who signed up in chapter 1); returns the session cookie value
    const signUp = async email => {
        const post = (path, body) => fetch(`${baseUrl}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await post('request-otp', { email });
        const otp = latestOtp(email);
        if (!otp) throw new Error(`No OTP stored for ${email}`);
        const r = await post('verify-otp', { email, code: otp.code });
        const m = (r.headers.get('set-cookie') || '').match(/session_id=([^;]+)/);
        if (!r.ok || !m) throw new Error(`Sign-up of ${email} failed (${r.status})`);
        return decodeURIComponent(m[1]);
    };
    return {
        baseUrl,
        ...seed,
        latestOtp,
        signUp,
        stop: () => new Promise(resolve => { proc.once('exit', resolve); proc.kill(); }),
    };
}

module.exports = { startServer, PORT, DB_PATH };
