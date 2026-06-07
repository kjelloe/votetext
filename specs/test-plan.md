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

## Group K — Review View

| ID | Scenario | Expected |
|----|----------|----------|
| K1 | PATCH `/variants/:id/review-status { status: 'conflict' }` — owner on voting doc | 200, `status = conflict` |
| K2 | PATCH `/variants/:id/review-status { status: 'rejected' }` — change from prior status | 200, `status = rejected` |
| K3 | PATCH `/variants/:id/review-status { status: 'pending' }` — restore to voting | 200, `status = pending` |
| K4 | PATCH `/variants/:id/review-status { status: 'not_applicable' }` | 200, `status = not_applicable` |
| K5 | PATCH with `status: 'approved'` (not in allowed list) | 400 |
| K6 | PATCH on variant in a non-voting document (e.g., archived) | 422 |
| K7 | PATCH by user with only `viewer` access | 403 |

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
- [ ] Comment thread: post comment → post reply → reply is indented; trying a 3rd level is blocked
- [ ] Activity feed: shows recent actions with correct labels; `voting_scheduled` events have amber highlight
- [ ] Profile: update display name → header reflects new name
- [ ] Logout: session cleared, redirected to login
- [ ] Mobile (375px): single-column layout, no overflow
- [ ] **Voting countdown:** open doc → Change status → voting → set 1 min → Schedule → amber banner appears with live countdown; other browser tab sees toast notification within 30 s
- [ ] **Cancel schedule:** banner [Cancel] button clears countdown and banner disappears
- [ ] **Auto-transition:** wait for countdown to reach 0 → page reloads and document is now in `voting` status
