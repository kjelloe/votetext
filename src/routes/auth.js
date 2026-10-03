'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { getOne, getAll, run } = require('../db');
const { requireAuth, signSessionId, unwrapSessionId } = require('../middleware/auth');
const { sendMail } = require('../lib/mail');

const router = Router();

// In-memory rate limiting: key → [timestamps]. Lost on restart, which is
// acceptable at this scale; stale keys are pruned every window.
const WINDOW_MS = 15 * 60 * 1000;
const IP_FAILED_VERIFY_MAX = 20;
const otpLog = new Map();          // code requests per email
const failedVerifies = new Map();  // wrong codes per email while a code is outstanding
const failedByIp = new Map();      // wrong codes per client address
const authByIp = new Map();        // sign-in requests per client address

function recent(map, key, windowMs) {
    const now = Date.now();
    const hits = (map.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length) map.set(key, hits); else map.delete(key);
    return hits;
}

function record(map, key, windowMs) {
    const hits = recent(map, key, windowMs);
    hits.push(Date.now());
    map.set(key, hits);
    return hits.length;
}

setInterval(() => {
    for (const map of [otpLog, failedVerifies, failedByIp, authByIp]) {
        for (const key of [...map.keys()]) recent(map, key, WINDOW_MS);
    }
}, WINDOW_MS).unref();

function isRateLimited(email) {
    const max = parseInt(process.env.OTP_MAX_ATTEMPTS || '5');
    if (recent(otpLog, email, WINDOW_MS).length >= max) return true;
    record(otpLog, email, WINDOW_MS);
    return false;
}

// RATE_LIMIT_MAX sign-in requests per client address per RATE_LIMIT_WINDOW_MS
function ipLimit(req, res, next) {
    const max = parseInt(process.env.RATE_LIMIT_MAX || '100');
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
    if (record(authByIp, req.ip, windowMs) > max) {
        return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    }
    next();
}

// SIGNUP_MODE=invited: only emails that already have an account (created by an
// invite) or match SIGNUP_ALLOWLIST (emails or @domains, comma-separated) get a code.
function maySignIn(email) {
    if (process.env.SIGNUP_MODE !== 'invited') return true;
    if (getOne('SELECT id FROM users WHERE email = ?', [email])) return true;
    const allow = (process.env.SIGNUP_ALLOWLIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return allow.some(a => (a.startsWith('@') ? email.endsWith(a) : email === a));
}

// POST /api/auth/request-otp
router.post('/request-otp', ipLimit, async (req, res, next) => {
    try {
        const { email } = req.body;
        if (typeof email !== 'string' || !email.includes('@') || email.length > 254) return res.status(400).json({ error: 'Valid email required' });

        const normalizedEmail = email.trim().toLowerCase();
        if (isRateLimited(normalizedEmail)) {
            return res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' });
        }

        if (!maySignIn(normalizedEmail)) return res.json({ message: 'Code sent' });

        const len = parseInt(process.env.OTP_LENGTH || '6');
        const code = String(crypto.randomInt(10 ** (len - 1), 10 ** len));
        const expiresAt = new Date(Date.now() + parseInt(process.env.OTP_EXPIRY_MINUTES || '10') * 60000).toISOString();

        run('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)', [normalizedEmail, code, expiresAt]);

        if (process.env.NODE_ENV === 'test') {
            console.warn(`[test] OTP for ${normalizedEmail}: ${code}`);
        } else {
            if (process.env.NODE_ENV !== 'production') {
                console.debug(`[dev] OTP for ${normalizedEmail}: ${code}`);
            }
            const expMins = process.env.OTP_EXPIRY_MINUTES || 10;
            const send = () => sendMail({
                to: normalizedEmail,
                subject: 'Your VoteText login code',
                text: `Your login code is: ${code}\n\nExpires in ${expMins} minutes.\n\nIf you didn't request this, ignore this email.`,
                html: `<p>Your VoteText login code:</p><h2 style="letter-spacing:4px">${code}</h2><p>Expires in ${expMins} minutes.</p>`,
            });
            const failed = err => console.warn(`[otp] Email send failed for ${normalizedEmail}:`, err.message || JSON.stringify(err));
            if (process.env.SIGNUP_MODE === 'invited') {
                // Not awaited: the response must take the same time whether or not the address is allowed
                send().catch(failed);
            } else {
                try {
                    await send();
                } catch (emailErr) {
                    failed(emailErr);
                    if (process.env.NODE_ENV === 'production') {
                        return res.status(502).json({ error: 'Could not send the login email. Try again in a moment.' });
                    }
                }
            }
        }

        res.json({ message: 'Code sent' });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', ipLimit, (req, res, next) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
        if (typeof email !== 'string' || typeof code !== 'string' || email.length > 254 || code.length > 12) {
            return res.status(400).json({ error: 'Invalid email or code' });
        }
        if (recent(failedByIp, req.ip, WINDOW_MS).length >= IP_FAILED_VERIFY_MAX) {
            return res.status(429).json({ error: 'Too many incorrect codes from this address. Try again later.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const now = new Date().toISOString();

        const otp = getOne(
            `SELECT * FROM otp_codes
             WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
             ORDER BY created_at DESC LIMIT 1`,
            [normalizedEmail, code.trim(), now]
        );

        if (!otp) {
            record(failedByIp, req.ip, WINDOW_MS);
            const outstanding = getOne('SELECT 1 FROM otp_codes WHERE email = ? AND used = 0 AND expires_at > ? LIMIT 1', [normalizedEmail, now]);
            if (outstanding && record(failedVerifies, normalizedEmail, WINDOW_MS) >= parseInt(process.env.OTP_MAX_ATTEMPTS || '5')) {
                run('UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0', [normalizedEmail]);
                failedVerifies.delete(normalizedEmail);
                return res.status(429).json({ error: 'Too many incorrect codes. Request a new code.' });
            }
            return res.status(401).json({ error: 'Invalid or expired code' });
        }

        run('UPDATE otp_codes SET used = 1 WHERE id = ?', [otp.id]);
        failedVerifies.delete(normalizedEmail);

        let user = getOne('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        if (!user) {
            const r = run('INSERT INTO users (email, display_name) VALUES (?, ?)', [normalizedEmail, normalizedEmail.split('@')[0]]);
            user = getOne('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
        }

        if (!user.is_active) return res.status(403).json({ error: 'Account disabled' });

        const sessionId = crypto.randomBytes(32).toString('hex');
        const lifetimeHours = parseInt(process.env.SESSION_LIFETIME_HOURS || '72');
        const expiresAt = new Date(Date.now() + lifetimeHours * 3600000).toISOString();

        run(
            'INSERT INTO sessions (session_id, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
            [sessionId, user.id, req.ip || '', req.headers['user-agent'] || '', expiresAt]
        );

        res.cookie('session_id', signSessionId(sessionId), {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: lifetimeHours * 3600000,
        });

        res.json({
            user: { id: user.id, email: user.email, display_name: user.display_name, organization: user.organization, role: user.role, is_non_searchable: user.is_non_searchable || 0 },
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    const sid = unwrapSessionId(req.cookies && req.cookies.session_id);
    if (sid) run('DELETE FROM sessions WHERE session_id = ?', [sid]);
    res.clearCookie('session_id');
    res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    const config = {
        toast_dismiss_seconds: parseInt(process.env.TOAST_DISMISS_SECONDS || '30'),
        voting_countdown_default_minutes: parseInt(process.env.VOTING_COUNTDOWN_DEFAULT_MINUTES || '5'),
        comment_edit_window_minutes: parseInt(process.env.COMMENT_EDIT_WINDOW_MINUTES || '30'),
    };
    res.json({ user: req.user, config });
});

// GET /api/auth/search?q=... — find users by partial email, display_name, or organization
router.get('/search', requireAuth, (req, res, next) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 3) return res.json({ users: [] });
        const like = `%${q}%`;
        const users = getAll(
            `SELECT id, display_name, email, organization FROM users
             WHERE (email LIKE ? OR display_name LIKE ? OR organization LIKE ?)
               AND is_non_searchable = 0 AND is_protected = 0
               AND id != ? AND is_active = 1
             ORDER BY display_name, email LIMIT 10`,
            [like, like, like, req.user.id]
        );
        res.json({ users });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/test-otp?email=... — test env only; returns latest unused OTP code for an email
if (process.env.NODE_ENV === 'test') {
    router.get('/test-otp', (req, res) => {
        const email = (req.query.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'email required' });
        const now = new Date().toISOString();
        const row = getOne(
            `SELECT code FROM otp_codes WHERE email = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1`,
            [email, now]
        );
        if (!row) return res.status(404).json({ error: 'No valid OTP found' });
        res.json({ code: row.code });
    });
}

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, (req, res, next) => {
    try {
        const { display_name, organization, is_non_searchable } = req.body;
        if (display_name !== undefined) {
            run("UPDATE users SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [display_name, req.user.id]);
        }
        if (organization !== undefined) {
            run("UPDATE users SET organization = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [organization, req.user.id]);
        }
        if (is_non_searchable !== undefined) {
            run("UPDATE users SET is_non_searchable = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [is_non_searchable ? 1 : 0, req.user.id]);
        }
        const user = getOne('SELECT id, email, display_name, organization, role, is_non_searchable FROM users WHERE id = ?', [req.user.id]);
        res.json({ user });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
