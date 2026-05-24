# VoteText — Claude Instructions

## What this project is

A self-hosted collaborative text-voting platform. Users upload documents, propose targeted text changes (variants), vote on them, and discuss them. Stack: Node.js + Express + SQLite + Vanilla JS SPA.

Read `ARCHITECTURE.md` for the full picture. The rest of this file is operational guidance.

---

## Commands

```bash
npm run init-db   # initialise data/votetext.db from schema.sql (run once)
npm run migrate   # add new columns to an existing database (idempotent)
npm run seed      # seed sample users + document (prints browser session cookie)
npm run dev       # start with nodemon auto-reload → http://localhost:3000
npm start         # production start
npm test          # integration tests (isolated DB, no email needed)
npm run clean-db  # drop and reinitialise the database
```

---

## Immovable constraints

- **Do not modify `schema.sql`** — it is the authoritative schema. If columns are needed, ask first.
- **Do not modify `package.json` dependencies** without a clear reason — the stack is intentionally minimal.
- **Keep `public/app.js` under 2000 lines** — prefer removing complexity over adding abstraction.
- **No TypeScript, no ORM, no build step** — plain JS, raw SQL with prepared statements.
- **No `innerHTML` with user-supplied data** — always pass through `esc()` first.

---

## Architecture summary

```
src/server.js       — Express entry point (does NOT call listen() when imported)
src/db.js           — single better-sqlite3 instance; getOne/getAll/run/transaction/logActivity
src/middleware/
    auth.js         — optionalAuth (attaches req.user), requireAuth, requireRole
    access.js       — requireDocumentAccess(minLevel) checks user_document_access table
    errors.js       — catch-all JSON error handler
src/routes/
    auth.js         — OTP flow: request → verify → session cookie; profile update
    documents.js    — CRUD + text import + nested /variants /access /activity routes
    variants.js     — variant CRUD + relations + /comments + /vote /votes
    comments.js     — PATCH/DELETE /api/comments/:id only
    activity.js     — GET /api/activity (user feed)
public/
    app.js          — hash router (#/documents, #/variants/:id, …); all views; esc() for XSS
    style.css       — CSS custom properties (--color-*, --font-*); mobile-first
```

---

## Coding patterns to follow

### Backend

```javascript
// DB calls are synchronous — no async/await needed in route handlers for DB ops
const doc = getOne('SELECT * FROM documents WHERE id = ?', [req.params.id]);

// Always wrap multi-step mutations in a transaction
const newId = transaction(() => {
    const r = run('INSERT INTO documents ...', [...]);
    run('INSERT INTO user_document_access ...', [...]);
    logActivity(userId, r.lastInsertRowid, null, 'document_created', {});
    return r.lastInsertRowid;
});

// Log every significant mutation
logActivity(userId, documentId, variantId, 'variant_proposed', { title });

// Throw structured errors for the error handler to catch
const err = new Error('Not found'); err.status = 404; throw err;
// — or just — 
return res.status(404).json({ error: 'Not found' });
```

### Frontend

```javascript
// Escape ALL user-supplied data before inserting into HTML
container.innerHTML = `<p>${esc(user.display_name)}</p>`;

// Use el() for dynamic DOM when escaping is complex
const p = el('p', { class: 'text-muted' }, user.display_name); // textContent, safe

// Central API helper — always use it, never fetch() directly
const data = await api('GET', '/documents/1');
const data = await api('POST', '/documents', { title, text });

// Navigate via hash; never manipulate history directly
location.hash = '#/documents/5';
```

---

## Access control hierarchy

```
viewer < commenter < proposer < voter < editor < admin
```

Owner of a document always has `admin`. Check `requireDocumentAccess('proposer')` etc. as route middleware.

Variant sub-routes (`/vote`, `/comments`, `/relations`) cannot use the middleware directly because the document ID is derived from the variant, not the URL. They use `checkDocAccess(doc, req, minLevel)` in `variants.js` instead — pass `'commenter'` for POST /comments, `'voter'` for POST /vote, omit `minLevel` for reads. `ACCESS_LEVELS` is imported from `middleware/access.js`.

---

## Activity logging

Call `logActivity` after **every** mutation. Valid actions are defined by the `CHECK` constraint on `activity_log.action` — see `schema.sql`. If you add a new action type, the schema constraint must be updated (discuss first).

---

## Testing

Tests live in `tests/api.test.js` and use `node:test` (no extra deps). Key conventions:

- **Never mock the database** — tests run against a real (ephemeral) SQLite file.
- OTPs are retrieved directly from the test DB (`db.prepare(...).get()`), so SMTP is not required.
- Tests are sequential and share state intentionally (session cookies, docId, variantId etc.) — this mirrors real user workflows.
- Set env vars at the top of the test file **before** requiring any project module, so `dotenv` does not override them.
- The test DB is deleted after every run; never rely on data from a previous run.

---

## Email

Uses the **Resend SDK** (`resend` npm package, CJS-compatible). Set `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME` in `.env`. Domain `kjell.solutions` is verified in Resend (eu-west-1).

`auth.js` loads it with a plain `require('resend')` at the top. The send call returns `{ data, error }` — check `error` explicitly rather than relying on a throw.

In `NODE_ENV !== 'production'`, email failures are non-fatal — the OTP is saved to the DB and logged to the console. Dev/test flows work without a live API key.

## Soft delete

Documents use soft delete: `DELETE /documents/:id` sets `deleted_at` instead of removing the row. All document lookups must include `AND deleted_at IS NULL`. The `scripts/migrate.js` script adds this column to existing databases.

---

## What to avoid

- Do not use `db.run()` with string concatenation — only prepared statements.
- Do not add route-level `try/catch` that swallows errors without calling `next(err)`.
- Do not add `console.log` for normal operation paths — use it for warnings/errors only.
- Do not add features not asked for (no extra columns, no new settings fields, no extra UI widgets).
- Do not add TypeScript types, JSDoc blocks, or inline comments explaining what code does.
