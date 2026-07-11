'use strict';

const { getOne } = require('../db');

const ACCESS_LEVELS = ['viewer', 'commenter', 'proposer', 'voter', 'supervisor', 'editor', 'admin'];

// THE access decision. Returns the effective access level for this request on
// this document, or null when access is denied. Every access check in the app
// (middleware, variant sub-routes, comment moderation, document reads) goes
// through here.
//
// Rules: owner and superadmin → 'admin'. Blocked → null. Drafts require an
// explicit editor+ record (default_access and anonymous never apply). Users
// without a record fall back to settings.default_access. Anonymous users get
// 'viewer' on non-draft docs with allow_anonymous_view.
function resolveAccessLevel(doc, settings, req) {
    const userId = req.user ? req.user.id : null;
    if (!userId) {
        if (!settings.allow_anonymous_view || doc.status === 'draft') return null;
        return 'viewer';
    }
    if (doc.owner_id === userId || req.user.role === 'superadmin') return 'admin';
    const access = getOne(
        'SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?',
        [userId, doc.id]
    );
    if (access && access.blocked) return null;
    if (doc.status === 'draft' && (!access || ACCESS_LEVELS.indexOf(access.access_level) < ACCESS_LEVELS.indexOf('editor'))) {
        return null;
    }
    if (!access) {
        const defaultLevel = settings.default_access;
        return defaultLevel && ACCESS_LEVELS.includes(defaultLevel) ? defaultLevel : null;
    }
    return access.access_level;
}

// Level meets minLevel? Anonymous users never satisfy an elevated minLevel.
function meetsLevel(level, minLevel, req) {
    if (!minLevel) return true;
    if (!req.user && minLevel !== 'viewer') return false;
    return ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(minLevel);
}

function requireDocumentAccess(minLevel) {
    return (req, res, next) => {
        const documentId = req.params.id || req.params.documentId;

        const doc = getOne('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', [documentId]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        const level = resolveAccessLevel(doc, settings, req);
        if (level === null) {
            return req.user
                ? res.status(403).json({ error: 'Access denied' })
                : res.status(401).json({ error: 'Authentication required' });
        }
        if (!meetsLevel(level, minLevel, req)) {
            return req.user
                ? res.status(403).json({ error: 'Insufficient access level' })
                : res.status(401).json({ error: 'Authentication required' });
        }

        req.document = doc;
        req.documentSettings = settings;
        req.userAccessLevel = level;
        next();
    };
}

module.exports = { requireDocumentAccess, resolveAccessLevel, meetsLevel, ACCESS_LEVELS };
