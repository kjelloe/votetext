# VoteText — Test Plan

> Automated: `npm test` runs `tests/api.test.js` against an isolated SQLite database on port 3099.
> Manual UI: open `http://localhost:3000` after `npm run dev` and follow the flows below.

---

## Group A — Authentication

| ID | Scenario | Expected |
|----|----------|----------|
| A1 | POST `/auth/request-otp` with valid email | 200, OTP code stored in `otp_codes` table |
| A2 | POST `/auth/request-otp` with missing/invalid email | 400 |
| A3 | POST `/auth/verify-otp` with correct code | 200, `session_id` cookie set, user object returned |
| A4 | POST `/auth/verify-otp` with wrong code | 401 |
| A5 | POST `/auth/verify-otp` with already-used code | 401 |
| A6 | GET `/auth/me` with valid cookie | 200, user object |
| A7 | GET `/auth/me` with no cookie | 401 |
| A8 | POST `/auth/logout` | 200, cookie cleared, subsequent `/me` returns 401 |
| A9 | OTP rate limit: 5 requests per email per 15 min | 6th request returns 429 |
| A10 | POST `/auth/profile` — update display_name, organization | 200, changes persisted |

---

## Group B — Document Import

| ID | Scenario | Expected |
|----|----------|----------|
| B1 | POST `/documents` with plain text | 201, `document_lines` rows created |
| B2 | Char offsets are contiguous and cover full text length | `char_offset_end` of last line equals `total_chars` − 1 |
| B3 | Page breaks occur at correct line intervals | Lines per page matches `settings.lines_per_page` |
| B4 | GET `/documents/:id/lines?page=2` | Returns lines for page 2 only |
| B5 | POST `/documents` with text exceeding `MAX_DOCUMENT_CHARS` | 400 |
| B6 | POST `/documents` without title | 400 |
| B7 | POST `/documents` without text | 400 |

---

## Group C — Variants

| ID | Scenario | Expected |
|----|----------|----------|
| C1 | Create `replace` variant with valid range | 201, `status = pending` |
| C2 | Create `insert` variant (char_start = char_end) | 201 |
| C3 | Create `delete` variant | 201 |
| C4 | Create variant with char_end > total_chars | 400 |
| C5 | Create variant with char_end < char_start | 400 |
| C6 | Create two overlapping variants | Both 201; `overlaps` relation auto-created |
| C7 | PATCH variant while pending, by proposer | 200 |
| C8 | PATCH variant by non-proposer | 403 |
| C9 | PATCH variant that is not pending | 422 |
| C10 | DELETE (withdraw) variant by proposer | 200, `status = withdrawn` |
| C11 | GET `/documents/:id/variants` | 200, withdrawn and hidden variants excluded |
| C12 | Propose variant on `draft` document | 201 (allowed) |

---

## Group D — Variant Relations

| ID | Scenario | Expected |
|----|----------|----------|
| D1 | POST `/variants/:id/relations` with valid relation | 201 |
| D2 | POST with duplicate relation | 409 |
| D3 | POST with self-relation | 400 |
| D4 | POST with invalid `relation_type` | 400 |
| D5 | POST with `to_variant_id` from different document | 422 |
| D6 | GET `/variants/:id/relations` | 200, both sides of relation returned |

---

## Group E — Voting

| ID | Scenario | Expected |
|----|----------|----------|
| E1 | POST `/variants/:id/vote` with value 1 | 200, `votes_for` increments |
| E2 | POST same variant again with value -1 | 200, `votes_for` = 0, `votes_against` = 1 (upsert) |
| E3 | POST with value 0 (abstain) | 200, `votes_abstain` increments |
| E4 | POST with invalid value (e.g., 2) | 400 |
| E5 | DELETE `/variants/:id/vote` | 204, tallies decremented |
| E6 | GET `/variants/:id/votes` | 200, vote list + tallies |
| E7 | Cast vote on document with status `resolved` | 422 |
| E8 | Two different users vote on same variant | Both 200, count = 2 |

---

## Group F — Comments

| ID | Scenario | Expected |
|----|----------|----------|
| F1 | POST top-level comment | 201 |
| F2 | POST reply to top-level comment | 201, `parent_comment_id` set |
| F3 | POST reply to a reply (3rd level) | 422 |
| F4 | GET `/variants/:id/comments` | 200, top-level comments with `replies` array |
| F5 | PATCH comment within 30-min window by author | 200 |
| F6 | PATCH comment by non-author | 403 |
| F7 | DELETE comment by author | 204, comment hidden |
| F8 | DELETE comment by document admin | 204 |
| F9 | DELETE comment by non-author, non-admin | 403 |

---

## Group G — Access Control

| ID | Scenario | Expected |
|----|----------|----------|
| G1 | `viewer` tries to POST a variant | 403 |
| G2 | `commenter` tries to POST a variant | 403 |
| G3 | `proposer` can POST a variant | 201 |
| G4 | Upgrade user from `viewer` to `proposer` | 200 |
| G5 | Block user → blocked user GET document | 403 |
| G6 | Unblock user → user can GET document again | 200 |
| G7 | Unauthenticated GET on document with `allow_anonymous_view = false` | 403 |
| G8 | Unauthenticated GET on document with `allow_anonymous_view = true` | 200 |
| G9 | DELETE `/documents/:id/access/:userId` | 204, access revoked |
| G10 | Non-owner tries to DELETE document | 403 |
| G11 | GET `/variants/:id/comments` on private document without auth | 403 |
| G12 | GET `/variants/:id/votes` on private document without auth | 403 |
| G13 | GET `/variants/:id/relations` on private document without auth | 403 |
| G14 | DELETE `/documents/:id` — document soft-deleted, subsequent GET → 404 |

---

## Group H — Document Status Lifecycle

| ID | Scenario | Expected |
|----|----------|----------|
| H1 | `draft → open` | 200 |
| H2 | `draft → voting` (invalid skip) | 422 |
| H3 | `open → voting` | 200 |
| H4 | `open → draft` (rollback) | 200 |
| H5 | `voting → resolved` | 200 |
| H6 | `resolved → archived` | 200 |
| H7 | `archived → any` | 422 (no further transitions) |
| H8 | Vote on `resolved` document | 422 |
| H9 | Propose variant on `archived` document | 422 |
| H10 | `POST /status { status: 'voting', countdown_minutes: 5 }` on open doc | 200, status stays `open`, `voting_scheduled_at` set ≥5 min from now |
| H11 | `GET /documents/:id` after scheduling | 200, `voting_scheduled_at` field present and set |
| H12 | `POST /status { cancel_schedule: true }` with active schedule | 200, `voting_scheduled_at` = null |
| H13 | `POST /status { cancel_schedule: true }` with no active schedule | 422 |
| H14 | Auto-transition: set `voting_scheduled_at` to past, then `GET /documents/:id` | 200, status = `voting`, `voting_scheduled_at` = null |
| H15 | `POST /status { status: 'voting', countdown_minutes: 0 }` | 200, status = `voting` immediately, `voting_scheduled_at` = null |

---

## Group I — Activity Feed

| ID | Scenario | Expected |
|----|----------|----------|
| I1 | GET `/activity` — default feed | 200, all activity on documents user owns or has access to, reverse chronological |
| I2 | GET `/activity?mine=true` — filtered feed | 200, only actions performed by the requesting user |
| I3 | GET `/documents/:id/activity` | 200, `document_created` action present |
| I4 | Pagination: `?page=2` | 200, second page of results |

---

## Group J — Client Config Delivery

| ID | Scenario | Expected |
|----|----------|----------|
| J1 | GET `/auth/me` — response includes `config` | 200, `config.toast_dismiss_seconds` (number), `config.voting_countdown_default_minutes` (number) |

---

## Group K — Review View & Conflict Resolution

| ID | Scenario | Expected |
|----|----------|----------|
| K1 | PATCH `/variants/:id/review-status { status: 'conflict' }` — owner on voting doc | 200, `status = conflict` |
| K2 | PATCH `/variants/:id/review-status { status: 'rejected' }` — change from prior status | 200, `status = rejected` |
| K3 | PATCH `/variants/:id/review-status { status: 'pending' }` — restore to voting | 200, `status = pending` |
| K4 | PATCH `/variants/:id/review-status { status: 'not_applicable' }` | 200, `status = not_applicable` |
| K5 | PATCH with `status: 'approved'` (not in allowed list) | 400 |
| K6 | PATCH on variant in a non-voting document (e.g., archived) | 422 |
| K7 | PATCH by user with only `viewer` access | 403 |
| K8 | PATCH `/variants/:id/conflict-order { vote_order: 1 }` — owner on voting doc | 200, `vote_order = 1` |
| K9 | PATCH `/variants/:id/conflict-order { vote_order: null, parent_variant_id: N }` — make child with explicit null | 200, `parent_variant_id` set, `vote_order` null |
| K10 | PATCH with `parent_variant_id` pointing to a child (3-level nesting) | 400 |
| K11 | PATCH with self as parent | 400 |
| K12 | PATCH conflict-order on non-voting doc | 422 |
| K13 | PATCH conflict-order by viewer | 403 |
| K14 | POST `/documents/:id/status { status: 'final_voting' }` — voting doc → 200 | 200, `status = final_voting` |
| K15 | POST `/documents/:id/status { status: 'voting' }` — final_voting → voting (rollback) → 200 | 200, `status = voting` |

---

## Group L — Final Voting

| ID | Scenario | Expected |
|----|----------|----------|
| L1 | PATCH `/variants/:id/final-vote { yes: 12, no: 3, abstain: 2 }` — editor on final_voting doc | 200, `final_yes = 12`, `final_no = 3`, `final_abstain = 2` |
| L2 | PATCH partial update `{ yes: 15 }` — other fields preserved | 200, `final_yes = 15`, `final_no = 3`, `final_abstain = 2` |
| L3 | PATCH with negative count `{ yes: -1 }` | 400 |
| L4 | PATCH `/variants/:id/final-vote` on doc not in `final_voting` | 422 |
| L5 | PATCH `/variants/:id/final-vote` by viewer | 403 |
| L6 | PATCH `/documents/:id/doc-vote { yes: 42, no: 1, abstain: 3 }` — editor on final_voting doc | 200, fields stored on document |
| L7 | PATCH `/documents/:id/doc-vote` on doc not in `final_voting` | 422 |
| L8 | PATCH `/documents/:id/doc-vote` by viewer | 403 |

---

## Group M — Gap Fixes (voting lifecycle guards)

| ID | Scenario | Expected |
|----|----------|----------|
| M1 | PATCH variant (proposer self-edit) while doc in `voting` | 422 |
| M2 | POST `/variants/:id/vote` while doc in `final_voting` | 422 |
| M3 | PATCH `/variants/:id/review-status` in `final_voting` | 200, status updated |
| M4 | PATCH `/review-status` with `rejected`/`not_applicable`/`withdrawn` — clears `vote_order` | 200, `vote_order = null` |
| M5 | POST `/documents/:id/status → resolved` — runs `resolveVariants()` | 200, `status = resolved`; variants with yes > no → `approved` |
| M6 | GET variant after resolve — yes > no variant | `status = approved` |

---

## Group N — Auto-assign child `vote_order`

| ID | Scenario | Expected |
|----|----------|----------|
| N1 | PATCH `/variants/:id/conflict-order { parent_variant_id: N }` — no `vote_order` sent | 200, `vote_order = 1` (auto-assigned as first child) |
| N2 | PATCH same endpoint with `{ vote_order: null, parent_variant_id: null }` — explicit null | 200, `vote_order = null`, `parent_variant_id = null` (explicit null honoured, no auto-assign) |

---

## Group O — Share Proposal

| ID | Scenario | Expected |
|----|----------|----------|
| O1 | GET `/variants/:id` — anonymous on non-public doc, share disabled | 403 |
| O2 | PATCH `/variants/:id/share` by non-proposer | 403 |
| O3 | PATCH `/variants/:id/share { allow_anonymous_share: 1 }` by proposer | 200, field updated |
| O4 | GET `/variants/:id` — anonymous after share enabled | 200, variant returned |
| O5 | PATCH `/variants/:id/share { allow_anonymous_share: 0 }` — disable | 200, field cleared |

---

## Group P — Draft Document Restriction

| ID | Scenario | Expected |
|----|----------|----------|
| P1 | GET `/documents/:id` — draft doc, viewer access | 403 |
| P2 | GET `/documents` — draft doc not visible in non-editor user's list | absent from list |
| P3 | GET `/documents/:id` — draft doc, owner | 200 |
| P4 | GET `/documents/:id` — draft doc, anonymous with allow_anonymous_view=true | 403 (draft always blocked) |

---

## Group Q — Final Vote Log

| ID | Scenario | Expected |
|----|----------|----------|
| Q1 | GET `/variants/:id/final-vote-log` — no auth | 401 |
| Q2 | GET `/variants/:id/final-vote-log` — viewer | 403 |
| Q3 | GET `/variants/:id/final-vote-log` — owner on resolved doc | 200, entries with `recorded_at` (unix ms) and `user_name` present |

---

## Group R — Resolved Text

| ID | Scenario | Expected |
|----|----------|----------|
| R1 | GET `/documents/:id/resolved-text` — no auth | 401 |
| R2 | GET `/documents/:id/resolved-text` — viewer | 403 |
| R3 | GET `/documents/:id/resolved-text` — `final_voting` doc, editor | 200, `text` string, `resolved_at: null`, `doc_vote_passed: null` |
| R4 | GET `/documents/:id/resolved-text` — doc in `open` status | 422 |
| R5 | POST `/documents/:id/status` `{ status: 'resolved' }` | 200, response doc has `resolved_text` and `resolved_at` set |
| R6 | GET `/documents/:id/resolved-text` — resolved doc | 200, `resolved_at` present, `doc_vote_passed: null` (no doc vote recorded), approved variant text present in `text` |

---

## Group S — Copy Document Data (UC-6)

| ID | Scenario | Expected |
|----|----------|----------|
| S1 | POST `/documents/:sourceId/copy-data { target_doc_id, copy_variants: true }` — owner of both | 200, `copied.variants` > 0; copied variants exist on target with `status = pending` |
| S2 | Copy with `copy_votes: true` | 200, votes copied; target variant tallies match source |
| S3 | Copy with `copy_comments: true` | 200, comments and replies copied; reply parent remapped to new comment id |
| S4 | Source has a withdrawn variant | Withdrawn variant not copied |
| S5 | `copy_votes: true` without `copy_variants` | 200, nothing copied (`copied` all 0) |
| S6 | `target_doc_id` not owned by requester | 403 |
| S7 | `target_doc_id` does not exist | 404 |
| S8 | Requester lacks admin access on source document | 403 |

---

## Group T — Majority Thresholds (UC-17)

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Create doc in `voting` status with one variant (owner) | 200, `threshDocId` and `threshVarId` captured |
| T2 | `PATCH /variants/:id/threshold { majority_threshold: 'absolute' }` — viewer | 403 |
| T3 | `PATCH /variants/:id/threshold { majority_threshold: 'half_and_half' }` — owner | 400 |
| T4 | `PATCH /variants/:id/threshold { majority_threshold: 'two_thirds' }` — owner | 200, `variant.majority_threshold = 'two_thirds'` |
| T5 | `GET /variants/:id` | 200, `majority_threshold` persists |
| T6 | `PATCH /documents/:id { settings: { majority_threshold: 'consensus' } }` | 400 |
| T7 | `PATCH /documents/:id { settings: { majority_threshold: 'absolute' } }` | 200, settings updated |
| T8 | Move doc to `final_voting`, record 2/2/2 tally, resolve — variant has `two_thirds` threshold | variant.status = `rejected` (3×2=6 < 2×6=12) |

---

## Group U — Fork Variant (UC-16)

| ID | Scenario | Expected |
|----|----------|----------|
| U1 | Create open doc with a variant | 200, `forkDocId` and `forkVarId` captured |
| U2 | `POST /variants/:id/fork` — unauthenticated | 401 |
| U3 | `POST /variants/:id/fork` on a draft document | 422 |
| U4 | `POST /variants/:id/fork` by viewer | 403 |
| U5 | `POST /variants/:id/fork` by owner (open doc) — valid body | 201, new variant returned |
| U6 | Forked variant title pre-filled from original | `new_title` matches `"Your variant of …"` prefix |
| U7 | `GET /variants/:newId/relations` | 200, `based_on` relation to original present |
| U8 | `POST /variants/:id/fork` on voting doc by viewer | 403 |
| U9 | `POST /variants/:id/fork` on voting doc by editor | 201 |

---

## Group W — Supervisor Role (UC-19)

> `supervisor` sits between `voter` and `editor`. Manages the voting process
> (review, conflicts, tallies, voting-cycle transitions, invites up to own level)
> without document-editing rights. See `specs/use-cases.md` § UC-19.

| ID | Scenario | Expected |
|----|----------|----------|
| W1 | Setup: draft doc, invite supervisor, supervisor GET draft doc | 403 (draft stays editor+) |
| W2 | GET `/documents/:id` as supervisor | 200, `my_access_level = 'supervisor'` |
| W3 | PATCH `/documents/:id` (edit title) as supervisor | 403 |
| W4 | POST `/access` — supervisor invites new user at `supervisor` | 201 (cap allows own level) |
| W5 | POST `/access` — supervisor grants `editor` | 403 (above own level) |
| W6 | POST `/access` — supervisor re-invites user with existing record | 403 (upsert = modification, admin only) |
| W7 | PATCH/DELETE `/access/:userId` as supervisor | 403 both; GET `/access` → 200 |
| W8 | POST `/status` open→voting as supervisor | 200 |
| W9 | review-status + conflict-order as supervisor | 200 both |
| W10 | Fork during voting as supervisor | 201 |
| W11 | PATCH `/variants/:id/threshold` as supervisor | 200 |
| W12 | POST `/status` voting→final_voting as supervisor | 200 |
| W13 | final-vote, final-vote-log, doc-vote, resolved-text as supervisor | 200 all |
| W14 | POST `/status` final_voting→resolved as supervisor | 200 |
| W15 | POST `/status` resolved→archived as supervisor | 403 (admin only) |
| W16 | PATCH `/documents/:id` `settings.default_access = 'supervisor'` | 400 (default_access capped at voter) |

---

## Group V — HMAC Session Signing

> Session cookies carry `sessionId.hmac` where the HMAC-SHA256 signature (keyed by
> `SESSION_SECRET`) is verified in `optionalAuth` before any DB lookup. Tampered or
> unsigned cookies never reach the sessions table.

| ID | Scenario | Expected |
|----|----------|----------|
| V1 | GET `/auth/me` with a properly signed session cookie | 200; cookie value contains `.` separator |
| V2 | GET `/auth/me` with tampered signature (last char flipped) | 401 |
| V3 | GET `/auth/me` with raw session id, no signature | 401 |
| V4 | GET `/auth/me` with valid signature over a different session id | 401 |

---

## Playwright E2E Suite

> Tests live in `tests/e2e/*.spec.js` (41 tests). Run with `npm run test:e2e`.
> Requires system libs (`sudo npx playwright install-deps`) the first time; uses Firefox.
> The suite manages its own server lifecycle and isolated DB — does not touch `votetext.db`.
> Specs create their own documents via the API (`tests/e2e/helpers.js`) so they stay order-independent.

### Coverage by file

| File | Story | Flows covered |
|------|-------|---------------|
| `crossfile.spec.js` | US-1 + smoke | Login page, full OTP login flow, profile page, unauth redirect, review/conflicts/final-vote/resolved-text render |
| `navigation.spec.js` | US-2 | Doc list → open doc → line highlights → sidebar All/On-page filter → card click → detail → back button |
| `comment.spec.js` | US-3 | Post comment (author + "just now") → indented reply → delete own reply. *Edit-in-window (story step 7) has no UI — API only* |
| `proposal.spec.js` | US-4, US-5 | Programmatic text selection → propose modal → submit → card + highlight; submit disabled without selection; edit title/rationale; withdraw with confirm |
| `vote.spec.js` | US-6 | Cast For → change to Against → click again retracts → Abstain; sidebar tally reflects votes |
| `share.spec.js` | US-7 | Enable anonymous share via checkbox (persists) → anonymous visitor sees read-only proposal + login button → blocked after disable |
| `review-flow.spec.js` | US-8 | Review cards + overlap badge; CONFLICT/NOT VOTING buttons; unresolved group gates Ready (alert); ordering (via API — HTML5 DnD not automatable) turns Ready green → transitions to final_voting |
| `final-voting.spec.js` | US-9 | Progress bar 0→1 of 3; tally save + ✓ Saved + majority label + persistence; threshold dropdown recalculates (70% simple → 64% needs ⅔); child greys when parent passes; audit trail; overall doc vote |
| `resolved.spec.js` | US-10 | Mark as Resolved (confirm) → PASSED banner + applied text; Export Markdown download; Print HTML popup; Resolved text toolbar button |

### Known limitations

- **Conflict drag-and-drop** (US-8 steps 6–7) — HTML5 DnD events are not reliably automatable; ordering is set via `PATCH /conflict-order` and the UI badges are asserted after reload. Drag itself remains a manual-checklist item.
- **Comment edit window** (US-3 step 7) — the UI renders no edit button; only the API supports comment editing (covered by Group F). Story and UI disagree — candidate UI addition.

### App fixes driven by this suite

- `viewLogin`/`viewProfile` lazy route references (app boot was broken in real browsers)
- "Mark as Resolved" on the resolved-text view now re-renders (identical-hash assignment fired no hashchange)
- Vote retract: clicking your active vote button now retracts via `DELETE /vote` (previously the UI only re-cast; retraction was API-only)

---

## Manual UI Checklist

Run `npm run dev` then open `http://localhost:3000`.

- [ ] Login flow: enter email → receive code → enter code → redirected to document list
- [ ] Create document: paste multi-page text → line numbers visible, correct page count
- [ ] Document view: lines highlighted when a variant targets them
- [ ] Variant sidebar: only shows variants overlapping current page
- [ ] Propose variant: fill form → appears in sidebar on document view
- [ ] Vote buttons: clicking For/Against/Abstain updates count immediately
- [ ] Changing vote: count adjusts correctly
- [ ] Retract vote: clicking the currently active vote button retracts the vote; counts and highlight reset
- [ ] Comment thread: post comment → post reply → reply is indented; trying a 3rd level is blocked
- [ ] Activity feed: shows recent actions with correct labels; `voting_scheduled` events have amber highlight
- [ ] Profile: update display name → header reflects new name
- [ ] Logout: session cleared, redirected to login
- [ ] Mobile (375px): single-column layout, no overflow
- [ ] **Voting countdown:** open doc → Change status → voting → set 1 min → Schedule → amber banner appears with live countdown; other browser tab sees toast notification within 30 s
- [ ] **Cancel schedule:** banner [Cancel] button clears countdown and banner disappears
- [ ] **Auto-transition:** wait for countdown to reach 0 → page reloads and document is now in `voting` status
- [ ] **Review view:** document in voting → Review button → two-panel view → action buttons change proposal status; CONFLICT turns yellow, VOTING turns green
- [ ] **Resolve conflicts:** Review view toolbar → Resolve conflicts → conflict resolution view shows conflict groups; drag proposals to reorder; drag onto root to make child (amber numbered child badge, blue root badge, × to remove); vote_order badges appear on roots (blue circle)
- [ ] **Child ordering:** drag child drop zones between children of the same root → children reorder, amber number updates; hover proposal title → rationale tooltip appears
- [ ] **Multiple children:** drop two proposals onto same root → first gets amber [1], second gets [2]; drag between child drop zones to swap order
- [ ] **Ready for final voting:** all conflict groups resolved → button turns green; click → document transitions to `final_voting`; toolbar shows "Final voting" badge
- [ ] **Roll back to voting:** final_voting doc → Change status → voting → back in voting with "Resolve conflicts" button visible
- [ ] **Voting walkthrough:** final_voting doc → Review view → "Voting walkthrough" button → walkthrough view loads with proposals in document order; conflict groups labelled and indented
- [ ] **Export CSV:** click Export CSV → file downloads; open in spreadsheet — columns correct, encoding correct, semi-colon separated
- [ ] **Print HTML:** click Print HTML → new tab opens with clean tally sheet; print dialog renders cleanly
- [ ] **Record tally:** enter yes/no/abstain for a proposal → Save → "✓ Saved at HH:MM" appears; majority percentage shows below inputs with threshold label (e.g. "64% yes — needs ⅔ majority"); reload page → values persist
- [ ] **Threshold dropdown (walkthrough):** each proposal card has a "Threshold" selector defaulting to "Doc default (Simple)"; change to "⅔ majority" → percentage recalculates using yes+no+abstain as denominator; change back to doc default → uses doc default rule
- [ ] **Threshold dropdown (review list):** review view proposal cards show a compact "Threshold" selector; changing value immediately calls `PATCH /variants/:id/threshold`
- [ ] **Document default threshold (settings modal):** document settings modal shows a "Majority threshold" selector; set to "⅔ majority" → save → reopen modal shows persisted value; walkthrough proposals without an override now use it
- [ ] **Fork variant (UC-16):** open a proposal on an `open` doc → Fork button visible → click → modal pre-filled with "Your variant of {title}" and original proposed text → submit → navigates to new proposal; relations show "based on" link to original; on a `voting` doc the button works for editor/admin but the backend rejects proposer (403 toast)
- [ ] **Export CSV threshold:** Export CSV from final voting walkthrough → open in spreadsheet → last column is "Threshold" showing effective threshold label per proposal
- [ ] **Print HTML threshold:** Print HTML → each proposal's tally row shows "Threshold: X · Yes: __ No: __ Abstain: __"
- [ ] **Parent passes collapse:** record yes > no for a parent proposal → child cards grey out and collapse showing "Not voting on — parent passed"; parent card shows "✓ Passed" badge; record yes ≤ no → "✗ Failed" badge; children remain visible
- [ ] **Overall document vote:** fill yes/no/abstain at bottom → Save → persists on reload
- [ ] **Profile completion modal:** log in as new user with no display name → modal appears; fill in name + org → Save and continue → header shows new name; or click Skip → header shows email
- [ ] **Activity unread badge:** navigate away from Activity page; trigger some activity in another tab → red badge number appears next to "Activity" nav link; click Activity → badge disappears
- [ ] **Share proposal:** open any proposal → click Share button → modal shows link + Copy button; clicking Copy closes modal and shows toast; proposer sees "Allow anyone to view" checkbox; enable it → open link in private/incognito tab → simplified view appears with proposal and login link
- [ ] **Draft restriction:** create document (stays in Draft) → log in as viewer/non-editor user → document NOT visible in list and GET returns 403; open the document (→ Open status) → document now visible
- [ ] **Audit trail:** in Final voting walkthrough, click "View audit trail" on any proposal → collapsible panel shows all save events with timestamp, user, yes/no/abstain values; click again → collapses; save new tally → re-expand → new entry appears
- [ ] **Resolved text preview (final_voting):** in voting walkthrough, click "Resolved text" button → resolved-text view shows document with approved variants applied; Export Markdown downloads `.md`; Print HTML opens clean browser tab; "Mark as Resolved" button visible to owner
- [ ] **Mark as Resolved:** click Mark as Resolved → confirm → document transitions to `resolved`; resolved-text view reloads showing PASSED/FAILED banner with timestamp
- [ ] **Fork as new document:** on resolved doc resolved-text view, click "Fork as new document" → new draft document created; if PASSED it contains the resolved text, if FAILED it contains the original text
- [ ] **Resolved text on document page:** resolved/archived doc → "Resolved text" button appears in document viewer toolbar for owner
- [ ] **Supervisor access modal:** invite a user as `supervisor` → they see Manage access button; modal is read-only (no Remove, no Default access selector); their invite dropdown caps at supervisor
- [ ] **Supervisor voting cycle:** as supervisor: open → voting → review buttons work → resolve conflicts → final voting → record tallies → Mark as Resolved; archiving the resolved doc is refused (admin only)
