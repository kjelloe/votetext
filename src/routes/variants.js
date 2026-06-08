'use strict';

const { Router } = require('express');
const { db, getOne, getAll, run, transaction, logActivity } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ACCESS_LEVELS } = require('../middleware/access');

const router = Router();

function checkDocAccess(doc, req, minLevel) {
    let settings = {};
    try { settings = JSON.parse(doc.settings || '{}'); } catch {}
    const userId = req.user ? req.user.id : null;
    if (!userId && (!settings.allow_anonymous_view || doc.status === 'draft')) return false;
    if (userId && doc.owner_id !== userId) {
        const access = getOne(
            'SELECT blocked, access_level FROM user_document_access WHERE user_id = ? AND document_id = ?',
            [userId, doc.id]
        );
        if (!access || access.blocked) return false;
        const effective = doc.status === 'draft' ? 'editor' : minLevel;
        if (effective && ACCESS_LEVELS.indexOf(access.access_level) < ACCESS_LEVELS.indexOf(effective)) return false;
    }
    return true;
}

function updateTallies(variantId) {
    const t = getOne(
        `SELECT
            SUM(CASE WHEN vote_value = 1  THEN 1 ELSE 0 END) as vf,
            SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) as va,
            SUM(CASE WHEN vote_value = 0  THEN 1 ELSE 0 END) as vb
         FROM votes WHERE variant_id = ?`,
        [variantId]
    );
    run(
        "UPDATE variants SET votes_for = ?, votes_against = ?, votes_abstain = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        [t.vf || 0, t.va || 0, t.vb || 0, variantId]
    );
}

// GET /api/variants/:id
router.get('/:id', (req, res, next) => {
    try {
        const variant = getOne(
            'SELECT v.*, u.display_name as proposer_name FROM variants v JOIN users u ON u.id = v.proposed_by WHERE v.id = ?',
            [req.params.id]
        );
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, status, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || (!variant.allow_anonymous_share && !checkDocAccess(doc, req))) return res.status(403).json({ error: 'Access denied' });

        res.json({ variant });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/variants/:id/share  (proposer only — toggle allow_anonymous_share)
router.patch('/:id/share', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });
        if (variant.proposed_by !== req.user.id) return res.status(403).json({ error: 'Not your variant' });
        const val = req.body.allow_anonymous_share ? 1 : 0;
        run("UPDATE variants SET allow_anonymous_share = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [val, variant.id]);
        res.json({ variant: getOne('SELECT * FROM variants WHERE id = ?', [variant.id]) });
    } catch (err) { next(err); }
});

// PATCH /api/variants/:id
router.patch('/:id', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });
        if (variant.proposed_by !== req.user.id) return res.status(403).json({ error: 'Not your variant' });
        if (variant.status !== 'pending') return res.status(422).json({ error: 'Can only edit pending variants' });
        const doc = getOne('SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (doc && !['draft', 'open'].includes(doc.status)) {
            return res.status(422).json({ error: 'Cannot edit proposals after voting has started' });
        }

        const { new_text, title, rationale } = req.body;
        run(
            "UPDATE variants SET new_text = COALESCE(?, new_text), title = COALESCE(?, title), rationale = COALESCE(?, rationale), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [new_text !== undefined ? new_text : null, title !== undefined ? title : null, rationale !== undefined ? rationale : null, variant.id]
        );
        logActivity(req.user.id, variant.document_id, variant.id, 'variant_updated', {});
        res.json({ variant: getOne('SELECT * FROM variants WHERE id = ?', [variant.id]) });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/variants/:id (withdraw)
router.delete('/:id', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });
        if (variant.status === 'withdrawn') return res.status(422).json({ error: 'Already withdrawn' });
        if (variant.proposed_by !== req.user.id && req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Not your variant' });
        }
        run("UPDATE variants SET status = 'withdrawn', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [variant.id]);
        logActivity(req.user.id, variant.document_id, variant.id, 'variant_withdrawn', {});
        res.json({ message: 'Withdrawn' });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/variants/:id/review-status  (editor/admin only; doc must be in 'voting')
router.patch('/:id/review-status', requireAuth, (req, res, next) => {
    try {
        const { status } = req.body;
        const allowed = ['pending', 'conflict', 'rejected', 'not_applicable', 'withdrawn'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, status, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (doc.status !== 'voting' && doc.status !== 'final_voting') {
            return res.status(422).json({ error: 'Document must be in voting or final_voting status' });
        }

        const isOwner = doc.owner_id === req.user.id;
        if (!isOwner) {
            const access = getOne('SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.user.id, doc.id]);
            if (!access || access.blocked) return res.status(403).json({ error: 'Access denied' });
            const userIdx = ACCESS_LEVELS.indexOf(access.access_level);
            if (userIdx < ACCESS_LEVELS.indexOf('editor')) return res.status(403).json({ error: 'Editor or admin access required' });
        }

        // Clear conflict ordering when removing a proposal from the vote
        const clearOrder = ['rejected', 'not_applicable', 'withdrawn'].includes(status);
        run(
            `UPDATE variants SET status = ?${clearOrder ? ', vote_order = NULL, parent_variant_id = NULL' : ''}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
            [status, variant.id]
        );
        const action = status === 'withdrawn' ? 'variant_withdrawn' : 'variant_updated';
        logActivity(req.user.id, variant.document_id, variant.id, action, status === 'withdrawn' ? {} : { review_status: status });
        res.json({ variant: getOne('SELECT * FROM variants WHERE id = ?', [variant.id]) });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/variants/:id/conflict-order  (editor/admin only; doc must be in 'voting')
router.patch('/:id/conflict-order', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, status, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (doc.status !== 'voting') return res.status(422).json({ error: 'Document must be in voting status to edit conflict order' });

        const isOwner = doc.owner_id === req.user.id;
        if (!isOwner) {
            const access = getOne('SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.user.id, doc.id]);
            if (!access || access.blocked) return res.status(403).json({ error: 'Access denied' });
            if (ACCESS_LEVELS.indexOf(access.access_level) < ACCESS_LEVELS.indexOf('editor')) {
                return res.status(403).json({ error: 'Editor or admin access required' });
            }
        }

        let { vote_order, parent_variant_id } = req.body;

        if (parent_variant_id != null) {
            if (parent_variant_id === variant.id) return res.status(400).json({ error: 'Cannot set self as parent' });
            const parent = getOne('SELECT id, parent_variant_id FROM variants WHERE id = ? AND document_id = ?', [parent_variant_id, variant.document_id]);
            if (!parent) return res.status(400).json({ error: 'Parent variant not found in this document' });
            if (parent.parent_variant_id != null) return res.status(400).json({ error: 'Cannot nest more than two levels deep' });
            if (vote_order === undefined) {
                const maxRow = getOne(
                    'SELECT MAX(vote_order) as m FROM variants WHERE parent_variant_id = ? AND id != ?',
                    [parent_variant_id, variant.id]
                );
                vote_order = (maxRow.m || 0) + 1;
            }
        }

        const newVoteOrder = vote_order !== undefined ? vote_order : variant.vote_order;
        const newParentId = parent_variant_id !== undefined ? parent_variant_id : variant.parent_variant_id;
        run(
            "UPDATE variants SET vote_order = ?, parent_variant_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [newVoteOrder, newParentId, variant.id]
        );
        logActivity(req.user.id, variant.document_id, variant.id, 'variant_updated', { vote_order: newVoteOrder, parent_variant_id: newParentId });
        res.json({ variant: getOne('SELECT * FROM variants WHERE id = ?', [variant.id]) });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/variants/:id/final-vote  (editor/admin only; doc must be in 'final_voting')
router.patch('/:id/final-vote', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, status, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (doc.status !== 'final_voting') return res.status(422).json({ error: 'Document must be in final_voting status' });

        const isOwner = doc.owner_id === req.user.id;
        if (!isOwner) {
            const access = getOne('SELECT access_level, blocked FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.user.id, doc.id]);
            if (!access || access.blocked) return res.status(403).json({ error: 'Access denied' });
            if (ACCESS_LEVELS.indexOf(access.access_level) < ACCESS_LEVELS.indexOf('editor')) {
                return res.status(403).json({ error: 'Editor or admin access required' });
            }
        }

        const { yes, no, abstain } = req.body;
        for (const [k, v] of [['yes', yes], ['no', no], ['abstain', abstain]]) {
            if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
                return res.status(400).json({ error: `${k} must be a non-negative integer or null` });
            }
        }

        const newYes     = yes     !== undefined ? yes     : variant.final_yes;
        const newNo      = no      !== undefined ? no      : variant.final_no;
        const newAbstain = abstain !== undefined ? abstain : variant.final_abstain;
        run(
            "UPDATE variants SET final_yes = ?, final_no = ?, final_abstain = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [newYes, newNo, newAbstain, variant.id]
        );
        run('INSERT INTO final_vote_log (variant_id, user_id, final_yes, final_no, final_abstain, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
            [variant.id, req.user.id, newYes, newNo, newAbstain, Date.now()]);
        logActivity(req.user.id, variant.document_id, variant.id, 'variant_updated', { final_yes: newYes, final_no: newNo, final_abstain: newAbstain });
        res.json({ variant: getOne('SELECT * FROM variants WHERE id = ?', [variant.id]) });
    } catch (err) {
        next(err);
    }
});

// GET /api/variants/:id/final-vote-log  (editor/admin only)
router.get('/:id/final-vote-log', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT id, document_id FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });
        const doc = getOne('SELECT id, status, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (!checkDocAccess(doc, req, 'editor')) return res.status(403).json({ error: 'Editor or admin access required' });
        const logs = getAll(
            'SELECT l.*, u.display_name as user_name FROM final_vote_log l JOIN users u ON u.id = l.user_id WHERE l.variant_id = ? ORDER BY l.recorded_at',
            [variant.id]
        );
        res.json({ logs });
    } catch (err) { next(err); }
});

// GET /api/variants/:id/relations
router.get('/:id/relations', (req, res, next) => {
    try {
        const variant = getOne('SELECT id, document_id FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || !checkDocAccess(doc, req)) return res.status(403).json({ error: 'Access denied' });

        const relations = getAll(
            `SELECT vr.*, v1.title as from_title, v2.title as to_title, u.display_name as created_by_name
             FROM variant_relations vr
             JOIN variants v1 ON v1.id = vr.from_variant_id
             JOIN variants v2 ON v2.id = vr.to_variant_id
             LEFT JOIN users u ON u.id = vr.created_by
             WHERE vr.from_variant_id = ? OR vr.to_variant_id = ?`,
            [variant.id, variant.id]
        );
        res.json({ relations });
    } catch (err) {
        next(err);
    }
});

// POST /api/variants/:id/relations
router.post('/:id/relations', requireAuth, (req, res, next) => {
    try {
        const { to_variant_id, relation_type } = req.body;
        if (!to_variant_id || !relation_type) return res.status(400).json({ error: 'to_variant_id and relation_type required' });

        const validTypes = ['based_on', 'overlaps', 'conflicts', 'supersedes'];
        if (!validTypes.includes(relation_type)) return res.status(400).json({ error: 'Invalid relation type' });

        const from = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!from) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [from.document_id]);
        if (!doc || !checkDocAccess(doc, req)) return res.status(403).json({ error: 'Access denied' });

        const to = getOne('SELECT * FROM variants WHERE id = ?', [to_variant_id]);
        if (!to) return res.status(404).json({ error: 'Target variant not found' });

        if (from.id === to.id) return res.status(400).json({ error: 'Cannot relate a variant to itself' });
        if (from.document_id !== to.document_id) return res.status(422).json({ error: 'Both variants must be in the same document' });

        try {
            run('INSERT INTO variant_relations (from_variant_id, to_variant_id, relation_type, created_by) VALUES (?, ?, ?, ?)', [from.id, to.id, relation_type, req.user.id]);
        } catch (e) {
            if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Relation already exists' });
            throw e;
        }
        res.status(201).json({ message: 'Relation created' });
    } catch (err) {
        next(err);
    }
});

// GET /api/variants/:id/comments
router.get('/:id/comments', (req, res, next) => {
    try {
        const variant = getOne('SELECT id, document_id FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || !checkDocAccess(doc, req)) return res.status(403).json({ error: 'Access denied' });

        const all = getAll(
            'SELECT c.*, u.display_name as author_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.variant_id = ? AND c.is_hidden = 0 ORDER BY c.created_at',
            [variant.id]
        );
        const top = all.filter(c => !c.parent_comment_id);
        const replies = all.filter(c => c.parent_comment_id);
        const threaded = top.map(c => ({ ...c, replies: replies.filter(r => r.parent_comment_id === c.id) }));
        res.json({ comments: threaded });
    } catch (err) {
        next(err);
    }
});

// POST /api/variants/:id/comments
router.post('/:id/comments', requireAuth, (req, res, next) => {
    try {
        const { text, parent_comment_id } = req.body;
        if (!text || !text.trim()) return res.status(400).json({ error: 'Text required' });

        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || !checkDocAccess(doc, req, 'commenter')) return res.status(403).json({ error: 'Access denied' });

        if (process.env.NODE_ENV !== 'test') {
            const commentCooldown = parseInt(process.env.COMMENT_COOLDOWN_SECONDS || '5');
            const lastComment = getOne('SELECT created_at FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [req.user.id]);
            if (lastComment) {
                const elapsed = (Date.now() - new Date(lastComment.created_at).getTime()) / 1000;
                if (elapsed < commentCooldown) {
                    const retryAfter = Math.ceil(commentCooldown - elapsed);
                    return res.status(429).json({ error: `Please wait ${retryAfter} more second${retryAfter !== 1 ? 's' : ''} before commenting.`, retry_after: retryAfter });
                }
            }
        }

        if (parent_comment_id) {
            const parent = getOne('SELECT * FROM comments WHERE id = ?', [parent_comment_id]);
            if (!parent || parent.variant_id !== variant.id) return res.status(422).json({ error: 'Invalid parent comment' });
            if (parent.parent_comment_id) return res.status(422).json({ error: 'Only one level of replies allowed' });
        }

        const r = run('INSERT INTO comments (variant_id, user_id, parent_comment_id, text) VALUES (?, ?, ?, ?)', [variant.id, req.user.id, parent_comment_id || null, text.trim()]);
        logActivity(req.user.id, variant.document_id, variant.id, 'comment_added', {});
        res.status(201).json({ comment: getOne('SELECT c.*, u.display_name as author_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [r.lastInsertRowid]) });
    } catch (err) {
        next(err);
    }
});

// POST /api/variants/:id/vote
router.post('/:id/vote', requireAuth, (req, res, next) => {
    try {
        const { vote_value } = req.body;
        if (![1, -1, 0].includes(vote_value)) return res.status(400).json({ error: 'vote_value must be 1, -1, or 0' });

        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, status, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || !checkDocAccess(doc, req, 'voter')) return res.status(403).json({ error: 'Access denied' });
        if (['final_voting', 'resolved', 'archived'].includes(doc.status)) {
            return res.status(422).json({ error: 'Cannot vote while document is in final_voting, resolved, or archived state' });
        }

        const existing = getOne('SELECT id FROM votes WHERE variant_id = ? AND user_id = ?', [variant.id, req.user.id]);
        const action = existing ? 'vote_changed' : 'vote_cast';

        transaction(() => {
            run(
                "INSERT INTO votes (variant_id, user_id, vote_value) VALUES (?, ?, ?) ON CONFLICT (variant_id, user_id) DO UPDATE SET vote_value = excluded.vote_value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                [variant.id, req.user.id, vote_value]
            );
            updateTallies(variant.id);
            logActivity(req.user.id, variant.document_id, variant.id, action, { vote_value });
        });

        const updated = getOne('SELECT votes_for, votes_against, votes_abstain FROM variants WHERE id = ?', [variant.id]);
        res.json({ tallies: updated });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/variants/:id/vote
router.delete('/:id/vote', requireAuth, (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const voteDoc = getOne('SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (voteDoc && ['final_voting', 'resolved', 'archived'].includes(voteDoc.status)) {
            return res.status(422).json({ error: 'Cannot retract vote while document is in final_voting, resolved, or archived state' });
        }

        transaction(() => {
            run('DELETE FROM votes WHERE variant_id = ? AND user_id = ?', [variant.id, req.user.id]);
            updateTallies(variant.id);
            logActivity(req.user.id, variant.document_id, variant.id, 'vote_retracted', {});
        });
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

// GET /api/variants/:id/votes
router.get('/:id/votes', (req, res, next) => {
    try {
        const variant = getOne('SELECT * FROM variants WHERE id = ?', [req.params.id]);
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const doc = getOne('SELECT id, owner_id, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [variant.document_id]);
        if (!doc || !checkDocAccess(doc, req)) return res.status(403).json({ error: 'Access denied' });

        const votes = getAll(
            'SELECT v.vote_value, v.user_id, u.display_name, v.created_at, v.updated_at FROM votes v JOIN users u ON u.id = v.user_id WHERE v.variant_id = ? ORDER BY v.created_at',
            [variant.id]
        );
        res.json({ votes, tallies: { votes_for: variant.votes_for, votes_against: variant.votes_against, votes_abstain: variant.votes_abstain } });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
