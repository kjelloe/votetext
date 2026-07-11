# VoteText — Tutorial Video Script (English)

One chaptered walkthrough video, ~12 minutes. Narration is written to be read aloud;
`[screen: …]` cues tell the screen recorder what must be visible or clicked while the
words are spoken. Norwegian version: `tutorial-video-script.no.md`.

---

## Production notes

**Setup (before every recording session):**

```bash
npm run clean-db && npm run seed-demo && npm run dev
```

`seed-demo` prints one session cookie per persona and the four document IDs. Set each
cookie in a separate browser profile (or container tab):
`document.cookie = "session_id=<value>; path=/"` — then reload.

**The cast** (who is on screen in each chapter):

| Persona | Role | Used in chapters |
|---|---|---|
| **Erik** (fresh email, created live) | brand-new participant | 1 |
| **Anna Berg** | chair — document owner/admin | 2, 3 |
| **Bjørn Dahl** | member — proposer | 4, 6, 8 |
| **Clara Foss** | member — voter/commenter | 5, 7, 11 |
| **David Lie** | secretary — supervisor | 9, 10, 12 |

**The seeded documents** (IDs printed by seed-demo, normally 1–4):

| Doc | Status | Purpose |
|---|---|---|
| Community Garden Charter | open | main stage — chapters 4–8 and 12 |
| Garden Budget Priorities 2027 | voting | review + conflict resolution — chapter 9 |
| Watering Schedule Amendment | final_voting | final-vote walkthrough — chapter 10 |
| Tool Shed Rules 2026 | resolved | reading the result — chapter 11 |

**Recording tips:**
- Chapters are independent — each starts from seeded state, so they can be recorded
  in any order and re-recorded after a `clean-db && seed-demo` reset.
- Chapter 1 needs the OTP code: in dev mode it is printed in the `npm run dev` console.
- Recommended viewport ≥ 1280×800; enable cursor highlighting in the recorder.
- Chapter 9 permanently transitions the Budget doc to final voting — record it last
  or reseed before retakes of earlier chapters.

---

## Chapter 0 — Intro *(0:30)*

[screen: document list in Anna's profile — four documents with coloured status badges]

This is VoteText — a tool for groups that decide on texts together. Bylaws, charters,
policies, meeting documents: anywhere people propose changes to wording, discuss them,
and vote. Instead of tracked changes flying around by email, everyone works on one
shared document, every proposal is visible, and every vote is counted.

In the next few minutes we'll follow a community garden through a full revision of
their charter — from signing in, to proposing changes, to the final vote and the
adopted text.

## Chapter 1 — Signing in *(1:00)* — Erik, fresh browser profile

[screen: clean browser at the app URL — the login page]

There are no passwords in VoteText. You sign in with your email address.

[screen: type erik@demo.votetext, click "Send code"]

Type your address and ask for a code. Within a few seconds a six-digit code arrives
in your inbox.

[screen: enter the 6-digit code from the dev console — form submits itself]

Enter the code, and you're in. That's the whole login.

[screen: profile completion modal appears]

The first time you sign in, VoteText asks who you are. Your name is what other
participants see next to your proposals and votes, so pick something they'll
recognise.

[screen: type "Erik Moen" and "Plot 7", click "Save and continue"]

[screen: empty document list]

And this is home: the document list. Erik's list is empty — documents appear here
once someone invites you, which is exactly what happens in a moment.

## Chapter 2 — Creating a document *(1:00)* — Anna

[screen: Anna's document list, click "New document"]

Now the other side of that story. Anna chairs the garden committee, and she has a
text the group needs to agree on.

[screen: create modal — paste the "Spring Planting Plan 2027" text from Appendix A, type the title]

Creating a document is paste-and-go. Drop in a text file or paste the content — plain
text or markdown — give it a title, and VoteText splits it into numbered lines and
pages automatically.

[screen: click Create — the document opens in the viewer, status badge "Draft"]

The new document starts as a *draft*. Drafts are private: only Anna and any editors
she names can see it. That gives her room to fix typos before the group piles in.

[screen: click "Change status", choose Open]

When the text is ready, she opens it — and from now on, invited members can read it
and propose changes.

## Chapter 3 — Inviting participants *(0:45)* — Anna

[screen: document sidebar, click "Manage access"]

Nobody can see a document until they're invited — access is per document, not
per site.

[screen: access modal — the role dropdown, type erik@demo.votetext, role "proposer", click Invite]

Anna invites Erik. The role decides what he can do: a *viewer* just reads, a
*commenter* joins the discussion, a *proposer* can suggest changes, and a *voter*
does all of that and votes. Erik gets an email telling him he's been invited.

[screen: point at the Default access selector]

For bigger groups there's a shortcut: *default access* gives every signed-in user a
baseline role on this document, so you don't have to invite the whole neighbourhood
one by one.

## Chapter 4 — Finding and reading a document *(1:15)* — Bjørn, Community Garden Charter

[screen: Bjørn's document list — click "Community Garden Charter" (Open badge)]

Let's join Bjørn, who has plot fourteen and opinions. From the document list he opens
the garden charter.

[screen: document view — text left, proposal sidebar right; scroll slowly]

The text sits on the left with numbered lines. On the right: every change that's been
proposed so far.

[screen: hover an amber-highlighted line — tooltip with proposal numbers]

Amber lines already have proposals attached. Hover one and you see which proposals
touch that line.

[screen: click "All", then "On-page" in the sidebar filter]

The sidebar follows you as you read — showing proposals for the page you're on, or
the whole document if you prefer.

[screen: click a proposal card — page jumps to the line; then click the proposal title]

Click a proposal card to jump to the passage it changes — and click its title to open
the full proposal.

## Chapter 5 — Joining the discussion *(1:00)* — Clara, "Raise the annual fee" proposal

[screen: proposal detail page — title, rationale, side-by-side diff]

Every proposal has the same anatomy: a title, the proposer's rationale, and the exact
text change — original on the left, proposed on the right. No guessing what the
author meant.

[screen: scroll to the comments — the seeded thread with Bjørn's indented reply]

Below the diff, the discussion. Replies stay attached to the comment they answer,
so threads keep their shape.

[screen: Clara types a comment, clicks "Post comment" — it appears with her name and "just now"]

Clara adds her view — it's visible to everyone the moment she posts it.

## Chapter 6 — Proposing a change *(1:30)* — Bjørn, Community Garden Charter

[screen: document view — select the guest rule sentence with the mouse; "Propose change" button appears]

Now the heart of VoteText. Bjørn thinks a sentence should change — so he selects it.
Right there, a button appears.

[screen: click "Propose change" — modal with the selected text collapsed, three fields]

The proposal form asks for three things: a short title, the new wording, and — most
importantly — *why*. A good rationale is what turns a change request into an argument
the group can weigh.

[screen: fill in title "Let guests visit without an escort", new text, rationale; click "Submit proposal"]

[screen: the new card appears in the sidebar; the selected lines turn amber]

Submitted. The proposal is instantly visible to every participant, attached to the
exact lines it would change.

[screen: on the new proposal page, click "Edit", adjust the title, Save; then point at "Withdraw"]

Until voting starts, Bjørn can refine the wording — or withdraw the proposal
entirely if the discussion changes his mind.

## Chapter 7 — Voting *(0:45)* — Clara, "Clarify the dog rule" proposal

[screen: proposal page — the three vote buttons For / Against / Abstain]

Once you've read a proposal, say what you think. Three buttons: for, against, abstain.

[screen: Clara clicks "For" — count increments, button highlights]

One click, one vote. The tally updates immediately, and the highlighted button always
shows where you stand.

[screen: click "Against" — counts adjust; click "Against" again — vote retracts]

Changed your mind? Just vote again. And clicking your own active vote retracts it
completely.

[screen: back on the document — sidebar cards showing ▲ and ▼ tallies]

Back on the document, the running tallies show at a glance which proposals have
momentum.

## Chapter 8 — Sharing with an outsider *(0:45)* — Bjørn, his fee proposal

[screen: proposal page, click "Share" — modal with link and Copy button]

Sometimes you want an opinion from someone outside the group. Every proposal has a
direct link.

[screen: tick "Allow anyone to view", click Copy]

By default the link requires a login — but the proposer can open it up, so anyone
with the link can read this one proposal.

[screen: private/incognito window with the link — read-only proposal with a "Log in" invitation]

An outsider sees the title, the reasoning, and the diff — nothing else, and they
can't touch anything. To vote or comment, they'd have to be invited properly.

## Chapter 9 — Running the vote: review and conflicts *(1:30)* — David, Garden Budget Priorities 2027

[screen: David's document list — open the Budget doc (Voting badge), click "Review"]

When discussion has run its course, someone has to shepherd the decision. That's the
*supervisor* — here David, the committee secretary. He can run the whole voting
process without being able to touch the document text itself.

[screen: two-panel review view — text left, proposal cards right with action buttons]

The review view shows every proposal with a simple question: what happens to this one
at the meeting? Goes to a vote, is withdrawn, or is no longer relevant.

[screen: point at the orange ⊕ badge on the two tool-budget proposals]

And here's the interesting case: two proposals want to change the *same sentence* —
one buys a hedge trimmer, one splits the budget. They can't both pass.

[screen: click CONFLICT on both — cards turn yellow; click "Resolve conflicts"]

David marks them as a conflict and opens the resolution view.

[screen: conflict group — drag one proposal above the other; blue order badge appears; drag the other onto it — amber "child of" badge]

Here he decides the voting order. The group votes on the first proposal first — and
the second is only put to a vote as a fallback, if the first one fails.

[screen: "Ready for final voting" button turns green — click it, confirm]

When every conflict has an order, the button turns green — and the document moves to
final voting.

## Chapter 10 — Recording the final vote *(1:30)* — David, Watering Schedule Amendment

[screen: Watering doc in final_voting — Review view, click "Voting walkthrough"]

The final vote itself usually happens in a room — hands in the air, or ballots.
VoteText's job is to keep the count honest. The voting walkthrough lists every
proposal in document order, conflict groups and fallbacks clearly marked.

[screen: point at the pre-recorded sprinkler tally with the green majority label]

For each proposal David types in the yes, no, and abstain counts. The majority
indicator does the maths in real time.

[screen: change the threshold dropdown on the weekend proposal to "⅔ majority" — requirement label updates]

Not every decision is a coin flip: a proposal can require an absolute, two-thirds,
or three-quarters majority — and the indicator immediately shows whether the tally
clears the bar.

[screen: enter tallies for the root conflict proposal so it passes — the child proposal greys out: "Not voting on — parent passed"]

Watch the fallback: the moment its parent passes, it's automatically taken off the
table.

[screen: click "Export CSV", then "Print HTML" — the printable tally sheet opens]

Need paper for the meeting, or a spreadsheet for the minutes? One click each. Every
saved tally is also kept in an audit log — who recorded what, and when.

## Chapter 11 — Reading the result *(0:45)* — Clara, Tool Shed Rules 2026

[screen: Clara's document list — open the resolved Tool Shed doc, click "Resolved text"]

When the vote is done, the document is *resolved* — and every participant can read
the outcome.

[screen: resolved-text view — green PASSED banner with timestamp, final text with line numbers]

This is the adopted text: every passing proposal applied, every failed one left out,
with a banner showing when the group made it official.

[screen: click "Export Markdown" — file downloads]

Export it as a file, print it, or just link people here. The document — and the whole
trail of proposals, arguments, and votes behind it — stays in VoteText for the record.

## Chapter 12 — A word on moderation *(0:45)* — David, Community Garden Charter

[screen: the gnome-catalogue comment on the dog proposal; click "Hide", confirm]

One more thing for the people running things. Occasionally a comment doesn't belong —
spam, or something that oversteps. A supervisor can hide it.

[screen: the comment is replaced by "Comment hidden by moderator" for a participant view]

Participants see that *something* was removed — honesty matters — but not what.

[screen: document sidebar → "Moderation" — the hidden comment listed with an Unhide button]

And nothing is silently destroyed: the moderation page lists everything that's
hidden, and any supervisor can restore it. Every action lands in the activity log.

## Chapter 13 — Outro *(0:20)*

[screen: back to the document list, the four documents with their status badges]

That's VoteText: one place where a group reads together, argues in the open, votes,
and walks away with a text everyone can point to. Set it up, invite your people, and
put your next document to the vote.

---

## Appendix A — paste text for Chapter 2

```
Spring Planting Plan 2027

1. The common beds are planted on the last weekend of April.
2. This year's theme crops are squash, sugar peas, and dahlias.
3. Seedlings are raised in the greenhouse from mid-March; sign-up sheet on the door.
4. Each member contributes two hours to the planting weekend or one tray of seedlings.
5. The plan is evaluated at the September assembly.
```

## Appendix B — live-typed content

- **Chapter 6 proposal** — title: *Let guests visit without an escort*; new text:
  `2.4 Guests are welcome during opening hours; children's guests must be accompanied by a member.`;
  rationale: *Requiring an escort for every adult guest is impractical — members' partners
  and neighbours visit all the time. Keeping the rule only for children's guests covers
  the actual concern.*
- **Chapter 5 comment** — *Agree with the friendlier tone — could we also name the
  committee as the ones to call when a dog is loose?*
