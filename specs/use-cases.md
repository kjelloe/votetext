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

---

## Planned / future use cases

- **UC-5:** Resolve a document — admin closes voting, marks variants approved/rejected, document moves to `resolved`.
- **UC-6:** Fork a variant — proposer creates a new variant based on an existing one with a `based_on` relation.
- **UC-7:** Anonymous viewing — public document accessible without login; read-only.
