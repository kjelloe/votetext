# VoteText — Build Prompt for Claude

> **Instructions**: Use this prompt with Claude (local or API) to build the complete VoteText application from the foundation files in this repository. Claude should read all referenced files before starting implementation.

---

## Context

You are building **VoteText**, a collaborative text voting platform. The foundation layer (database schema, package.json, environment config) is already in place. Your job is to implement the complete working application: backend API, frontend UI, and all supporting scripts.

### Read These Files First

Before writing any code, read and internalize these existing files:

1. **`schema.sql`** — Complete SQLite database schema (11 tables, all indexes and constraints)
2. **`package.json`** — Dependencies and npm scripts
3. **`.env.example`** — All environment variables with documentation
4. **`README.md`** — Full architecture docs, API endpoint specifications, directory structure

---

## What to Build

### Project Structure

```
votetext/
├── schema.sql              ← EXISTS — do not modify
├── package.json            ← EXISTS — do not modify (add deps only if essential)
├── .env.example            ← EXISTS — do not modify
├── .gitignore              ← EXISTS
├── README.md               ← EXISTS
├── data/                   ← Created at runtime (gitignored)
├── scripts/
│   ├── init-db.js          ← CREATE: reads schema.sql, creates data/votetext.db
│   └── seed.js             ← CREATE: optional dev seed data
├── src/
│   ├── server.js           ← CREATE: Express app entry point
│   ├── db.js               ← CREATE: better-sqlite3 connection + helper functions
│   ├── middleware/
│   │   ├── auth.js         ← CREATE: session validation, requireAuth, optionalAuth
│   │   ├── access.js       ← CREATE: document-level access control checks
│   │   └── errors.js       ← CREATE: centralized error handling
│   └── routes/
│       ├── auth.js         ← CREATE: POST /api/auth/request-otp, verify-otp, logout, GET me
│       ├── documents.js    ← CREATE: full document CRUD + text import + status changes
│       ├── variants.js     ← CREATE: variant proposals + relations
│       ├── votes.js        ← CREATE: cast/change/retract votes
│       ├── comments.js     ← CREATE: two-level threaded comments
│       ├── activity.js     ← CREATE: user + document activity feeds
│       └── access.js       ← CREATE: invitation + access level management
└── public/
    ├── index.html          ← CREATE: single-page application shell
    ├── app.js              ← CREATE: client-side logic (vanilla JS)
    └── style.css           ← CREATE: all styles
```

---

## Backend Implementation

### 1. `scripts/init-db.js`

```javascript
// - Read schema.sql from project root
// - Ensure data/ directory exists
// - Create SQLite database at DATABASE_PATH (from .env or default)
// - Execute schema.sql using db.exec()
// - Print success message with table count
```

### 2. `src/db.js` — Database Layer

```javascript
// - Load .env with dotenv
// - Create better-sqlite3 connection to DATABASE_PATH
// - Enable WAL mode, foreign keys, busy timeout (as in schema.sql PRAGMAs)
// - Export the db instance
// - Export helper functions:
//   db.getOne(sql, params)    — db.prepare(sql).get(...params)
//   db.getAll(sql, params)    — db.prepare(sql).all(...params)
//   db.run(sql, params)       — db.prepare(sql).run(...params)
//   db.transaction(fn)        — wrap in db.transaction()
```

### 3. `src/server.js` — Express App

```javascript
// - Load dotenv
// - Create Express app
// - Middleware stack (in order):
//   1. cors() with CORS_ORIGINS from env
//   2. express.json({ limit: '2mb' })
//   3. express.static('public')
//   4. cookieParser()
//   5. optionalAuth (attach req.user if valid session cookie exists)
// - Mount route modules:
//   /api/auth      → routes/auth.js
//   /api/documents → routes/documents.js
//   /api/variants  → routes/variants.js
//   /api/comments  → routes/comments.js
//   /api/activity  → routes/activity.js
// - Catch-all: serve index.html for SPA routing
// - Error handler middleware (last)
// - Listen on PORT
```

### 4. `src/middleware/auth.js`

```javascript
// optionalAuth(req, res, next):
//   - Read session_id from cookie
//   - If present, look up in sessions table (check not expired)
//   - If valid, attach req.user (join with users table)
//   - Always call next() (even if no session — for public routes)

// requireAuth(req, res, next):
//   - If req.user is set, call next()
//   - Otherwise, return 401 JSON error

// requireRole(...roles):
//   - Returns middleware that checks req.user.role is in roles list
```

### 5. `src/middleware/access.js`

```javascript
// requireDocumentAccess(minLevel):
//   - Returns middleware that:
//     1. Reads :id or :documentId param
//     2. Checks user_document_access for req.user
//     3. Document owner always has full access
//     4. Compares access_level against minLevel hierarchy:
//        viewer < commenter < proposer < voter < editor < admin
//     5. Checks blocked flag
//     6. Returns 403 if insufficient access
```

### 6. Route Implementations

Follow the API endpoints specified in `README.md`. Key implementation details:

#### `routes/auth.js`
- **POST /request-otp**: Generate 6-digit code, store in otp_codes, send via Nodemailer. Rate-limit: max 5 OTPs per email per 15 min.
- **POST /verify-otp**: Check code + expiry, mark as used, create/find user, create session, set httpOnly cookie.
- **POST /logout**: Delete session from DB, clear cookie.
- **GET /me**: Return current user from req.user.

#### `routes/documents.js`
- **POST /**: Accept text body or file upload. Parse into pages/lines, compute char offsets. Insert into documents + document_lines. Owner gets automatic 'admin' access.
- **GET /:id**: Return document metadata + settings. Respect access control.
- **GET /:id/lines**: Paginated line retrieval (query param `page`).
- **PATCH /:id**: Update title, description, settings. Owner/admin only.
- **POST /:id/status**: Transition document status with validation (only valid transitions).
- **DELETE /:id**: Soft-delete or hard-delete. Owner only.

**Text Import Logic** (critical):
```
Input: raw text string + optional config { linesPerPage: 30 }
1. Split text by newlines
2. Group into pages of N lines
3. For each line, compute:
   - char_offset_start = running character count
   - char_offset_end = char_offset_start + line.length
4. Insert all lines into document_lines
5. Update documents.total_pages, total_lines, total_chars
```

#### `routes/variants.js`
- **POST /documents/:id/variants**: Validate char_start/char_end against document length. Check for overlapping variants and auto-create 'overlaps' relations.
- **GET /documents/:id/variants**: Return all variants with vote tallies, grouped by status. Include proposer display_name.
- **PATCH /variants/:id**: Only the proposer can edit, only while status is 'pending'.
- **DELETE /variants/:id**: Set status to 'withdrawn'.
- **POST /variants/:id/relations**: Add a relation (created_by = current user). Validate both variants belong to same document.

#### `routes/votes.js`
- **POST /variants/:id/vote**: Upsert vote. Update denormalized tallies on variants table. Reject if document status is 'resolved' or 'archived'.
- **DELETE /variants/:id/vote**: Remove vote, update tallies.
- **GET /variants/:id/votes**: Return vote list with user display names (for transparency).

#### `routes/comments.js`
- **POST /variants/:id/comments**: Create comment. If parent_comment_id is set, validate it exists and belongs to same variant. Enforce two-level max at app layer.
- **GET /variants/:id/comments**: Return threaded comments (top-level with nested replies).
- **PATCH /comments/:id**: Author can edit within time window.
- **DELETE /comments/:id**: Author or document admin can delete.

#### `routes/activity.js`
- **GET /activity**: Return activity_log entries for current user, ordered by created_at DESC, paginated.
- **GET /documents/:id/activity**: Return activity_log for a specific document.
- Activity entries are created in other routes via a shared helper: `logActivity(userId, documentId, variantId, action, metadata)`.

#### `routes/access.js`
- **POST /documents/:id/access**: Invite user by email. If user doesn't exist, create a stub user record. Set access_level.
- **PATCH /documents/:id/access/:userId**: Update access level or blocked status.
- **DELETE /documents/:id/access/:userId**: Remove access.
- **GET /documents/:id/access**: List all users with access to the document.

---

## Frontend Implementation

### Philosophy

The frontend is a **single HTML page** (`public/index.html`) with vanilla JavaScript (`public/app.js`). No framework, no build step.

- Use **hash-based routing** (`#/documents`, `#/documents/5`, `#/documents/5/variants/12`)
- All API calls go through a central `api()` helper function
- Render views by swapping innerHTML of a main container
- Progressive enhancement: basic content readable without JS where possible

### `public/index.html`

```html
<!-- Minimal shell -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VoteText</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <header id="app-header">
        <!-- Logo, nav, user info/login button -->
    </header>
    <main id="app-main">
        <!-- Views rendered here by app.js -->
    </main>
    <footer>
        <!-- Minimal footer -->
    </footer>
    <script src="/app.js"></script>
</body>
</html>
```

### `public/app.js` — Client Architecture

```javascript
// === Core ===
// api(method, path, body) — fetch wrapper with error handling, cookie auth
// router — hash-based: listen to hashchange, map patterns to view functions
// render(html) — set app-main innerHTML
// escapeHtml(str) — XSS prevention

// === Views ===
// viewLogin()        — email input → request OTP → code input → verify
// viewDocumentList() — list user's documents + create new
// viewDocument(id)   — document text with line numbers, sidebar with variants
// viewVariant(id)    — variant detail: diff view, vote buttons, comment thread
// viewActivity()     — user's recent activity feed
// viewProfile()      — display name, organization, email

// === Components (render helpers) ===
// renderDocumentText(lines, variants) — show text with variant highlights
// renderVariantCard(variant)          — compact variant summary with vote counts
// renderVoteButtons(variant)          — for/against/abstain + current user's vote
// renderCommentThread(comments)       — nested comments with reply form
// renderDiffView(original, variant)   — side-by-side or inline diff of the change
// renderPagination(currentPage, totalPages)

// === State ===
// Keep minimal client state:
//   - currentUser (from GET /api/auth/me on load)
//   - currentDocument (loaded per view)
//   - Polling timer for activity updates
```

### UI/UX Details

#### Document View
- Left panel: document text with line numbers (monospace font)
- Lines targeted by variants are highlighted (different colors for different variant statuses)
- Clicking a highlighted range opens the variant detail
- Right sidebar: list of variants for the current page, sortable by votes/date/status

#### Variant Detail
- Show the original text range
- Show the proposed change as a diff (deletions in red, insertions in green)
- Vote buttons: 👍 For / 👎 Against / 🤷 Abstain (show current counts)
- Comment thread below
- Relations section: links to related variants

#### Login Flow
1. User enters email → clicks "Send Code"
2. Backend sends OTP via email
3. User enters 6-digit code → clicks "Verify"
4. On success, redirect to document list

#### Responsive Design
- Mobile: single column, variant sidebar becomes bottom sheet
- Desktop: side-by-side document + variants panel
- Use CSS Grid/Flexbox, no media query library needed

### `public/style.css`

```css
/* Design tokens */
:root {
    --color-primary: #2563eb;
    --color-success: #16a34a;
    --color-danger: #dc2626;
    --color-warning: #d97706;
    --color-bg: #ffffff;
    --color-bg-secondary: #f8fafc;
    --color-text: #1e293b;
    --color-text-muted: #64748b;
    --color-border: #e2e8f0;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --radius: 6px;
}

/* Use system font stack, clean typography, generous whitespace */
/* Line numbers: fixed-width gutter, right-aligned */
/* Variant highlights: semi-transparent background colors */
/* Vote buttons: pill-shaped, color-coded */
/* Comments: indented replies, subtle thread lines */
/* Mobile-first responsive breakpoints */
```

---

## Coding Patterns & Conventions

### Backend
- **Synchronous SQLite**: better-sqlite3 is synchronous — no async/await needed for DB calls. This is intentional and faster for single-server SQLite.
- **Error handling**: Throw errors with `{ status, message }` shape. Catch in error middleware.
- **Input validation**: Validate at the route handler level. No ORM — write raw SQL.
- **Activity logging**: After every mutation (create variant, cast vote, etc.), call `logActivity()`.
- **Transaction wrapping**: Use `db.transaction()` for multi-statement mutations (e.g., inserting a variant + creating overlap relations).

### Frontend
- **No `innerHTML` with user data** — always escape HTML or use `textContent`.
- **Minimal state** — fetch fresh data on each view render. Only cache `currentUser`.
- **Event delegation** — attach listeners to container elements, not individual items.
- **Template literals** — use tagged templates for HTML generation with auto-escaping.

### General
- **No TypeScript** — plain JavaScript, JSDoc comments for documentation.
- **No ORM** — raw SQL queries (better-sqlite3 prepared statements).
- **No build step** — files served as-is from `public/`.
- **Descriptive variable names** — avoid abbreviations except well-known ones (id, db, req, res).
- **Early returns** — prefer guard clauses over nested conditionals.
- **HTTP status codes** — 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error.

---

## Implementation Order

Build in this sequence, testing each step before moving on:

1. **`scripts/init-db.js`** — Verify schema creates cleanly
2. **`src/db.js`** — Database connection layer
3. **`src/server.js`** — Minimal Express app that serves static files
4. **`src/middleware/errors.js`** — Error handling
5. **`src/routes/auth.js`** + `src/middleware/auth.js` — Full OTP login flow
6. **`public/index.html`** + `public/style.css`** — App shell with login view
7. **`public/app.js`** — Router + API helper + login view
8. **`src/routes/documents.js`** — Document CRUD + text import
9. **Frontend: document list and document view**
10. **`src/routes/variants.js`** — Variant proposals
11. **Frontend: variant creation and display**
12. **`src/routes/votes.js`** — Voting
13. **Frontend: vote buttons and tallies**
14. **`src/routes/comments.js`** — Comment threads
15. **Frontend: comment thread UI**
16. **`src/middleware/access.js`** + `src/routes/access.js` — Access control
17. **`src/routes/activity.js`** — Activity feeds
18. **Frontend: activity feed view**
19. **Polish: responsive design, error states, loading states**
20. **`scripts/seed.js`** — Development seed data

---

## Testing Checklist

After building, verify these scenarios work:

- [ ] `npm run init-db` creates the database with all tables
- [ ] `npm run dev` starts the server on port 3000
- [ ] Visiting `http://localhost:3000` shows the app
- [ ] Request OTP → email sent (check Ethereal or SMTP logs)
- [ ] Verify OTP → session created, cookie set, redirected to document list
- [ ] Create document from pasted text → pages and lines created correctly
- [ ] View document with line numbers → correct pagination
- [ ] Create variant (insert, replace, delete) → char offsets validated
- [ ] Vote for/against/abstain → tallies update correctly
- [ ] Change vote → old vote replaced, tallies recalculated
- [ ] Add comment → shows under variant
- [ ] Reply to comment → nested correctly (max 2 levels)
- [ ] Activity feed → shows recent actions
- [ ] Logout → session destroyed, cookie cleared
- [ ] Access control: invited user with 'viewer' role cannot propose variants
- [ ] Document status transition: draft → open → voting → resolved
- [ ] Mobile layout works (test at 375px width)

---

## Important Notes

- The SQLite schema is **final** — do not modify `schema.sql`. If you need additional columns, discuss first.
- Keep the frontend **under 2000 lines of JavaScript** total. If it grows beyond that, you're overcomplicating it.
- The app should work **without JavaScript** for basic document reading (server-rendered HTML fallback is a nice-to-have, but not required for v1).
- All dates are stored and transmitted in **ISO-8601 UTC** format.
- Use **prepared statements** for all SQL queries — never concatenate user input into SQL strings.
- The `data/` directory should be created automatically by `init-db.js` if it doesn't exist.
