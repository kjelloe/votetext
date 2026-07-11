# VoteText — User Stories

These stories describe the main user flows as experienced from the browser. They are written to serve two purposes simultaneously:

1. **Playwright test spec** — each numbered step maps directly to a UI interaction or assertion.
2. **Tutorial script** — read these in sequence as the narration for a walkthrough video.

The stories assume a document has already been created and is in **Open** status, with at least one invited participant. Supervisor actions use the `supervisor` access role (UC-19) — editor/admin also qualify.

---

## Roles in these stories

| Role | What they can do |
|------|-----------------|
| **Participant** | Any authenticated user — read documents, see proposals |
| **Commenter** | Post and edit comments on proposals |
| **Proposer** | Propose text changes; also vote |
| **Voter** | Cast and change votes |
| **Supervisor** | Manage the voting process — resolve conflicts, record tallies, finalise the result |

---

## US-1 — Sign in

**Actor:** Any user (first visit or returning)
**Goal:** Authenticate and land on the document list

1. User opens the app URL; the login page appears with an email field.
2. User types their email address and clicks **Send code**.
3. User opens their email, copies the one-time code, pastes it into the code field, and clicks **Verify**.
4. *(First-time only)* A profile completion modal appears. User types their display name and organisation, then clicks **Save and continue** — or clicks **Skip** to fill it in later.
5. User lands on the document list. Their name appears in the navigation header.

---

## US-2 — Find and read a document

**Actor:** Any authenticated user
**Goal:** Navigate to a document and understand its proposal landscape

1. The document list shows each document's title, status badge (Draft / Open / Voting / Resolved), and total proposal count.
2. User clicks a document in **Open** status.
3. The document view opens: paginated text on the left, a proposal sidebar on the right.
4. Lines covered by proposals are highlighted in amber. Hovering a highlighted line shows a tooltip with the overlapping proposal numbers.
5. User scrolls through the text. The sidebar automatically shows only proposals that overlap the current page.
6. User clicks **All** in the sidebar filter bar to see every proposal across the whole document; clicks **On-page** to return to the current-page view.
7. User clicks a proposal card in the sidebar — the page jumps to the relevant line and the card comes into view.
8. User clicks the proposal title to open the full proposal detail page.
9. User clicks the browser **Back** button (or the **← Document** link) to return to the document, scrolled back to the proposal's line.

---

## US-3 — Read and comment on a proposal

**Actor:** Commenter (commenter access or higher)
**Goal:** Understand a proposal and contribute to the discussion

1. On the proposal detail page, user reads the **Title** and **Rationale** written by the proposer.
2. User reads the side-by-side diff: **Original** text on the left, **Proposed** text on the right.
3. User clicks the **Proposed** toggle in the line context preview to see how the passage would read with the change applied.
4. User scrolls to the **Comments** section and types a comment in the text field.
5. User clicks **Post comment**. The comment appears immediately, showing their display name and "just now".
6. Another user sees the comment and clicks **Reply**. Their reply appears indented beneath the original comment.
7. Within the edit window (default 30 minutes), the original commenter clicks **Edit**, adjusts the wording inline, and saves. The comment now shows an "edited" marker with the time. If the edit changes the meaning, replies to that comment get a fresh window to be adjusted or deleted, and show a "parent comment was edited" hint (UC-20).

---

## US-4 — Propose a text change

**Actor:** Proposer
**Goal:** Highlight a passage and submit a proposal to change it

1. On the document view, user reads through the text and identifies a passage they want to change.
2. User clicks at the start of the passage and drags to the end to select it. A **Propose change** button appears below the selection.
3. User clicks **Propose change**. A modal opens showing the selected text (collapsed) plus three fields.
4. User fills in:
   - **Title** — a short label, e.g. "Replace vague deadline with specific date"
   - **Proposed text** — the replacement wording
   - **Rationale** — why this change is needed
5. User clicks **Submit proposal**. The modal closes; the new proposal card appears in the sidebar and the selected lines turn amber.
6. The proposal begins in **Pending** status. Other participants can now see it, vote on it, and comment.

---

## US-5 — Edit or withdraw a proposal

**Actor:** Proposer (owner of the proposal; document must be in Open status)
**Goal:** Refine wording or retract a proposal that is no longer needed

**Edit:**

1. User opens their proposal detail page.
2. User clicks **Edit**. The title, proposed text, and rationale fields become editable.
3. User updates the wording and clicks **Save**. The changes are visible immediately to all participants.

**Withdraw:**

1. User opens their proposal detail page.
2. User clicks **Withdraw** and confirms in the prompt.
3. The proposal status changes to **Withdrawn** and it disappears from the active sidebar.

---

## US-6 — Vote on proposals

**Actor:** Voter (voter access or higher; document in Open or Voting status)
**Goal:** Express a position on each proposal

1. User opens a proposal detail page. Three vote buttons are visible: **For**, **Against**, **Abstain**.
2. User clicks **For**. The "For" count increments by one; the button stays highlighted to show the current vote.
3. User changes their mind and clicks **Against**. The counts adjust: "For" drops by one, "Against" rises by one.
4. User clicks **Against** again to retract the vote entirely. All counts return to their previous values.
5. Back on the document view, proposal cards in the sidebar show the running tallies (▲ for / ▼ against).

---

## US-7 — Share a proposal with an outsider

**Actor:** Proposer
**Goal:** Let someone without an account read a specific proposal

1. User opens their proposal detail page and clicks **Share**.
2. A modal appears with a direct link to the proposal. User clicks **Copy link** — the modal closes and a confirmation toast appears.
3. User sees an **Allow anyone to view** checkbox in the modal. They tick it to enable unauthenticated access via this link.
4. User sends the link by email or message.
5. Recipient opens the link in a browser without logging in. They see the proposal title, rationale, and diff, plus an invitation to log in to vote or comment.

---

## US-8 — Supervisor: review proposals and resolve conflicts

**Actor:** Supervisor
**Goal:** Categorise all proposals and put overlapping ones into a clean voting order before the final vote

1. Document is in **Voting** status. Supervisor clicks **Review** in the document toolbar. The two-panel review view opens.
2. The right panel lists all proposals. Each card shows action buttons: **VOTING** (green), **CONFLICT** (yellow), **NOT VOTING**, **Not applicable**, **Withdrawn**.
3. Proposals that cover the same text range are flagged with an orange **⊕** overlap badge. Supervisor clicks **CONFLICT** on those proposals; their cards turn yellow.
4. Proposals that are outdated or irrelevant are marked **NOT VOTING** or **Withdrawn**.
5. Supervisor clicks **Resolve conflicts** in the toolbar. The conflict resolution view opens.
6. Each conflict group is shown as a card stack. Supervisor drags proposals within a group to set the voting order — a blue numbered badge appears on each root proposal.
7. For a proposal that should only be voted on as a fallback, supervisor drags it onto a root proposal to make it a **child** — an amber "child of #N" badge appears. Children are only put to a vote if their parent fails.
8. When every conflict group is resolved, the **Ready for final voting** button turns green. Supervisor clicks it; the document transitions to **Final voting** status.

---

## US-9 — Supervisor: run the final vote and record results

**Actor:** Supervisor
**Goal:** Record the physical vote tallies, verify thresholds, and finalise the document

1. Document is in **Final voting** status. Supervisor clicks **Voting walkthrough** in the Review view toolbar.
2. All proposals appear in document order. Conflict groups are shown as labelled sections; child proposals are indented below their parent.
3. For each proposal, supervisor checks the **Threshold** dropdown. The default is the document default (Simple majority). For a proposal that requires a higher bar, supervisor changes it to **Absolute majority**, **⅔ majority**, or **¾ majority** — the requirement label on the majority indicator updates immediately.
4. Supervisor enters the physical vote counts — **Yes**, **No**, **Abstain** — then clicks **Save**. The majority indicator shows e.g. `64% yes — needs ⅔ majority` in green (passes) or red (fails).
5. When a parent proposal passes, its child proposals automatically grey out with a "Not voting on — parent passed" label. If the parent fails, child proposals stay open for tallies.
6. The progress bar at the top tracks completion: "N of N proposals recorded".
7. Supervisor fills in the **Overall document vote** totals at the bottom of the page and clicks **Save**.
8. Supervisor optionally clicks **Export CSV** to download a full tally sheet, or **Print HTML** to open a printable version in a new tab — each proposal shows its threshold requirement alongside the yes/no/abstain blanks.
9. Supervisor clicks **Resolved text** in the toolbar to preview the document with all passing proposals applied.
10. Supervisor clicks **Mark as Resolved** and confirms. The document transitions to **Resolved** status; the resolved text is stored and a PASSED or FAILED banner appears with the timestamp.

---

## US-10 — Read the resolved document

**Actor:** Any authenticated user
**Goal:** Read the final adopted text and understand what changed

1. Document is in **Resolved** (or **Archived**) status. User opens it from the document list.
2. A **Resolved text** button appears in the document toolbar.
3. User clicks it. The resolved-text view opens, showing the document with all approved proposals applied, with line numbers.
4. A green **PASSED** or red **FAILED** banner displays the resolution timestamp.
5. User clicks **Export Markdown** to download the text as a `.md` file, or **Print HTML** to open a clean printable version in a new tab.

---

## Coverage map

> All 10 stories have Playwright coverage as of 2026-07-10 (44 tests in `tests/e2e/`, incl. an XSS guard-rail spec) — see the Playwright section of `test-plan.md` for the story→spec-file mapping and known limitations (conflict drag-and-drop, comment edit UI).

| Story | Playwright priority | Video segment |
|-------|--------------------|-|
| US-1  Sign in | Critical — prerequisite for all | Opening: "Getting started" |
| US-2  Read a document | Critical — first thing most users do | "Finding your document" |
| US-3  Comment | High — most common engagement | "Joining the discussion" |
| US-4  Propose a change | High — core proposer flow | "Proposing a change" |
| US-5  Edit / withdraw | Medium — needed for completeness | "Refining your proposal" |
| US-6  Vote | High — all voters, every session | "Casting your vote" |
| US-7  Share | Low — occasional | "Sharing a proposal" |
| US-8  Resolve conflicts | High — supervisor, every vote | "Preparing the final vote" |
| US-9  Final vote | High — supervisor, every vote | "Running the vote" |
| US-10 Read result | Medium — post-vote audience | "Reading the result" |
