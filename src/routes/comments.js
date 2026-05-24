'use strict';

const { Router } = require('express');
const { getOne, run, logActivity } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const editWindowMins = parseInt(process.env.COMMENT_EDIT_WINDOW_MINUTES || '30');
const EDIT_WINDOW_MS = editWindowMins * 60 * 1000;

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

        if (comment.user_id !== req.user.id) {
            const variant = getOne('SELECT document_id FROM variants WHERE id = ?', [comment.variant_id]);
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

        run('UPDATE comments SET is_hidden = 1 WHERE id = ?', [comment.id]);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
