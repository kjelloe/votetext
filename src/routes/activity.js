'use strict';

const { Router } = require('express');
const { getAll, applyVotingSchedules } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { redactActivity, VISIBLE_DOCUMENT_IDS_SQL } = require('../middleware/access');

const router = Router();

// GET /api/activity
// Returns activity on all documents the user owns or has access to (drafts only with editor+).
// ?mine=true restricts to actions performed by the requesting user.
router.get('/', requireAuth, (req, res, next) => {
    try {
        applyVotingSchedules();
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
             LEFT JOIN variants hv ON hv.id = al.variant_id
             WHERE al.document_id IN (${VISIBLE_DOCUMENT_IDS_SQL})
               AND (hv.id IS NULL OR hv.is_hidden = 0)
             ${mineClause}
             ORDER BY al.created_at DESC
             LIMIT ? OFFSET ?`,
            params
        );

        res.json({ activity: redactActivity(activity), page });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
