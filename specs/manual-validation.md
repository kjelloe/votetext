# Manual Validation — pending sign-off

Compact per-UC checklist for features that shipped recently and are not covered by
automated e2e tests. A UC is closed in `use-cases.md` only when its section here is
fully checked. Run against `npm run dev` (seeded DB gives alice/bob/carol sessions).

---

## 0. Post-fix browser boot (regression for the viewLogin bug)

The app was unbootable in real browsers between the app.js split and 2026-07-09
(routes array referenced `viewLogin`/`viewProfile` before auth.js loaded).

- [ ] Hard-refresh (Ctrl+Shift+R) → login page renders, no console errors
- [ ] Log in → document list renders; Profile page opens from the header menu
- [ ] Quick click-through: document view → proposal detail → back

---

## UC-15 — Resolved text

- [ ] `final_voting` doc → Review → **Resolved text** → preview shows approved variants applied, line numbers correct
- [ ] **Mark as Resolved** → confirm → status becomes `resolved`; PASSED or FAILED banner with timestamp
- [ ] **Export Markdown** downloads a correct `.md`; **Print HTML** opens a clean printable tab
- [ ] **Fork as new document** → new draft; contains resolved text if PASSED, original text if FAILED
- [ ] Resolved/archived doc → "Resolved text" button visible in document toolbar (owner)

## UC-16 — Fork a variant

- [ ] Open doc, as proposer: proposal detail shows **Fork** button → modal pre-filled with "Your variant of {title}" + original proposed text
- [ ] Submit fork → navigates to the new proposal; original shows a "based on" relation
- [ ] Voting doc, as editor/admin: fork works
- [ ] Voting doc, as plain proposer: fork submit is rejected with a 403 error toast
- [ ] Withdrawn/rejected proposal: no Fork button

## UC-17 — Majority thresholds

- [ ] Doc settings modal: **Majority threshold** dropdown → set ⅔ → save → reopen shows ⅔ persisted
- [ ] Final voting walkthrough: per-proposal Threshold dropdown defaults to "Doc default (…)"; changing it updates the majority label immediately and persists on reload
- [ ] Majority label uses the right denominator: simple = yes/(yes+no); absolute/⅔/¾ = yes/(yes+no+abstain) — try 4 yes / 2 no / 2 abstain with ⅔ → "50% yes — needs ⅔ majority" in red
- [ ] Review list: compact threshold selector on cards works
- [ ] Export CSV has a Threshold column; Print HTML shows "Threshold: X" per proposal
- [ ] Resolve a doc where a ⅔ proposal has yes ≤ ⅔ of total → proposal ends `rejected`

## UC-19 — Supervisor role

Invite a test user as `supervisor` on a doc you own, log in as them in a second browser.

- [ ] Supervisor sees **Manage access** button; modal shows the access list read-only (no Remove buttons, no Default access selector) with an invite form capped at supervisor
- [ ] Supervisor invites a new user at `supervisor` → appears in list; re-inviting an existing user → error toast (admin required)
- [ ] Supervisor moves doc open → voting; runs Review (status buttons work), Resolve conflicts, transitions to final voting
- [ ] Supervisor records tallies, changes a per-proposal threshold, fills overall doc vote, views resolved text, clicks Mark as Resolved → doc resolves
- [ ] Supervisor can NOT: edit document settings (settings modal hidden/403), see a draft doc, archive a resolved doc
- [ ] Voter-level user still gets 403 on all of the above

---

## UC-18 — Moderation

Use the supervisor from UC-19 (or any editor/admin) plus a voter in a second browser.

- [ ] Supervisor opens a proposal → **Hide** button → confirm → red "Hidden by moderator" banner appears
- [ ] Voter's sidebar no longer lists the proposal; opening its direct URL shows an error (404)
- [ ] Document sidebar shows a **Moderation** link for the supervisor (voter has none) → page lists the hidden proposal → **Unhide** restores it for the voter
- [ ] Supervisor clicks **Hide** on the voter's comment → voter sees "*Comment hidden by moderator*" placeholder (no text/author); supervisor still sees the text inline + Unhide
- [ ] Voter deletes their own comment → gone for everyone; it does NOT appear on the Moderation page and cannot be unhidden
- [ ] Set your own `users.role = 'superadmin'` in the DB, re-login → **Users** link in the header menu → Protect a user → they vanish from the access-invite search; Unprotect brings them back

---

## UC-20 — Comment editing

Post a comment as one user; use a second browser for the reply-grace checks.

- [ ] Own comment shows an **Edit** button within the window → click → inline form pre-filled with the current text; Save updates it in place
- [ ] After saving, a "· edited <time>" marker appears next to the timestamp; reload keeps the marker and the new text
- [ ] Another user's comment shows no Edit button; your own comment past the 30-min window (`COMMENT_EDIT_WINDOW_MINUTES`) no longer offers Edit
- [ ] Edit a parent comment → its direct replies show a "parent comment was edited" hint and regain an **Edit** button even if their own window had passed
- [ ] A comment hidden by a moderator cannot be edited (no Edit button; direct PATCH returns 422)
- [ ] Activity feed / log records the edit (`comment_updated`); the previous text is not shown in the UI payload

---

## Sign-off

| UC | Validated by | Date | Result |
|----|--------------|------|--------|
| Boot regression | | | |
| UC-15 | | | |
| UC-16 | | | |
| UC-17 | | | |
| UC-18 | | | |
| UC-19 | | | |
| UC-20 | | | |
