# VoteText — Plan to Production

_Last updated: 2026-11-16 (Phase K complete incl. K.4; Phase V.1 + V.2 built for English; header below is the 2026-10-03 review context)_

A full review on 2026-10-02 found access, correctness and security gaps, spec features
with no UI, and a tutorial script describing behaviour the app does not have. Phases 1,
2 and 3 are implemented and tested locally. **Nothing is committed or deployed**; the
production server is live and still runs the old code.

Test status on 2026-11-16: **366 node tests** and **89 Playwright e2e tests** green (two projects: Firefox desktop, Chromium phone).
At the time of the 2026-10-03 review: 329 node (273 API + 30 unit + 12 frontend contract + 8 migration + 6 deploy contract) and 65 e2e.

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
| B.1 | **Offsite backup.** Nightly `rsync` of the backups to a Hetzner Storage Box; one restore rehearsed end to end. Step-by-step guide written 2026-10-22: `ops/notes/harden-live-vm.md` Part 4 | you | S–M | Both backups live on the VM today |
| B.2 | **Dedicated service user.** Prepared 2026-10-03: `cloud-init-hardened-example.yaml` + `scripts/deploy.sh` support. Decision 2026-10-22: convert the live VM in place (two-day-old box, tiny DB, no DNS/cert churn) — step-by-step guide in `ops/notes/harden-live-vm.md` Parts 1–3 (admin account first, then service user + locked unit + limited sudoers, then drop the deploy user's full sudo) | you | M | The app runs as a passwordless-sudo user today |
| B.3 | **CI.** Done 2026-10-03: `.github/workflows/ci.yml` runs `npm test`, the deploy harness, then Playwright (Firefox desktop + Chromium phone project since 2026-10-29) with the report uploaded on failure. Check the first run on GitHub after pushing | you (push, watch) | S | Tests only run when someone remembers |
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

## Phase M — Proposing and browsing on phones (designed 2026-10-23; Q19–Q25 decided as recommended; M.1 committed dbdbeb2, M.2 + M.3 done 2026-10-30, committed 1220fd9 on 2026-11-13)

**Trigger:** a user test with the Oslo Høyre programme (23 pages, 840 lines) on a phone. Reading works;
proposing does not: the only **Propose** button sits in the sidebar, which on phones stacks *below* the
whole text panel, so after selecting a sentence the user has to scroll away from it. Variants of an
existing proposal can only be started from the proposal page. After submitting, the app leaves the
document for the proposal page, so "scroll on and propose as you go" means Back after every proposal.

### What exists today (facts the design builds on)

- Selection capture already works on touch (`selectionchange`, phase 3) and stores `pendingSelection`
  with exact character offsets; the sidebar button just reads it.
- The modal is a centred box (`#modal-overlay`/`#modal-box`, max-height 90 vh); phones get the same box.
- Fork = `POST /variants/:id/fork` creates a `based_on` child with the parent's range; allowed on
  `pending`/`conflict` proposals (same rule the proposal page uses for its Fork button).
- Proposal list: server returns document order with `line_start/line_end/page_start/page_end`,
  `comment_count`, vote tallies — no `my_vote`. Sidebar filters: All / On-page / Top N % (by vote count).
- Proposal page has Back-to-document (restores page + line) and comment sorting, no next/previous proposal.
- `public/app.js` is at 1 900 lines; the 2 000 cap means new frontend code goes into a new file
  (`public/selection.js`) and the editor-only views move to `review.js` first (the split planned in memory).
- Playwright runs Firefox only; Firefox cannot emulate touch or mobile. Layout can be tested by viewport
  size; real touch selection needs a Chromium project (no new npm dependency, one more browser download in CI).

### Design

**M.1 Selection toolbar.** When a proposer+ on a document that accepts proposals selects text inside the
page, a small floating bar appears anchored to the selection rectangle: **Propose**, and **Variant** when
the selection overlaps a forkable proposal (one → "Variant of #N"; several → a chooser). Mouse: bar above
the selection (editor convention). Touch: bar *below* the selection, because iOS and Android draw their own
callout above it; flips when there is no room. Shown after the finger lifts (`pointerup`/`touchend` plus a
short debounce while handles are dragged), repositioned on scroll, hidden when the selection collapses.
The sidebar **Propose** stays as the keyboard/desktop path and keeps the e2e hooks.

**M.2 Inline sheet and stay-in-place.** The modal gets a sheet mode: on ≤768 px it anchors to the bottom
(rounded top, 85 vh max, scroll inside, safe-area padding, follows the keyboard via `visualViewport`);
desktop keeps the centred box. While the sheet is open the selected lines keep a temporary highlight, since
focusing the textarea collapses the native selection. The Variant sheet shows the parent proposal (number,
title, its text) above the fork form, text prefilled. After submit the sheet closes, the current page and
sidebar re-render with the new highlight, scroll position is kept, and a toast "Proposal #N added · Open"
offers the proposal page. Same behaviour on desktop for consistency (Q19).

**M.3 Browsing proposals in an order of your choice.** The sidebar's three buttons become *filter* (All ·
This page) plus *sort* (Document order · Most discussed · Most voted · Newest), compact `<select>`s on
phones, segments on desktop, remembered per device. "Top N %" folds into *Most voted*. On phones a sticky
bottom bar "N proposals · Propose" opens the proposal list as a sheet with the same controls, so the list is
reachable from any scroll position; tapping a card opens the proposal page as today, whose Back already
returns to page + line. The proposal page gains **‹ Previous / Next ›** following the chosen order, so a
voter can walk the whole set on either device. Optional (Q23): a *Not yet voted by me* filter, which needs
`my_vote` added to the list query.

**M.1 done 2026-10-29:** `public/selection.js` (202 lines) — `wireSelectionToolbar` called from `viewDocument` under the `#propose-btn` rule; bar shown on pointer/finger lift or 350 ms after the last `selectionchange`, above for mouse, below for touch, flipped and clamped to the viewport, repositioned on scroll/resize, `data-placement` for tests; **Variant of #N** / **Variant…** chooser under the proposal page's `canFork` rule; `openForkModal` moved out of `viewVariant` (app.js 1 514 lines). Playwright gained a Chromium `mobile` project (375 px, touch) scoped to `mobile.spec.js`; CI installs chromium too. Tests: 359 node, 79 e2e (`selection.spec.js` 6, `mobile.spec.js` 2). Omission pass 2026-10-30: the flip respects the sticky header, pointer state is tracked on the document (a drag may start outside the text panel), Escape hides the bar, tutorial cues now show the floating bar. Submit still navigates to the proposal page — that changes in M.2.

**M.2 + M.3 done 2026-10-30:** sheet mode by CSS below 768 px (`#modal-overlay` end-aligned, rounded 85 vh box with grab handle and safe-area padding), `wireSheetSupport()` in `selection.js` follows `visualViewport` and clears the `.line-selected` marks on close; `markSelectedLines()` keeps the captured lines blue while the propose/fork sheet is open; fork sheet shows the parent block; `openProposeModal`/`openForkModal` take `onCreated` → `viewDocument.onProposalCreated` re-fetches the list, rebuilds overlaps, re-renders lines + list in place and toasts "Proposal #N added · Open" (`showToast` accepts `{ href, label }`); the proposal page's Fork still navigates. M.3: `proposalPrefs()`/`sortProposals()`/`isUnvoted()` in `app.js`, two selects (filter All · This page · Not yet voted by me; order Document · Most discussed · Most voted · Newest) rendered into every `.proposal-controls-holder`, stored in `localStorage.vt_proposal_prefs`; `my_vote` added to `GET /documents/:id/variants` (group AE); phone `#doc-bottom-bar` ("N proposals" opens the list as a sheet, **Propose** under the `#propose-btn` rule); Prev/Next on the proposal page follow the stored order and skip voted ones under the voter filter. Retired: *Top N %* and `PROPOSALS_TOP_PERCENT` (server no longer returns `top_percent`). Decision taken on the way: selects on desktop as well as phones instead of segmented buttons — one control, keyboard-friendly, and the design pass restyles it. Noticed items from M.1 handled: a new selection outside the text panel now drops the captured range (sidebar button says "No text selected"); reduced-motion disables the bar/toast animation. app.js 1 584 lines, selection.js 255. Tests: 362 node, 84 e2e (`browse.spec.js` 3, `mobile.spec.js` 4). Still manual: keyboard/visualViewport behaviour and safe-area on real phones.

**Omission passes after M.3 (2026-10-30 and 2026-11-06):** the viewport meta gained `viewport-fit=cover` (without it every `env(safe-area-inset-*)` is 0 on iPhones) and the bar/sheet got side insets; a print rule hides the fixed overlays; a contract test ties both down. `votingOpen(doc)` in `app.js` is now the one client rule for "this user can still vote here" (signed-in voter+, document draft/open/voting — the server's rule on `POST /variants/:id/vote`): it gates the vote buttons, the *Not yet voted by me* option and the Prev/Next skip, which were previously offered on final-voting and resolved documents too. Changing a selector no longer drops keyboard focus (the controls are re-rendered; focus is handed back). The skills count tests from the runners instead of grep. app.js 1 592 lines. Tests: 362 node, 85 e2e (`browse.spec.js` 4).

**Q25 done 2026-10-23:** `openCreateDocModal`, `openDocSettingsModal`, `openStatusModal` moved to `review.js` unchanged (app.js 1 900 → 1 541 lines); its own commit; suites green.

**M.4 Ship — done 2026-10-30, as listed:** new `public/selection.js` (toolbar, sheet positioning, toast), `review.js` takes the
editor-only views out of `app.js` first, CSS for bar/sheet/sticky bar, API `my_vote` if Q23 says yes.
Tests: e2e for the toolbar with programmatic selection (as `proposal.spec.js` does) at desktop and
375 px viewports, the sheet flow end to end, sort/filter, Prev/Next; a Chromium mobile project for touch
if Q22 says yes. Docs: UC-24, user story US-4 amended, test-plan rows, manual rows for real-phone checks
with the programme. Order: M.1 → M.2 → M.3, each behind the full suite; the visual design pass (phase 4)
then restyles the new DOM rather than the old one. Left to the owner: commit, deploy Phase P + M together, then the real-phone rows in `specs/manual-validation.md`.

### Decisions (Q19–Q25, all as recommended on 2026-10-23)

| # | Question | Recommendation |
|---|---|---|
| Q19 | After submitting from the sheet: stay on the document with a toast, or go to the proposal page as today? On desktop too? | Stay, both devices; the toast's *Open* link keeps the old path one tap away |
| Q20 | **Variant** means a fork: the child keeps the *parent's* range even if the user selected a slightly different stretch. A different range is a new competing proposal (**Propose**). Agree? | Yes — that is what `based_on` means today; the toolbar explains it in the chooser ("Variant of #12 — same lines, different wording") |
| Q21 | Phone proposal list as a sticky bottom bar + sheet, or keep the stacked sidebar under the text? | Bottom bar + sheet |
| Q22 | Add a Chromium "mobile" Playwright project (touch, 375 px) for the toolbar and sheet tests? Adds a browser download to CI, no npm change | Yes, scoped to the new specs |
| Q23 | Add a *Not yet voted by me* filter (needs `my_vote` in the list)? | Yes — it is the voter's "where was I" |
| Q24 | Which statuses accept the toolbar? Today the sidebar button shows for proposer+ unless resolved/archived; the server decides the rest | Keep the same rule; the bar simply mirrors `#propose-btn` |
| Q25 | Do the `app.js` split (editor views → `review.js`) as the first step of this phase, or as its own commit before it? | Own commit first — pure move, full suite green, then M.1 |

## Phase P — Automatic page detection on import (2026-10-23, committed 1220fd9)

After a user test with the Oslo Høyre programme (variable numbered lines per page: title and
contents pages, 21 lines on page 3, 40 on page 4 …) the fixed `lines_per_page` import produced
wrong pages and line numbers. Decisions (as recommended): skip unnumbered lines by default with a
checkbox to keep them; store the source page number so VoteText pages match the printed document
(empty cover/contents pages included); keep `#`/`##` heading markers verbatim for a later view
option; superadmin only at first, opened to creators the same day. Done: `importPagedText`/`exportPagedText` in `src/lib/text.js`,
`lines_per_page: "auto"` on `POST /documents`, `GET /text?format=paged` for
**Copy**, `PATCH` refuses `lines_per_page` changes (422) for every document, proposals carry
`page_start`/`page_end` and the reader no longer derives pages from a line count, empty-page note,
*Auto* option + keep-checkbox + counts in the modal. `pdf2md.py` (doctools) `HEADING_L2_HEIGHT`
11.0 → 11.5: body text is 11 pt, so 789 of 836 lines had been tagged `##`. Tests: 357 node (unit
paged cases + group AD), 71 e2e (`paged.spec.js`). **Open for you:** commit, deploy, import the
programme and check page 3 starts at line 1 and page 4 at line 22.

## Phase S — Security hardening (designed and implemented 2026-10-21, deployed 2026-10-22 as 4485389)

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
**Shipped 2026-10-22:** G2–G4 done — commit 4485389 deployed, `users` migrated with pre-deploy backup, superadmin
granted, C3 nginx rate limit added by hand, `--check` clean apart from the simple-layout and offsite-backup
warnings. Those are B.1/B.2 — guide in `ops/notes/harden-live-vm.md`. Same day: audit allow-lists `.ssh` under
the app dir (the template's offsite key lives there), the deploy harness env gained `VOTETEXT_URL` (it had been
failing since Phase S — CI never ran it; a `deploy-harness` CI job now does), and `roles.spec.js` gained the superadmin
Users-page flow (e2e accounts `root@e2e.test` superadmin and `carol@e2e.test`): 68 e2e.


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
| C3 | nginx on the live VM: `limit_req_zone … votetext_auth … 30r/m` + `limit_req` on `/api/auth/` — **done 2026-10-22**, audit OK | **You** |

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
| G4 A8 (grant superadmin + creators), C3 (nginx), `./scripts/deploy.sh --check`, browser check: sign in as a plain user → no "New document" | **You** — done 2026-10-22 except C3 (audit still warns) |

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

## Phase K — Modal keyboard and focus (noticed after Phase M, designed 2026-11-09, K.1 + K.2 built 2026-11-10, committed 1220fd9)

Three items noticed during the Phase M omission passes, analysed here. K.1 and K.2 are
small, behaviour-only and belong *before* the design pass (phase 4), whose gate is the e2e
suite and which should restyle finished behaviour. K.3 folds into the design pass itself.

### What exists today

- `openModal(html, title)` in `app.js` swaps in a fresh `#modal-content`, shows `#modal-overlay`
  and wires three ways to close: the × button, a click on the overlay, `.modal-cancel`. There is
  no Escape, no `role="dialog"`, focus stays on the button behind the overlay, and Tab walks the
  page underneath. Thirteen callers (`app.js` 5, `review.js` 5, `selection.js` 2, `auth.js` 1)
  rely only on `openModal`/`closeModal`, so the change is confined to those two functions.
- `selection.js` already hides the floating bar on Escape; the bar is hidden before any modal opens.
- `#toast-container` moves above the phone bottom bar through `body:has(.doc-bottom-bar)`;
  Firefox < 121 (ESR 115) ignores `:has()` and shows the toast under the bar.
- The two proposal-list selectors are rebuilt on every `renderVariantList()`; focus is handed back
  by class name (2026-11-06).

### Design

**K.1 Keyboard and focus for every modal (S, ~40 lines in `app.js`).** `openModal` records
`document.activeElement` as the opener, sets `role="dialog"`, `aria-modal="true"` and
`aria-labelledby` (the `.modal-title` gets an id) on `#modal-box`, then moves focus: on a fine
pointer to the first field or button in the content that is not `.modal-cancel`, on a coarse
pointer (phone sheet) to `#modal-box` itself (`tabindex="-1"`) so the on-screen keyboard does not
jump up before the reader has seen the sheet. One document-level `keydown` listener, wired once:
Escape while the overlay is visible → `closeModal()`; Tab/Shift+Tab at the last/first focusable
element inside `#modal-box` wraps around (focus trap). `closeModal` returns focus to the opener
when it is still in the document, otherwise to `#app-main`. The destructive confirmations
(withdraw, hide, delete comment, resolve) use `confirm()`, and document delete is a two-step inside
the settings modal, so Escape can only cancel, never skip a confirmation.
Tests: new `tests/e2e/modal.spec.js` (3 tests, Firefox): Propose → focus is in the form → Escape
closes and focus is back on `#propose-btn`; Tab from the last button wraps to the first field;
`mobile.spec.js` gains an assertion that the sheet opens with focus on `#modal-box` and no field
focused. Docs: ARCHITECTURE § Frontend (modal paragraph), `specs/test-plan.md` row, manual rows
for VoiceOver/TalkBack announcing the dialog title.

**K.2 Toast placement without `:has()` (S, 3 lines).** `setMain()` toggles
`document.body.classList` `has-bottom-bar` from whether the new view contains `.doc-bottom-bar`;
the CSS rule becomes `body.has-bottom-bar #toast-container`. Covered by the existing
`mobile.spec.js` toast-above-bar assertion. Same commit as K.1.

**K.3 Build the list controls once (S, inside phase 4).** `renderVariantList()` creates the two
selectors on first render per holder and afterwards only rewrites option labels (counts) and
values, which removes the focus hand-back. Do it when the design pass restyles the controls
(and decides whether desktop gets segments), not before — the e2e assertions stay the same.

**Owner items, unchanged:** commit the working tree; deploy Phase P + M + K together and run the
real-phone rows in `specs/manual-validation.md`; D1 (`howot-host-service.md`, `resume.txt`).

**Order:** K.1 + K.2 (one commit, full suite) → K.4 (done) → owner deploy → phase 4 with K.3.

**K.1 + K.2 done 2026-11-10:** `openModal`/`closeModal`/`wireModalKeys` in `app.js` as designed (`MODAL_FOCUSABLE`, `modalOpener`; one document keydown listener; coarse pointer → focus on `#modal-box`); `#modal-box:focus, #app-main:focus { outline: none }`; `setMain()` toggles `body.has-bottom-bar`, CSS rule renamed. Tests: `tests/e2e/modal.spec.js` (2 tests: focus in + dialog attributes + Escape returns focus; Tab/Shift+Tab wrap + × returns focus) and a phone assertion in `mobile.spec.js`. app.js 1 631 lines. Tests: 363 node (incl. the tutorial-cue contract), 87 e2e. K.3 stays in phase 4.

**Omission pass after K (2026-11-10, later the same day):** the *Manage access* modal replaces its
content after the data loads and lost the `id="modal-title"` the dialog's `aria-labelledby` points at
(fixed in `review.js`, both the loaded and the error branch; third test in `modal.spec.js`, which also
checks Escape from a `<select>`). UC-2 step 6 still said submit navigates to the proposal page; it
now describes the stay-in-place flow. Checked and fine: every one of the thirteen callers passes a
title; the selection toolbar never takes focus (its `mousedown` is prevented), so focus on close
returns to what had it before the bar was pressed; Escape in `selection.js` only hides the bar.
88 e2e.

**K.4 Keep typed text on an accidental close (S, ~15 lines in `app.js`, before the design pass).**
Six modals take free text (Propose, Fork, Edit proposal, New document, Document settings, Profile).
Three ways out are deliberate (×, Cancel, submit); two are easy to hit by accident: Escape, and a
click or tap on the dim overlay — on a phone the overlay is the whole area above the sheet, so a tap
meant to scroll the document throws away a half-written proposal. Design: `openModal` snapshots the
value of every text input and textarea in the fresh content; `modalDirty()` compares; Escape and the
overlay click go through `requestClose()`, which asks `confirm('Discard what you typed?')` only when
something changed. × and Cancel stay immediate (they are explicit), submit paths call `closeModal()`
directly as today. Chooser → fork (two `openModal` calls while open) simply re-snapshots. Test:
`modal.spec.js` — type in *New text*, Escape with the confirm dismissed → the dialog stays and the text
is kept; Escape with it accepted → closed. Docs: UC-2 note, ARCHITECTURE modal paragraph, manual row
for the phone overlay tap. Recommendation: build in the next round together with any further K items,
one commit with K.1–K.2.

**K.4 done 2026-11-16:** `MODAL_TEXT`, `modalInitial` (node → value at open) and `requestCloseModal()` in `app.js`; Escape and the overlay click use it, ×/Cancel/submit call `closeModal()` directly. Fourth test in `modal.spec.js` (dismiss keeps dialog and text, overlay click asks too, accept closes, Cancel and an untouched form never ask). app.js 1 642 lines. 89 e2e.

## Phase V — Tutorial video production (designed 2026-11-10, voice decided 2026-11-13, V.1 + V.2 built 2026-11-16 for English)

**Ask:** short clips with voice-over, a visible pointer that moves and clicks, and typing that the
viewer can follow — in English and Norwegian — showing how VoteText works.

### What exists today

- `specs/tutorial-video-script.md` / `.no.md`: 14 chapters (0–13, ~12 min), each a sequence of
  `[screen: …]` cues followed by the narration spoken over that cue; the cues are identical in both
  files (enforced by convention, checked in the vt-docs round). `npm run seed-demo` builds the cast
  (four personas with printed session cookies) and four documents frozen at open / voting /
  final_voting / resolved. Chapters are independent and restart from the seeded state.
- Playwright (`@playwright/test`, already a devDependency; Firefox + Chromium installed) can drive a
  real browser, type with a per-key delay, record each page to WebM (`recordVideo`), and emulate a
  phone (`devices['iPhone 13']`). Its recording does **not** show an OS cursor.
- `ffmpeg` is installed (`/usr/bin/ffmpeg`). `db.js` honours `DATABASE_PATH`, so a tutorial database
  can live beside the e2e one. The e2e global setup already shows how to boot the server on a spare
  port against its own database and read OTP codes straight from SQLite.
- No text-to-speech on the machine (`edge_tts` is not installed; Python 3 and Node 22 are).

### Options

| | Approach | Pros | Cons |
|---|---|---|---|
| A | **Scripted recording** — one Playwright script per chapter drives the browser against seed-demo data, records WebM, overlays a drawn cursor, types with a human delay; narration is synthesised per cue; ffmpeg mixes audio and video and concatenates | Re-recordable with one command after every UI change (the design pass is next); EN and NO from one action script; exact timing of voice to screen; the same scripts double as living documentation of the flows | Up-front toolkit (M); synthetic voice unless replaced; a drawn cursor, not the OS one |
| B | **Manual recording** — OBS or the OS recorder, the owner clicks and reads the script | Zero code, natural voice and pointer | 12 minutes × 2 languages of takes, redone after the design pass and after every later UI change; timing drifts between the two languages |
| C | **Hybrid** — A for the screen (video + cue timeline), owner records the voice per cue into the same file slots, ffmpeg assembles | Natural voice, automated screen | The owner still records ~25 minutes of speech, once per revision of the script text |

**Verdict: A, built so that C is a drop-in later.** The pipeline is file-based (`audio/<lang>/<chapter>-<beat>.wav`);
synthesised files can be replaced by recorded ones per beat without touching the scripts.

### Design

**Layout.** `tutorial/` at the repo root (not under `tests/`, so Playwright's test runner ignores it):

```
tutorial/
  record.js            # node tutorial/record.js <chapter|all> --lang en|no [--phone]
  lib/server.js        # boots src/server.js on port 3002 with DATABASE_PATH=data/tutorial_votetext.db, runs seed-demo, returns cookies + doc ids
  lib/script.js        # parses the chapter's [screen: …] cues + narration paragraphs out of the .md (both languages)
  lib/stage.js         # the acting primitives: glide(sel), click(sel), type(sel, text), spotlight(sel), beat(id)
  lib/cursor.js        # addInitScript: draws #tutorial-cursor (SVG arrow / touch dot) that follows mousemove, ripple on mousedown
  lib/tts.js           # kokoro-js (EN) / Piper or recorded files (NO) → wav per beat, cached by text hash; returns durations
  lib/assemble.js      # ffmpeg: beat audio placed on the timeline → one track; mux with the WebM → mp4; SRT; title card; concat
  chapters/ch01-signin.js … ch13-outro.js   # one action script per chapter, cue ids match the .md order
  out/                 # gitignored: webm, wav, mp4, srt, timeline.json
```

**Beats.** A chapter script is a list of `beat(n, async () => { …actions… })`. The toolkit looks up
cue *n* of that chapter in the script file for the chosen language, has the audio for its narration
(generated beforehand, so its duration is known), starts the clock, runs the actions, then holds the
screen for `max(0, audioDuration − elapsed) + 400 ms`. Every beat's actual start offset is written to
`timeline.json`; assembly puts each audio file at its offset (`adelay` + `amix` in one ffmpeg call),
so the voice starts exactly when the cue starts even if an action was slower than expected. One
action script serves both languages because the cues are identical; only the hold times differ.

**Pointer and typing.** `cursor.js` is injected with `context.addInitScript`: a fixed-position SVG
arrow that follows `mousemove` (Playwright's `mouse.move` dispatches real events) with a click ripple
on `mousedown`; the phone variant is a translucent touch dot. `glide(sel)` moves in ~25 steps with
ease-in-out over 500–700 ms to the element's centre; `spotlight(sel)` pulses a ring around an element
for the duration of a beat ("pointing"); `type(sel, text)` uses `pressSequentially` with 45–70 ms
per key and a longer pause after punctuation. Text selection for the propose chapter uses
`mouse.down` → `glide` → `mouse.up` across the sentence, so the floating bar appears exactly as in
UC-24.

**Voice (decided 2026-11-13: Kokoro).** Narration is synthesised at build time with
[kokoro-js](https://www.npmjs.com/package/kokoro-js) (Apache-2.0, the 82M Kokoro model as ONNX,
runs on the CPU in Node, nothing in the request path and no key). `tts.js` loads the model once per
run, renders one WAV per beat (24 kHz) and caches by text hash; the model weights (~300 MB
quantised) download on first use into the package cache, which stays out of the repo. English voice:
`bm_george` or `bf_emma` (British) — the owner picks after hearing chapter 6. Cost: one devDependency
(`kokoro-js`), which the owner adds himself or approves before V.2.
**Norwegian gap:** Kokoro v1.0 covers eight languages (American/British English, Spanish, French,
Hindi, Italian, Brazilian Portuguese, Japanese, Mandarin) and no Norwegian; kokoro-js also phonemises
everything with English rules. The NO track therefore needs one of: (a) **Piper** offline voice
`no_NO-talesyntese-medium` (free, ONNX, a standalone binary release — no pip needed, downloaded into
`tutorial/bin/`, gitignored; quality is plain but clear), (b) the owner's own recording per beat (option
C, the file slots are the same), (c) Azure `nb-NO-FinnNeural` (rejected 2026-11-13 in favour of a
local voice). Recommendation: (a) for every draft, (b) for the release if the Piper voice is not good
enough. Decision Q30 below.

**Output.** Per chapter: `chNN-<lang>.mp4` (1280×800 H.264 + AAC, 3 s title card from an HTML slide
rendered in the same browser, burnt-in subtitles optional, sidecar `.srt` always) — the "short
clips". Plus `votetext-tutorial-<lang>.mp4`: all chapters concatenated with MP4 chapter markers.
A phone clip (`--phone`, iPhone viewport at 2× → 750×1334) for chapter 6 proposing from a phone.
Nothing under `tutorial/out/` is tracked (the root `.gitignore` already ignores any `out` directory; `data/*` covers the tutorial database).

**Server and data.** `lib/server.js` mirrors `tests/e2e/global-setup.js` (busy-port guard, health
wait) on port 3002 with its own database; `seed-demo` runs against it; chapter 1's OTP is read from
the database as the tests do. Chapter 9 changes the Budget document's status, so `all` records it
last and the seed is rebuilt before each chapter anyway (seeding takes well under a second).

### Phases

| Phase | Content | Effort |
|---|---|---|
| V.1 | **Done 2026-11-16.** Toolkit without audio: server boot + seed, cursor overlay, stage primitives, script parser, timeline; chapter 6 (proposing) recorded in EN as a silent clip for review of pace and pointer | M |
| V.2 | **Done 2026-11-16 (EN).** Voice and assembly: `tts.js` (kokoro-js for EN; recorded files for NO), `assemble.js` (track, mux, SRT, burnt-in copy), chapter 6 in EN with voice; README/ARCHITECTURE/CLAUDE.md/tutorial production notes | M |
| V.3 | All 14 chapters + the phone clip (`devices['iPhone 13']`, touch dot pointer, chapter 6 only); `all` mode with concat and chapter markers; owner review of the `bm_george` voice against `bf_emma`. **Done early (2026-11-16):** `--list-beats` and the per-beat recorded takes (`out/audio/<lang>/chNN-<beat>.wav`) for the owner's Norwegian recordings | L |
| V.4 | After the design pass: re-record everything with one command; owner review; optional C (own voice per beat) | S |

**Tests.** The toolkit is not part of `npm test`. `tests/unit.test.js` already asserts (since
2026-11-10) that the `[screen: …]` cues of the EN and NO scripts are identical and in the same order —
the contract one action script per chapter depends on; V.1 extends it to the parser (one beat per cue
per chapter). Recording runs are manual and local.

**Order.** V.1 and V.2 can be built now against the current UI (the toolkit is UI-independent apart
from selectors, and chapter 6 exercises the Phase M bar). V.3 waits for the design pass, so the
remaining twelve scripts are written once against the final DOM. The existing plan item "record
after the design pass" (Phase 6) becomes V.4.

### V.1 + V.2 done 2026-11-16 (English)

Built as designed, with these differences: audio is WAV throughout and the narration track is laid
out in Node (`lib/wav.js`) instead of an ffmpeg `adelay`/`amix` graph, which the installed ffmpeg 4.4
handles unevenly; the title card is rendered in the recorded page for 3 s (no concat per chapter);
`stage.narrate()` lets an action script start the narration mid-beat (chapter 6 beat 3: the words
"Submitted…" come after the 30 s of typing, not before); `npm run tutorial -- <chapter>` exists as a
script line. One devDependency added with the owner's go: `kokoro-js` (pulls `@huggingface/transformers`
and the ONNX runtime; the q8 model, ~90 MB, lands in the package cache on first run, never in the repo).
Chapter 6 recorded in English: 105 s, five beats, `bm_george`, sidecar and burnt-in subtitles; frames
checked (pointer, drag selection, floating bar, typed form, spotlight). Running `--lang no` needs
`--silent` or the owner's WAV files in `out/audio/no/` (Q30). Found on the way and fixed: the scripts and
UC-2/UC-24 said pending lines turn *amber*; the app highlights them in blue (`--color-highlight-pending`),
so three cues and two narration lines changed in both languages. Chapter 1 has a cue with no narration
(the profile save, followed at once by the empty list) — the toolkit treats it as a silent beat.
Tests: three unit tests in `tests/unit.test.js` (parser shape and EN/NO parity, one action per cue in
every `chapters/` file; WAV round trip, track offsets, SRT and ASS; recorded takes and the missing-take error). The toolkit itself is not under `npm test`
beyond those contracts; a recording is the review.

**Norwegian track (parallel, owner's voice; built 2026-11-16).** Same action scripts.
`npm run tutorial -- 6 --lang no --list-beats` prints, per beat, the text to read and the file it must be saved
as: `tutorial/out/audio/no/ch06-<beat>.wav` (any sample rate, mono, 16-bit or float; beats without narration
need no file). The owner records them and runs `npm run tutorial -- 6 --lang no`; a recorded take wins over
Kokoro for every language, so an English beat can be re-voiced the same way. Missing takes in a language
without a Kokoro voice stop the run with the list of files still needed; `--silent` records without audio
(the timeline and the Norwegian `.srt` still come out). Verified end to end with stand-in takes: 108 s
Norwegian clip, Norwegian title card and subtitles. The hash-named cache files were never usable as
drop-in slots because the owner could not compute the names — that was the omission this closes.
Found on the way: the burnt-in subtitles were stretched sideways (libass lays a plain SRT out in a 4:3
reference frame, the clip is 16:10) and touched the toast in the corner; the burnt-in copy now renders from
a generated `.ass` with the real picture size (Liberation Sans, 3 % of the height, translucent box, 8 %
bottom margin).

### Decisions needed (Q26–Q30)

| # | Question | Recommendation |
|---|---|---|
| Q26 | Voice: Azure neural TTS, `edge-tts`, Piper, or the owner's own recording? | **Decided 2026-11-13: Kokoro (kokoro-js) at build time** — a local, keyless voice; C stays open per beat |
| Q30 | Norwegian voice, since Kokoro has none: Piper `no_NO-talesyntese-medium`, own recording, or Azure? | Piper for drafts, own recording for the release if Piper is not good enough |
| Q27 | Resolution and ratio: 1280×800 (the script's recommended viewport) or 1920×1080? | **Settled 2026-11-16:** 1280×800 layout, 1920×1200 frames (the default `--scale 1.5`). Found on the way: an *emulated* `deviceScaleFactor` only pads the recorder's frame (content stays 1280×800), and CSS `zoom` on the root skews the app's own rectangle maths (the floating bar lands in the wrong place). What works is Chromium's `--force-device-scale-factor=1.5` launch flag with the plain 1280×800 viewport: the recorder then takes real device pixels and the text is sharp |
| Q28 | Subtitles burnt in, sidecar only, or both? | Both: sidecar `.srt` always, a burnt-in variant (from a generated `.ass` at the real picture size) for channels without caption support |
| Q29 | Build V.1 + V.2 before the design pass? | Yes — the toolkit is ready the day the design lands, and chapter 6 gives an early look at pace and voice |

## Remaining work packages

### Phase 4 — Visual design pass

Now the next UI step (K.3 goes in here); Phase V V.1 + V.2 run in parallel. Agree direction first (palette, typography, density, light/dark),
then tokens → components → responsive, with the full e2e suite (89 tests, incl. the XSS
and regression specs and the Chromium phone project) as the gate. The phone layout fixes from
phase 3 and the Phase M bar, sheet and list controls are functional only; the design pass
should revisit them (the two `<select>`s may become segments on desktop).

### Phase 5 — Manual validation

All sign-off rows in `specs/manual-validation.md` are empty, including the three added
for the review fixes, phase 3 and the deploy.

### Phase 6 — Tutorial video

Both scripts match the app as of 2026-11-16 (floating bar, filter/order selects, stay-in-place toast, blue pending highlight). Production is Phase V above: V.1 + V.2 are built (chapter 6 in English, `npm run tutorial -- 6`), the Norwegian track takes the owner's recordings per beat (`--list-beats`); V.3 (the other chapters) after the design pass; V.4 is the final recording.

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
