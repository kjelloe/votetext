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
3. Blocked users (explicit record with `blocked = 1`) receive 403 regardless of default access
4. Users with an explicit access record use that level; level must meet the route's `minLevel`
5. Users with **no** explicit record fall back to `settings.default_access` (if set and a valid level); if not set or insufficient, 403

`GET /api/documents/:id` has an equivalent inline check (it does not use `requireDocumentAccess`).

### Default access

`documents.settings.default_access` stores a per-document open-access level (`viewer` / `commenter` / `proposer` / `voter`; `editor` and `admin` cannot be defaults). When set, any authenticated non-blocked user without an explicit access record is granted that effective level. Document admins control this via the Manage Access modal (saved with `PATCH /api/documents/:id`).

### Invite cap

`POST /api/documents/:id/access` enforces that the assigned `access_level` index ≤ the inviter's own level index (`ACCESS_LEVELS` from `src/middleware/access.js`). Returns 403 with a descriptive message if exceeded.

### User searchability

`users.is_non_searchable` (user-controlled via `PATCH /api/auth/profile`) and `users.is_protected` (admin-controlled, no UI yet) exclude users from `GET /api/auth/search`. Both columns default to 0. Excluded users can still be invited by exact email.

### Invite email

When an invited email has no existing account, `POST /api/documents/:id/access` sends a fire-and-forget invitation email via Resend (same SDK as OTP). The email names the inviter, the document, the role, and the app URL (`VOTETEXT_URL` env var). Email failure does not roll back the access grant.

### Global roles

`users.role` controls platform-wide permissions: `user`, `admin`, `superadmin`. Currently only `superadmin` can delete other users' documents or withdraw others' variants.

---

## API Design

All endpoints return JSON. Error responses use `{ "error": "<message>" }`.

Routes are grouped by resource and mounted in `server.js`:

```
/api/auth/*        → src/routes/auth.js
                       (includes GET /search — user lookup, excludes non-searchable/protected)
/api/documents/*   → src/routes/documents.js
                       (includes GET /:id/text — full reconstructed text for copy/export)
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

### Client-side pre-processing (in `public/app.js` → `openCreateDocModal`)

Before the text is sent to the server, the browser detects the format and pre-processes the content:

| Detected format | Trigger | Action |
|----------------|---------|--------|
| **Paged markdown** | `---` lines present and ≥1 section has ≥5 numbered lines | Strip `---` separators, strip `*Page N*` / `*Page N - …*` headers, strip leading line-number prefixes, collapse excess blank lines; set `lines_per_page` to the line count of the first content page |
| **Pre-numbered** | ≥50% of non-empty lines match `/^\s*\d+\s/` | Optionally strip leading line-number prefixes (user toggle, default on) |
| **Plain text** | Neither above | No transformation |

The `lines_per_page` selector auto-populates with the detected value (added as a dynamic option if not already in the preset list). The user can override before submitting.

### Server-side import

When a document is created, the raw text body is split into lines and inserted into `document_lines`:

```
Input: raw text string
       settings.lines_per_page (default: 30, range: 27–60)

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

### Proposals sidebar

The sidebar always shows **all** variants for the document (not filtered by page). Cards are ordered by `char_start ASC, created_at ASC` so overlapping proposals appear adjacent, matching document reading order. Each card carries `data-char-start`, `data-char-end`, and `data-line-start` attributes. A `mouseover`/`mouseout` delegation listener on the list:

- **On-page variant** (char range overlaps `state.docLines[docId][currentPage]`): adds `.hover-highlight` to matching `.line-text` spans (blue outline + tint); removed on leave.
- **All variants on hover**: shows a `↗ p.N` goto-link in the card footer. Clicking calls `navigatePage(N, lineStart)` — if already on page N the API fetch is skipped and only the scroll is performed; otherwise the page is fetched, rendered, then scrolled via `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the target `.doc-line[data-line-num]`.
- **Overlapping variants on hover**: shows a `⊕ #N, #M` overlap indicator to the left of the goto-link. Overlaps are computed client-side with an O(n²) char-range intersection pass after variants load and stored in `overlapMap: { id → [{id, num}] }`. Clicking the indicator toggles `.overlap-highlight` (amber border + cream background) on all cards in the overlap group; clicking again or opening a different group clears it.

`GET /api/documents/:id/variants` enriches each row with:
- `proposer_org` (joined from `users`)
- `line_start` / `line_end` — correlated `MIN`/`MAX` subqueries on `document_lines` matching the variant's char range

Proposal numbers (`#1`, `#2` …) are assigned client-side in creation order (`id` ascending) and are stable regardless of document-position sort.

### Text selection → variant proposal

Each rendered line span (`<span class="line-text">`) carries `data-char-start` and `data-char-end` (absolute byte offsets from the DB). On `mouseup` in `#doc-lines-container`, `resolveSelectionOffset` maps the browser's `Selection` anchor/focus nodes to document offsets:

- Node inside `.line-text` → `data-char-start + in-span character offset`
- Node in the line-number gutter → clamped to the line's `data-char-start`

The resolved `{ char_start, char_end, text }` is stored in `pendingSelection` and passed to `openProposeModal`. The modal shows the raw selected text in a collapsible `<details>` panel and disables submit if no selection is present.

See `specs/use-cases.md` for full user-facing flows.

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

Email is sent via the **Resend SDK** (`resend` npm package, CJS-compatible — loaded with `require('resend')`). Configure `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME` in `.env`. Domain `kjell.solutions` is verified in Resend (eu-west-1).

Email behaviour by environment:

| `NODE_ENV` | OTP email | Invite email |
|------------|-----------|--------------|
| `production` | Sent; failure throws and returns 500 | Sent fire-and-forget; failure logged |
| `development` (default) | OTP logged via `console.debug` before send; send failure is non-fatal and logged | Invite details logged via `console.debug` before send; send failure logged |
| `test` | Send skipped entirely; OTP logged via `console.warn` | Send skipped entirely; logged via `console.warn` |

The `test` skip prevents real Resend API calls during `npm test`. Tests read OTPs directly from the database.

---

## Testing

```bash
npm test          # integration tests (node:test, isolated test DB on port 3099)
npm run init-db   # (re)create database from schema
npm run seed      # seed dev data + print session cookie for browser login
```

Tests use Node's built-in `node:test` runner — no additional test framework. They spin up the Express server programmatically on port 3099 against an ephemeral `data/test_votetext.db` that is deleted after each run. OTPs are read directly from the test database to avoid SMTP dependency.
