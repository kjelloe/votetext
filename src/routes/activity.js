'use strict';

const { Router } = require('express');
const { getAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// GET /api/activity
router.get('/', requireAuth, (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = 20;
        const offset = (page - 1) * limit;

        const activity = getAll(
            `SELECT al.*, u.display_name as user_name, d.title as document_title
             FROM activity_log al
             JOIN users u ON u.id = al.user_id
             LEFT JOIN documents d ON d.id = al.document_id
             WHERE al.user_id = ?
             ORDER BY al.created_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.id, limit, offset]
        );

        res.json({ activity, page });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
