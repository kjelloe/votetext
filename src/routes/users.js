'use strict';

const { Router } = require('express');
const { getOne, getAll, run, transaction, logActivity } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

const USER_FIELDS = 'id, email, display_name, organization, role, is_active, is_protected';

// GET /api/users  (superadmin — user list for moderation)
router.get('/', requireAuth, requireRole('superadmin'), (req, res, next) => {
    try {
        const q = (req.query.q || '').trim();
        const users = q
            ? getAll(`SELECT ${USER_FIELDS} FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY email`, [`%${q}%`, `%${q}%`])
            : getAll(`SELECT ${USER_FIELDS} FROM users ORDER BY email`);
        res.json({ users });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/users/:id/protection  (superadmin — toggle is_protected)
router.patch('/:id/protection', requireAuth, requireRole('superadmin'), (req, res, next) => {
    try {
        const user = getOne('SELECT id, is_protected FROM users WHERE id = ?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const val = req.body.is_protected ? 1 : 0;
        run("UPDATE users SET is_protected = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [val, user.id]);
        logActivity(req.user.id, null, null, val ? 'user_protected' : 'user_unprotected', { target_user_id: user.id });
        res.json({ user: getOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [user.id]) });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/users/:id/role  (superadmin — user | creator | superadmin; not your own)
router.patch('/:id/role', requireAuth, requireRole('superadmin'), (req, res, next) => {
    try {
        const { role } = req.body;
        if (!['user', 'creator', 'superadmin'].includes(role)) return res.status(400).json({ error: 'role must be user, creator or superadmin' });
        const user = getOne('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.id === req.user.id) return res.status(422).json({ error: 'You cannot change your own role' });
        if (user.role !== role) {
            transaction(() => {
                run("UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [role, user.id]);
                logActivity(req.user.id, null, null, 'user_role_changed', { target_user_id: user.id, role, previous_role: user.role });
            });
        }
        res.json({ user: getOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [user.id]) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
