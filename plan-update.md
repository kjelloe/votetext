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
