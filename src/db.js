'use strict';

const path = require('path');
require('dotenv').config();
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || './data/votetext.db';

const db = new Database(path.resolve(DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function getOne(sql, params = []) {
    return db.prepare(sql).get(...params);
}

function getAll(sql, params = []) {
    return db.prepare(sql).all(...params);
}

function run(sql, params = []) {
    return db.prepare(sql).run(...params);
}

function transaction(fn) {
    return db.transaction(fn)();
}

function logActivity(userId, documentId, variantId, action, metadata = {}) {
    db.prepare(
        `INSERT INTO activity_log (user_id, document_id, variant_id, action, metadata)
         VALUES (?, ?, ?, ?, ?)`
    ).run(userId, documentId || null, variantId || null, action, JSON.stringify(metadata));
}

function applyVotingSchedules() {
    const now = new Date().toISOString();
    const scheduled = db.prepare(
        "SELECT id, owner_id FROM documents WHERE status = 'open' AND voting_scheduled_at IS NOT NULL AND voting_scheduled_at <= ? AND deleted_at IS NULL"
    ).all(now);
    for (const doc of scheduled) {
        db.transaction(() => {
            db.prepare(
                "UPDATE documents SET status = 'voting', voting_scheduled_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
            ).run(doc.id);
            logActivity(doc.owner_id, doc.id, null, 'document_status_changed', { from: 'open', to: 'voting', auto: true });
        })();
    }
}

module.exports = { db, getOne, getAll, run, transaction, logActivity, applyVotingSchedules };
