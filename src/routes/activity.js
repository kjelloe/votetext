'use strict';

const { Router } = require('express');
const { getAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// GET /api/activity
// Returns activity on all documents the user owns or has access to.
// ?mine=true restricts to actions performed by the requesting user.
router.get('/', requireAuth, (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const mine = req.query.mine === 'true';
        const limit = 20;
        const offset = (page - 1) * limit;

        const params = [req.user.id, req.user.id];
        const mineClause = mine ? 'AND al.user_id = ?' : '';
        if (mine) params.push(req.user.id);
        params.push(limit, offset);

        const activity = getAll(
            `SELECT al.*, u.display_name as user_name, d.title as document_title
             FROM activity_log al
             JOIN users u ON u.id = al.user_id
             LEFT JOIN documents d ON d.id = al.document_id
             WHERE al.document_id IN (
                 SELECT id FROM documents WHERE owner_id = ?
                 UNION
                 SELECT document_id FROM user_document_access WHERE user_id = ? AND blocked = 0
             )
             ${mineClause}
             ORDER BY al.created_at DESC
             LIMIT ? OFFSET ?`,
            params
        );

        res.json({ activity, page });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
