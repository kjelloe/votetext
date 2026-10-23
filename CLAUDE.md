# VoteText — Claude Instructions

## What this project is

A self-hosted collaborative text-voting platform. Users upload documents, propose targeted text changes (variants), vote on them, and discuss them. Stack: Node.js + Express + SQLite + Vanilla JS SPA.

Read `ARCHITECTURE.md` for the full picture. The rest of this file is operational guidance.

---

## Commands

```bash
npm run init-db   # initialise data/votetext.db from schema.sql (run once)
npm run migrate   # bring an existing database in line with schema.sql (idempotent, one transaction)
npm run seed      # seed sample users + document (prints browser session cookie)
npm run seed-demo # tutorial-video demo data (four personas, four documents)
npm run dev       # start with nodemon auto-reload → http://localhost:3000
npm start         # production start
npm test          # integration + unit + frontend-contract + migration + deploy-contract tests (isolated DBs, no email needed)
npm run test:e2e  # Playwright browser tests (Firefox, own server on port 3001)
npm run test:deploy # scripts/deploy.sh against a local stand-in server (never touches the real server)
npm run clean-db  # drop and reinitialise the database
./scripts/deploy.sh   # deploy the committed HEAD to production — only when the owner asks (settings in deploy.env)
./scripts/deploy.sh --check  # read-only hardening audit of the server — also only when asked (it connects to production)
```

Open work, decisions and their order live in `plan-update.md`.

---

## Immovable constraints

- **Do not modify `schema.sql`** — it is the authoritative schema. If columns are needed, ask first. Once approved, `schema.sql` is the only file to edit: `scripts/migrate.js` derives every change from it.
- **Do not modify `package.json` dependencies** without a clear reason — the stack is intentionally minimal.
- **Keep `public/app.js` under 2000 lines** — prefer removing complexity over adding abstraction.
- **No TypeScript, no ORM, no build step** — plain JS, raw SQL with prepared statements.
- **No `innerHTML` with user-supplied data** — always pass through `esc()` first.

---

## Architecture summary

```
src/server.js       — Express entry point (does NOT call listen() when imported)
src/db.js           — single better-sqlite3 instance; getOne/getAll/run/transaction/logActivity
src/lib/text.js     — pure helpers (applyVariantsToText, passesThreshold, decideOutcomes, escapeHtml, importText, importPagedText/exportPagedText for `lines_per_page: "auto"`); unit-tested; passesThreshold is mirrored in public/review.js and a contract test enforces sync
src/lib/mail.js     — sendMail(): the only place that talks to Resend (client created on first send)
src/middleware/
    auth.js         — optionalAuth (attaches req.user), requireAuth, requireRole
    access.js       — resolveAccessLevel/meetsLevel (the ONLY access decision — all checks delegate here) + requireDocumentAccess(minLevel)
    errors.js       — catch-all JSON error handler
src/routes/
    auth.js         — OTP flow: request → verify → session cookie; profile update
    documents.js    — CRUD + text import + nested /variants /access /activity routes
    variants.js     — variant CRUD + relations + /comments + /vote /votes
    comments.js     — PATCH/DELETE /api/comments/:id + moderation /hide /unhide
    activity.js     — GET /api/activity (user feed)
    users.js        — superadmin only: user list + is_protected toggle
public/
    app.js          — hash router (#/documents, #/variants/:id, …); all-role views; esc() for XSS
    auth.js         — viewLogin, showProfileModal, viewProfile (depends on app.js globals)
    review.js       — supervisor/editor/admin views: review, conflicts, final voting, resolved text, moderation, user admin, manage-access modal
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

// Every stored text goes through the caps in src/lib/limits.js; cooldowns through src/lib/cooldown.js
const bad = checkText(title, 'title'); if (bad) return res.status(400).json({ error: bad });
const wait = proposalCooldown(req.user.id); if (wait) return res.status(429).json(wait);

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

// Show a control only when the server would allow the action — mirror the route's minLevel
${hasLevel(doc, 'supervisor') ? '<button id="doc-status-btn">Change status</button>' : ''}

// openModal() gives each modal a fresh #modal-content node — attach listeners after opening,
// never to the overlay or document. Re-render the current view with runRoute(), not by calling it.
```

---

## Access control hierarchy

```
viewer < commenter < proposer < voter < supervisor < editor < admin
```

Site roles (`users.role`): `user` (default, takes part in documents it is invited to), `creator` (may also create documents and copy data — `requireRole('creator', 'superadmin')` on those two routes), `superadmin`. Granted via `PATCH /api/users/:id/role` or `scripts/grant-role.js`; tests grant `creator` to the owner account with a direct `UPDATE users` after login.

Owner of a document always has `admin`. Check `requireDocumentAccess('proposer')` etc. as route middleware. `supervisor` manages the voting process (review, conflicts, tallies, voting-cycle status transitions, new invites up to own level) and moderation (hide/unhide variants and comments — UC-18) but cannot edit the document, see drafts, or modify existing access records — see ARCHITECTURE.md § Access Control.

Variant sub-routes (`/vote`, `/comments`, `/relations`) cannot use the middleware directly because the document ID is derived from the variant, not the URL. They load the document with `getDoc(variant.document_id)` — never an inline `SELECT … FROM documents`, which is how the draft rule was once skipped — and use `checkDocAccess(doc, req, minLevel)` in `variants.js` instead — pass `'commenter'` for POST /comments, `'voter'` for POST /vote, omit `minLevel` for reads. It is a thin wrapper over `resolveAccessLevel`/`meetsLevel` from `middleware/access.js` — never write a new inline access check; delegate to those. Site `superadmin` resolves to document admin everywhere; drafts require an explicit editor+ record (`default_access` never applies).

---

## Activity logging

Call `logActivity` for **every** mutation, inside the same `transaction()` as the mutation, and only when something actually changed. Valid actions are defined by the `CHECK` constraint on `activity_log.action` — see `schema.sql`. If you add a new action type, the schema constraint must be updated (discuss first, then follow `/vt-new-action`).

Activity metadata is returned by the feeds. `redactActivity()` in `middleware/access.js` strips `previous_text` and `email` for readers below supervisor — add a key there if new metadata should not be readable by every participant.

---

## Resolving a document

Any transition to `resolved` goes through `resolveBlocker()` in `documents.js`: it refuses (422, nothing written) when two passing proposals overlap or a voteable proposal has no tally. Outcomes come from the pure `decideOutcomes()` in `src/lib/text.js`, which the final-voting preview also uses. Do not decide pass/fail anywhere else.

---

## Testing

`npm test` runs five files under `node:test` (no extra deps): `tests/api.test.js` (integration, groups A–AB — see `specs/test-plan.md`), `tests/unit.test.js` (pure helpers in `src/lib/text.js`), `tests/frontend.test.js` (cross-file contracts in `public/`) `tests/migrate.test.js` (upgrades databases built from the historical schemas in `tests/fixtures/` — never edit those) and `tests/deploy.test.js` (every `sudo` in `scripts/deploy.sh` must be allowed by the hardened sudoers; the cloud-init templates' embedded scripts must parse). Browser tests are in `tests/e2e/` (`npm run test:e2e`). Key conventions:

- **Never mock the database** — tests run against a real (ephemeral) SQLite file.
- OTPs are retrieved directly from the test DB (`db.prepare(...).get()`), so SMTP is not required.
- Tests are sequential and share state intentionally (session cookies, docId, variantId etc.) — this mirrors real user workflows.
- Set env vars at the top of the test file **before** requiring any project module, so `dotenv` does not override them.
- The test DB is deleted after every run; never rely on data from a previous run.

---

## Email

Uses the **Resend SDK** (`resend` npm package, CJS-compatible). Set `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, and `MAIL_FROM_NAME` in `.env`. Domain `kjell.solutions` is verified in Resend (eu-west-1).

All mail goes through `sendMail({ to, subject, text, html })` in `src/lib/mail.js` — never call the SDK from a route. The client is created on first send, so the app loads without a key; `sendMail` throws when the key is missing or Resend returns an error. Escape user-supplied values in HTML bodies with `escapeHtml()` from `src/lib/text.js`.

In `NODE_ENV !== 'production'`, email failures are non-fatal — the OTP is saved to the DB and logged to the console. Dev/test flows work without an API key. In production the server refuses to start without `RESEND_API_KEY`.

## Soft delete

Documents use soft delete: `DELETE /documents/:id` sets `deleted_at` instead of removing the row. All document lookups must include `AND deleted_at IS NULL`. 

---

## What to avoid

- Do not use `db.run()` with string concatenation — only prepared statements.
- Do not add route-level `try/catch` that swallows errors without calling `next(err)`.
- Do not add `console.log` for normal operation paths — use it for warnings/errors only.
- Do not add features not asked for (no extra columns, no new settings fields, no extra UI widgets).
- Do not add TypeScript types, JSDoc blocks, or inline comments explaining what code does.
