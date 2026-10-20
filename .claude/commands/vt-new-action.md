Guide for adding a new action type to VoteText's `activity_log` table.

The `activity_log.action` column has a CHECK constraint, so a new action is a schema change. `schema.sql` is the only place the list lives — `scripts/migrate.js` reads `schema.sql` and rebuilds any table whose definition differs, so there is no second list to keep in sync.

## Before you start
`schema.sql` must not be changed without the owner's approval (see CLAUDE.md). Ask first, naming the action(s) and the mutation(s) they log.

## Touch-points, in order

### 1. schema.sql
Add the action string to the CHECK list in the `activity_log` table definition.

### 2. Route handler
Call `logActivity(userId, documentId, variantId, 'your_new_action', { ...metadata })` inside the same `transaction()` as the mutation it records. Only log when something actually changed (check `r.changes` for deletes/updates that may be no-ops).

Metadata is returned by the activity feeds. Do not put text or email addresses in it unless they should be readable; if supervisors may read them but participants may not, add the key to `redactActivity()` in `src/middleware/access.js`.

### 3. Frontend icon
Add an entry to the `icons` object in `viewActivity` (`public/app.js`). It is one line — keep `app.js` under 2000 lines.

### 4. Tests
- In `tests/api.test.js`: perform the mutation, then assert a row with the action (and the expected metadata) exists in `activity_log`.
- `npm test` also runs `tests/migrate.test.js`, which upgrades databases built from the historical schemas in `tests/fixtures/` and inserts every action from the CHECK list. It needs no edit — it fails if an old database cannot take the new action after migration.

### 5. Verify
```bash
npm test
grep -n "your_new_action" schema.sql src/routes/*.js public/app.js tests/api.test.js
```

### 6. Docs
Run `/vt-docs`. The action list appears in README.md (schema section) and ARCHITECTURE.md.

## How it reaches production
`./scripts/deploy.sh` backs up the database, then runs `scripts/migrate.js`, which rebuilds `activity_log` with the new CHECK inside one transaction and copies every row by column name. If anything fails, nothing is changed and the deploy restores the previous version.

## Common mistakes
- Logging outside the transaction — a failed mutation leaves a log row, or the reverse.
- Logging a no-op (e.g. deleting a row that was not there).
- Adding a fixture: do NOT edit files in `tests/fixtures/` — they are historical snapshots. Add a new dated snapshot only when a release has been deployed with that schema.
