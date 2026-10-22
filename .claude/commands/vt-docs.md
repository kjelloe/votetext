Update all documentation artifacts after a VoteText feature is completed. Work through each artifact in order:

## 1. specs/use-cases.md
- Add a new UC (next sequential number) for the feature just built
- Each UC needs: Actor, Entry point, Preconditions, Main flow (numbered steps), relevant sub-sections
- Update the "Planned / future use cases" list — remove any UC that is now implemented, renumber the rest
- Do not change existing UCs unless the feature changes their behaviour

## 2. specs/test-plan.md
- Add a new Group with a table of test scenarios — check the current last group letter in test-plan.md (do not trust this file's mapping to be complete) and use the letter matching the new group in tests/api.test.js
- Group mapping for reference: A=auth, B=docs, C=variants, D=relations, E=voting, F=comments, G=access, H=status, I=activity, J=config, K=review-view, L=final-voting, M=gap-fixes, N=auto-assign, O=share, P=draft-restriction, Q=final-vote-log, R=resolved-text, S=copy-data, T=thresholds, U=fork, W=supervisor, V=hmac-sessions, X=moderation, Y=access-matrix+expiry, Z=comment-editing, AA=2026-10 review fixes, AB=activity-log actions (after Z the letters double)
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
- `plan-update.md` — move the item to "Done", adjust the remaining phases and the test counts
- `specs/user-stories.md` — if a browser flow changed; keep the coverage map's e2e count right
- `specs/manual-validation.md` — add a walkthrough and a sign-off row for anything not covered by e2e
- `specs/tutorial-video-script.md` AND `specs/tutorial-video-script.no.md` — the `[screen: …]` cues are identical in both; change them together and translate the narration
- `.env.example` and the README configuration table — for every new or removed `process.env` variable
- `.claude/commands/vt-*.md` — if the feature changes what a skill tells you to do
- `cloud-init-example.yaml`, `cloud-init-hardened-example.yaml`, `deploy.env.example` and `scripts/deploy.sh` — for anything that changes how the server is provisioned or deployed; keep the two templates' headers in step and run `npm run test:deploy`
- `ops/notes/*.md` (private, outside the repo) — the server-hardening and offsite-backup guide must still match the templates and `scripts/deploy.sh --check` after any change to them

## 4. memory/project-votetext.md
- Update the test counts (run `grep -c "^test(" tests/*.test.js tests/e2e/*.spec.js` to get the real numbers)
- Add a short description of the new feature under a new bold heading
- Update the Status line to reflect what's done and what's next
- Update the Next major feature pointer

## Rules
- Verify the actual test count by running the grep command — do not guess
- Check K14/K15-style table rows: if Expected column is blank, fill it
- After updating memory, do NOT also update MEMORY.md index unless the memory file itself was created or renamed
- Do not create new memory files for feature details — update project-votetext.md in place
