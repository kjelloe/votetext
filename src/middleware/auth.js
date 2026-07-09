'use strict';

const crypto = require('crypto');
const { getOne } = require('../db');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret';

function signSessionId(sessionId) {
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
    return `${sessionId}.${sig}`;
}

function unwrapSessionId(cookieValue) {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const dot = cookieValue.lastIndexOf('.');
    if (dot === -1) return null;
    const sessionId = cookieValue.slice(0, dot);
    const sig = cookieValue.slice(dot + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
    return sessionId;
}

function optionalAuth(req, res, next) {
    const sessionId = unwrapSessionId(req.cookies && req.cookies.session_id);
    if (!sessionId) return next();

    const session = getOne(
        `SELECT s.session_id, u.id as user_id, u.email, u.display_name, u.organization, u.role, u.is_active, u.is_non_searchable
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.session_id = ?
           AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        [sessionId]
    );

    if (session && session.is_active) {
        req.user = {
            id: session.user_id,
            email: session.email,
            display_name: session.display_name,
            organization: session.organization,
            role: session.role,
            is_non_searchable: session.is_non_searchable,
        };
        req.sessionId = sessionId;
    }

    next();
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
        next();
    };
}

module.exports = { optionalAuth, requireAuth, requireRole, signSessionId, unwrapSessionId };
