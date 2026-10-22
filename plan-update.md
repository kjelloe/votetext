# VoteText — Plan to Production

_Last updated: 2026-10-03 (phase 3 implemented)_

A full review on 2026-10-02 found access, correctness and security gaps, spec features
with no UI, and a tutorial script describing behaviour the app does not have. Phases 1,
2 and 3 are implemented and tested locally. **Nothing is committed or deployed**; the
production server is live and still runs the old code.

Test status: **329 node tests** green (273 API + 30 unit + 12 frontend contract +
8 migration + 6 deploy contract) and **65 Playwright e2e tests** green, run on the final state.

Effort labels are rough estimates: **S** under an hour, **M** about half a day,
**L** a day or more.

---

## Decisions (all made 2026-10-02)

| Topic | Decision |
|---|---|
| Deploy layout | In place under `/opt/votetext`, no server change. Rollback = redeploy an older commit (code only; the database is not migrated backwards). |
| Deploy template | `cloud-init-example.yaml` brought in line with the new script. |
| Overlapping winners | Refuse to resolve when two overlapping proposals both pass. |
| Activity log schema | Approved: new action types for the unlogged mutations. |
| Q1 Profile modal | Show it when the name is empty or still equals the email prefix. |
| Q2 Activity metadata | Redact previous comment text and invitee emails below supervisor. |
| Q3 Draft text editing | Correct the wording now; build the feature later. |
| Q4 Default-access documents | Stay link-only; say so in UC-5 and the tutorial. |
| Q5 "Propose change" button | Correct US-4 and the script; do not build it. |
| Q6 Open registration | Env switch: `SIGNUP_MODE=invited` plus `SIGNUP_ALLOWLIST`. |
| Q7 Untallied proposals | Block resolve until each has a tally or is marked not voting. |
| Q8 Author comment deletes | Add `comment_deleted` with the other new actions. |
| Q9 Deploy script home | Commit a sanitised `scripts/deploy.sh` reading the host from a gitignored `deploy.env`; private files go in `votetext-ops`. |

| Q10 Outcome label | Neutral **RESOLVED** when no overall document vote was recorded (the non-blocking half of the recommendation). |
| Q11 Tallies visible | Leave — the count happens in the room. |
| Q12 Author delete | Refused while a moderator has the comment hidden. |
| Q13 Proposal numbers | Assigned by the server by creation order across all proposals, gaps allowed. |

---

## Done 2026-10-02

### Phase 1 — backend fixes

| ID | Fix | Test |
|---|---|---|
| A1 | Draft rule on `/variants/:id/comments`, `/votes`, `/relations` — every sub-route loads the document through one `getDoc()` | AA2 |
| A2 | Activity feed and document list share one visibility rule; drafts and deleted documents no longer surface | AA3 |
| A3 | Final-voting preview applies the proposals whose tallies currently pass | AA10, unit |
| A4 + Q7 | Resolve gate: 422 and nothing written when passing proposals overlap or a voteable proposal has no tally | AA11, unit |
| A5 | Proposer withdraw only while the document is `draft` or `open`; Edit/Withdraw hidden afterwards | AA8, AA12, e2e |
| A6 | A root with active children cannot become a child; `vote_order` and `parent_variant_id` are type-checked | AA9, AA18 |
| A7 | Page cap returns 400; `lines_per_page` must be a positive integer | AA7 |
| A8, A9 | Vote retract needs voter access and logs only a real retraction; relations need proposer access | AA5, AA6 |
| B1 | Codes from `crypto.randomInt`; code invalidated after `OTP_MAX_ATTEMPTS` wrong tries; a new code does not reset the count; 20 wrong codes and `RATE_LIMIT_MAX` requests per client address; input length checks; expired OTPs and sessions purged daily | AA13, AA21–AA23 |
| B2 | `previous_text` and invitee `email` stripped from activity metadata below supervisor | AA4 |
| B3, B5 | Invite email escaped and rate-limited; all mail through `lib/mail.js`; app loads without a key, production refuses to boot without one | unit, by hand |
| B6, B7 | JSON 404 for unknown `/api/*`; `GET /healthz`; `SIGNUP_MODE=invited` | AA15, AA14 |
| C2, C3 | Multi-step mutations in transactions; comment delete uses `resolveAccessLevel` | existing |

### Phase 2 — schema and migration

| ID | Change | Test |
|---|---|---|
| T3 | `tests/migrate.test.js` with three historical schema snapshots in `tests/fixtures/`. **It showed the old `scripts/migrate.js` crashed on a database created from the first schema** ("table variants_new has 21 columns but 23 values were supplied") and left it half-migrated | 8 tests |
| — | `scripts/migrate.js` rewritten: reads `schema.sql`, creates missing tables and indexes, rebuilds any table whose definition differs (rows copied by column name, sequences kept), all in one transaction; leaves a table alone when the database is newer than the code. `schema.sql` is now the only file to edit for a schema change | same |
| C1 + Q8 | Seven new actions in the `activity_log` CHECK and logged in the routes: `document_deleted`, `document_data_copied`, `user_access_changed`, `user_access_removed`, `variant_share_changed`, `variant_relation_added`, `comment_deleted`; icons for all fourteen newer actions | AB1–AB7 |

### Second review round — fixed

Found by two independent read-only reviews (backend diff, whole frontend). Each fix
below was confirmed before and has a test.

| Finding | Fix | Test |
|---|---|---|
| **Stored XSS**: `POST /documents/:id/variants` accepted non-numeric `char_start`/`char_end`, and the proposal page put `char_start` into the page unescaped | Offsets must be integers; the diff fallback is escaped | AA16 |
| **Wrong document changed**: click handlers stayed on the persistent modal node, so "Change status" (and "Remove access") also acted on a document whose modal had been opened earlier | Every modal gets a fresh content node; backdrop close no longer breaks after the first click | e2e regression (fails without the fix) |
| **Reply and Edit stopped working** after the comment thread re-rendered (handlers attached again on each refresh) | Thread is wired once | e2e regression (fails without the fix) |
| **Insert proposals deleted the selected text** at resolve, while the proposal page showed it kept | An insert is a point at `char_start` in the merge and the overlap check | unit ×2 |
| **Dead end**: a document without overlapping proposals could not reach final voting from the browser | "Ready for final voting" shown in the no-conflict state; status modal offers `final_voting → voting / resolved` | e2e regression |
| Children of a proposal that left the vote vanished from every view but still blocked resolve | Children are released when the parent is rejected, withdrawn or hidden | AA17 |
| Hidden proposals still readable through `/comments`, `/votes`, relations of siblings and both activity feeds | 404 below supervisor everywhere; feeds filtered | AA19 |
| Blocked proposer could still edit and share their proposal | Access check on both | AA20 |
| Wrong-code counter was reset by requesting a new code (65 guesses per 15 min instead of 25); one address could lock any email out indefinitely; rate-limit maps grew without bound | See B1 above | AA21–AA23 |
| Selecting text inside a highlighted line navigated to the existing proposal | Click ignored while text is selected | e2e regression |
| "Send code" stayed disabled after "Use different email" (needed after the new 429) | Form reset on back | e2e regression |
| "Author's" comment filter never matched | Uses `proposed_by` | — |
| CSV export: no protection against spreadsheet formulas in titles and text | Cells starting with `= + - @` are prefixed with `'` | — |
| Invited mode leaked account existence by response time; a failed login email surfaced the mail provider's error text | Mail not awaited in invited mode; generic 502 message | — |

### Phase 3 — UI gaps and review findings (2026-10-03)

| ID | Done |
|---|---|
| U0 | `openAccessModal` moved to `review.js` (app.js 1931 → 1856 lines) |
| U1, R1 | Every write control gated with `hasLevel(doc, level)` on `doc.my_access_level`, both ways: supervisors get Change status (voting-cycle transitions) and Mark as Resolved; viewers lose Propose, the comment form, Fork and get disabled vote buttons with a note; review/conflict/final-voting pages refuse below supervisor |
| U2 | Status modal offers `final_voting → voting / resolved` |
| U3 | Profile modal shows when the name is empty or still the email prefix; `profile.spec.js` no longer edits the database |
| U4 | Access modal: level dropdown and Block/Unblock per row (admin) |
| U5, U6, U7 | "based on #N" / "forked as #M" on proposals; Delete document in the settings modal; tooltip on highlighted lines |
| U8 | Walkthrough banner listing overlapping winners and missing tallies, updated on every save |
| R2, R3 | 401 → sign-out and login page; `startSession()` after an in-tab login |
| R4 | Proposal page fetches every page it spans before cutting the original text |
| R5 | Children sorted by order; badges by position; group line range from all items; progress counts skipped children; threshold change refreshes the parent/child state; unassigned proposals drawn once; inserts show "Inserted at … nothing removed" |
| R6 | Q10, Q12, Q13 as decided (`proposal_num` from the server) |
| R7 | Selection captured on `selectionchange` (touch, release outside the panel); element-anchored selections resolve to line edges; trailing newline trimmed |
| R8 | Phone: nav wraps under the logo at ≤480px; review layout stacks at ≤768px |
| R9 | Proposal cards focusable (Enter opens); conflict ordering with + root / ↑ ↓ / child of… controls |
| R10 | Toast double-escape, own actions in the badge, countdown reload loop (polls the server instead), textarea leading newline, review page jump clamp, re-renders through the router, dead `?page=` code, access-modal document listener |
| B4 | CSP, nosniff, DENY framing, referrer policy, HSTS in production, no `X-Powered-By`; the one inline handler converted; unused Google Fonts preconnect removed |
| T2 | 13 new browser tests: `supervisor.spec.js`, `moderation.spec.js`, `access.spec.js`, `document.spec.js`, `fork.spec.js` |

### Third review round (2026-10-03) — fixed

An independent read-only review of the phase 3 diff found: a voting countdown could be
scheduled on a non-open document (`final_voting → voting` through the countdown form),
leaving a schedule nothing could fire or cancel — now 400 on the server and the form only
appears for open documents (AA26); Reply shown to viewers; the 401 sign-out left a modal
open; the access modal had no error path and restored the wrong Block/Unblock label;
closing the profile modal with × stranded the user on the login view; a drag that ended
outside the text panel lost the selection; the stacked review layout kept a sticky text
panel over the proposals; the wrapped phone header kept its fixed height; "+ root" could
create duplicate orders; `viewResolvedText` re-rendered outside the router (the likely
flake); two e2e assertions passed before the page rendered. All fixed; the supervisor
resolve test is now self-contained and asserts the status response.

Noted, not changed: Delete, Copy and Withdraw are owner-only in the UI although the API
also allows superadmin / any document admin.

### Deploy tooling round (2026-10-03)

- `scripts/deploy.sh` tracked (Q9), settings in gitignored `deploy.env` with a tracked
  `deploy.env.example`; `ssh-deploy.sh` is a one-line wrapper. `--check` hardening audit.
  Service-user support for the hardened layout.
- `cloud-init-hardened-example.yaml` next to the simple template.
- `tests/deploy.test.js` (6 contract tests in `npm test`): every `sudo` in the script is
  allowed by the hardened sudoers, embedded scripts parse, placeholders documented,
  unit hardening lines present, `deploy.env.example` complete.
- `npm run test:deploy`: the local stand-in harness, now in the repo
  (`tests/deploy/run-local.sh`, eight scenarios, all passing).
- `.github/workflows/ci.yml` (B.3): `npm test`, then Playwright.
- Omission found and fixed: `data/` is gitignored, so on a fresh checkout (CI) the test
  suites could not open their databases — tests now create the directory and
  `data/.gitkeep` is tracked.

### Deploy and docs

- `scripts/deploy.sh`: committed files only, tests first, refuses a dirty tree, backup,
  migrate, `/healthz` check, automatic restore; deploying a commit older than the live
  one skips the migration; `--no-migrate` flag. Exercised end to end against a local
  stand-in server; **never run against the live server**.
- `cloud-init-example.yaml`, `.env.example`, README, ARCHITECTURE, CLAUDE.md,
  `specs/` (use cases incl. new UC-21, user stories, test plan groups AA and AB,
  manual validation, both tutorial scripts), the three `.claude/commands` skills and
  `howot-host-service.md` updated.

---

## Before launch

Everything that must happen between now and declaring the public server open, in
order. "You" = things only the owner can do; the rest can be prepared by Claude.

### A. Ship phases 1–3 (you)

**Done 2026-10-20:** `efc032c` (main) deployed with `./scripts/deploy.sh --env`; fresh database
(no earlier production data); certificate obtained; `client_max_body_size` set; `--check`:
all public checks OK. Open from the audit: no backup cron on the VM (add
`/etc/cron.d/votetext-backup` from the template and take one backup by hand), pending
reboot, and the known simple-layout warnings (B.1, B.2). Browser smoke test (A.6) still to do.
Server-side gotcha met: `~/.npm` was root-owned from old sudo installs — `chown` fixed it.
Second gotcha: sqlite3 3.46.1's `.backup` dot-command fails with "cannot open" under
`/home/kjelloe` (root-owned home, `/tmp` works); `VACUUM INTO` works. Deploy script, both
templates and docs now use `VACUUM INTO` (2026-10-20) — the live cron line must be replaced
to match, and the first manual backup was taken with it.


1. Phases 1–3 are committed (f0e80c5, f4f7b5d). Still untracked and needed (2026-10-20):
   `.env.example`, `scripts/deploy.sh`, `.github/workflows/ci.yml`, `data/.gitkeep` —
   `git add` them with the staged changes; `tests/deploy.test.js` and CI fail without
   `scripts/deploy.sh`. Also commit `src/server.js` (loopback bind). `npm audit fix` is done (0 vulnerabilities). Readiness check
   2026-10-20: 329 node tests, 8 harness scenarios, 65 e2e all green (local Node is now 22 —
   `npm rebuild better-sqlite3` was needed once). Deploy from `main` after merging `dev`
   so the SHA in `.deployed-version` is on the main branch.
2. `./scripts/deploy.sh --dry-run`, then `./scripts/deploy.sh --env`. The first deploy rebuilds several
   tables on the live database to match `schema.sql`; the script backs the database up
   to `~/backups/votetext-predeploy-*.db` first and restores it if the health check fails.
   There is no production data to preserve (owner, 2026-10-20): whatever database is on
   the server is migrated or, if none, created with `init-db.js` — either way nothing to
   rehearse.
3. Remove the files the script lists as left over from earlier rsync deploys in
   `/opt/votetext` (`.git`, `archive/` with its key files, the zip, tests).
4. **After `~/first-deploy.sh`, on the server** (only if the VM predates the current template —
   both templates now ship the line): add `client_max_body_size 2m;` inside the `server {}`
   block of `/etc/nginx/sites-available/votetext` (certbot has split it into an HTTPS and a
   redirect block by then — put it in the HTTPS one), then `sudo nginx -t && sudo systemctl
   reload nginx`. Without it nginx rejects uploads above 1 MB with 413 before the app sees
   them. `./scripts/deploy.sh --check` reports `nginx client_max_body_size set` once done.
5. `.env.prod` — done 2026-10-20: unread keys removed, header points at
   `./scripts/deploy.sh --env`, `SIGNUP_MODE=open` (C.3 decided), `RATE_LIMIT_MAX=100` /
   `RATE_LIMIT_WINDOW_MS=60000` kept. The first deploy must therefore use `--env`.
   Optional, both default sensibly: `VOTING_COUNTDOWN_DEFAULT_MINUTES`, `TOAST_DISMISS_SECONDS`.
   Also done 2026-10-20: the app binds to 127.0.0.1 in production (`src/server.js`), so the
   audit's loopback line is OK without relying on ufw; `game-ops/.gitignore` now keeps
   `votetext-ops/server/deploy.env`.
6. Smoke test on the live domain: request a code, receive the email, sign in, open a
   document, `https://votetext.kjell.solutions/healthz` → `{"ok":true}`.

### B. Hardening that should not wait for the design pass

| # | Item | Who | Effort | Why before launch |
|---|---|---|---|---|
| B.1 | **Offsite backup.** Nightly `rsync` of `~/backups` to a Hetzner Storage Box (or a pull from your machine); one restore rehearsed end to end (`sqlite3 … .restore`, restart, log in) | you + Claude (cron line, README) | S–M | Both backups live on the VM today |
| B.2 | **Dedicated service user.** Prepared 2026-10-03: `cloud-init-hardened-example.yaml` (service user, locked-down unit, limited sudoers, admin account, unattended upgrades, nginx rate limit, backups + offsite stub) and `scripts/deploy.sh` support for it. **To apply on the live VM** either rebuild from the hardened template (cleanest: new server, `./scripts/deploy.sh --env` with `DEPLOY_HOST` pointing at it, restore the latest backup into `data/`, switch DNS) or convert in place as `<ADMIN_USER>`: `useradd -r -s /usr/sbin/nologin -d /opt/votetext votetext`, `usermod -aG votetext <DEPLOY_USER>`, `install -d -o votetext -g votetext -m 2770 /opt/votetext/data /opt/votetext/backups` after moving the database in, `chown votetext:votetext data/*`, `chgrp votetext .env && chmod 640 .env`, drop the unit and sudoers files from the template in place, `daemon-reload`, restart, then `./scripts/deploy.sh --check` | you | M | The app runs as a passwordless-sudo user today |
| B.3 | **CI.** Done 2026-10-03: `.github/workflows/ci.yml` runs `npm test`, then Playwright (Firefox) with the report uploaded on failure. Check the first run on GitHub after pushing | you (push, watch) | S | Tests only run when someone remembers |
| B.4 | **Tracked deploy script** (Q9). Done 2026-10-03: `scripts/deploy.sh` is tracked, settings in the gitignored `deploy.env` (`deploy.env.example` tracked), `ssh-deploy.sh` is a one-line wrapper. Private files (`cloud-init.yaml`, `.env.prod`, `deploy.env`, `ssh-connect.sh`, `dev-prompts.md`) now live in the private `game-ops` repo under `votetext-ops/`, symlinked back via `ops/` (gitignored). Open: `game-ops/.gitignore` has `*.env`, which would drop `deploy.env` — add `!votetext-ops/server/deploy.env` | you | S | Private ops files have no history or backup |
| B.5 | **Private `cloud-init.yaml`**: re-derive it from the hardened template (fill the placeholders) rather than patching the old copy | you | S | A rebuild would otherwise diverge |
| B.6 | **Run `./scripts/deploy.sh --check`** after the first live deploy and after B.1–B.5; every line should be OK | you | S | The audit is the control that the above actually happened |

### C. Operational checks (you, on the live VM)

- [ ] C.1 `sudo certbot renew --dry-run` succeeds; `systemctl list-timers` shows the certbot timer
- [ ] C.2 `ls ~/backups` shows a file from last night (the 03:00 cron)
- [x] C.3 `SIGNUP_MODE` decided 2026-10-20: `open` (anyone can sign up); switch to `invited`
      + `SIGNUP_ALLOWLIST` later if the group should be closed
- [ ] C.4 Unattended security upgrades on (`unattended-upgrades` package, `apt` auto-reboot
      window outside meeting hours)
- [ ] C.5 `journalctl -u votetext` shows no `[otp] Email send failed` lines after the smoke test
- [ ] C.6 `.env.prod` is backed up somewhere other than the VM (it holds `SESSION_SECRET`)

### D. Product gates

- [ ] D.1 Visual design pass done and the full e2e suite green afterwards (phase 4)
- [ ] D.2 Manual validation signed off — every row of `specs/manual-validation.md` (phase 5)
- [ ] D.3 Tutorial recorded, or decided it is not a launch blocker (phase 6)
- [ ] D.4 `npm run seed-demo` data removed from the production database if it was ever used
      there (check `SELECT email FROM users WHERE email LIKE '%@demo.votetext'`)

A and B can run in parallel with the design pass; C after the first live deploy; D last.

---

## Security review 2026-10-21 (live efc032c; three independent read-only reviews, every finding verified in code)

No way was found for a user without a login, or without access to a document, to read a
document's text or to change or delete anyone else's data. The core (`resolveAccessLevel`,
sessions, CSRF posture, soft delete, mass assignment, headers) is clean. What remains is
abuse of open sign-up, a few routes that skip a companion check, and missing size caps.

### S1 — Fix before wider use (abuse by any self-registered account)

| # | Finding | Where | Fix |
|---|---|---|---|
| S1.1 | **No size caps**: `title`, `description`, variant `new_text`/`rationale`, comment `text`, `display_name`/`organization` and the `settings` blob accept anything up to the 2 MB body limit; `POST /documents` has no cooldown; `POST /variants/:id/fork` has **no cooldown** (only direct proposals do) | documents.js POST/PATCH, variants.js fork + comments, auth.js profile | One `limits` helper: title 200, description 2 000, new_text 50 000, rationale 5 000, comment 5 000, name/org 100, settings keys whitelisted; apply the variant cooldown to fork; 10 documents/hour per user |
| S1.2 | **copy-data onto itself** doubles a document's variants per call (14→28→56…), no throttle | documents.js copy-data | Reject `target_doc_id == id`; treat as a mutation with the variant cooldown |
| S1.3 | **Sign-in email flood**: 100 code requests/min per IP, 5 per address, no global budget; no nginx `limit_req` on the live VM | auth.js `ipLimit`; cloud-init (simple) | Per-IP limit for `request-otp` alone (5/min), a process-wide send budget (e.g. 300/h), and the hardened template's nginx `limit_req` on the live site |
| S1.4 | **Invites as a spam channel**: any account creates a document and invites any address; a new address gets a user row and an email whose plain-text body embeds the attacker's unbounded `display_name` and title; 20/h per account, accounts are free. In `invited` mode this also bypasses the allowlist | documents.js POST /access | Fixed plain-text template (no user text), name cap (S1.1), invite limit per IP as well as per user; in `invited` mode only allowlisted addresses get a user row |
| S1.5 | **User directory dump**: `GET /api/auth/search?q=` needs only a login and returns `email` for any 3-character substring, 10 per query | auth.js search | Exact-email match only, or restrict to users sharing a document with the caller; drop `email` from the result |

### S2 — Access gaps (moderation and draft rules bypassed by one route each)

| # | Finding | Where | Fix |
|---|---|---|---|
| S2.1 | **Fork reveals a moderator-hidden proposal**: `POST /variants/:id/fork` never calls `hiddenFrom`, copies `new_text`/title/range and returns them (ids are sequential) | variants.js fork | `hiddenFrom` → 404; also refuse withdrawn/rejected/not_applicable/merged originals |
| S2.2 | **Settings unvalidated on create**: `POST /documents` stores `default_access:'admin'` (PATCH caps it at voter) → every logged-in user becomes admin of that document; bad `majority_threshold` later blocks PATCH | documents.js POST | Share the PATCH validation |
| S2.3 | **Share link survives `open → draft`** and ignores blocks: `allow_anonymous_share` short-circuits the document check | variants.js GET | Require `doc.status !== 'draft'` even when shared, or clear the flag on the transition to draft |
| S2.4 | **Blocked users keep editing/deleting their comments** for the edit window: comment PATCH/DELETE check authorship only | comments.js | Author path also needs `hasDocLevel(req, variant.document_id, 'commenter')` |
| S2.5 | **Hidden-comment placeholder leaks `user_id`/`hidden_by`** below supervisor | variants.js comments list | Null those fields too |
| S2.6 | **Author can withdraw a hidden variant** (DELETE lacks `hiddenFrom`; `/share` answers 403 where GET answers 404) | variants.js DELETE, share | `hiddenFrom` → 404 in both |

### S3 — Hygiene

| # | Finding | Fix |
|---|---|---|
| S3.1 | 500 responses echo `err.message` (e.g. SQLite constraint text) | `status === 500 ? 'Internal server error' : message` in errors.js |
| S3.2 | Profile fields untyped: `null` → 500, numbers stored as text | `typeof === 'string'` + cap (S1.1) |
| S3.3 | Earlier sign-in codes stay valid until expiry (up to 5 live codes) | Mark older codes used on each new request |
| S3.4 | Invite link falls back to the `Host` header when `VOTETEXT_URL` is unset (set in `.env.prod`, so not live today) | Add `VOTETEXT_URL` to the production boot check |
| S3.5 | Anonymous readers of `allow_anonymous_view` documents get `d.*` (settings blob, `resolved_text`, owner organisation) and per-voter identities from `/votes` | Whitelist fields in `GET /documents/:id`; decide whether ballots are open (today: yes, by design?) |
| S3.6 | `/relations` answers 422 vs 404 before the access check — existence oracle on other documents' variant ids | Reorder checks |
| S3.7 | Voting on withdrawn/rejected variants is accepted (tallies polluted, resolution unaffected) | Reject unless `status IN ('pending','conflict')` |

Effort: S1 ≈ M (one limits helper + rate-limit helper + nginx line), S2 ≈ S (six one-to-three-line changes), S3 ≈ S. Each fix gets an API test in a new group AC.

---

## Phase S — Security hardening (designed and implemented 2026-10-21, uncommitted, undeployed)

**Done 2026-10-21 (Q14–Q18 as recommended):** S.A role `creator` (schema, `tests/fixtures/schema-2026-10-03.sql`,
`requireRole` on create + copy-data, `PATCH /api/users/:id/role`, `scripts/grant-role.js`, role dropdown
in `#/admin/users`, notice + hidden button for plain users, seeds/tests grant creator), S.B caps and quotas
(`src/lib/limits.js`, `src/lib/cooldown.js`, fork cooldown, 10 docs/h, 5 copies/h, self-copy refused, invite
limit per IP, fixed plain-text invite), S.C sign-in (10 code requests/IP/15 min, one live code per address,
300 mails/h budget → 503), S.D companions (fork/withdraw/share hidden → 404, settings validated on create,
draft/blocked share, blocked commenters, placeholder ids, relations 404, vote on closed → 422), S.E hygiene
(generic 500, `VOTETEXT_URL` required in production + audited, anonymous document trimmed, `/votes`
identities voter+ only), S.F docs/specs/skills. Tests: 346 node (group AC = 16), 67 e2e (`roles.spec.js`).
Review round (independent agent) fixed: Copy / Fork-as-new-document buttons now hidden for non-creators, fork and
vote buttons match the server's status rules, quotas no longer burn a slot on a refused request, invites refuse
with 503 before writing when the mail budget is gone, `seed.js` re-runs grant alice `creator`.
**Open for you:** C3 nginx `limit_req` on the live VM; G2–G4 (commit, merge, push, deploy, then
`node scripts/grant-role.js kjell@kjell.solutions superadmin` on the server, grant creators in Users, `--check`).
Note: after the migration every existing account — including yours — is `user` until that grant.


Goal: a fresh sign-up can only *take part* in documents it is invited to (or that open
themselves via `default_access`); creating documents is a granted site role; the abuse
paths S1–S3 are closed with caps and companion checks. No new npm dependency, no new
tables; one `schema.sql` change (role list + two activity actions), which needs the
owner's approval.

### Decisions needed (Q14–Q18)

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q14 | How to gate document creation | (a) new site role `creator` in `users.role` (replaces the unused `admin` value: `user` / `creator` / `superadmin`); (b) reuse the existing `admin` value as "may create"; (c) `CREATOR_ALLOWLIST` env var, no schema change | **(a)**: clear name, manageable in the UI, migration is a plain table rebuild; (b) overloads "admin" with the document-level admin; (c) cannot be managed without a deploy |
| Q15 | Where the new limits live | (a) constants in code like `INVITE_EMAILS_PER_HOUR`; (b) new `.env` variables | **(a)**; only `SIGNUP_MODE` stays configurable. Fewer knobs, nothing to get wrong on the server |
| Q16 | Who sees individual ballots (`/votes`) | (a) anyone with read access incl. anonymous (today); (b) signed-in voter+ only, anonymous and viewers get tallies; (c) supervisor+ only | **(b)**: participants can still audit each other, outsiders see counts only |
| Q17 | `SIGNUP_MODE` after the creator role | (a) stay `open`; (b) `invited` | **(a)**: a new account can no longer create anything or invite anyone, so open sign-up only lets people reach documents they were pointed to |
| Q18 | Who may use user search (for invites) | (a) any account (today); (b) `creator`/`superadmin`, or supervisor+ on the document the modal is opened for | **(b)** with `?document_id=`; exact e-mail still works for everyone with invite rights |

### S.A — Site role `creator` (Q14a)

| Step | Change | Who |
|---|---|---|
| A1 | `schema.sql`: `role IN ('user','creator','superadmin')`; activity actions `user_role_changed`, `document_create_denied` is **not** logged (no spam) — only `user_role_changed { target_user_id, role }` | Claude, after approval |
| A2 | `tests/fixtures/schema-2026-10-03.sql` = copy of today's schema, so `migrate.test.js` proves the rebuild of `users` (FK targets: sessions, documents, votes, comments, access, activity) keeps every row | Claude |
| A3 | `POST /documents` and `POST /documents/:id/copy-data` require `requireRole('creator','superadmin')`; `superadmin` always implies creator | Claude |
| A4 | `PATCH /api/users/:id/role { role }` (superadmin; cannot change own role; logs `user_role_changed`); `#/admin/users` gets a role selector next to Protect | Claude |
| A5 | `scripts/grant-role.js <email> <role>` for bootstrapping the first superadmin on the server (today a manual SQL) — ships with `scripts/`, documented in README | Claude |
| A6 | Frontend: `+ New document` only for creator/superadmin; `user` sees a one-line notice on the list ("You can take part in documents you are invited to. Ask the site administrator for permission to create documents.") and a 403 toast if they hit the API anyway | Claude |
| A7 | Seeds, API tests, e2e global-setup grant `creator` to the accounts that create documents (`UPDATE users SET role`), invited accounts stay `user`; new API group **AC** (role gating, grant/revoke, self-change refused, user cannot create/copy) and one e2e assertion (button hidden for a `user`) | Claude |
| A8 | After deploy, on the server: `node scripts/grant-role.js kjell@kjell.solutions superadmin`, then grant `creator` to the people who should start documents via `#/admin/users` | **You** |

### S.B — Abuse caps (S1.1, S1.2, S1.4, S3.2)

| Step | Change | Who |
|---|---|---|
| B1 | `src/lib/limits.js`: `LIMITS = { title: 200, description: 2000, new_text: 50000, rationale: 5000, comment: 5000, name: 100, organization: 100, settings_keys: [...] }` + `checkText(value, max, label)` → 400 message; applied in documents POST/PATCH/import, variants POST/PATCH/fork, comments POST/PATCH, profile PATCH; `settings` reduced to the whitelisted keys before storing | Claude |
| B2 | Fork shares the variant cooldown (move the cooldown into a helper used by both routes) | Claude |
| B3 | Document creation: 10 per user per hour (in-memory map like invites) | Claude |
| B4 | `copy-data`: refuse `target_doc_id === id`; 5 per user per hour | Claude |
| B5 | Invite e-mail: fixed plain-text template (no inviter name or title in the text part; the HTML part stays escaped); invite limit also per IP (20/h); in `invited` mode a new address only gets a user row if it matches `SIGNUP_ALLOWLIST` | Claude |
| B6 | Tests in group AC for every cap (413-style 400s, cooldown on fork, self-copy refused, invite template) | Claude |

### S.C — Sign-in flood (S1.3, S3.3)

| Step | Change | Who |
|---|---|---|
| C1 | `request-otp`: own per-IP window — 10 code requests per IP per 15 min (existing `ipLimit` stays for `verify-otp`); process-wide send budget 300 mails/hour across OTP + invites (`src/lib/mail.js` counts, returns a 503 "Try again later" when exhausted, logs once) | Claude |
| C2 | New code request marks that address's earlier unused codes as used (one live code per address) | Claude |
| C3 | nginx on the live VM: `limit_req_zone … votetext_auth … 30r/m` + `limit_req` on `/api/auth/` (the hardened template's two blocks) — done by hand now, or arrives with the hardened rebuild (B.2) | **You** |

### S.D — Access companions (S2.1–S2.6, S3.6, S3.7)

| Step | Change | Who |
|---|---|---|
| D1 | Fork: `hiddenFrom` → 404; refuse originals not in `pending`/`conflict` | Claude |
| D2 | `POST /documents` validates `settings` with the same helper as PATCH (`validateSettings()`) | Claude |
| D3 | Shared variant: also requires `doc.status !== 'draft'`; blocked users refused | Claude |
| D4 | Comment PATCH/DELETE: author path also needs `hasDocLevel(req, document_id, 'commenter')` | Claude |
| D5 | Hidden-comment placeholder nulls `user_id`, `hidden_by`, `edited_at` for non-moderators | Claude |
| D6 | Variant DELETE and `/share`: `hiddenFrom` → 404 | Claude |
| D7 | `/relations`: access check before the target lookup (404 for both) ; `/vote` refuses variants not `pending`/`conflict` | Claude |
| D8 | Tests AC for each (extends AA19/AA20 patterns); UC-18 step 3 gains "fork, withdraw, share" | Claude |

### S.E — Hygiene (S3.1, S3.4, S3.5)

| Step | Change | Who |
|---|---|---|
| E1 | `errors.js`: generic text for 500 | Claude |
| E2 | `VOTETEXT_URL` added to the production boot check; `--check` warns when missing | Claude |
| E3 | `GET /documents/:id` returns a whitelisted field set (no settings blob/`resolved_text` for anonymous); `/votes` per Q16 | Claude |

### S.F — Docs, specs, skills, memory

ARCHITECTURE (§ Global roles rewritten, § Limits new), README (API table: role route, grant script, limits), CLAUDE.md (role gate + limits helper in "patterns"), `specs/use-cases.md` (UC-22 Site roles; UC-18 step 3), `specs/user-stories.md`, `specs/test-plan.md` (group AC, migration fixture row), `specs/manual-validation.md` (role rows), tutorial scripts (persona who creates = creator), `.claude/commands/vt-check.md` (limits helper present, no route without a cap), memory. | Claude |

### S.G — Ship

| Step | Who |
|---|---|
| G1 Review round with independent agents on the diff (the pattern that found all of the above) | Claude |
| G2 `npm test`, `npm run test:e2e`, `npm run test:deploy` green; commit; merge to main; push; CI green | **You** (commit/push) |
| G3 `./scripts/deploy.sh --dry-run` → `./scripts/deploy.sh` (migrates `users`; pre-deploy backup automatic) | **You** |
| G4 A8 (grant superadmin + creators), C3 (nginx), `./scripts/deploy.sh --check`, browser check: sign in as a plain user → no "New document" | **You** |

### Omissions checked after the first draft

- **Existing accounts on the live DB**: only the owner today; the migration keeps `role='user'` for everyone, so A8 is required before anyone can create a document — including you.
- **Invited users who later should create**: superadmin promotes them in `#/admin/users`; no self-service request flow (deliberate; a mailto line in the notice is enough).
- **`default_access` documents** still let any sign-up propose/comment there — that is the owner's explicit choice per document; the caps in S.B bound the damage.
- **Supervisors can still invite** (they need no creator role) — fine, they were appointed by a creator; B5 removes the free-text from the mail.
- **Demo/seed data**: `seed.js`, `seed-demo.js` set `creator` on the persona that uploads; the tutorial scripts mention the role once.
- **Tests that create documents as ad-hoc users** (api.test.js groups A–AB, e2e fixtures): the test helper that signs a user in gets a `role` option; default `creator` so existing groups stay green, `user` where the gate is under test.
- **Migration of `users`** rebuilds a table referenced by six foreign keys — `migrate.js` already disables FK enforcement during rebuilds and the new fixture (A2) proves it on real data.
- **Rollback**: deploying the previous commit keeps the new schema (role list is a superset in practice: `creator` rows would violate the old CHECK only if the old code tried to rewrite them, which it never does).
- **Rate-limit state is in memory**: resets on restart and per process — acceptable for one VM; noted in ARCHITECTURE.
- **`--check` audit**: add a line that `VOTETEXT_URL` is set and that nginx has `limit_req` (already warns).

Effort: S.A M, S.B M, S.C S, S.D S, S.E S, S.F S, S.G S — about two working sessions, S.A first because everything else assumes the role gate.

---

## Remaining work packages

### Phase 4 — Visual design pass

Now the next step. Agree direction first (palette, typography, density, light/dark),
then tokens → components → responsive, with the full e2e suite (65 tests, incl. the XSS
and regression specs) as the gate. The phone layout fixes from phase 3 are functional
only; the design pass should revisit them.

### Phase 5 — Manual validation

All sign-off rows in `specs/manual-validation.md` are empty, including the three added
for the review fixes, phase 3 and the deploy.

### Phase 6 — Tutorial video

Both scripts match the app as of 2026-10-03. Record after the design pass.

### Phase 7 — Launch

The consolidated list is **Before launch** above (A–D). Nothing else.

### Any time, in parallel

| ID | Item | Effort |
|---|---|---|
| D1 | Rename `howot-host-service.md` and decide whether it belongs in the repo; drop `resume.txt` | S |
| D2 | Major dependency bumps when convenient: express 5, better-sqlite3 12, resend 6, dotenv 18 — none required, each needs the suite run | M |

### Later — analysed, not implemented

Design notes for the items previously listed as "noted, not planned" and "later, if
wanted" (2026-10-03). Each has a verdict; none is scheduled.

#### L1 — UI stricter than the API: Delete, Copy, Withdraw

*Today.* Delete document and Copy are shown to the owner only; the API allows
`DELETE /documents/:id` for owner or superadmin, and `copy-data` for any document admin.
Withdraw is shown to the proposer only; the API also lets a superadmin withdraw anyone's
proposal.

*Options.* (a) Align the UI with the API: Delete for owner + superadmin, Copy for
`hasLevel(doc, 'admin')`, Withdraw for proposer + superadmin. (b) Tighten the API to the
UI. (c) Leave.

*Verdict.* **(a), S, whenever a superadmin actually needs it.** The API behaviour is the
documented one (ARCHITECTURE § Global roles) and superadmin is a manual DB grant. Three
one-line condition changes plus three assertions in `supervisor.spec.js`'s pattern. Risk:
none — the server already enforces it.

#### L2 — `decideOutcomes` on legacy three-level chains

*Today.* A child whose parent is itself a child (only possible with data created before
the nesting guard of phase 1) is decided by row order: if it is listed after its parent
it is skipped correctly, otherwise both can pass and produce an overlap blocker. Never a
wrong resolved text, only a confusing message.

*Options.* (a) Normalise the data once: `UPDATE variants SET parent_variant_id = NULL,
vote_order = NULL WHERE parent_variant_id IN (SELECT id FROM variants WHERE
parent_variant_id IS NOT NULL)` — releases grandchildren to unordered roots. (b) Make
`decideOutcomes` order-independent: decide roots, then repeat over children until no
outcome changes (at most depth passes), treating a child whose parent is undecided as a
root. (c) Leave.

*Verdict.* **(a) as a one-off SQL in the first live deploy's notes, plus (b) as a
5-line change with a unit test — S.** (a) removes the only data that can trigger it;
(b) costs nothing and closes the class. Not urgent: the production database predates
conflict ordering entirely, so it most likely has no chains at all — check with
`SELECT COUNT(*) FROM variants c JOIN variants p ON p.id = c.parent_variant_id WHERE
p.parent_variant_id IS NOT NULL` before doing anything.

#### L3 — Distributed invalidation of a victim's sign-in code

*Today.* Five wrong codes for an address invalidate its outstanding code. One client
address is capped (20 wrong codes / 15 min) so a single machine cannot keep a victim out;
twenty machines could. The victim just requests a new code, so the effect is annoyance,
not lockout, and it requires the attacker to know the address and keep going.

*Options.* (a) Accept. (b) Bind each code to the browser that requested it: a random
`request_token` stored on the `otp_codes` row (schema change) and set as an HttpOnly
cookie on `request-otp`; `verify-otp` matches email + code + token, and wrong attempts
count per token. An attacker never holds the victim's token, so their attempts touch a
code the victim never sees. Cost: requesting on one device and verifying on another stops
working (rare; the error can say "request the code on this device"). (c) Magic link in
the email instead of a code — bigger change, same device-binding issue. (d) Backoff
instead of invalidation (1 s, 2 s, 4 s … per email) — keeps the code valid but a
distributed attacker still slows the victim down.

*Verdict.* **(a) now; (b) is the right fix if it ever matters — M, needs a `schema.sql`
change (ask first), AA13/AA21/AA22 rewritten, and one e2e login test.** The threat needs
a motivated attacker with many addresses against a small committee tool; the cost of (b)
is a real usability edge case. Revisit if a lockout is ever reported.

#### L4 — Draft text editing (Q3 b)

*Today.* Document text is immutable after creation; a wrong draft is fixed by **Copy**
→ correct → create, which also orphans the draft (there is no delete-and-replace flow).

*Design.* `PATCH /documents/:id` accepts `text` **only** when `status = 'draft'` and the
document has no variants at all (not even withdrawn ones — offsets would be meaningless):
in one transaction delete `document_lines`, re-run `importText` with the current
`lines_per_page`, update `total_lines/pages/chars`, log `document_updated
{ text_replaced: true, from_lines, to_lines }`. 422 otherwise. UI: a "Replace text"
textarea in the settings modal, shown only for drafts without proposals, prefilled from
`GET /:id/text`. Tests: replace succeeds on an empty draft; 422 on open, on a draft with
one variant, on a draft with a withdrawn variant; page count updates; activity row.

*Verdict.* **Worth doing — M — after the design pass, before the tutorial is recorded**
(chapter 2 then regains "room to fix typos" and the Copy workaround note goes away). No
schema change. Risk: low; the guard "no variants" keeps offsets safe.

#### L5 — Documents reached through default access (Q4 b)

*Today.* A document with `default_access` set is reachable by link only; it never
appears in that user's document list or activity feed. The tutorial says "share the link".

*Options.* (a) Auto-join: on the first `GET /documents/:id` by a user without a record,
insert a `user_document_access` row at the default level (`invited_by NULL`). Pros: the
document then behaves exactly like an invitation everywhere. Cons: a GET writes; a
later change of the default no longer affects users who already joined; the access list
fills with everyone who ever opened the link. (b) Query-time inclusion: `GET /documents`
and the feed's visibility SQL also match `d.status != 'draft' AND
json_extract(d.settings, '$.default_access') IS NOT NULL` for any signed-in user, with
`access_level` = that default. Pros: no writes, follows the current default, no new
rows. Cons: on a multi-group instance every signed-in user sees every default-access
document in their list — which is exactly what the setting means ("any signed-in user").
(c) Leave link-only.

*Verdict.* **(b) — S — if asked for; (c) until then.** It is one `OR` clause in
`VISIBLE_DOCUMENT_IDS_SQL` (shared by the list and the feed) plus `access_level` in the
list query, Y7-style tests, and a two-line change to UC-5 and the tutorial. Avoid (a):
hidden state created by a read request is the kind of thing that surprises later. Note
that (b) makes default-access documents visible to *all* accounts on the instance; with
`SIGNUP_MODE=invited` that is the invited circle, with `open` it is the public.

#### L6 — Restore or purge of soft-deleted documents

*Today.* `DELETE /documents/:id` sets `deleted_at`; the row and everything under it stay
forever, invisible, and cannot be brought back without SQL.

*Design.* Restore: `POST /documents/:id/restore` (owner or superadmin), clears
`deleted_at`, logs `document_restored` (schema change: one new action — ask first).
Listing: `GET /documents?deleted=1` returns the caller's own deleted documents; the
document list gets a "Deleted" filter with a Restore button. Purge: the daily
`purgeExpired()` job also hard-deletes documents with `deleted_at` older than
`DELETED_RETENTION_DAYS` (default 30, new env var); `ON DELETE CASCADE` already removes
lines, variants, votes, comments, access rows and activity. Tests: restore round trip;
restore by a non-owner → 403; purge removes a 31-day-old document and its children and
leaves a 29-day-old one; `document_deleted` activity survives as long as the document.

*Verdict.* **Worth doing, M, after launch.** Restore is the user-facing half and is cheap;
purge is what keeps the database from growing with ghosts and is what makes "delete"
honest for GDPR-style requests. Needs one activity action and one env var — both to be
approved.

#### L7 — Pagination for the document and user lists

*Today.* `GET /documents` and `GET /users` return everything; the document grid renders
all cards. Fine up to a few hundred documents.

*Design.* Server: `?page=&limit=` (limit default 50, max 200) with `ORDER BY updated_at
DESC` already in place; response gains `page` and `has_more`. Client: a "Load more"
button under the grid that appends the next page (no page numbers — the list is sorted
by activity). Users page: the same plus the existing `?q=` filter box exposed in the UI.
Tests: two pages of three documents each with `limit=3`; `limit` clamped; the e2e
document list still finds a document created in the test.

*Verdict.* **Not needed for launch — S–M when an instance passes ~200 documents.** The
real cost today is the `GET /documents` payload on every list view, not correctness.
Add a `COUNT` check to the health-check skill instead so it is noticed.

#### L8 — Deactivating a user

*Today.* `users.is_active` exists and is honoured (an inactive user cannot sign in and
existing sessions stop working at the next request), but nothing sets it except SQL.

*Design.* `PATCH /users/:id/active { is_active }` (superadmin, `requireRole`), refusing
to deactivate yourself or another superadmin; on deactivation delete the user's sessions
and mark their outstanding OTP codes used; log `user_deactivated` /
`user_reactivated` (two new actions — ask first). The Users page gets a Deactivate /
Reactivate button next to Protect; the user list already shows "inactive". Their
proposals, votes and comments stay (authorship is history). Tests: X-group style —
non-superadmin 403; deactivate → their session 401 and `verify-otp` 403; reactivate →
sign-in works; self-deactivation 400.

*Verdict.* **Worth doing before the first real multi-group use, S.** It is the only
moderation action that currently requires the database shell, and the first thing an
operator will need when someone leaves a committee. Two activity actions to approve.

#### L9 — "Export resolved document (further polish)"

*Today.* Markdown and print-HTML exports of the resolved text with the
PASSED/FAILED/RESOLVED line and the timestamp. The README roadmap item has no spec.

*Options.* (a) An appendix in both exports listing every proposal with its outcome:
`#N · title · proposer · yes/no/abstain · approved/rejected/not applicable`, so the
exported document carries its own decision record. (b) A side-by-side "original vs
resolved" diff export. (c) `.docx`/PDF generation — needs a dependency or a headless
browser; against the minimal-dependency rule. (d) Include the overall document vote
figures in the header line.

*Verdict.* **(a) + (d), S–M, after launch — it is what a secretary attaches to the
minutes.** The data is already on the page (`GET /documents/:id/variants` carries
status and tallies). (b) is nice but the per-proposal diffs already exist on each
proposal page; (c) stays out unless a group insists — "Print HTML → Save as PDF" covers
it.

### Order, if all of them were wanted

L4 (draft editing) and L8 (deactivate user) first — both small, both close a visible
hole; then L6 (restore/purge) and L9 (export appendix); L1, L2, L5 on demand; L7 when
the numbers call for it; L3 only if a lockout is ever reported.
