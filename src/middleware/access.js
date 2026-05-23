'use strict';

const { getOne } = require('../db');

const ACCESS_LEVELS = ['viewer', 'commenter', 'proposer', 'voter', 'editor', 'admin'];

function requireDocumentAccess(minLevel) {
    return (req, res, next) => {
        const documentId = req.params.id || req.params.documentId;
        const userId = req.user ? req.user.id : null;

        const doc = getOne('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', [documentId]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        // Owner always has full access
        if (userId && doc.owner_id === userId) {
            req.document = doc;
            req.documentSettings = settings;
            req.userAccessLevel = 'admin';
            return next();
        }

        // Anonymous: only allowed for viewer on documents with allow_anonymous_view
        if (!userId) {
            if (settings.allow_anonymous_view && minLevel === 'viewer') {
                req.document = doc;
                req.documentSettings = settings;
                req.userAccessLevel = 'viewer';
                return next();
            }
            return res.status(401).json({ error: 'Authentication required' });
        }

        const access = getOne(
            'SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?',
            [userId, documentId]
        );

        if (access && access.blocked) return res.status(403).json({ error: 'You are blocked from this document' });
        if (!access) return res.status(403).json({ error: 'Access denied' });

        const userIdx = ACCESS_LEVELS.indexOf(access.access_level);
        const minIdx = ACCESS_LEVELS.indexOf(minLevel);
        if (userIdx < minIdx) return res.status(403).json({ error: 'Insufficient access level' });

        req.document = doc;
        req.documentSettings = settings;
        req.userAccessLevel = access.access_level;
        next();
    };
}

module.exports = { requireDocumentAccess, ACCESS_LEVELS };
