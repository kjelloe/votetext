-- =============================================================================
-- VoteText — Collaborative Text Voting Platform
-- Database Schema (SQLite)
-- =============================================================================
-- This schema uses SQLite-specific features:
--   • STRICT tables where practical (SQLite ≥ 3.37)
--   • JSON columns stored as TEXT (validated at app layer)
--   • INTEGER PRIMARY KEY = implicit rowid alias
--   • AUTOINCREMENT only where gap-free IDs matter
-- =============================================================================

PRAGMA journal_mode = WAL;            -- better concurrent read performance
PRAGMA foreign_keys = ON;             -- enforce FK constraints
PRAGMA busy_timeout = 5000;           -- wait up to 5 s on lock contention

-- ---------------------------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT    NOT NULL DEFAULT '',
    organization    TEXT    NOT NULL DEFAULT '',
    role            TEXT    NOT NULL DEFAULT 'user'
                            CHECK (role IN ('user', 'admin', 'superadmin')),
    is_active           INTEGER NOT NULL DEFAULT 1,   -- 0 = soft-deleted / banned
    is_non_searchable   INTEGER NOT NULL DEFAULT 0,   -- 1 = hidden from user search (user-controlled)
    is_protected        INTEGER NOT NULL DEFAULT 0,   -- 1 = hidden from all searches (admin-controlled)
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_email      ON users (email);
CREATE INDEX idx_users_created_at ON users (created_at);

-- ---------------------------------------------------------------------------
-- 2. OTP CODES  (email-based passwordless auth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL COLLATE NOCASE,
    code        TEXT    NOT NULL,          -- 6-digit numeric string
    expires_at  TEXT    NOT NULL,          -- ISO-8601 UTC
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_otp_email_expires ON otp_codes (email, expires_at);

-- ---------------------------------------------------------------------------
-- 3. SESSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    session_id  TEXT    PRIMARY KEY,       -- crypto-random hex token
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    ip_address  TEXT    NOT NULL DEFAULT '',
    user_agent  TEXT    NOT NULL DEFAULT '',
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sessions_user_id    ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 4. DOCUMENTS
-- ---------------------------------------------------------------------------
-- status lifecycle: draft → open → voting → resolved → archived
CREATE TABLE IF NOT EXISTS documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL DEFAULT 'Untitled Document',
    description     TEXT    NOT NULL DEFAULT '',
    owner_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

    -- Document status
    status          TEXT    NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'open', 'voting', 'resolved', 'archived')),

    -- Source text metadata
    source_format   TEXT    NOT NULL DEFAULT 'plain'
                            CHECK (source_format IN ('plain', 'markdown')),
    total_pages     INTEGER NOT NULL DEFAULT 1 CHECK (total_pages >= 1 AND total_pages <= 200),
    total_lines     INTEGER NOT NULL DEFAULT 0,
    total_chars     INTEGER NOT NULL DEFAULT 0,

    -- Configurable settings stored as JSON blob
    -- Example: {
    --   "resolution_mode": "majority|supermajority|owner_decides",
    --   "allow_anonymous_view": true,
    --   "allow_anonymous_comment": false,
    --   "require_email_to_vote": true,
    --   "moderation_mode": "none|pre|post",
    --   "max_variants_per_user": 0,          -- 0 = unlimited
    --   "voting_deadline": null,              -- ISO-8601 or null
    --   "lines_per_page": 30
    -- }
    settings        TEXT    NOT NULL DEFAULT '{}',

    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at          TEXT,                                                          -- NULL = active; set to soft-delete
    voting_scheduled_at TEXT                                                           -- ISO-8601 UTC when open→voting transition fires; NULL = not scheduled
);

CREATE INDEX idx_documents_owner_id   ON documents (owner_id);
CREATE INDEX idx_documents_status     ON documents (status);
CREATE INDEX idx_documents_created_at ON documents (created_at);

-- ---------------------------------------------------------------------------
-- 5. DOCUMENT LINES
-- ---------------------------------------------------------------------------
-- Stores the original document text broken into page/line structure.
-- char_offset_start/end are absolute character offsets within the full document
-- text, enabling precise variant targeting.
CREATE TABLE IF NOT EXISTS document_lines (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id         INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    page_num            INTEGER NOT NULL CHECK (page_num >= 1),
    line_num            INTEGER NOT NULL CHECK (line_num >= 1),
    original_text       TEXT    NOT NULL DEFAULT '',
    char_offset_start   INTEGER NOT NULL CHECK (char_offset_start >= 0),
    char_offset_end     INTEGER NOT NULL CHECK (char_offset_end >= 0),

    UNIQUE (document_id, page_num, line_num)
);

CREATE INDEX idx_doclines_document   ON document_lines (document_id);
CREATE INDEX idx_doclines_offsets    ON document_lines (document_id, char_offset_start, char_offset_end);

-- ---------------------------------------------------------------------------
-- 6. VARIANTS  (proposed text changes)
-- ---------------------------------------------------------------------------
-- A variant targets a character range [char_start, char_end) in the original
-- document.  Operations:
--   • 'replace' – replace chars in range with new_text
--   • 'insert'  – insert new_text at char_start (char_end = char_start)
--   • 'delete'  – delete chars in range (new_text = '')
CREATE TABLE IF NOT EXISTS variants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id     INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    proposed_by     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

    -- Target range (absolute character offsets)
    char_start      INTEGER NOT NULL CHECK (char_start >= 0),
    char_end        INTEGER NOT NULL CHECK (char_end >= 0),

    operation       TEXT    NOT NULL DEFAULT 'replace'
                            CHECK (operation IN ('insert', 'replace', 'delete')),
    new_text        TEXT    NOT NULL DEFAULT '',

    -- Contextual info
    title           TEXT    NOT NULL DEFAULT '',       -- short summary
    rationale       TEXT    NOT NULL DEFAULT '',       -- why this change

    -- Status lifecycle: pending → approved | rejected | withdrawn | merged
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'merged')),

    -- Moderation
    is_hidden       INTEGER NOT NULL DEFAULT 0,       -- hidden by moderator

    -- Vote tallies (denormalized for fast reads; updated via trigger/app)
    votes_for       INTEGER NOT NULL DEFAULT 0,
    votes_against   INTEGER NOT NULL DEFAULT 0,
    votes_abstain   INTEGER NOT NULL DEFAULT 0,

    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CHECK (char_end >= char_start)
);

CREATE INDEX idx_variants_document   ON variants (document_id);
CREATE INDEX idx_variants_proposer   ON variants (proposed_by);
CREATE INDEX idx_variants_status     ON variants (document_id, status);
CREATE INDEX idx_variants_range      ON variants (document_id, char_start, char_end);
CREATE INDEX idx_variants_created    ON variants (created_at);

-- ---------------------------------------------------------------------------
-- 7. VARIANT RELATIONS
-- ---------------------------------------------------------------------------
-- Tracks semantic relationships between variants:
--   • 'based_on'  – this variant builds upon / refines another
--   • 'overlaps'  – the two variants touch the same character range
--   • 'conflicts' – the two variants are mutually exclusive
--   • 'supersedes' – this variant replaces an older one
CREATE TABLE IF NOT EXISTS variant_relations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_variant_id INTEGER NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
    to_variant_id   INTEGER NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
    relation_type   TEXT    NOT NULL
                            CHECK (relation_type IN ('based_on', 'overlaps', 'conflicts', 'supersedes')),
    created_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (from_variant_id, to_variant_id, relation_type),
    CHECK  (from_variant_id != to_variant_id)
);

CREATE INDEX idx_varrel_from ON variant_relations (from_variant_id);
CREATE INDEX idx_varrel_to   ON variant_relations (to_variant_id);

-- ---------------------------------------------------------------------------
-- 8. VOTES
-- ---------------------------------------------------------------------------
-- One vote per user per variant. Users may change their vote until
-- the document enters 'resolved' status.
CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id  INTEGER NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users (id)    ON DELETE CASCADE,

    -- +1 = for, -1 = against, 0 = abstain
    vote_value  INTEGER NOT NULL CHECK (vote_value IN (-1, 0, 1)),

    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (variant_id, user_id)
);

CREATE INDEX idx_votes_variant ON votes (variant_id);
CREATE INDEX idx_votes_user    ON votes (user_id);

-- ---------------------------------------------------------------------------
-- 9. COMMENTS  (two-level threaded discussions under variants)
-- ---------------------------------------------------------------------------
-- parent_comment_id = NULL  →  top-level comment
-- parent_comment_id = <id>  →  reply (max one level of nesting enforced at app layer)
CREATE TABLE IF NOT EXISTS comments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id          INTEGER NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
    user_id             INTEGER NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
    parent_comment_id   INTEGER          REFERENCES comments (id) ON DELETE CASCADE,
    text                TEXT    NOT NULL DEFAULT '',
    is_hidden           INTEGER NOT NULL DEFAULT 0,   -- moderator can hide
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_comments_variant ON comments (variant_id);
CREATE INDEX idx_comments_user    ON comments (user_id);
CREATE INDEX idx_comments_parent  ON comments (parent_comment_id);

-- ---------------------------------------------------------------------------
-- 10. USER–DOCUMENT ACCESS CONTROL
-- ---------------------------------------------------------------------------
-- Per-document access levels:
--   • 'viewer'      – can read document, see variants & votes
--   • 'commenter'   – viewer + can comment
--   • 'proposer'    – commenter + can propose variants
--   • 'voter'       – proposer + can vote
--   • 'editor'      – voter + can edit document text
--   • 'admin'       – full control (co-owner)
CREATE TABLE IF NOT EXISTS user_document_access (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users (id)     ON DELETE CASCADE,
    document_id     INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,

    access_level    TEXT    NOT NULL DEFAULT 'viewer'
                            CHECK (access_level IN ('viewer', 'commenter', 'proposer', 'voter', 'editor', 'admin')),
    blocked         INTEGER NOT NULL DEFAULT 0,   -- 1 = explicitly blocked from this document

    invited_by      INTEGER          REFERENCES users (id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (user_id, document_id)
);

CREATE INDEX idx_uda_user     ON user_document_access (user_id);
CREATE INDEX idx_uda_document ON user_document_access (document_id);

-- ---------------------------------------------------------------------------
-- 11. ACTIVITY LOG  (lightweight event log for user activity feeds)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
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
    metadata    TEXT    NOT NULL DEFAULT '{}',   -- JSON with action-specific data
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_activity_user       ON activity_log (user_id);
CREATE INDEX idx_activity_document   ON activity_log (document_id);
CREATE INDEX idx_activity_created    ON activity_log (created_at);
CREATE INDEX idx_activity_user_time  ON activity_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 12. CLEANUP HELPERS
-- ---------------------------------------------------------------------------
-- Periodically delete expired OTP codes and sessions (run from app or cron)
-- DELETE FROM otp_codes WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
-- DELETE FROM sessions  WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
