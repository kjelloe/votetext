Update all documentation artifacts after a VoteText feature is completed. Work through each artifact in order:

## 1. specs/use-cases.md
- Add a new UC (next sequential number) for the feature just built
- Each UC needs: Actor, Entry point, Preconditions, Main flow (numbered steps), relevant sub-sections
- Update the "Planned / future use cases" list — remove any UC that is now implemented, renumber the rest
- Do not change existing UCs unless the feature changes their behaviour

## 2. specs/test-plan.md
- Add a new Group with a table of test scenarios — check the current last group letter in test-plan.md (do not trust this file's mapping to be complete) and use the letter matching the new group in tests/api.test.js
- Group mapping for reference: A=auth, B=docs, C=variants, D=relations, E=voting, F=comments, G=access, H=status, I=activity, J=config, K=review-view, L=final-voting, M=gap-fixes, N=auto-assign, O=share, P=draft-restriction, Q=final-vote-log, R=resolved-text, S=copy-data, T=thresholds, U=fork, W=supervisor, V=hmac-sessions, X=moderation, Y=access-matrix+expiry, Z=comment-editing, AA=2026-10 review fixes, AB=activity-log actions, AC=security hardening (roles, caps), AD=paged import, AE=my_vote in the proposal list, AF=security review 2026-11-18 (after Z the letters double)
- Every row must have a non-empty Expected column — fill it even if it seems obvious
- Add any new manual UI checklist items at the bottom of the checklist section

## 3. ARCHITECTURE.md
- Update the hash-router table (Frontend Architecture section) if new routes were added
- Update the API routes listing if new endpoints were added
- Add or extend a feature section describing the implementation (pattern, endpoints used, data flow)
- Update any stale route or status lifecycle diagrams
- Update the `app.js` split strategy table if new candidate files are identified

## 3b. README.md
- Update the Features section to list new capabilities
- Update the schema tables section if new tables were added
- Update the API Endpoints tables if new endpoints were added
- Update the Roadmap — mark completed items `[x]` and add new in-progress items

## 3c. CLAUDE.md
- Update the architecture summary if a file was added, moved or changed purpose
- Update a rule or pattern section if the feature changed how things must be done (access checks, email, logging, migrations, testing)

## 3d. Other artifacts — update only those the feature touches
- `plan-update.md` — move the item to "Done", adjust the remaining phases and the test counts; a security finding gets a "Patched" note under its T table with the commit, the test group and what still waits on the owner (a server-side fix says where it lands: the repo template, or B.2 on the live VM)
- `specs/user-stories.md` — if a browser flow changed; keep the coverage map's e2e count right
- `specs/manual-validation.md` — add a walkthrough and a sign-off row for anything not covered by e2e
- `specs/tutorial-video-script.md` AND `specs/tutorial-video-script.no.md` — the `[screen: …]` cues are identical in both (a unit test fails otherwise); change them together and translate the narration; each cue is a beat of the scripted recording: when a cue is added or removed, the chapter's action script in `tutorial/chapters/` needs one function per cue (the unit test checks the count), and the Oslo pair `tutorial-video-script.oslo.md` / `.oslo.no.md` must carry the same cue count per chapter (one set of chapters serves every scenario); narration changes re-synthesise automatically (cached by text hash) — a changed Norwegian beat means a new take (`specs/tutorial-norwegian-recording.md`)
- `tutorial/scenarios/*.js` — when a UI label, button text or seeded text the chapters click or type changes, the `targets` of every scenario change with it; re-record the affected chapter silently (`npm run tutorial -- <n> --silent [--scenario oslo]`) to check
- `specs/tutorial-video-script.oslo.md` § Production record — when the recording setup (scale, voice, theme, source draft) changes
- `.env.example` and the README configuration table — for every new or removed `process.env` variable
- `.claude/commands/vt-*.md` — if the feature changes what a skill tells you to do
- `cloud-init-example.yaml`, `cloud-init-hardened-example.yaml`, `deploy.env.example` and `scripts/deploy.sh` — for anything that changes how the server is provisioned or deployed; keep the two templates' headers in step and run `npm run test:deploy`
- `ops/notes/*.md` (private, outside the repo) — the server-hardening and offsite-backup guide must still match the templates and `scripts/deploy.sh --check` after any change to them

## 4. memory/project-votetext.md
- Update the test counts from the runners, not from grep (nested `test(` calls make grep undercount): `npm test 2>&1 | grep -E "^# (tests|pass)"` for node and `npx playwright test --list 2>&1 | tail -1` for e2e
- Add a short description of the new feature under a new bold heading
- Update the Status line to reflect what's done and what's next
- Update the Next major feature pointer

## Rules
- Verify the actual test counts with the two runner commands above — do not guess and do not trust grep
- Check K14/K15-style table rows: if Expected column is blank, fill it
- After updating memory, do NOT also update MEMORY.md index unless the memory file itself was created or renamed
- Do not create new memory files for feature details — update project-votetext.md in place
