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

module.exports = { db, getOne, getAll, run, transaction, logActivity };
