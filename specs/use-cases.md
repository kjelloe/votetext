# VoteText — Use Cases

Detailed use cases capturing intended user flows and UI behaviour. These serve as the reference for feature refinement and future test scenarios.

---

## UC-1: Create a document from a file or pasted text

**Actor:** Authenticated user  
**Entry point:** Documents list → "+ New document"

### Preconditions
- User is logged in
- User has a `.txt` or `.md` file, or text on their clipboard

### Main flow — pasted text

1. User clicks "+ New document".
2. Modal opens with title, description, a drop zone, a textarea, and a lines-per-page selector.
3. User pastes text into the textarea.
4. System detects format automatically (see Format Detection below) and shows a notice.
5. User fills in title (required) and optional description.
6. User adjusts lines-per-page if needed, then clicks "Create document".
7. System strips format artefacts (if applicable), sends text to the API, navigates to the new document.

### Alternate flow — file upload

3a. User drops a `.txt` or `.md` file onto the drop zone, or clicks "browse" and selects one.  
3b. File is read client-side via FileReader; content is placed in the textarea.  
3c. Continue from step 4.

Only `.txt` and `.md` are accepted; other file types show an error.

### Format detection

| Detected format | Trigger | Client-side transform |
|---|---|---|
| **Paged markdown** | `---` separator lines present AND at least one section has ≥ 5 pre-numbered lines | Strip `---` lines, strip `*Page N*` / `*Page N - …*` header lines, strip leading line-number prefixes, collapse excess blank lines; set lines-per-page to the line count of the first content page |
| **Pre-numbered** | ≥ 50 % of non-empty lines match `/^\s*\d+\s/` | Optionally strip leading line-number prefixes (checkbox, on by default) |
| **Plain text** | Neither above | No transform |

The lines-per-page selector auto-populates with the detected value. A `(detected)` option is added if the value is not in the preset list (27 / 30 / 35 / 40 / 50 / 60). User can override.

### Notes
- Maximum document size: 1 000 000 characters (overridable via `MAX_DOCUMENT_CHARS` env var).
- Lines-per-page range: 27–60.
- At 60 lpp, a 4 000-line document produces ~67 pages. The page-jump control (Go to page) appears automatically when total pages > 10.

---

## UC-2: Propose a variant by selecting text

**Actor:** Authenticated user with at least `proposer` access  
**Entry point:** Document viewer

### Preconditions
- Document is open (status `draft` or `open`).
- User has `proposer` (or higher) access level.

### Main flow

1. User reads through the document text on the current page.
2. User clicks and drags to select the passage they want to target.
   - Selection is captured on `mouseup`; the system resolves it to absolute character offsets using `data-char-start` / `data-char-end` on each rendered line span.
3. User clicks "Propose" in the Proposals sidebar.
4. "Propose variant" modal opens:
   - **Collapsible "Selected text" panel** (open by default) shows the raw selected text in monospace. User can collapse it.
   - **Operation** selector: Replace / Insert / Delete.
   - **New text** field (hidden for Delete).
   - **Title** (required) and **Rationale** (optional).
   - **Grayed-out info row** just above "Submit proposal" shows the resolved character range (`chars N–M`).
5. User chooses operation, fills in new text and title, clicks "Submit proposal".
6. System posts to `POST /api/documents/:id/variants`; on success navigates to the new variant detail page.

### Alternate flow — no selection

3a. User clicks "Propose" without having selected any text first.  
3b. Modal opens with "No text selected — select text in the document before proposing" in the info row; "Submit proposal" is disabled.  
3c. User must close the modal, select text, and click Propose again.

### Selection resolution details

Each `<span class="line-text">` carries `data-char-start` and `data-char-end` (absolute byte offsets in the document). On `mouseup`, the browser's `Selection` API provides anchor and focus nodes with character offsets within their text nodes. `resolveSelectionOffset` maps these to document offsets:
- If the node is inside `.line-text`: `char_start + in-span offset`.
- If the node is in the line-number gutter: clamped to the line's `char_start`.

`Math.min` / `Math.max` normalise drag direction (left-to-right or right-to-left).

---

## UC-3: Navigate a large document

**Actor:** Any user with at least `viewer` access  
**Entry point:** Document viewer

### Main flow

1. Document loads on page 1.
2. User uses "← Prev" / "Next →" buttons to step through pages.
3. For documents with more than 10 pages, a numeric input and "Go" button appear. User types a page number and presses Enter or clicks Go; the view jumps directly to that page.
4. The text panel re-renders for the new page; the Proposals sidebar remains unchanged (it always shows all proposals for the document).

---

## UC-4: Browse and locate proposals

**Actor:** Any user with at least `viewer` access  
**Entry point:** Document viewer — Proposals sidebar

### Proposal card contents

Each card in the sidebar shows:
- **#N** — sequential proposal number within the document (assigned client-side by creation order, i.e. `id` ascending)
- **Title** (or operation + char offset if untitled)
- **Status badge · lines X–Y · by [Author]** — line range is resolved server-side via correlated subqueries on `document_lines`; author name has a dotted underline with a tooltip showing `Display Name · Organisation`
- **Vote tallies** (▲ for / ▼ against / ◆ abstain)

### Card ordering

Cards are displayed in **document position order** (`char_start ASC, created_at ASC`). Overlapping proposals — those whose character ranges intersect — appear adjacent to each other in the sidebar, matching the order a reader encounters them in the text.

### Hover behaviour

When the user hovers any proposal card:

1. **If the proposal's char range overlaps the current page** — all matching `.line-text` spans receive a blue highlight outline and tint. Highlight is removed when the cursor leaves the card boundary.
2. **Always** — a **↗ p.N** goto-link appears in the lower-right of the card footer.
   - Clicking navigates to page N (skipping the network fetch if already on that page) and scrolls the first line of the proposal to the centre of the viewport (`scrollIntoView({ behavior: 'smooth', block: 'center' })`).
   - The link disappears when the cursor leaves the card.
3. **If the proposal overlaps other proposals** — an **⊕ #N, #M** overlap indicator appears to the left of the goto-link.
   - Calculated client-side from char range intersections across all variants in the document.
   - The indicator disappears when the cursor leaves the card.

### Overlap group highlight

Clicking the **⊕** overlap indicator toggles an amber highlight on all cards in the overlap group (the current card plus every card it overlaps). The highlight persists across page navigation since all cards remain in the sidebar DOM. Clicking the indicator again (or clicking any indicator in the group) clears the highlight. Only one overlap group can be highlighted at a time — opening a new group automatically clears the previous one.

### Sidebar filter

Three filter buttons appear in the sidebar header next to "Proposals":

- **All N** — shows every proposal for the document (default)
- **On-page N** — shows only proposals whose char range overlaps the current page; the count updates automatically when the user navigates to a different page
- **Top** — shows the top `ceil(count × PROPOSALS_TOP_PERCENT / 100)` proposals (minimum 1) ranked by total votes cast (for + against + abstain combined), highest first

The active filter is highlighted (primary button style); inactive buttons are ghost. The selected filter is persisted per document in client state (`state.docFilterMode`) and restored when the user navigates back from a proposal detail page.

### Comment count heatmap

Each proposal card shows a 💬 N comment count to the right of the vote tallies. The colour signals relative comment activity on this proposal versus the document as a whole:

- **Normal** (muted) — proposal holds < `COMMENT_HEAT_ORANGE`% of total document comments
- **Orange, bold** — ≥ `COMMENT_HEAT_ORANGE`% (default 10%)
- **Red, bold** — ≥ `COMMENT_HEAT_RED`% (default 25%)

Both thresholds are system-configurable env vars. Total comment count is computed client-side from the `comment_count` field returned per variant by `GET /api/documents/:id/variants`.

---

## UC-7: View a proposal detail

**Actor:** Any user with at least `viewer` access  
**Entry point:** Clicking a proposal card in the sidebar, or a "view variant" link in the activity feed

### Page header

- **← Back to document** button (top-left) — navigates back to the document and automatically scrolls to the line where the proposal begins, replicating the goto-link behaviour. The sidebar filter mode is preserved.
- **← Prev** / **Next →** buttons (top-right) — navigate to the previous or next proposal in **document position order** (same order as the sidebar). Each button shows a native tooltip on hover with the target proposal's number and title, e.g. `#3 Fjern streng skole`. Buttons are omitted when there is no previous/next proposal.

### Proposal title

The page heading shows **Proposal #N** where N is the sequential number from creation order (same as the sidebar `#N`). The variant's title appears as a subtitle line beneath.

### Proposal metadata line

Below the heading a metadata line shows: `operation · position · proposed by Name · time ago`.

For **INSERT** proposals the position is shown as `char N` (a single insertion point — there is no range being removed). For **replace** and **delete** the position is `chars N–M`.

### Comment sorting

A row of sort/filter buttons appears above the comment list:

- **Oldest** (default) — chronological order, oldest thread first
- **Newest** — reverse chronological, newest top-level thread first
- **Most replied** — top-level threads ordered by reply count, descending
- **Author's** — shows only comments posted by the proposal's author

Sorting applies to top-level threads only; replies remain nested under their parent. The sort mode resets to **Oldest** each time a new proposal page is loaded.

### Line context preview

Below the diff block, an **"In context"** section shows the affected document lines with an **Original / Proposed** toggle:

- **Original** (default) — shows the complete affected lines. For **replace** and **delete** proposals the targeted range is highlighted in red. For **insert** proposals no highlight is shown (nothing is being removed from the original).
- **Proposed** — reconstructs the same lines with the change applied: replaced/inserted text highlighted in green, deleted text removed. For multiline replacements the resulting line count may differ from the original; line numbers start from the first affected line.

The preview is shown to all users (not just the author).

---

## UC-5: Manage document access

**Actor:** Document owner or admin-level user  
**Entry point:** Document viewer → Settings sidebar → "Manage access"

### Default access

At the top of the modal a **Default access** selector sets the role granted to any signed-in user who visits the document without being explicitly invited. Valid values: `viewer`, `commenter`, `proposer`, `voter` (not `editor` or `admin` — those must be explicitly invited). Changing the selector saves immediately via `PATCH /api/documents/:id`.

When a user with no explicit access record requests any document endpoint:
- If `default_access` is set to a valid level, that level is used as the effective access for this request.
- If not set (invite-only), the request is denied with 403.
- Explicitly blocked users are always denied regardless of the default.

### Invite user — search flow

1. User types 3+ characters into the search input and presses **Enter** or clicks 🔍.
2. System calls `GET /api/auth/search?q=…` and shows a dropdown of matching users (by email, display name, or organisation).
3. Users marked **non-searchable** or **protected** are excluded from results.
4. User clicks a result — the email fills in and the dropdown closes.
5. User selects a role from the dropdown (options capped at their own access level) and clicks **Invite**.

### Invite user — exact email

If the intended recipient does not appear in search results (new user or non-searchable), the inviter types a full email address directly and clicks Invite. The system creates a user record if none exists.

### Invite email (new users only)

When the invited email has no prior account, an invitation email is sent via Resend:
- **Subject:** `You have been invited to "{document name}" on VoteText`
- **Body:** inviter's name, document name, role, sign-in URL with the invited email address noted, one-line opt-out sentence
- Plain text + minimal HTML, no images, no tracking
- Email is fire-and-forget — a send failure does not roll back the access grant

### Remove user access

Each row in the access list has a **Remove** button. Clicking it replaces the button inline with **OK** (red) and **Cancel** — no browser confirm dialog. Clicking OK calls `DELETE /api/documents/:id/access/:userId` and refreshes the list; Cancel restores the Remove button. This allows multiple removals in quick succession without repeated native prompts.

### Role cap

An inviter can never assign a level higher than their own. The role dropdown only shows permitted levels; the backend enforces the cap with 403.

### Non-searchable profile

Users can toggle **Non-searchable profile** in their profile page (`PATCH /api/auth/profile` with `is_non_searchable: 1`). Non-searchable users are excluded from `GET /api/auth/search` results but can still be added by exact email.

---

## UC-6: Copy a document

**Actor:** Document owner  
**Entry point:** Document viewer → "Copy" button (between Settings and Change status)

1. Owner clicks **Copy**.
2. Client fetches `GET /api/documents/:id/text` to retrieve the full reconstructed text.
3. **New Document** modal opens pre-filled with the original title + " (copy)" and the full text; description is blank; lines-per-page matches the source document.
4. Format detection runs on the pre-filled text (paged/numbered banners appear if applicable).
5. An optional **"Copy from source"** row appears above the Create button with three checkboxes: **Copy proposals**, **Copy votes** (enabled only when proposals is checked), **Copy comments** (same dependency).
6. User edits title/description as needed and clicks **Create document**.
7. A new `draft` document is created. If copy options were selected, `POST /api/documents/:sourceId/copy-data` copies the chosen data (proposals → votes → comments, in dependency order) into the new document in a single transaction.

---

## UC-8: Schedule a document for voting

**Actor:** Document owner  
**Entry point:** Document viewer → "Change status" button → voting option

### Preconditions

- Document is in `open` status.
- User is the document owner (or has `admin` access).

### Main flow — scheduled countdown

1. Owner clicks **Change status**.
2. "Change status" modal opens. "voting" appears as a transition button alongside other valid transitions.
3. Owner clicks **voting**.
4. The button is replaced inline by a mini-form:
   - Label: *Minutes until voting opens (0 = immediate)*
   - Number input, default `VOTING_COUNTDOWN_DEFAULT_MINUTES` (default 5), range 0–10080 (14 days)
   - **Schedule** and **Cancel** buttons
5. Owner adjusts the minutes and clicks **Schedule**.
6. System calls `POST /api/documents/:id/status { status: 'voting', countdown_minutes: N }`.
7. Server sets `documents.voting_scheduled_at = now + N minutes`, logs `voting_scheduled` activity, returns the updated document. **Status remains `open`.**
8. Modal closes; the page reloads.
9. An **amber countdown banner** appears between the document header and the text body:
   - Shows `⏱ Voting opens in M:SS` (live tick every second)
   - Owner sees a **[Cancel]** button on the right
10. All users who have access to the document and are active in the app see a **toast notification** in the bottom-right corner: `⏱ Voting for "Doc Title" opens in N minutes [View] ×`
    - Toast auto-dismisses after `TOAST_DISMISS_SECONDS` (default 30 s) or when the user clicks ×.
11. The `voting_scheduled` event appears prominently in the activity feed (amber background, ⏱ icon, countdown minutes in the body).

### Alternate flow — immediate (countdown = 0)

5a. Owner sets minutes to 0 and clicks **Schedule**.  
5b. System transitions the document immediately to `voting` status (same as `POST … { status: 'voting' }` with no countdown).  
5c. No banner is shown; document is now in voting state.

### Alternate flow — cancel schedule

1. Owner clicks **Cancel** in the amber banner, or opens "Change status" and clicks **Cancel schedule** in the warning notice at the top of the modal.
2. System calls `POST /api/documents/:id/status { cancel_schedule: true }`.
3. Server clears `voting_scheduled_at`, logs `voting_schedule_cancelled`, returns updated document.
4. Banner disappears; status remains `open`.
5. Owner can immediately reschedule with a new countdown.

### Auto-transition (server-side)

- `applyVotingSchedules()` in `src/db.js` is called lazily on every `GET /api/documents`, `GET /api/documents/:id`, and `GET /api/activity` request.
- Any document with `status = 'open'` and `voting_scheduled_at ≤ now` is transitioned to `voting`, `voting_scheduled_at` is cleared, and a `document_status_changed { from: 'open', to: 'voting', auto: true }` activity entry is logged under the document owner's user ID.
- If the countdown expires while a user is viewing the document, the banner's live countdown will reach 0 and trigger `location.reload()`, which calls the GET endpoint and returns the document already in `voting` status.

### Activity feed display

`voting_scheduled` events are shown with:
- ⏱ icon
- Amber background highlight
- Countdown minutes appended: `· N min countdown`

`voting_schedule_cancelled` events are shown with a 🚫 icon.

---

## UC-9: Review proposals before resolution

**Actor:** Document owner or user with `editor`/`admin` access
**Entry point:** Document viewer → "Review" button (visible when document is in `voting` status)

### Preconditions

- Document is in `voting` status.
- User is authenticated and has `editor` or `admin` access (or is the document owner).

### Main flow

1. Owner/editor clicks **Review** in the document header.
2. Browser navigates to `#/documents/:id/review`.
3. The review view loads with a two-panel layout:
   - **Left panel** — full document text (paginated, sticky), same line rendering as the document view.
   - **Right panel** — all proposals listed by default in **document position order** (line number / char_start).
4. Each proposal card shows:
   - **#N** — sequential proposal number (id-ascending, same as sidebar)
   - **Title** and optional **overlap badge** (⊕N) showing how many other proposals share a character range
   - **Line range · operation · ▲ for / ▼ against** vote tallies
   - **Action buttons** (see below)
5. Editor reviews each proposal and selects an action. Changes are saved immediately to the backend on each click; no submit step.
6. After reviewing all proposals the editor navigates back or continues to document status management.

### Action buttons per proposal

| Button | Status set | Colour | Default suggested when |
|--------|------------|--------|------------------------|
| **VOTING** | `pending` | Green | Proposal has no character-range overlaps with other proposals |
| **CONFLICT** | `conflict` | Yellow | Proposal overlaps ≥1 other proposal (auto-suggested) |
| **NOT VOTING** | `rejected` | Red | — |
| **Not applicable** | `not_applicable` | Red | — |
| **Withdrawn** | `withdrawn` | Red | — |

The currently active status is highlighted on the button. An editor can change any proposal's status at any time, including overriding the suggested state.

### Sort options

| Sort | Behaviour |
|------|-----------|
| **Line** (default) | Document position order (`char_start ASC`) |
| **#** | Proposal number order (creation order, id ASC) |
| **Votes** | Highest total vote count (for + against + abstain) first |
| **Conflicts** | Most overlapping proposals first (descending overlap count) |

### Filter

A **Hide 0-vote** checkbox removes proposals that have received no votes (for + against + abstain = 0), helping editors focus on actively-discussed proposals.

### Pagination (left panel)

The document text panel supports the same page navigation as the regular document view (Prev / Next / Go to page). Proposals in the right panel always show all proposals regardless of the current page.

### New variant statuses

Two statuses are only set via the review endpoint, not by proposers:

- **`conflict`** — the proposal overlaps another; editor excludes it from the final vote. Displayed with the existing status badge in the sidebar.
- **`not_applicable`** — the proposal no longer applies to the document as currently worded.

---

## UC-10: Resolve conflicts before final voting

**Actor:** Document owner or user with `editor`/`admin` access
**Entry point:** Review view (`#/documents/:id/review`) → "Resolve conflicts" button

### Preconditions

- Document is in `voting` status.
- At least two active proposals target overlapping character ranges.

### Conflict group computation

A conflict group is a set of ≥ 2 active proposals (not withdrawn / rejected / not_applicable) whose character ranges overlap. The system computes connected components of the overlap graph client-side. Each group must be resolved before the document can proceed to final voting.

### Main flow

1. Editor clicks **Resolve conflicts** in the review view toolbar.
2. Browser navigates to `#/documents/:id/conflicts`.
3. The conflict resolution view shows one card per conflict group, labelled by line range. Each card starts with all proposals in an **Unassigned** section at the bottom.
4. For each group, the editor drags proposals into the numbered **ordered list** above:
   - **Drag to a drop zone** (highlighted line between roots) → proposal becomes a root at that position, receiving a vote-order number [1], [2], [3]…
   - **Drag onto a root proposal card** → dropped proposal becomes a **child** of that root (indented, amber "child of #N" badge, amber numbered order badge). Children are voted only if their parent proposal fails.
   - **Drag between child cards** (drop zones appear between children of the same parent) → reorders children within that parent. Child order determines voting sequence if the parent fails.
5. To remove a child relationship, the editor clicks **×** on the child card (returns it to Unassigned).
6. Hovering over any proposal's title shows its **rationale** text (browser tooltip).
7. A group is marked **✓ Resolved** once every proposal has either a vote-order number (root) or a parent (child). Max two levels of nesting.
7. When all groups are resolved, the **Ready for final voting** button turns green.
8. Editor clicks **Ready for final voting** → document transitions to `final_voting` status → browser navigates to document view.

### "Ready for final voting" button states

| State | Appearance | Click action |
|-------|-----------|--------------|
| Conflicts remain | Yellow button | Alert explaining what's needed |
| All resolved | Green **✓ Ready for final voting** | `POST /documents/:id/status { status: 'final_voting' }` |

### Voting semantics (conflict resolution ordering)

Within a conflict group, root proposals are voted in vote-order number sequence (1 first, then 2, etc.). If a root proposal **passes**, its children are skipped (become `not_applicable`). If a root **fails**, its children proceed to their own vote in their child-order sequence.

---

## UC-11: Conduct final voting

**Actor:** Document owner or user with `editor`/`admin` access
**Entry point:** Review view (`#/documents/:id/review`) → "Voting walkthrough" button (visible when document is in `final_voting`)

### Preconditions

- Document is in `final_voting` status.
- All conflict groups have been ordered (UC-10 completed).

### Main flow

1. Editor clicks **Voting walkthrough** in the review view toolbar.
2. Browser navigates to `#/documents/:id/final-vote`.
3. The walkthrough view shows:
   - **Export CSV** button — downloads a Nordic CSV (semi-colon separated, double-quoted, UTF-8 BOM) with all voteable proposals in document-position order.
   - **Print HTML** button — opens a new browser tab with a print-ready HTML tally sheet.
   - All voteable proposals (pending + ordered conflict proposals) in a scrollable list, ordered by document position. Conflict groups appear as a labelled section; child proposals are indented with a "↳ child of #N — voted only if parent fails" note.
4. For each proposal, the editor records the physical vote tally: **Yes**, **No**, **Abstain** (integer counts). Clicking **Save** calls `PATCH /api/variants/:id/final-vote`.
   - After saving, a coloured **majority percentage** appears below the inputs: green if yes > 50%, yellow if exactly 50/50, red if yes < 50%.
   - The save indicator shows **"✓ Saved at HH:MM"** (human-readable timestamp).
   - Each save also writes a new row to `final_vote_log` with a Unix-millisecond timestamp, enabling a full audit trail.
   - Clicking **"View audit trail"** on a proposal expands a collapsible panel showing all save events — timestamp, user name, and the yes/no/abstain values recorded at each save. Clicking again collapses it.
   - If a **parent** proposal passes (yes > no), its child cards collapse and grey out, showing "Not voting on — parent passed". A **"✓ Passed"** badge appears on the parent card. If the parent fails, a **"✗ Failed"** badge appears and children remain active.
5. At the bottom, an **Overall document vote** section records the total vote on the document as a whole. Clicking **Save** calls `PATCH /api/documents/:id/doc-vote`.
6. After all tallies are recorded, the editor can click **Resolved text** in the toolbar to preview the document with all approved variants applied (see UC-15).
7. The document remains in `final_voting` until the owner clicks **Mark as Resolved** on the resolved-text view (or uses **Change Status → resolved**), which triggers the status transition and stores the resolved text.

### Proposal ordering in export and walkthrough

All voteable proposals are merged into a single document-position sequence. Conflict groups appear as a unit at the position of their earliest character offset; within each group, root proposals are ordered by `vote_order`, with children immediately following their parent. Proposals not in any conflict group appear at their own character position, interleaved with groups by document order.

**Excluded from the walkthrough:** `withdrawn`, `rejected`, `not_applicable`, and hidden proposals.

### Export columns (CSV)

`Order; Proposal #; Title; Type; Line Start; Line End; Proposer; Organization; Original Text; Proposed Text; Conflict Group; Vote Order; Parent Proposal #; Yes; No; Abstain`

### Overall document vote

After all individual proposals are voted on, the assembly votes on the document as a whole (a common requirement in formal Nordic parliamentary procedure, typically failing only at a very high no-vote threshold such as ≥1% of total). The yes/no/abstain totals from this vote are stored on the document and appear in the print HTML tally sheet.

---

## UC-12: Share a proposal via direct link

**Actor:** Any authenticated user viewing a proposal; proposer to control anonymous access  
**Entry point:** Proposal view (`#/variants/:id`) → **Share** button

### Main flow

1. User clicks **Share** in the top-right of the proposal card.
2. A modal opens showing the direct link (`origin/#/variants/:id`) and a **Copy** button.
3. Clicking **Copy** writes the URL to the clipboard, shows a brief toast, and closes the modal.
4. If the user is the proposer of the variant, the modal also shows a checkbox: **"Allow anyone to view this proposal without logging in"**. The checkbox reflects the current `allow_anonymous_share` setting.
5. Toggling the checkbox immediately calls `PATCH /api/variants/:id/share` to update the setting.

### Anonymous access via share link

When `allow_anonymous_share = 1`:
- `GET /api/variants/:id` succeeds for anonymous (unauthenticated) requests even if the document does not allow anonymous viewing.
- The frontend detects the anonymous-with-no-doc-access scenario and renders a **simplified view**: proposal title, rationale, and diff only — no vote card, no comment section.
- A **"Log in"** link invites the visitor to register/log in to access the full document.

When `allow_anonymous_share = 0` (default): anonymous access to a non-public document returns 403 as usual.

---

## UC-13: Profile completion after first login

**Actor:** New user who just verified their OTP for the first time (display name not yet set)  
**Entry point:** Automatic — triggered after `POST /auth/verify-otp` succeeds when `display_name` is empty

### Main flow

1. User verifies their OTP and the server returns a valid session.
2. Client detects `user.display_name === ''` and shows a **modal overlay** before navigating away.
3. The modal displays:
   - **Email** (read-only)
   - **Display name** text input
   - **Organization** text input (optional)
   - **"Skip for now"** and **"Save and continue"** buttons
4. If user clicks **Save and continue**: client calls `PATCH /auth/profile` with the entered values, updates `state.user`, then navigates to `#/documents`.
5. If user clicks **Skip for now**: client navigates to `#/documents` without saving. The modal appears again on the next login if the name is still empty.

---

## UC-14: Draft document visibility restriction

**Actor:** Any user  
**Applies to:** Documents in `draft` status

### Rules

| User type | Can see draft document? |
|-----------|------------------------|
| Owner | Yes |
| User with `editor` or `admin` access | Yes |
| User with `viewer`, `commenter`, `proposer`, `voter` access | No (403) |
| Anonymous (even with `allow_anonymous_view = true`) | No (403) |

This restriction applies to both `GET /documents/:id` and the document list (`GET /documents` — draft docs only appear in the list if the requesting user has editor+ access or is the owner). Once a document transitions to `open`, normal access rules apply.

---

---

## UC-15: View and export resolved text

**Actor:** Document owner or editor/admin  
**Entry point:** Final voting walkthrough toolbar → "Resolved text", or document viewer → "Resolved text" button (owner only, for `final_voting` / `resolved` / `archived` documents)

### Preconditions

- Document is in `final_voting`, `resolved`, or `archived` status.
- User has at least `editor` access (or is the owner).

### Main flow — during final_voting

1. Editor clicks **Resolved text** from the final-vote walkthrough toolbar.
2. Browser navigates to `#/documents/:id/resolved-text`.
3. The system computes the resolved text on-the-fly: all approved variants are applied to the original text in character-offset order (overlapping approved variants are skipped).
4. The view shows the resolved text in a scrollable read-only pane with line numbers.
5. The toolbar offers:
   - **Export Markdown** — downloads `<title>_resolved.md` with a `# Title` heading.
   - **Print HTML** — opens a print-ready HTML tab.
   - **Mark as Resolved** (owner only) — transitions the document to `resolved` status, persisting the resolved text and `resolved_at` timestamp.
   - **← Back** — returns to the final-vote walkthrough.

### Main flow — after resolution

1. Owner navigates to a `resolved` or `archived` document and clicks **Resolved text**.
2. The view shows the stored resolved text with a **PASSED** or **FAILED** banner (derived from `doc_vote_yes` / `doc_vote_no`).
   - The banner includes the timestamp: "PASSED at <date/time>" or "FAILED at <date/time>".
3. Export Markdown and Print HTML include the PASSED/FAILED line with the timestamp.
4. Owner can click **Fork as new document** to create a new draft based on:
   - The **resolved text** if the document vote PASSED.
   - The **original text** if the document vote FAILED.
   The fork is created as a new document (`<title> (fork)`) owned by the same user.

### Data storage

- On `final_voting → resolved` transition, `resolveVariants()` applies approved variants to the original text and stores the result in `documents.resolved_text`; `resolved_at` is set to the current ISO-8601 timestamp.
- The `GET /api/documents/:id/resolved-text` endpoint returns `{ text, resolved_at, doc_vote_passed }`.
  - During `final_voting`: text is computed on-the-fly; `resolved_at` and `doc_vote_passed` are `null`.
  - After resolution: stored values are returned.

### Access control

| User | Access |
|------|--------|
| Owner | Yes |
| Editor / admin | Yes |
| Viewer–voter | No (403) |
| Anonymous | No (401) |

---

## Planned / future use cases

- **UC-16:** Fork a variant — proposer creates a new variant based on an existing one with a `based_on` relation.
