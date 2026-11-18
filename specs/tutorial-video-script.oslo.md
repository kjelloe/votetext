# VoteText — Tutorial Video Script, Oslo programme scenario (English)

The same fourteen chapters as `tutorial-video-script.md`, told on a real document: Oslo Høyre's first
draft of its 2027–2031 programme (`tutorial/scenarios/oslo-program.md`, pages renumbered from the
source's page 3). The programme committee works in VoteText; every seeded and recorded proposal touches
the first pages only. The `[screen: …]` cues carry the same count per chapter as the garden script, so
`tutorial/chapters/*.js` drive both (targets in `tutorial/scenarios/oslo.js`). Norwegian narration:
`tutorial-video-script.oslo.no.md`, read by the owner (`npm run tutorial -- all --scenario oslo --lang no --list-beats`).

```bash
npm run tutorial -- all --scenario oslo --burn   # → tutorial/out/oslo/votetext-tutorial-oslo-en.mp4 (+ .subtitled.mp4)
npm run tutorial -- 6 --scenario oslo            # one chapter
```

## Production record (English video approved by the owner 2026-11-18)

**Source.** `doctools/1st-utkast-til-Oslo-Hoyres-program.md` (pdf2md output of the committee's PDF, 23 pages,
numbered lines with `*Page N*` markers — the `lines_per_page: "auto"` format of UC-23). The copy at
`tutorial/scenarios/oslo-program.md` drops pages 1–2 (cover, contents; they have no numbered lines, and the
importer takes page numbers from the markers, so the document would have opened on an empty page) and
renumbers the remaining markers from 1. To refresh it after a new draft: copy the file, delete everything up to
and including the second `*Page*` block, renumber `*Page N*` to `N − 2`, keep the HTML comment on line 1, then
re-check the line prefixes in `tutorial/scenarios/oslo.js` (`line:` of every variant, `targets.propose.line`,
`jumpLine`, `commentMatch`) and the `lines(from, to)` ranges of the three short documents.

**Scenario** (`tutorial/scenarios/oslo.js`): four personas with Oslo Høyre affiliations (Anna chairs the
committee and owns the documents, Bjørn proposes, Clara votes, David is the secretary/supervisor); the whole
draft as the open document (839 lines, 21 pages); seeded proposals on pages 1–2 only (the property-tax sentence,
the kindergarten equal-treatment bullet with the off-topic el-sykkel comment for chapter 12); the recorded
proposal on the "går, sykler, reiser kollektivt eller med bil" sentence; the voting, final-voting and resolved
documents are lines 1–20, 24–43 and 45–62 of the same draft, with Norwegian proposals, rationales, comments and
tallies. Seed it alone with `npm run seed-demo -- oslo`.

**Recording setup.** `npm run tutorial -- all --scenario oslo --burn`: Chromium 1280×800 layout at
`--force-device-scale-factor=1.5` → 1920×1200 H.264/AAC, light theme, drawn pointer, Kokoro `bm_george`
(English), subtitles from this file burnt in from a generated `.ass`, MP4 chapter markers per chapter. Fourteen
chapters, 12.1 minutes, about fifteen minutes of machine time on the owner's laptop; the Kokoro clips are cached
under `tutorial/out/oslo/audio/en/`, so a re-run after a UI change only re-records the screen.

**Result.** `tutorial/out/oslo/votetext-tutorial-oslo-en.subtitled.mp4` (36 MB), published with
`npm run tutorial:publish` to `public/video/` and linked from the login page and footer as
"Tutorial · Oslo (English)". Norwegian narration: `tutorial-norwegian-recording.md`.

---

## Chapter 0 — Intro *(0:30)*

[screen: Anna's document list — the programme draft and three chapter documents with coloured status badges]

This is VoteText, a tool for groups that decide on texts together. Here it is a party programme: Oslo Høyre's programme committee has a first draft of the 2027 programme, and the local associations are invited to propose changes, argue for them and vote. Instead of tracked changes flying around by email, everyone works on one shared document, every proposal is visible, and every vote is counted. The next minutes follow the committee from the first draft to an adopted chapter.

---

## Chapter 1 — Signing in *(0:45)*

[screen: clean browser at the app URL — the login page]

There are no passwords in VoteText. You sign in with your email address.

[screen: type erik@demo.votetext, click "Send code"]

Type your address and ask for a code. Within a few seconds a six-digit code arrives in your inbox.

[screen: enter the 6-digit code from the dev console — form submits itself]

Enter the code, and you're in. That's the whole login.

[screen: profile completion modal appears]

The first time you sign in, VoteText asks who you are. Your name is what other participants see next to your proposals and votes, so pick the one your association knows you by. The organisation is optional; here it is the local branch.

[screen: type "Erik Moen" and "Frogner Høyre", click "Save and continue"]

[screen: empty document list]

And this is home: the document list. Erik's list is empty, documents appear here once someone invites you, which is exactly what happens in a moment.

---

## Chapter 2 — Creating a document *(1:00)*

[screen: Anna's document list, click "New document"]

> Note: Anna leads the programme committee and holds the site role creator, which is why she sees New document; members like Bjørn and Clara do not. Now the other side: Anna adds the next chapter of the draft as its own document.

[screen: create modal — paste the "Kapittel 3" draft, type the title]

Creating a document is paste-and-go. Drop in a text file or paste the content, plain text or markdown, give it a title, and VoteText splits it into numbered lines and pages. A draft exported from a PDF keeps its printed page numbers, so the committee can say "page four, line twelve" and mean the same thing on paper and on screen.

[screen: click Create — the document opens in the viewer, status badge "Draft"]

The new document starts as a draft. Drafts are private: only Anna and any editors she names can see it. That gives her a chance to check the text came in right before anyone else reads it.

[screen: click "Change status", choose Open]

When the text is ready, she opens it, and from now on, invited members can read it and propose changes.

---

## Chapter 3 — Inviting participants *(0:45)*

[screen: document sidebar, click "Manage access"]

Nobody can see a document until they're invited, access is per document, not per site.

[screen: access modal — the role dropdown, type erik@demo.votetext, role "proposer", click Invite]

Anna invites Erik. The role decides what he can do: a viewer just reads, a commenter joins the discussion, a proposer can suggest changes, and a voter does all of that and votes. A supervisor runs the voting process without being able to edit the text, and an editor can. Erik is a proposer: he can argue for changes but does not vote on them.

[screen: point at the Default access selector]

For a whole association there's a shortcut: default access gives every signed-in member who opens the document's link a baseline role, so the committee can share one link instead of inviting a few hundred people one by one.

---

## Chapter 4 — Finding and reading a document *(1:00)*

[screen: Bjørn's document list — click "Oslo Høyres program 2027–2031" (Open badge)]

Let's join Bjørn from Grünerløkka, who has read the draft and has opinions. From the document list he opens the programme.

[screen: document view — text left, proposal sidebar right; scroll slowly]

The text sits on the left with numbered lines and the printed page numbers. On the right: every change that's been proposed so far.

[screen: hover a blue-highlighted line — tooltip with proposal numbers]

Blue lines already have proposals attached. Hover one and you see which proposals touch that line.

[screen: pick "This page" in the filter above the proposal list, then "All"; open the order selector and pick "Most voted", then back to "Document order"]

The sidebar follows you as you read, showing proposals for the page you're on, or the whole programme, in the order you prefer: as written, most discussed, most voted, or newest.

[screen: hover a proposal card — click the ↗ link that appears: the page jumps to the line; then click the card itself]

Hover a proposal card and follow the arrow to jump to the passage it changes, here a bullet on page two, or click the card to open the full proposal.

---

## Chapter 5 — Joining the discussion *(0:45)*

[screen: proposal detail page — title, rationale, side-by-side diff]

Every proposal has the same anatomy: a title, the proposer's rationale, and the exact text change, original on the left, proposed on the right. No guessing what someone meant by "tighten the wording on taxes".

[screen: scroll to the comments — the seeded thread with Bjørn's indented reply]

Below the diff, the discussion. Replies stay attached to the comment they answer, so threads keep their shape.

[screen: Clara types a comment, clicks "Post comment" — it appears with her name and "just now"]

Clara from Nordstrand adds her view, it's visible to everyone the moment she posts it.

---

## Chapter 6 — Proposing a change *(1:30)*

[screen: document view — select the sentence about getting around the city with the mouse; the floating "Propose" bar appears above the selection]

Now the heart of VoteText. Bjørn thinks a sentence in the introduction should change, so he selects it, and a small Propose button appears right on the selection. On a phone it sits just below the selected words.

[screen: click "Propose" on the floating bar — modal showing the selected text, the operation selector and three fields]

The proposal form asks for three things: a short title, the new wording, and, most importantly, why. A good rationale is what turns a change request into an argument the committee can weigh.

[screen: fill in title "Nevn ytre by i innledningen", new text, rationale; click "Submit proposal" — the sheet closes, the lines turn blue, a toast "Proposal #N added · Open" appears; click "Open"]

Submitted. Bjørn is still on the document: the line is highlighted in blue, the card is in the list, and a small message offers the proposal's page. He opens it.

[screen: on the proposal page, click "Edit", adjust the title, Save; then point at "Withdraw"]

Until voting starts, Bjørn can refine the wording, or withdraw the proposal entirely if the discussion changes his mind.

[screen: click "← Back to document" — the new card in the sidebar, the selected line now highlighted in blue]

Back on the document, the proposal sits attached to the exact line it would change, and on a phone the same flow runs from a bar that floats on the selected words.

---

## Chapter 7 — Voting *(0:45)*

[screen: proposal page — the three vote buttons For / Against / Abstain]

Once you've read a proposal, say what you think. Three buttons: for, against, abstain.

[screen: Clara clicks "For" — count increments, button highlights]

One click, one vote. The tally updates immediately, and the highlighted button always shows where you stand.

[screen: click "Against" — counts adjust; click "Against" again — vote retracts]

Changed your mind? Just vote again. And clicking your own active vote retracts it completely.

[screen: back on the document — sidebar cards showing ▲ and ▼ tallies]

Back on the document, the running tallies show at a glance which proposals have momentum before the committee meets.

---

## Chapter 8 — Sharing with an outsider *(0:45)*

[screen: proposal page, click "Share" — modal with link and Copy button]

Sometimes you want an opinion from someone outside the committee, a policy adviser, say. Every proposal has a direct link.

[screen: tick "Allow anyone to view", click Copy]

By default the link requires a login, but the proposer can open it up, so anyone with the link can read this one proposal.

[screen: private/incognito window with the link — read-only proposal with a "Log in" invitation]

An outsider sees the title, the reasoning, and the diff, nothing else, and they can't touch anything. To vote or comment, they'd have to be invited properly.

---

## Chapter 9 — Running the vote: review and conflicts *(1:30)*

[screen: David's document list — open the introduction chapter (Voting badge), click "Review"]

When discussion has run its course, someone has to shepherd the decision. That's the supervisor, here David, the committee's secretary. He can run the whole voting process without being able to change a word of the text himself. The introduction chapter is already in voting.

[screen: two-panel review view — text left, proposal cards right with action buttons]

The review view shows every proposal with a simple question: what happens to this one at the committee meeting? Goes to a vote, is withdrawn, or is no longer relevant.

[screen: point at the orange ⊕ badge on the two proposals about getting a "yes" from the city]

And here's the interesting case: two proposals want to change the same sentence about getting a "yes" from the city, one promises an answer within four weeks, one says the city should look for reasons to say yes. They can't both pass.

[screen: click CONFLICT on both — cards turn yellow; click "Resolve conflicts"]

David marks them as a conflict and opens the resolution view.

[screen: conflict group — drag one proposal above the other; blue order badge appears; drag the other onto it — amber "child of" badge]

Here he decides the voting order. The committee votes on the four-week promise first, and the other wording is only put to a vote as a fallback, if the first one fails.

[screen: "Ready for final voting" button turns green — click it, confirm]

When every conflict has an order, the button turns green, and the chapter moves to final voting.

---

## Chapter 10 — Recording the final vote *(1:30)*

[screen: the kindergarten chapter in final_voting — Review view, click "Voting walkthrough"]

The final vote itself happens in the committee room, hands in the air, or ballots. VoteText's job is to keep the count honest. The voting walkthrough lists every proposal in the order just decided, with the original and proposed text side by side, so nobody votes on a summary.

[screen: point at the pre-recorded tally on "Daglig høytlesing" with the green majority label]

For each proposal David types in the yes, no, and abstain counts. The majority indicator does the maths in real time.

[screen: change the threshold dropdown on the "50 prosent barnehagelærere" proposal to "⅔ majority" — requirement label updates]

Not every decision is a coin flip: a proposal can require an absolute, two-thirds, or three-quarters majority, and the indicator immediately shows whether the tally clears the bar. Programme changes with budget consequences often need the higher bar.

[screen: enter tallies for the root conflict proposal so it passes — the child proposal greys out: "Not voting on — parent passed"]

Watch the fallback: the moment its parent passes, it's automatically taken off the table.

[screen: click "Export CSV", then "Print HTML" — the printable tally sheet opens]

Need paper for the meeting, or a spreadsheet for the minutes? One click each. Every saved tally is also kept in an audit log, who recorded what, and when. And VoteText refuses to call a chapter resolved while two passing proposals overlap or a proposal still lacks a tally.

---

## Chapter 11 — Reading the result *(0:45)*

[screen: Clara's document list — open the resolved school chapter, click "Resolved text"]

When the vote is done, the chapter is resolved, and every participant can read the outcome.

[screen: resolved-text view — green PASSED banner with timestamp, final text with line numbers]

This is the adopted text: every passing proposal applied, every failed one left out, with a banner showing when the committee made it official.

[screen: click "Export Markdown" — file downloads]

Export it as a file for the layout people, print it, or just link members here. The chapter, and the whole trail of proposals, arguments, and votes behind it, stays in VoteText for the next revision.

---

## Chapter 12 — A word on moderation *(0:45)*

[screen: the e-bike comment on the kindergarten proposal; click "Hide", confirm]

One more thing for the people running things. Occasionally a comment doesn't belong, an advertisement, or something that oversteps. A supervisor can hide it.

[screen: the comment is replaced by "Comment hidden by moderator" for a participant view]

Participants see that something was removed, honesty matters, but not what.

[screen: document sidebar → "Moderation" — the hidden comment listed with an Unhide button]

And nothing is silently destroyed: the moderation page lists everything that's hidden, and any supervisor can restore it. Every action lands in the activity log.

---

## Chapter 13 — Outro *(0:30)*

[screen: back to the document list, the programme and its chapters with their status badges]

That's VoteText: one place where a committee reads together, argues in the open, votes, and walks away with a programme text everyone can point to. Set it up, invite your associations, and let the next programme write itself, one argued proposal at a time.
