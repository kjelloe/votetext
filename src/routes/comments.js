'use strict';

const { Router } = require('express');
const { getOne, run, logActivity } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ACCESS_LEVELS } = require('../middleware/access');

const router = Router();
const editWindowMins = parseInt(process.env.COMMENT_EDIT_WINDOW_MINUTES || '30');
const EDIT_WINDOW_MS = editWindowMins * 60 * 1000;

function canModerate(req, documentId) {
    const doc = getOne('SELECT owner_id FROM documents WHERE id = ? AND deleted_at IS NULL', [documentId]);
    if (!doc) return false;
    if (doc.owner_id === req.user.id || req.user.role === 'superadmin') return true;
    const access = getOne(
        'SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?',
        [req.user.id, documentId]
    );
    return !!access && !access.blocked &&
        ACCESS_LEVELS.indexOf(access.access_level) >= ACCESS_LEVELS.indexOf('supervisor');
}

// PATCH /api/comments/:id
router.patch('/:id', requireAuth, (req, res, next) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });

        const comment = getOne('SELECT * FROM comments WHERE id = ?', [req.params.id]);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Not your comment' });

        const editCutoff = new Date(Date.now() - EDIT_WINDOW_MS).toISOString();
        if (comment.created_at < editCutoff) return res.status(422).json({ error: `Edit window has passed (${editWindowMins} min)` });

        run("UPDATE comments SET text = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [text.trim(), comment.id]);

        const variant = getOne('SELECT document_id FROM variants WHERE id = ?', [comment.variant_id]);
        logActivity(req.user.id, variant ? variant.document_id : null, comment.variant_id, 'comment_updated', { comment_id: comment.id });

        res.json({ comment: getOne('SELECT c.*, u.display_name as author_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [comment.id]) });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/comments/:id
router.delete('/:id', requireAuth, (req, res, next) => {
    try {
        const comment = getOne('SELECT * FROM comments WHERE id = ?', [req.params.id]);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        const variant = getOne('SELECT document_id FROM variants WHERE id = ?', [comment.variant_id]);

        if (comment.user_id !== req.user.id) {
            const doc = variant ? getOne('SELECT owner_id FROM documents WHERE id = ?', [variant.document_id]) : null;
            const access = variant ? getOne(
                'SELECT access_level FROM user_document_access WHERE user_id = ? AND document_id = ?',
                [req.user.id, variant.document_id]
            ) : null;

            const isDocAdmin = (doc && doc.owner_id === req.user.id) ||
                               (access && access.access_level === 'admin') ||
                               req.user.role === 'superadmin';

            if (!isDocAdmin) return res.status(403).json({ error: 'Not authorized' });
        }

        const hiddenBy = comment.user_id === req.user.id ? null : req.user.id;
        run('UPDATE comments SET is_hidden = 1, hidden_by = ? WHERE id = ?', [hiddenBy, comment.id]);
        if (hiddenBy) {
            logActivity(req.user.id, variant ? variant.document_id : null, comment.variant_id, 'comment_hidden', { comment_id: comment.id });
        }
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

// POST /api/comments/:id/hide  (supervisor+ moderation)
router.post('/:id/hide', requireAuth, (req, res, next) => {
    try {
        const comment = getOne('SELECT * FROM comments WHERE id = ?', [req.params.id]);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        const variant = getOne('SELECT document_id FROM variants WHERE id = ?', [comment.variant_id]);
        if (!variant || !canModerate(req, variant.document_id)) return res.status(403).json({ error: 'Supervisor access required' });
        if (comment.is_hidden) return res.status(422).json({ error: 'Comment is already hidden' });

        run("UPDATE comments SET is_hidden = 1, hidden_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [req.user.id, comment.id]);
        logActivity(req.user.id, variant.document_id, comment.variant_id, 'comment_hidden', { comment_id: comment.id });
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

// POST /api/comments/:id/unhide  (supervisor+ moderation; author deletes cannot be unhidden)
router.post('/:id/unhide', requireAuth, (req, res, next) => {
    try {
        const comment = getOne('SELECT * FROM comments WHERE id = ?', [req.params.id]);
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        const variant = getOne('SELECT document_id FROM variants WHERE id = ?', [comment.variant_id]);
        if (!variant || !canModerate(req, variant.document_id)) return res.status(403).json({ error: 'Supervisor access required' });
        if (!comment.is_hidden) return res.status(422).json({ error: 'Comment is not hidden' });
        if (!comment.hidden_by) return res.status(422).json({ error: 'Comment was deleted by its author and cannot be restored' });

        run("UPDATE comments SET is_hidden = 0, hidden_by = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [comment.id]);
        logActivity(req.user.id, variant.document_id, comment.variant_id, 'comment_unhidden', { comment_id: comment.id });
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
