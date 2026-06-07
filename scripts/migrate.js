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

addColumnIfMissing('variants', 'vote_order', 'INTEGER');
addColumnIfMissing('variants', 'parent_variant_id', 'INTEGER REFERENCES variants (id) ON DELETE SET NULL');

// Recreate documents to extend status CHECK constraint with 'final_voting'
const docSchemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='documents'").get();
if (docSchemaRow && !docSchemaRow.sql.includes('final_voting')) {
    console.log('[migrating] Recreating documents to extend status CHECK constraint…');
    db.pragma('foreign_keys = OFF');
    db.exec(`
        CREATE TABLE documents_new (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT    NOT NULL DEFAULT 'Untitled Document',
            description     TEXT    NOT NULL DEFAULT '',
            owner_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
            status          TEXT    NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft', 'open', 'voting', 'final_voting', 'resolved', 'archived')),
            source_format   TEXT    NOT NULL DEFAULT 'plain'
                                    CHECK (source_format IN ('plain', 'markdown')),
            total_pages     INTEGER NOT NULL DEFAULT 1 CHECK (total_pages >= 1 AND total_pages <= 200),
            total_lines     INTEGER NOT NULL DEFAULT 0,
            total_chars     INTEGER NOT NULL DEFAULT 0,
            settings        TEXT    NOT NULL DEFAULT '{}',
            created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            deleted_at          TEXT,
            voting_scheduled_at TEXT
        );
        INSERT INTO documents_new SELECT * FROM documents;
        DROP TABLE documents;
        ALTER TABLE documents_new RENAME TO documents;
        CREATE INDEX idx_documents_owner_id   ON documents (owner_id);
        CREATE INDEX idx_documents_status     ON documents (status);
        CREATE INDEX idx_documents_created_at ON documents (created_at);
    `);
    db.pragma('foreign_keys = ON');
    console.log('[done] Recreated documents with extended CHECK constraint');
} else {
    console.log('[skip] documents CHECK constraint already up to date');
}

// Recreate variants to extend status CHECK constraint with 'conflict', 'not_applicable'
const varSchemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='variants'").get();
if (varSchemaRow && !varSchemaRow.sql.includes('not_applicable')) {
    console.log('[migrating] Recreating variants to extend status CHECK constraint…');
    db.pragma('foreign_keys = OFF');
    db.exec(`
        CREATE TABLE variants_new (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id     INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
            proposed_by     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
            char_start      INTEGER NOT NULL CHECK (char_start >= 0),
            char_end        INTEGER NOT NULL CHECK (char_end >= 0),
            operation       TEXT    NOT NULL DEFAULT 'replace'
                                    CHECK (operation IN ('insert', 'replace', 'delete')),
            new_text        TEXT    NOT NULL DEFAULT '',
            title           TEXT    NOT NULL DEFAULT '',
            rationale       TEXT    NOT NULL DEFAULT '',
            status          TEXT    NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'merged', 'conflict', 'not_applicable')),
            is_hidden       INTEGER NOT NULL DEFAULT 0,
            votes_for       INTEGER NOT NULL DEFAULT 0,
            votes_against   INTEGER NOT NULL DEFAULT 0,
            votes_abstain   INTEGER NOT NULL DEFAULT 0,
            vote_order          INTEGER,
            parent_variant_id   INTEGER REFERENCES variants (id) ON DELETE SET NULL,
            created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            CHECK (char_end >= char_start)
        );
        INSERT INTO variants_new SELECT * FROM variants;
        DROP TABLE variants;
        ALTER TABLE variants_new RENAME TO variants;
        CREATE INDEX idx_variants_document ON variants (document_id);
        CREATE INDEX idx_variants_proposer  ON variants (proposed_by);
        CREATE INDEX idx_variants_status    ON variants (document_id, status);
        CREATE INDEX idx_variants_range     ON variants (document_id, char_start, char_end);
        CREATE INDEX idx_variants_created   ON variants (created_at);
    `);
    db.pragma('foreign_keys = ON');
    console.log('[done] Recreated variants with extended CHECK constraint');
} else {
    console.log('[skip] variants CHECK constraint already up to date');
}

db.close();
console.log('Migration complete.');
