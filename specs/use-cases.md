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
5. User edits title/description as needed and clicks **Create document**.
6. A new `draft` document is created with no proposals, variants, or access records (owner only).

---

## Planned / future use cases

- **UC-8:** Resolve a document — admin closes voting, marks variants approved/rejected, document moves to `resolved`.
- **UC-9:** Fork a variant — proposer creates a new variant based on an existing one with a `based_on` relation.
- **UC-10:** Anonymous viewing — public document accessible without login; read-only.
