'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { getOne, getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const router = Router();

// In-memory OTP rate limiting: email → [timestamps]
const otpLog = new Map();

function isRateLimited(email) {
    const now = Date.now();
    const window = 15 * 60 * 1000;
    const max = parseInt(process.env.OTP_MAX_ATTEMPTS || '5');
    const attempts = (otpLog.get(email) || []).filter(t => now - t < window);
    if (attempts.length >= max) return true;
    attempts.push(now);
    otpLog.set(email, attempts);
    return false;
}

// POST /api/auth/request-otp
router.post('/request-otp', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

        const normalizedEmail = email.trim().toLowerCase();
        if (isRateLimited(normalizedEmail)) {
            return res.status(429).json({ error: 'Too many requests. Try again in 15 minutes.' });
        }

        const len = parseInt(process.env.OTP_LENGTH || '6');
        const code = String(Math.floor(Math.pow(10, len - 1) + Math.random() * 9 * Math.pow(10, len - 1)));
        const expiresAt = new Date(Date.now() + parseInt(process.env.OTP_EXPIRY_MINUTES || '10') * 60000).toISOString();

        run('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)', [normalizedEmail, code, expiresAt]);

        if (process.env.NODE_ENV === 'test') {
            console.warn(`[test] OTP for ${normalizedEmail}: ${code}`);
        } else {
            if (process.env.NODE_ENV !== 'production') {
                console.debug(`[dev] OTP for ${normalizedEmail}: ${code}`);
            }
            try {
                const expMins = process.env.OTP_EXPIRY_MINUTES || 10;
                const from = `${process.env.MAIL_FROM_NAME || 'VoteText'} <${process.env.MAIL_FROM_ADDRESS || 'votetext@kjell.solutions'}>`;
                const { error: sendError } = await resend.emails.send({
                    from,
                    to: normalizedEmail,
                    subject: 'Your VoteText login code',
                    text: `Your login code is: ${code}\n\nExpires in ${expMins} minutes.\n\nIf you didn't request this, ignore this email.`,
                    html: `<p>Your VoteText login code:</p><h2 style="letter-spacing:4px">${code}</h2><p>Expires in ${expMins} minutes.</p>`,
                });
                if (sendError) throw sendError;
            } catch (emailErr) {
                if (process.env.NODE_ENV === 'production') throw emailErr;
                console.warn(`[dev] Email send failed — OTP for ${normalizedEmail}: ${code}`, emailErr?.message || emailErr);
            }
        }

        res.json({ message: 'Code sent' });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res, next) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

        const normalizedEmail = email.trim().toLowerCase();
        const now = new Date().toISOString();

        const otp = getOne(
            `SELECT * FROM otp_codes
             WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
             ORDER BY created_at DESC LIMIT 1`,
            [normalizedEmail, code.trim(), now]
        );

        if (!otp) return res.status(401).json({ error: 'Invalid or expired code' });

        run('UPDATE otp_codes SET used = 1 WHERE id = ?', [otp.id]);

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

        res.cookie('session_id', sessionId, {
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
    const sid = req.cookies && req.cookies.session_id;
    if (sid) run('DELETE FROM sessions WHERE session_id = ?', [sid]);
    res.clearCookie('session_id');
    res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    const config = {
        toast_dismiss_seconds: parseInt(process.env.TOAST_DISMISS_SECONDS || '30'),
        voting_countdown_default_minutes: parseInt(process.env.VOTING_COUNTDOWN_DEFAULT_MINUTES || '5'),
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
