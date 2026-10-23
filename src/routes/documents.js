'use strict';

const { Router } = require('express');
const { db, getOne, getAll, run, transaction, logActivity, applyVotingSchedules } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkText, pickSettings } = require('../lib/limits');
const { proposalCooldown } = require('../lib/cooldown');
const { requireDocumentAccess, resolveAccessLevel, meetsLevel, redactActivity, ACCESS_LEVELS, VISIBLE_DOCUMENT_IDS_SQL } = require('../middleware/access');
const { applyVariantsToText, decideOutcomes, escapeHtml, VALID_THRESHOLDS, importText, importPagedText, exportPagedText } = require('../lib/text');
const { sendMail, budgetLeft } = require('../lib/mail');

const router = Router();

// In-memory invite-email rate limiting: inviter id → [timestamps]
const inviteLog = new Map();
const INVITE_EMAILS_PER_HOUR = 20;

const inviteByIp = new Map();
const createLog = new Map();
const DOCUMENTS_PER_HOUR = 10;
const copyLog = new Map();
const COPIES_PER_HOUR = 5;

// true when `key` already has `max` hits in the last hour; records the hit otherwise
function hourlyLimited(map, key, max) {
    if (process.env.NODE_ENV === 'test') return false;
    const now = Date.now();
    const hits = (map.get(key) || []).filter(t => now - t < 3600000);
    if (hits.length >= max) return true;
    hits.push(now);
    map.set(key, hits);
    return false;
}

function inviteLimited(req) {
    if (process.env.NODE_ENV === 'test') return false;
    const now = Date.now();
    const fresh = (map, key) => (map.get(key) || []).filter(t => now - t < 3600000);
    if (fresh(inviteLog, req.user.id).length >= INVITE_EMAILS_PER_HOUR || fresh(inviteByIp, req.ip).length >= INVITE_EMAILS_PER_HOUR) return true;
    hourlyLimited(inviteLog, req.user.id, INVITE_EMAILS_PER_HOUR);
    hourlyLimited(inviteByIp, req.ip, INVITE_EMAILS_PER_HOUR);
    return false;
}

const DEFAULT_ACCESS_VALUES = ['viewer', 'commenter', 'proposer', 'voter'];

// Shared by POST and PATCH: returns an error message or null
function settingsError(settings) {
    if (settings.majority_threshold != null && !VALID_THRESHOLDS.has(settings.majority_threshold)) {
        return 'Invalid majority_threshold. Use simple, absolute, two_thirds, or three_quarters.';
    }
    if (settings.default_access != null && !DEFAULT_ACCESS_VALUES.includes(settings.default_access)) {
        return 'default_access must be viewer, commenter, proposer, or voter';
    }
    const lpp = settings.lines_per_page;
    if (lpp != null && lpp !== 'auto' && !(Number.isInteger(Number(lpp)) && Number(lpp) >= 1)) {
        return 'lines_per_page must be a positive whole number or "auto"';
    }
    return null;
}

function originalText(documentId) {
    return getAll('SELECT original_text FROM document_lines WHERE document_id = ? ORDER BY line_num', [documentId])
        .map(l => l.original_text).join('\n');
}

function loadOutcomes(doc) {
    let settings = {};
    try { settings = JSON.parse(doc.settings || '{}'); } catch {}
    const voteable = getAll(
        "SELECT * FROM variants WHERE document_id = ? AND status IN ('pending', 'conflict') AND is_hidden = 0",
        [doc.id]
    );
    return { voteable, ...decideOutcomes(voteable, settings.majority_threshold || 'simple') };
}

// A document cannot be resolved while passing proposals overlap or voteable
// proposals lack a tally. Returns the 422 body, or null when resolving is fine.
function resolveBlocker(doc) {
    const { voteable, untallied, overlaps } = loadOutcomes(doc);
    const label = id => { const v = voteable.find(x => x.id === id); return `"${v.title || v.operation}"`; };
    if (overlaps.length) {
        const [a, b] = overlaps[0];
        return {
            error: `Cannot resolve: ${label(a)} and ${label(b)} overlap and both passed. Mark one as not voting, or go back to voting and make it a child of the other.`,
            overlaps,
        };
    }
    if (untallied.length) {
        const names = untallied.slice(0, 3).map(label).join(', ') + (untallied.length > 3 ? ', …' : '');
        const fix = doc.status === 'voting'
            ? 'Move the document to final voting to record tallies, or mark the proposals as not voting.'
            : 'Record a tally or mark as not voting.';
        return {
            error: `Cannot resolve: ${untallied.length} proposal${untallied.length !== 1 ? 's have' : ' has'} no recorded tally (${names}). ${fix}`,
            untallied,
        };
    }
    return null;
}

function resolveVariants(doc) {
    const { outcomes } = loadOutcomes(doc);
    for (const [id, status] of Object.entries(outcomes)) {
        run("UPDATE variants SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [status, Number(id)]);
    }
    const approved = getAll("SELECT * FROM variants WHERE document_id = ? AND status = 'approved'", [doc.id]);
    run("UPDATE documents SET resolved_text = ?, resolved_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        [applyVariantsToText(originalText(doc.id), approved), new Date().toISOString(), doc.id]);
}

const VALID_TRANSITIONS = {
    draft: ['open'],
    open: ['voting', 'draft'],
    voting: ['resolved', 'open', 'final_voting'],
    final_voting: ['resolved', 'voting'],
    resolved: ['archived'],
    archived: [],
};

// GET /api/documents
router.get('/', (req, res, next) => {
    try {
        applyVotingSchedules();
        if (!req.user) return res.json({ documents: [] });

        const docs = getAll(
            `SELECT d.id, d.title, d.description, d.status, d.total_lines, d.total_pages,
                    d.created_at, d.updated_at, d.owner_id, u.display_name as owner_name,
                    CASE WHEN d.owner_id = ? THEN 'admin' ELSE uda.access_level END as access_level
             FROM documents d
             JOIN users u ON u.id = d.owner_id
             LEFT JOIN user_document_access uda ON uda.document_id = d.id AND uda.user_id = ?
             WHERE d.id IN (${VISIBLE_DOCUMENT_IDS_SQL})
             ORDER BY d.updated_at DESC`,
            [req.user.id, req.user.id, req.user.id, req.user.id]
        );
        res.json({ documents: docs });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents
router.post('/', requireAuth, requireRole('creator', 'superadmin'), (req, res, next) => {
    try {
        const { title, text, description, settings } = req.body;
        if (!title || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Title required' });
        if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Text content required' });
        for (const [value, key] of [[title, 'title'], [description, 'description']]) {
            const bad = checkText(value, key);
            if (bad) return res.status(400).json({ error: bad });
        }

        const maxChars = parseInt(process.env.MAX_DOCUMENT_CHARS || '1000000');
        if (text.length > maxChars) return res.status(400).json({ error: `Document too large (max ${maxChars} chars)` });

        const parsedSettings = pickSettings(settings);
        const settingsBad = settingsError(parsedSettings);
        if (settingsBad) return res.status(400).json({ error: settingsBad });
        let lineItems, totalPages, storedText = text, importInfo = null;
        if (parsedSettings.lines_per_page === 'auto') {
            const imported = importPagedText(text, { keepUnnumbered: req.body.keep_unnumbered === true });
            if (imported.error) return res.status(400).json({ error: imported.error });
            lineItems = imported.lines;
            totalPages = imported.total_pages;
            storedText = imported.text;
            importInfo = { skipped_unnumbered: imported.skipped_unnumbered, renumbered: imported.renumbered };
        } else {
            const linesPerPage = Number(parsedSettings.lines_per_page ?? (process.env.DEFAULT_LINES_PER_PAGE || '30'));
            lineItems = importText(text, linesPerPage);
            totalPages = Math.max(1, Math.ceil(lineItems.length / linesPerPage));
        }
        const totalLines = lineItems.length;
        const maxPages = Math.min(parseInt(process.env.MAX_PAGES || '200'), 200);
        if (totalPages > maxPages) {
            return res.status(400).json({ error: `Document too long: ${totalPages} pages (max ${maxPages} pages)` });
        }

        if (hourlyLimited(createLog, req.user.id, DOCUMENTS_PER_HOUR)) {
            return res.status(429).json({ error: `You can create at most ${DOCUMENTS_PER_HOUR} documents per hour.` });
        }

        const insertLine = db.prepare(
            'INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (?, ?, ?, ?, ?, ?)'
        );

        const documentId = transaction(() => {
            const r = run(
                'INSERT INTO documents (title, description, owner_id, total_pages, total_lines, total_chars, settings) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [title.trim(), (description || '').trim(), req.user.id, totalPages, totalLines, storedText.length, JSON.stringify(parsedSettings)]
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

        res.status(201).json({ document: getOne('SELECT * FROM documents WHERE id = ?', [documentId]), import: importInfo });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id
router.get('/:id', (req, res, next) => {
    try {
        applyVotingSchedules();
        const doc = getOne(
            'SELECT d.*, u.display_name as owner_name, u.organization as owner_organization FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.deleted_at IS NULL',
            [req.params.id]
        );
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        const myAccessLevel = resolveAccessLevel(doc, settings, req);
        if (myAccessLevel === null) return res.status(403).json({ error: 'Access denied' });

        const document = { ...doc, settings, my_access_level: myAccessLevel };
        if (!req.user) {
            delete document.resolved_text;
            delete document.owner_organization;
            document.settings = { lines_per_page: settings.lines_per_page, majority_threshold: settings.majority_threshold, allow_anonymous_view: settings.allow_anonymous_view };
        }
        res.json({ document });
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

        const newSettings = settings ? { ...currentSettings, ...pickSettings(settings) } : currentSettings;
        const settingsBad = settingsError(newSettings);
        if (settingsBad) return res.status(400).json({ error: settingsBad });
        if (settings && settings.lines_per_page !== undefined && String(settings.lines_per_page) !== String(currentSettings.lines_per_page ?? '')) {
            return res.status(422).json({ error: 'lines_per_page is fixed at import; copy the document to re-page it' });
        }
        for (const [value, key] of [[title, 'title'], [description, 'description']]) {
            const bad = checkText(value, key);
            if (bad) return res.status(400).json({ error: bad });
        }

        run(
            "UPDATE documents SET title = ?, description = ?, settings = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [
                title != null ? title.trim() : doc.title,
                description != null ? description.trim() : doc.description,
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
// Supervisor may perform the voting-cycle transitions (and schedule/cancel); everything else needs admin
const SUPERVISOR_TRANSITIONS = { open: ['voting'], voting: ['final_voting'], final_voting: ['voting', 'resolved'] };
router.post('/:id/status', requireAuth, requireDocumentAccess('supervisor'), (req, res, next) => {
    try {
        const { status, countdown_minutes, cancel_schedule } = req.body;
        const doc = req.document;

        if (req.userAccessLevel !== 'admin') {
            const supervisorAllowed = cancel_schedule
                ? doc.status === 'open'
                : (SUPERVISOR_TRANSITIONS[doc.status] || []).includes(status);
            if (!supervisorAllowed) {
                return res.status(403).json({ error: 'Admin access required for this transition' });
            }
        }

        const fullDoc = () => getOne(
            'SELECT d.*, u.display_name as owner_name, u.organization as owner_organization FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?',
            [doc.id]
        );

        if (cancel_schedule) {
            if (!doc.voting_scheduled_at) return res.status(422).json({ error: 'No scheduled voting to cancel' });
            run("UPDATE documents SET voting_scheduled_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [doc.id]);
            logActivity(req.user.id, doc.id, null, 'voting_schedule_cancelled', {});
            return res.json({ document: fullDoc() });
        }

        const allowed = VALID_TRANSITIONS[doc.status] || [];
        if (!allowed.includes(status)) {
            return res.status(422).json({ error: `Cannot transition from '${doc.status}' to '${status}'` });
        }

        if (status === 'voting' && countdown_minutes !== undefined && parseInt(countdown_minutes) > 0) {
            if (doc.status !== 'open') return res.status(400).json({ error: 'A voting countdown can only be scheduled on an open document' });
            const mins = parseInt(countdown_minutes);
            if (mins > 10080) return res.status(400).json({ error: 'Countdown cannot exceed 10080 minutes (14 days)' });
            const scheduledAt = new Date(Date.now() + mins * 60000).toISOString();
            run("UPDATE documents SET voting_scheduled_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [scheduledAt, doc.id]);
            logActivity(req.user.id, doc.id, null, 'voting_scheduled', { countdown_minutes: mins, scheduled_at: scheduledAt });
            return res.json({ document: fullDoc() });
        }

        if (status === 'resolved') {
            const blocker = resolveBlocker(doc);
            if (blocker) return res.status(422).json(blocker);
        }

        transaction(() => {
            run("UPDATE documents SET status = ?, voting_scheduled_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [status, doc.id]);
            logActivity(req.user.id, doc.id, null, 'document_status_changed', { from: doc.status, to: status });
            if (status === 'resolved') resolveVariants(doc);
        });
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
        transaction(() => {
            run("UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [doc.id]);
            logActivity(req.user.id, doc.id, null, 'document_deleted', { title: doc.title });
        });
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/lines
router.get('/:id/lines', (req, res, next) => {
    try {
        const doc = getOne('SELECT id, owner_id, status, settings, total_pages FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}

        if (resolveAccessLevel(doc, settings, req) === null) return res.status(403).json({ error: 'Access denied' });

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
        const doc = getOne('SELECT id, owner_id, status, settings, total_pages FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}
        if (resolveAccessLevel(doc, settings, req) === null) return res.status(403).json({ error: 'Access denied' });
        if (req.query.format === 'paged') {
            const lines = getAll('SELECT page_num, line_num, original_text FROM document_lines WHERE document_id = ? ORDER BY line_num', [doc.id]);
            return res.json({ text: exportPagedText(lines, doc.total_pages) });
        }
        res.json({ text: originalText(doc.id) });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/resolved-text
// Resolved/archived: any participant may read the outcome (US-10). The
// final_voting preview stays supervisor+ — it shows a result that is not final.
router.get('/:id/resolved-text', requireAuth, requireDocumentAccess('viewer'), (req, res, next) => {
    try {
        const doc = req.document;
        if (!['final_voting', 'resolved', 'archived'].includes(doc.status)) {
            return res.status(422).json({ error: 'Resolved text not available for this document status' });
        }
        if (doc.status === 'final_voting') {
            if (ACCESS_LEVELS.indexOf(req.userAccessLevel) < ACCESS_LEVELS.indexOf('supervisor')) {
                return res.status(403).json({ error: 'Supervisor access required until the document is resolved' });
            }
            const { voteable, outcomes } = loadOutcomes(doc);
            const approved = voteable.filter(v => outcomes[v.id] === 'approved');
            return res.json({ text: applyVariantsToText(originalText(doc.id), approved), resolved_at: null, doc_vote_passed: null });
        }
        const docVotePassed = (doc.doc_vote_yes != null || doc.doc_vote_no != null)
            ? (doc.doc_vote_yes || 0) > (doc.doc_vote_no || 0)
            : null;
        res.json({ text: doc.resolved_text || '', resolved_at: doc.resolved_at, doc_vote_passed: docVotePassed });
    } catch (err) {
        next(err);
    }
});

// POST /api/documents/:id/copy-data — copy variants/votes/comments into a target doc (owner only)
router.post('/:id/copy-data', requireAuth, requireRole('creator', 'superadmin'), requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const sourceDoc = req.document;
        const { target_doc_id, copy_variants, copy_votes, copy_comments } = req.body;

        const targetDoc = getOne('SELECT id, owner_id FROM documents WHERE id = ? AND deleted_at IS NULL', [target_doc_id]);
        if (!targetDoc) return res.status(404).json({ error: 'Target document not found' });
        if (targetDoc.id === sourceDoc.id) return res.status(422).json({ error: 'Target must be a different document' });
        if (targetDoc.owner_id !== req.user.id) return res.status(403).json({ error: 'You do not own the target document' });
        if (hourlyLimited(copyLog, req.user.id, COPIES_PER_HOUR)) return res.status(429).json({ error: `You can copy data at most ${COPIES_PER_HOUR} times per hour.` });

        const counts = { variants: 0, votes: 0, comments: 0 };

        transaction(() => {
            if (!copy_variants) return;

            const srcVariants = getAll(
                "SELECT * FROM variants WHERE document_id = ? AND is_hidden = 0 AND status != 'withdrawn' ORDER BY id",
                [sourceDoc.id]
            );
            const variantMap = {}; // oldId → newId

            for (const v of srcVariants) {
                const r = run(
                    'INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title, rationale, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [targetDoc.id, v.proposed_by, v.char_start, v.char_end, v.operation, v.new_text, v.title, v.rationale, 'pending']
                );
                variantMap[v.id] = r.lastInsertRowid;
                counts.variants++;
            }

            if (copy_votes) {
                const srcVotes = getAll(
                    'SELECT * FROM votes WHERE variant_id IN (SELECT id FROM variants WHERE document_id = ?)',
                    [sourceDoc.id]
                );
                for (const vote of srcVotes) {
                    const newVId = variantMap[vote.variant_id];
                    if (!newVId) continue;
                    run('INSERT OR IGNORE INTO votes (variant_id, user_id, vote_value) VALUES (?, ?, ?)',
                        [newVId, vote.user_id, vote.vote_value]);
                    if (vote.vote_value === 1)  run('UPDATE variants SET votes_for     = votes_for     + 1 WHERE id = ?', [newVId]);
                    if (vote.vote_value === -1) run('UPDATE variants SET votes_against = votes_against + 1 WHERE id = ?', [newVId]);
                    if (vote.vote_value === 0)  run('UPDATE variants SET votes_abstain = votes_abstain + 1 WHERE id = ?', [newVId]);
                    counts.votes++;
                }
            }

            if (copy_comments) {
                const srcComments = getAll(
                    'SELECT * FROM comments WHERE variant_id IN (SELECT id FROM variants WHERE document_id = ?) AND is_hidden = 0 ORDER BY id',
                    [sourceDoc.id]
                );
                const commentMap = {}; // oldId → newId
                // Top-level first
                for (const c of srcComments.filter(c => !c.parent_comment_id)) {
                    const newVId = variantMap[c.variant_id];
                    if (!newVId) continue;
                    const r = run('INSERT INTO comments (variant_id, user_id, text) VALUES (?, ?, ?)',
                        [newVId, c.user_id, c.text]);
                    commentMap[c.id] = r.lastInsertRowid;
                    counts.comments++;
                }
                // Replies
                for (const c of srcComments.filter(c => c.parent_comment_id)) {
                    const newVId = variantMap[c.variant_id];
                    const newParentId = commentMap[c.parent_comment_id];
                    if (!newVId || !newParentId) continue;
                    const r = run('INSERT INTO comments (variant_id, user_id, parent_comment_id, text) VALUES (?, ?, ?, ?)',
                        [newVId, c.user_id, newParentId, c.text]);
                    commentMap[c.id] = r.lastInsertRowid;
                    counts.comments++;
                }
            }

            logActivity(req.user.id, targetDoc.id, null, 'document_data_copied', { source_document_id: sourceDoc.id, ...counts });
        });

        res.json({ copied: counts });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/variants
router.get('/:id/variants', (req, res, next) => {
    try {
        const doc = getOne('SELECT id, owner_id, status, settings FROM documents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        let settings = {};
        try { settings = JSON.parse(doc.settings || '{}'); } catch {}
        if (resolveAccessLevel(doc, settings, req) === null) return res.status(403).json({ error: 'Access denied' });

        const variants = getAll(
            `SELECT v.*, u.display_name as proposer_name, u.organization as proposer_org,
                (SELECT MIN(dl.line_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as line_start,
                (SELECT MAX(dl.line_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as line_end,
                (SELECT MIN(dl.page_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as page_start,
                (SELECT MAX(dl.page_num) FROM document_lines dl WHERE dl.document_id = v.document_id AND dl.char_offset_start < v.char_end AND dl.char_offset_end > v.char_start) as page_end,
                (SELECT COUNT(*) FROM comments c WHERE c.variant_id = v.id AND c.is_hidden = 0) as comment_count,
                (SELECT COUNT(*) FROM variants x WHERE x.document_id = v.document_id AND x.id <= v.id) as proposal_num
             FROM variants v JOIN users u ON u.id = v.proposed_by
             WHERE v.document_id = ? AND v.is_hidden = 0 AND v.status != 'withdrawn'
             ORDER BY v.char_start ASC, v.created_at ASC`,
            [doc.id]
        );
        const comment_heat = {
            orange: parseInt(process.env.COMMENT_HEAT_ORANGE || '10'),
            red: parseInt(process.env.COMMENT_HEAT_RED || '25'),
        };
        const top_percent = parseInt(process.env.PROPOSALS_TOP_PERCENT || '10');
        res.json({ variants, comment_heat, top_percent });
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

        const wait = proposalCooldown(req.user.id);
        if (wait) return res.status(429).json(wait);
        for (const [value, key] of [[new_text, 'new_text'], [title, 'title'], [rationale, 'rationale']]) {
            const bad = checkText(value, key);
            if (bad) return res.status(400).json({ error: bad });
        }

        if (!Number.isInteger(char_start) || !Number.isInteger(char_end)) return res.status(400).json({ error: 'char_start and char_end must be whole numbers' });
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

// GET /api/documents/:id/moderation  (supervisor+ — hidden variants and moderator-hidden comments)
router.get('/:id/moderation', requireAuth, requireDocumentAccess('supervisor'), (req, res, next) => {
    try {
        const hiddenVariants = getAll(
            'SELECT v.*, u.display_name as proposer_name, (SELECT COUNT(*) FROM variants x WHERE x.document_id = v.document_id AND x.id <= v.id) as proposal_num FROM variants v JOIN users u ON u.id = v.proposed_by WHERE v.document_id = ? AND v.is_hidden = 1 ORDER BY v.id',
            [req.params.id]
        );
        const hiddenComments = getAll(
            `SELECT c.*, u.display_name as author_name, m.display_name as hidden_by_name
             FROM comments c
             JOIN users u ON u.id = c.user_id
             JOIN variants v ON v.id = c.variant_id
             LEFT JOIN users m ON m.id = c.hidden_by
             WHERE v.document_id = ? AND c.is_hidden = 1 AND c.hidden_by IS NOT NULL
             ORDER BY c.id`,
            [req.params.id]
        );
        res.json({ hidden_variants: hiddenVariants, hidden_comments: hiddenComments });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/activity
router.get('/:id/activity', requireAuth, requireDocumentAccess('viewer'), (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1'));
        const limit = 20;
        const full = meetsLevel(req.userAccessLevel, 'supervisor', req);
        const activity = getAll(
            `SELECT al.*, u.display_name as user_name FROM activity_log al
             JOIN users u ON u.id = al.user_id
             LEFT JOIN variants hv ON hv.id = al.variant_id
             WHERE al.document_id = ? AND (? = 1 OR hv.id IS NULL OR hv.is_hidden = 0)
             ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
            [req.params.id, full ? 1 : 0, limit, (page - 1) * limit]
        );
        res.json({ activity: full ? activity : redactActivity(activity), page });
    } catch (err) {
        next(err);
    }
});

// GET /api/documents/:id/access
router.get('/:id/access', requireAuth, requireDocumentAccess('supervisor'), (req, res, next) => {
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
// Supervisor+ can invite; only admin may modify an existing access record (POST is an upsert)
router.post('/:id/access', requireAuth, requireDocumentAccess('supervisor'), (req, res, next) => {
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
        if (user && req.userAccessLevel !== 'admin') {
            const existing = getOne('SELECT id FROM user_document_access WHERE user_id = ? AND document_id = ?', [user.id, req.params.id]);
            if (existing) return res.status(403).json({ error: 'Admin access required to change existing access' });
        }
        if (isNewUser && inviteLimited(req)) {
            return res.status(429).json({ error: 'Too many invitations to new addresses. Try again in an hour.' });
        }
        if (isNewUser && process.env.NODE_ENV === 'production' && !budgetLeft()) {
            return res.status(503).json({ error: 'Too many emails are being sent right now. Try the invitation again later.' });
        }
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
            const subject = 'You have been invited to a document on VoteText';
            const plainText =
                `You have been invited to take part in a document on VoteText as a ${access_level}.\n\n` +
                `Sign in with this email address (${normalizedEmail}) at:\n${appUrl}\n\n` +
                `If you were not expecting this, you can safely ignore this email.`;
            const htmlBody =
                `<p>${escapeHtml(inviterName)} has invited you to participate in <strong>${escapeHtml(docTitle)}</strong> as a <strong>${escapeHtml(access_level)}</strong>.</p>` +
                `<p>Sign in with this email address (${escapeHtml(normalizedEmail)}) at:<br><a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p>` +
                `<p style="color:#6b7280;font-size:0.875em">If you were not expecting this, you can safely ignore this email.</p>`;
            if (process.env.NODE_ENV === 'test') {
                console.warn(`[test] Invite email skipped — to=${normalizedEmail} role=${access_level}`);
            } else {
                if (process.env.NODE_ENV !== 'production') {
                    console.debug(`[dev] Invite to=${normalizedEmail} role=${access_level} doc="${docTitle}"`);
                }
                sendMail({ to: normalizedEmail, subject, text: plainText, html: htmlBody })
                    .catch(err => console.warn('[invite] Send failed:', err.message || JSON.stringify(err)));
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
        const validLevels = ACCESS_LEVELS;
        if (access_level && !validLevels.includes(access_level)) return res.status(400).json({ error: 'Invalid access level' });

        const existing = getOne('SELECT * FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.params.userId, req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Access record not found' });

        transaction(() => {
            run(
                "UPDATE user_document_access SET access_level = ?, blocked = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND document_id = ?",
                [access_level || existing.access_level, blocked !== undefined ? (blocked ? 1 : 0) : existing.blocked, req.params.userId, req.params.id]
            );

            if (access_level && access_level !== existing.access_level) {
                logActivity(req.user.id, req.params.id, null, 'user_access_changed', { user_id: existing.user_id, from: existing.access_level, to: access_level });
            }
            if (blocked === true) logActivity(req.user.id, req.params.id, null, 'user_blocked', { user_id: req.params.userId });
            else if (blocked === false) logActivity(req.user.id, req.params.id, null, 'user_unblocked', { user_id: req.params.userId });
        });

        res.json({ message: 'Access updated' });
    } catch (err) {
        next(err);
    }
});

// PATCH /api/documents/:id/doc-vote  (editor/admin only; doc must be in 'final_voting')
router.patch('/:id/doc-vote', requireAuth, requireDocumentAccess('supervisor'), (req, res, next) => {
    try {
        const doc = req.document;
        if (doc.status !== 'final_voting') return res.status(422).json({ error: 'Document must be in final_voting status' });

        const { yes, no, abstain } = req.body;
        for (const [k, v] of [['yes', yes], ['no', no], ['abstain', abstain]]) {
            if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) {
                return res.status(400).json({ error: `${k} must be a non-negative integer or null` });
            }
        }

        const newYes     = yes     !== undefined ? yes     : doc.doc_vote_yes;
        const newNo      = no      !== undefined ? no      : doc.doc_vote_no;
        const newAbstain = abstain !== undefined ? abstain : doc.doc_vote_abstain;
        run(
            "UPDATE documents SET doc_vote_yes = ?, doc_vote_no = ?, doc_vote_abstain = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [newYes, newNo, newAbstain, doc.id]
        );
        logActivity(req.user.id, doc.id, null, 'document_updated', { doc_vote_yes: newYes, doc_vote_no: newNo, doc_vote_abstain: newAbstain });
        res.json({ document: getOne('SELECT * FROM documents WHERE id = ?', [doc.id]) });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/documents/:id/access/:userId
router.delete('/:id/access/:userId', requireAuth, requireDocumentAccess('admin'), (req, res, next) => {
    try {
        const existing = getOne('SELECT user_id, access_level FROM user_document_access WHERE user_id = ? AND document_id = ?', [req.params.userId, req.params.id]);
        if (existing) {
            transaction(() => {
                run('DELETE FROM user_document_access WHERE user_id = ? AND document_id = ?', [existing.user_id, req.params.id]);
                logActivity(req.user.id, req.params.id, null, 'user_access_removed', { user_id: existing.user_id, access_level: existing.access_level });
            });
        }
        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
