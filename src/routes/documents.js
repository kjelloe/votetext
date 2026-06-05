'use strict';

const { Router } = require('express');
const { db, getOne, getAll, run, transaction, logActivity } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireDocumentAccess, ACCESS_LEVELS } = require('../middleware/access');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const router = Router();

const VALID_TRANSITIONS = {
    draft: ['open'],
    open: ['voting', 'draft'],
    voting: ['resolved', 'open'],
    resolved: ['archived'],
    archived: [],
};

function importText(text, linesPerPage) {
    const lines = text.split('\n');
    let charOffset = 0;
    return lines.map((lineText, i) => {
        const item = {
            page_num: Math.floor(i / linesPerPage) + 1,
            line_num: i + 1,
            original_text: lineText,
            char_offset_start: charOffset,
            char_offset_end: charOffset + lineText.length,
        };
        charOffset += lineText.length + 1; // +1 for \n
        return item;
    });
}

// GET /api/documents
router.get('/', (req, res, next) => {
    try {
        if (!req.user) return res.json({ documents: [] });

        const docs = getAll(
            `SELECT d.id, d.title, d.description, d.status, d.total_lines, d.total_pages,
                    d.created_at, d.updated_at, d.owner_id, u.display_name as owner_name,
                    CASE WHEN d.owner_id = ? THEN 'admin' ELSE uda.access_level END as access_level
             FROM documents d
             JOIN users u ON u.id = d.owner_id
             LEFT JOIN user_document_access uda ON uda.document_id = d.id AND uda.user_id = ?
             WHERE d.deleted_at IS NULL AND (d.owner_id = ? OR (uda.user_id IS NOT NULL AND uda.blocked = 0))
             ORDER BY d.updated_at DESC`,
            [req.user.id, req.user.id, req.user.id]
        );
        res.json({ documents: docs });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents
router.post('/', requireAuth, (req, res, next) => {
    try {
        const { title, text, description, settings } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
        if (!text || !text.trim()) return res.status(400).json({ error: 'Text content required' });

        const maxChars = parseInt(process.env.MAX_DOCUMENT_CHARS || '1000000');
        if (text.length > maxChars) return res.status(400).json({ error: `Document too large (max ${maxChars} chars)` });

        const parsedSettings = (settings && typeof settings === 'object') ? settings : {};
        const linesPerPage = parseInt(parsedSettings.lines_per_page || process.env.DEFAULT_LINES_PER_PAGE || '30');
        const lineItems = importText(text, linesPerPage);
        const totalLines = lineItems.length;
        const totalPages = Math.max(1, Math.ceil(totalLines / linesPerPage));

        const insertLine = db.prepare(
            'INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (?, ?, ?, ?, ?, ?)'
        );

        const documentId = transaction(() => {
            const r = run(
                'INSERT INTO documents (title, description, owner_id, total_pages, total_lines, total_chars, settings) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [title.trim(), (description || '').trim(), req.user.id, totalPages, totalLines, text.length, JSON.stringify(parsedSettings)]
            );
            const docId = r.lastInsertRowid;
            for (const line of lineItems) {
                insertLine.run(docId, line.page_num, line.line_num, line.original_text, line.char_offset_start, line.char_offset_end);
            }
            run(
                "INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, 'admin', ?)",
                [req.user.id, docId, req.user.id]
            );
            logActivity(req.user.id, docId, null, 'document_created', { title: title.trim() });
            return docId;
        });

        res.status(201).json({ document: getOne('SELECT * FROM documents WHERE id = ?', [documentId]) });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id
router.get('/:id', (req, res, next) => {
    try {
        const doc = getOne(
            'SELECT d.*, u.display_name as owner_name, u.organization as owner_organization FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.deleted_at IS NULL',
            [req.params.id]
        );
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        const userId = req.user ? req.user.id : null;

        if (!userId) {
            if (!settings.allow_anonymous_view) return res.status(403).json({ error: 'Access denied' });
        } else if (doc.owner_id !== userId) {
            const access = getOne('SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?', [userId, doc.id]);
            if (access && access.blocked) return res.status(403).json({ error: 'Access denied' });
            if (!access && !ACCESS_LEVELS.includes(settings.default_access)) return res.status(403).json({ error: 'Access denied' });
        }

        res.json({ document: { ...doc, settings } });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/documents/:id
router.patch('/:id', requireAuth, requireDocumentAccess('editor'), (req, res, next) => {
    try {
        const { title, description, settings } = req.body;
        const doc = req.document;

        let currentSettings = {};
        try { currentSettings = JSON.parse(doc.settings || '{}'); } catch {}

        const newSettings = settings ? { ...currentSettings, ...settings } : currentSettings;

        run(
            "UPDATE documents SET title = ?, description = ?, settings = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [
                title !== undefined ? title.trim() : doc.title,
                description !== undefined ? description.trim() : doc.description,
                JSON.stringify(newSettings),
                doc.id,
            ]
        );

        logActivity(req.user.id, doc.id, null, 'document_updated', {});
        res.json({ document: getOne('SELECT * FROM documents WHERE id = ?', [doc.id]) });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents/:id/status
router.post('/:id/status', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const { status } = req.body;
        const doc = req.document;
        const allowed = VALID_TRANSITIONS[doc.status] || [];
        if (!allowed.includes(status)) {
            return res.status(422).json({ error: `Cannot transition from '${doc.status}' to '${status}'` });
        }
        run("UPDATE documents SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [status, doc.id]);
        logActivity(req.user.id, doc.id, null, 'document_status_changed', { from: doc.status, to: status });
        res.json({ document: getOne('SELECT * FROM documents WHERE id = ?', [doc.id]) });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/documents/:id
router.delete('/:id', requireAuth, (req, res, next) => {
    try {
        const doc = getOne('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (doc.owner_id !== req.user.id && req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Only the owner can delete this document' });
        }
        run("UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [doc.id]);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/lines
router.get('/:id/lines', (req, res, next) => {
    try {
        const doc = getOne('SELECT id, owner_id, settings, total_pages FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        const userId = req.user ? req.user.id : null;
        if (!userId && !settings.allow_anonymous_view) return res.status(403).json({ error: 'Access denied' });

        const page = Math.max(1, parseInt(req.query.page || '1'));
        const lines = getAll('SELECT * FROM document_lines WHERE document_id = ? AND page_num = ? ORDER BY line_num', [doc.id, page]);
        res.json({ lines, page, total_pages: doc.total_pages });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/text — full reconstructed document text (for copy/export)
router.get('/:id/text', (req, res, next) => {
    try {
        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}
        const userId = req.user ? req.user.id : null;
        if (!userId && !settings.allow_anonymous_view) return res.status(403).json({ error: 'Access denied' });
        const lines = getAll('SELECT original_text FROM document_lines WHERE document_id = ? ORDER BY line_num', [doc.id]);
        res.json({ text: lines.map(l => l.original_text).join('\n') });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/variants
router.get('/:id/variants', (req, res, next) => {
    try {
        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}
        const userId = req.user ? req.user.id : null;
        if (!userId && !settings.allow_anonymous_view) return res.status(403).json({ error: 'Access denied' });

        const variants = getAll(
            `SELECT v.*, u.display_name as proposer_name, u.organization as proposer_org,
                (SELECT MIN(dl.line_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as line_start,
                (SELECT MAX(dl.line_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as line_end,
                (SELECT COUNT(*) FROM comments c WHERE c.variant_id = v.id AND c.is_hidden = 0) as comment_count
             FROM variants v JOIN users u ON u.id = v.proposed_by
             WHERE v.document_id = ? AND v.is_hidden = 0 AND v.status != 'withdrawn'
             ORDER BY v.char_start ASC, v.created_at ASC`,
            [doc.id]
        );
        const comment_heat = {
            orange: parseInt(process.env.COMMENT_HEAT_ORANGE || '10'),
            red: parseInt(process.env.COMMENT_HEAT_RED || '25'),
        };
        res.json({ variants, comment_heat });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents/:id/variants
router.post('/:id/variants', requireAuth, requireDocumentAccess('proposer'), (req, res, next) => {
    try {
        const { char_start, char_end, operation, new_text, title, rationale } = req.body;
        const doc = req.document;

        if (doc.status === 'resolved' || doc.status === 'archived') {
            return res.status(422).json({ error: 'Cannot propose on a resolved or archived document' });
        }
        if (char_start === undefined || char_end === undefined) return res.status(400).json({ error: 'char_start and char_end required' });
        if (char_start < 0 || char_end < char_start) return res.status(400).json({ error: 'Invalid character range' });
        if (char_end > doc.total_chars) return res.status(400).json({ error: 'Range exceeds document length' });

        const validOps = ['insert', 'replace', 'delete'];
        if (!validOps.includes(operation)) return res.status(400).json({ error: 'Operation must be insert, replace, or delete' });

        const insertOverlap = db.prepare(
            'INSERT OR IGNORE INTO variant_relations (from_variant_id, to_variant_id, relation_type, created_by) VALUES (?, ?, \'overlaps\', ?)'
        );

        const variantId = transaction(() => {
            const r = run(
                'INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title, rationale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [doc.id, req.user.id, char_start, char_end, operation, new_text || '', title || '', rationale || '']
            );
            const newId = r.lastInsertRowid;

            const overlapping = getAll(
                "SELECT id FROM variants WHERE document_id = ? AND id != ? AND status != 'withdrawn' AND char_start < ? AND char_end > ?",
                [doc.id, newId, char_end, char_start]
            );
            for (const other of overlapping) insertOverlap.run(newId, other.id, req.user.id);

            logActivity(req.user.id, doc.id, newId, 'variant_proposed', { operation, title: title || '' });
            return newId;
        });

        res.status(201).json({ variant: getOne('SELECT v.*, u.display_name as proposer_name FROM variants v JOIN users u ON u.id = v.proposed_by WHERE v.id = ?', [variantId]) });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/activity
router.get('/:id/activity', requireAuth, requireDocumentAccess('viewer'), (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = 20;
        const activity = getAll(
            'SELECT al.*, u.display_name as user_name FROM activity_log al JOIN users u ON u.id = al.user_id WHERE al.document_id = ? ORDER BY al.created_at DESC LIMIT ? OFFSET ?',
            [req.params.id, limit, (page - 1) * limit]
        );
        res.json({ activity, page });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/access
router.get('/:id/access', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const entries = getAll(
            'SELECT uda.*, u.email, u.display_name, u.organization FROM user_document_access uda JOIN users u ON u.id = uda.user_id WHERE uda.document_id = ? ORDER BY uda.created_at',
            [req.params.id]
        );
        res.json({ access: entries, my_access_level: req.userAccessLevel, default_access: req.documentSettings.default_access || '' });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents/:id/access
router.post('/:id/access', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const { email, access_level } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        if (!ACCESS_LEVELS.includes(access_level)) return res.status(400).json({ error: 'Invalid access level' });
        if (ACCESS_LEVELS.indexOf(access_level) > ACCESS_LEVELS.indexOf(req.userAccessLevel)) {
            return res.status(403).json({ error: `You cannot grant ${access_level} access — your own level is ${req.userAccessLevel}` });
        }

        const normalizedEmail = email.trim().toLowerCase();
        let user = getOne('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        const isNewUser = !user;
        if (!user) {
            const r = run('INSERT INTO users (email, display_name) VALUES (?, ?)', [normalizedEmail, normalizedEmail.split('@')[0]]);
            user = getOne('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
        }

        run(
            "INSERT INTO user_document_access (user_id, document_id, access_level, invited_by) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, document_id) DO UPDATE SET access_level = excluded.access_level, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            [user.id, req.params.id, access_level, req.user.id]
        );

        logActivity(req.user.id, req.params.id, null, 'user_invited', { email: normalizedEmail, access_level });

        if (isNewUser) {
            const appUrl = process.env.VOTETEXT_URL || `${req.protocol}://${req.get('host')}`;
            const inviterName = req.user.display_name || req.user.email;
            const docTitle = req.document.title;
            const from = `${process.env.MAIL_FROM_NAME || 'VoteText'} <${process.env.MAIL_FROM_ADDRESS || 'votetext@kjell.solutions'}>`;
            const subject = `You have been invited to "${docTitle}" on VoteText`;
            const plainText =
                `${inviterName} has invited you to participate in "${docTitle}" as a ${access_level}.\n\n` +
                `Sign in with this email address (${normalizedEmail}) at:\n${appUrl}\n\n` +
                `If you were not expecting this, you can safely ignore this email.`;
            const htmlBody =
                `<p>${inviterName} has invited you to participate in <strong>${docTitle}</strong> as a <strong>${access_level}</strong>.</p>` +
                `<p>Sign in with this email address (${normalizedEmail}) at:<br><a href="${appUrl}">${appUrl}</a></p>` +
                `<p style="color:#6b7280;font-size:0.875em">If you were not expecting this, you can safely ignore this email.</p>`;
            if (process.env.NODE_ENV === 'test') {
                console.warn(`[test] Invite email skipped — to=${normalizedEmail} role=${access_level}`);
            } else {
                if (process.env.NODE_ENV !== 'production') {
                    console.debug(`[dev] Invite to=${normalizedEmail} role=${access_level} doc="${docTitle}"`);
                }
                console.log(`[invite] Sending to=${normalizedEmail} from="${from}" subject="${subject}" key=${process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.slice(0, 8) + '…' : 'MISSING'}`);
                resend.emails.send({ from, to: normalizedEmail, subject, text: plainText, html: htmlBody })
                    .then(({ data, error: sendError }) => {
                        if (sendError) {
                            console.warn('[invite] Resend error:', JSON.stringify(sendError));
                        } else {
                            console.log('[invite] Sent OK — id:', data && data.id);
                        }
                    })
                    .catch(err => {
                        console.warn('[invite] Send threw:', err.message || err);
                    });
            }
        }

        res.status(201).json({ message: 'Access granted', user_id: user.id });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/documents/:id/access/:userId
router.patch('/:id/access/:userId', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const { access_level, blocked } = req.body;
        const validLevels = ['viewer', 'commenter', 'proposer', 'voter', 'editor', 'admin'];
        if (access_level && !validLevels.includes(access_level)) return res.status(400).json({ error: 'Invalid access level' });

        const existing = getOne('SELECT * FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.params.userId, req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Access record not found' });

        run(
            "UPDATE user_document_access SET access_level = ?, blocked = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND document_id = ?",
            [access_level || existing.access_level, blocked !== undefined ? (blocked ? 1 : 0) : existing.blocked, req.params.userId, req.params.id]
        );

        if (blocked === true) logActivity(req.user.id, req.params.id, null, 'user_blocked', { user_id: req.params.userId });
        else if (blocked === false) logActivity(req.user.id, req.params.id, null, 'user_unblocked', { user_id: req.params.userId });

        res.json({ message: 'Access updated' });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/documents/:id/access/:userId
router.delete('/:id/access/:userId', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        run('DELETE FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.params.userId, req.params.id]);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
