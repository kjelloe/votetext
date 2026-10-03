# VoteText — Plan to Production

_Last updated: 2026-10-03 (phase 3 implemented)_

A full review on 2026-10-02 found access, correctness and security gaps, spec features
with no UI, and a tutorial script describing behaviour the app does not have. Phases 1,
2 and 3 are implemented and tested locally. **Nothing is committed or deployed**; the
production server is live and still runs the old code.

Test status: **323 node tests** green (273 API + 30 unit + 12 frontend contract +
8 migration) and **65 Playwright e2e tests** green, run on the final state.

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

### Deploy and docs

- `ssh-deploy.sh`: committed files only, tests first, refuses a dirty tree, backup,
  migrate, `/healthz` check, automatic restore; deploying a commit older than the live
  one skips the migration; `--no-migrate` flag. Exercised end to end against a local
  stand-in server; **never run against the live server**.
- `cloud-init-example.yaml`, `.env.example`, README, ARCHITECTURE, CLAUDE.md,
  `specs/` (use cases incl. new UC-21, user stories, test plan groups AA and AB,
  manual validation, both tutorial scripts), the three `.claude/commands` skills and
  `howot-host-service.md` updated.

---

## To ship phases 1–3

1. Review and commit. Before committing, untrack the test artifacts (they are now in
   `.gitignore`): `git rm -r --cached playwright-report tests/e2e/.auth`.
2. `./ssh-deploy.sh --dry-run`, then `./ssh-deploy.sh`. This deploy rebuilds several
   tables on the live database to match `schema.sql`; the script backs the database up
   first and restores it if the health check fails. The script lists files earlier
   rsync deploys left in `/opt/votetext` — review and remove them by hand.
3. On the server, add `client_max_body_size 2m;` to the nginx site by hand (certbot has
   edited that file), `nginx -t`, reload.
4. To restrict sign-in, add `SIGNUP_MODE=invited` and
   `SIGNUP_ALLOWLIST=<your email or @domain>` to `.env.prod` and deploy with `--env`.
5. `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` in `.env` / `.env.prod` are now read
   (100 sign-in requests per minute per address with your current values). Remove
   `LOG_LEVEL`, `ACTIVITY_REFRESH_INTERVAL` and `OTP_LOCKOUT_MINUTES` — nothing reads them.

---

## Remaining work packages

### Left as they are, with the reason

- `decideOutcomes` on three-level chains depends on row order — only reachable with
  data created before the nesting guard; produces a blocker, never a wrong text.
- The invite link falls back to the request's Host header when `VOTETEXT_URL` is unset
  — it is set in production.
- A distributed attacker can still invalidate a victim's sign-in code; one address
  cannot. Acceptable for this scale.
- The conflict view groups an insert by its selected range although it only occupies a
  point — conservative, never wrong.
- Integer values from the server are interpolated without `esc()` in a few places
  (line numbers, counts) — server-computed, not user input.

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

### Phase 7 — Launch checklist

- [ ] Real Resend key and verified sender in `.env.prod`; OTP email smoke test on the
      live domain
- [ ] `SESSION_SECRET` and `RESEND_API_KEY` present in `.env.prod` (the server will not
      start without them)
- [ ] `SIGNUP_MODE` decided for the public server
- [ ] Offsite backup in place and one restore rehearsed
- [ ] `certbot renew --dry-run`; the 03:00 backup cron produces files; unattended
      security upgrades on

### Any time, in parallel

| ID | Item | Effort |
|---|---|---|
| T4 | GitHub Actions: `npm ci && npm test` on every push; Playwright as a second job with the report uploaded on failure | S |
| O3 | Mirror the template changes into the private `cloud-init.yaml` | S |
| O4 | Offsite backup: Hetzner Storage Box via `rsync` in the cron job, a pull from your own machine, or `restic` to object storage | S–M |
| O5 | Run the app as a dedicated service user; narrow the deploy user's sudo to the `votetext` unit | M |
| O6 | Q9: tracked `scripts/deploy.sh` + gitignored `deploy.env`; `votetext-ops` for `cloud-init.yaml` and `.env.prod` | S |
| D1 | Rename `howot-host-service.md` and decide whether it belongs in the repo | S |

### Later, unscheduled

"Export resolved document (further polish)" from the README roadmap; draft text editing
(Q3); auto-join for default-access documents (Q4); restore or purge of soft-deleted
documents; pagination for the document and user lists; a way to deactivate a user
(`is_active` has no setter); transaction around invite upsert + log.

```
Phases 1–3 (done, to ship) ──► Phase 4 design pass
                                      │
                   Phase 5 validation ◄┤
                   Phase 6 video      ◄┘
                          │
                   Phase 7 launch checklist
```
