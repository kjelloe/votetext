# VoteText — Architecture

## Overview

VoteText is a self-hosted collaborative document-voting platform. Users upload text documents, propose targeted changes (variants), vote on proposals, and discuss them in threaded comments. The goal is transparent, auditable text decision-making.

```
Browser (Vanilla JS SPA)
        │  HTTP + cookie session
        ▼
Express HTTP server  ──  static files (public/)
        │
        ├── /api/auth       OTP login, session management
        ├── /api/documents  document CRUD + line parsing
        ├── /api/variants   variant proposals + relations
        ├── /api/comments   comment CRUD
        └── /api/activity   event feed
        │
        ▼
better-sqlite3 (synchronous)
        │
        ▼
data/votetext.db  (single SQLite file, WAL mode)
```

---

## Technology Choices

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 18+ | LTS, native fetch, `node:test` built in |
| HTTP | Express 4 | Minimal, well-understood, enough middleware |
| Database | SQLite via `better-sqlite3` | Zero-config, single file, synchronous API = simpler code |
| Auth | Passwordless email OTP | No password storage, Resend SDK covers email delivery |
| Frontend | Vanilla JS + HTML + CSS | No build step, no framework churn, < 2000 lines total |
| Deployment target | Single Linux VPS | Single-process, SQLite handles thousands of concurrent readers in WAL mode |

---

## Directory Structure

```
votetext/
├── schema.sql              — canonical DB schema (do not modify)
├── package.json
├── .env                    — secrets (gitignored)
├── data/
│   └── votetext.db         — SQLite database (gitignored)
├── scripts/
│   ├── init-db.js          — creates DB from schema.sql
│   ├── migrate.js          — ALTER TABLE migrations for existing databases
│   └── seed.js             — seeds sample data for development
├── src/
│   ├── server.js           — Express app; only calls listen() when run directly
│   ├── db.js               — single better-sqlite3 connection + query helpers
│   ├── middleware/
│   │   ├── auth.js         — optionalAuth / requireAuth / requireRole
│   │   ├── access.js       — requireDocumentAccess(minLevel)
│   │   └── errors.js       — centralized JSON error handler
│   └── routes/
│       ├── auth.js         — OTP request/verify, logout, profile
│       ├── documents.js    — document CRUD, text import, variant/access sub-routes
│       ├── variants.js     — variant CRUD, relations, voting, comments
│       ├── comments.js     — comment edit/delete (standalone path /api/comments/:id)
│       └── activity.js     — user activity feed
├── public/
│   ├── index.html          — SPA shell
│   ├── app.js              — client router + all views (< 1100 lines)
│   └── style.css           — design tokens + all component styles
├── specs/
│   └── test-plan.md        — human-readable test scenarios
└── tests/
    └── api.test.js         — integration tests (node:test, no extra deps)
```

---

## Database Schema

12 tables in a single SQLite file. Key relationships:

```
users ──────────────┬── sessions
       │             └── otp_codes
       │
       ├── documents ──── document_lines
       │       │
       │       └── variants ──── variant_relations
       │               │
       │               ├── votes
       │               └── comments ── comments (self-ref, max 1 level)
       │
       └── user_document_access (per-user, per-document ACL)

activity_log ── references users, documents, variants
```

### Key design decisions

**Character offsets** — Variants target `[char_start, char_end)` in the original document text, independent of line/page structure. This allows precise diffs even if line boundaries change.

**Denormalized vote tallies** — `variants.votes_for/against/abstain` are updated atomically alongside the `votes` table insert/update inside a transaction. This gives O(1) tally reads.

**JSON settings blob** — `documents.settings` stores configurable options (`allow_anonymous_view`, `lines_per_page`, `resolution_mode`, etc.) without schema migrations.

**Soft delete** — `documents.deleted_at TEXT` (NULL = active). All queries filter `AND deleted_at IS NULL`. Existing DBs need `npm run migrate` to add the column.

**WAL mode** — All reads happen concurrently; writes are serialised by SQLite. Busy timeout is 5 s.

---

## Authentication Flow

```
Client                          Server                       DB
  │                               │                           │
  │── POST /api/auth/request-otp ─▶                           │
  │          { email }            │── INSERT otp_codes ───────▶
  │                               │── sendMail(OTP code)      │
  │◀─── 200 { message: 'Code sent' }                          │
  │                               │                           │
  │── POST /api/auth/verify-otp ──▶                           │
  │      { email, code }          │── SELECT otp_codes ───────▶
  │                               │◀─── row (if valid) ───────│
  │                               │── UPDATE otp used = 1     │
  │                               │── UPSERT users            │
  │                               │── INSERT sessions         │
  │◀── 200 { user } + Set-Cookie: session_id=<hex> ────────────
  │                               │                           │
  │── (subsequent requests) ──────▶                           │
  │   Cookie: session_id=<hex>    │── optionalAuth middleware  │
  │                               │   joins sessions + users  │
  │                               │   attaches req.user       │
```

Session tokens are 32-byte random hex strings stored as plain values in the `sessions` table. HttpOnly + SameSite=Lax cookies. Secure flag is set when `NODE_ENV=production`.

OTP codes are rate-limited at 5 per email per 15 minutes using an in-memory Map (resets on server restart, acceptable for this scale). In production, OTP expiry is 10 minutes.

---

## Access Control

### Document access levels (ordered, lowest to highest)

```
viewer < commenter < proposer < voter < editor < admin
```

Each level includes all permissions of lower levels:
- **viewer** — read document, lines, variants, votes, comments
- **commenter** — viewer + post comments
- **proposer** — commenter + propose variants
- **voter** — proposer + cast/change votes
- **editor** — voter + edit document metadata
- **admin** — full control (co-owner), manage access list

### Decision rules (in `src/middleware/access.js`)

1. Document owner always resolves to `admin`
2. Anonymous users can access at `viewer` level if `settings.allow_anonymous_view = true`
3. Blocked users receive 403 regardless of their access level
4. Users with no explicit access record receive 403

### Global roles

`users.role` controls platform-wide permissions: `user`, `admin`, `superadmin`. Currently only `superadmin` can delete other users' documents or withdraw others' variants.

---

## API Design

All endpoints return JSON. Error responses use `{ "error": "<message>" }`.

Routes are grouped by resource and mounted in `server.js`:

```
/api/auth/*        → src/routes/auth.js
/api/documents/*   → src/routes/documents.js
                       (includes /variants, /access, /activity sub-routes)
/api/variants/*    → src/routes/variants.js
                       (includes /vote, /votes, /comments, /relations)
/api/comments/*    → src/routes/comments.js   (edit/delete only)
/api/activity      → src/routes/activity.js
```

All write endpoints (except logout) require a valid session cookie. Read endpoints on documents with `allow_anonymous_view = true` permit unauthenticated access.

### HTTP status codes used

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 204 | No Content (DELETE success) |
| 400 | Bad Request (invalid input) |
| 401 | Unauthenticated (no session cookie on a `requireAuth` endpoint) |
| 403 | Forbidden — wrong role/access level, or unauthenticated access to a private document |
| 404 | Not Found |
| 409 | Conflict (duplicate, e.g., unique constraint) |
| 422 | Unprocessable (business rule violation, e.g., invalid status transition) |
| 429 | Too Many Requests (rate limit) |
| 500 | Internal Server Error |

---

## Text Import

When a document is created, the raw text body is split into lines and inserted into `document_lines`:

```
Input: raw text string
       settings.lines_per_page (default: 30, range: 27–40)

For each line i (0-indexed):
    page_num          = floor(i / linesPerPage) + 1
    line_num          = i + 1
    char_offset_start = running byte counter
    char_offset_end   = char_offset_start + line.length
    advance counter   = char_offset_end + 1   (for the \n separator)

total_chars = text.length   (raw byte count)
total_lines = lines.length
total_pages = ceil(total_lines / linesPerPage)
```

The entire import runs inside a single `db.transaction()` call alongside the `documents` INSERT and the owner's access record.

---

## Variant Overlap Detection

When a variant is proposed, overlapping variants in the same document are automatically detected and linked with an `overlaps` relation:

```sql
SELECT id FROM variants
WHERE document_id = ?
  AND id != <new_variant_id>
  AND status != 'withdrawn'
  AND char_start < <new_char_end>
  AND char_end   > <new_char_start>
```

This uses the index `idx_variants_range`.

---

## Frontend Architecture

Single HTML page (`public/index.html`) with hash-based routing:

```
#/login            → viewLogin()
#/documents        → viewDocumentList()
#/documents/:id    → viewDocument(id)
#/variants/:id     → viewVariant(id)
#/activity         → viewActivity()
#/profile          → viewProfile()
```

### Key patterns

- **`api(method, path, body)`** — central fetch wrapper; always sends/receives JSON, attaches credentials
- **`esc(str)`** — HTML-escapes all user-supplied values before inserting into innerHTML
- **`el(tag, attrs, ...children)`** — creates DOM nodes programmatically for dynamic content
- **Event delegation** — one listener on a container, not per-item
- **Minimal client state** — only `state.user`, `state.docLines` (line cache per document), `state.docCache`. Fresh fetch on every view render

### XSS prevention

All interpolated user values go through `esc()` before entering any innerHTML string. Trusted static HTML (from template literals with only escaped values) is safe. DOM node creation via `el()` never touches innerHTML.

---

## Deployment

Designed for a single Hetzner cx23 (2 vCPU, 4 GB RAM, €4.51/month).

```
systemd → node src/server.js
nginx   → reverse proxy to 127.0.0.1:3000
certbot → TLS via Let's Encrypt
```

SQLite backups via `sqlite3 data/votetext.db ".backup /backup/votetext-$(date +%F).db"` — safe with WAL mode active.

Email is sent via the **Resend SDK** (`resend` npm package, CJS-compatible — loaded with `require('resend')`). Configure `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME` in `.env`. Domain `kjell.solutions` is verified in Resend (eu-west-1). In non-production mode, email failures are non-fatal — the OTP is logged to the console.

---

## Testing

```bash
npm test          # integration tests (node:test, isolated test DB on port 3099)
npm run init-db   # (re)create database from schema
npm run seed      # seed dev data + print session cookie for browser login
```

Tests use Node's built-in `node:test` runner — no additional test framework. They spin up the Express server programmatically on port 3099 against an ephemeral `data/test_votetext.db` that is deleted after each run. OTPs are read directly from the test database to avoid SMTP dependency.
