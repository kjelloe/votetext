Run a quick health check on the VoteText project and report the results. Execute all checks and summarise findings.

## Checks to run

**1. Line count limits**
```bash
wc -l public/app.js public/review.js public/auth.js
```
- `public/app.js` must stay under 2000 lines. Report as OK / WARNING (>1900) / OVER LIMIT
- `public/review.js` has no hard limit but flag if it exceeds 1700 lines (1484 on 2026-10-23 after the creator/editor modals moved in); `public/selection.js` (Phase M) should stay under 600

**2. Test counts**
```bash
grep -c "^test(" tests/api.test.js tests/unit.test.js tests/frontend.test.js tests/migrate.test.js
grep -c "^test(" tests/e2e/*.spec.js | awk -F: '{s+=$2} END {print "e2e:", s}'
```
Report each. Cross-check against the counts in `plan-update.md`, `README.md` (Roadmap), `specs/test-plan.md` and memory/project-votetext.md and flag any that differ. Do not trust a number written in this file.

**3. Tests passing**
```bash
npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
npm run test:e2e 2>&1 | tail -3
```
Report pass / fail counts. If any fail, show the failing test names. The e2e run needs Firefox (`npx playwright install firefox`); say so if it cannot start rather than skipping silently.

**4. Schema and migration**
`scripts/migrate.js` derives everything from `schema.sql`, so there is no column list to compare. Check instead:
- `tests/migrate.test.js` passes (it is part of `npm test`).
- Every action passed to `logActivity` in `src/` is in the `activity_log` CHECK list:
```bash
grep -rhoE "logActivity\([^;]*" src | grep -oE "'[a-z_]+'" | sort -u
```
- `git diff --stat schema.sql` — an uncommitted schema change must have the owner's approval.
- Every route that stores free text runs it through `checkText()` from `src/lib/limits.js`; grep `run('INSERT INTO (documents|variants|comments)` and `UPDATE users SET display_name` in `src/routes/` and confirm a `checkText` call precedes each. `POST /documents` and `copy-data` carry `requireRole('creator', 'superadmin')`.

**5. Environment variables**
Every `process.env.X` read in `src/` should be in `.env.example` and in the README configuration table, and nothing in `.env.example` should be unread:
```bash
grep -rhoE "process\.env\.[A-Z_]+" src | sort -u
grep -oE "^[A-Z_]+" .env.example | sort -u
```

**6. Router coverage**
List all hash routes in `public/app.js` and confirm each has a view function (the frontend contract test covers this; report its result).

**7. Repo hygiene**
```bash
git status --short
git ls-files playwright-report tests/e2e/.auth test-results
```
Flag tracked test artifacts and leftover `data/*.db-wal` / `-shm` files from test runs.

**8. Deploy tooling**
```bash
bash -n scripts/deploy.sh && echo ok
ls deploy.env .env.example 2>&1
```
`deploy.env` must exist locally (gitignored) and `.env.example` must be tracked. `npm test` already runs the deploy contract tests; run `npm run test:deploy` after any change to `scripts/deploy.sh` (it needs network and takes about a minute). Never run `scripts/deploy.sh` or `--check` for real from this skill.

**9. Dependencies**
```bash
npm audit --omit=dev 2>&1 | tail -5
npm outdated 2>&1 | head
```
Report vulnerabilities in production dependencies. Do not run `npm audit fix` or change `package.json` — the owner decides on upgrades (CLAUDE.md).

**10. Open work**
Read the "Remaining work packages" section of `plan-update.md` and report the next unstarted phase in one line.

## Output format
Report each check as a one-line status: ✓ OK, ⚠ WARNING, or ✗ FAIL with a brief explanation. End with an overall summary line.
