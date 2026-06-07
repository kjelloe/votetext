'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './data/votetext.db';
const db = new Database(dbPath);

function addColumnIfMissing(table, column, definition) {
    const cols = db.pragma(`table_info(${table})`);
    if (cols.some(c => c.name === column)) {
        console.log(`[skip] ${table}.${column} already exists`);
        return;
    }
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`[done] Added ${table}.${column}`);
}

addColumnIfMissing('documents', 'deleted_at', 'TEXT');
addColumnIfMissing('documents', 'voting_scheduled_at', 'TEXT');
addColumnIfMissing('users', 'is_non_searchable', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'is_protected', 'INTEGER NOT NULL DEFAULT 0');

// Recreate activity_log to extend the action CHECK constraint with voting actions
const actSchemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_log'").get();
if (actSchemaRow && !actSchemaRow.sql.includes('voting_scheduled')) {
    console.log('[migrating] Recreating activity_log to extend action CHECK constraint…');
    db.exec(`
        CREATE TABLE activity_log_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            document_id INTEGER          REFERENCES documents (id) ON DELETE CASCADE,
            variant_id  INTEGER          REFERENCES variants (id) ON DELETE SET NULL,
            action      TEXT    NOT NULL
                                CHECK (action IN (
                                    'document_created', 'document_updated', 'document_status_changed',
                                    'variant_proposed', 'variant_updated', 'variant_withdrawn',
                                    'vote_cast', 'vote_changed', 'vote_retracted',
                                    'comment_added', 'comment_updated',
                                    'user_invited', 'user_blocked', 'user_unblocked',
                                    'voting_scheduled', 'voting_schedule_cancelled'
                                )),
            metadata    TEXT    NOT NULL DEFAULT '{}',
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO activity_log_new SELECT * FROM activity_log;
        DROP TABLE activity_log;
        ALTER TABLE activity_log_new RENAME TO activity_log;
        CREATE INDEX idx_activity_user      ON activity_log (user_id);
        CREATE INDEX idx_activity_document  ON activity_log (document_id);
        CREATE INDEX idx_activity_created   ON activity_log (created_at);
        CREATE INDEX idx_activity_user_time ON activity_log (user_id, created_at DESC);
    `);
    console.log('[done] Recreated activity_log with extended CHECK constraint');
} else {
    console.log('[skip] activity_log CHECK constraint already up to date');
}

db.close();
console.log('Migration complete.');
