'use strict';

const { getOne } = require('../db');

function optionalAuth(req, res, next) {
    const sessionId = req.cookies && req.cookies.session_id;
    if (!sessionId) return next();

    const session = getOne(
        `SELECT s.session_id, u.id as user_id, u.email, u.display_name, u.organization, u.role, u.is_active
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

module.exports = { optionalAuth, requireAuth, requireRole };
