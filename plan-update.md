# VoteText — Plan to Production

_Last updated: 2026-07-13_

The codebase is feature-complete against the specs (use cases UC-1 through UC-20).
Test status: **269 node tests** (239 API + 20 unit + 10 frontend contract) and
**45 Playwright e2e tests**, all green. What remains before production is one
substantial build task, one human validation gate, and the deploy itself.

---

## Remaining work items

### 1. Visual design pass — task #8 (only substantial build work left)

The groundwork is deliberately favorable: `style.css` already uses design tokens
(`--color-*`, `--font-*`), so this is meant to be a **CSS-mostly** change — retheme
tokens and component styles, and touch `app.js` only if a layout genuinely needs new
DOM.

- **Agree direction first** (palette, typography, density, light/dark) before writing
  CSS — taste is the owner's to set. Prepare 2–3 concrete options with side-by-side
  previews.
- Apply in order: tokens → components → responsive/mobile (layout is already
  mobile-first).
- **Regression gate:** re-run the full e2e suite afterward. The 45 e2e tests + the XSS
  spec exist to protect exactly this. If the redesign keeps the same element hooks
  (`.comment`, `.vote-btn`, `#propose-btn`, …), they catch breakage; if a layout change
  renames a hook, the failing test flags it immediately.
- **Constraint:** keep `public/app.js` under 2000 lines (currently 1928 — ~72 lines of
  headroom). Prefer CSS over JS.

### 2. Manual validation — human gate (can run in parallel with #1)

`specs/manual-validation.md` has two-browser walkthroughs for the boot regression and
UC-15/16/17/18/19, plus UC-18 items in the test-plan checklist. Automated tests can't
replace the "does it feel right" pass.

- **Gap to close:** the sign-off table is **missing UC-20** (comment editing), and there
  is no UC-20 walkthrough yet. Small doc fix.
- Best done **after** the design pass, so validation covers the final look rather than a
  throwaway UI.

### 3. Tutorial video — owner's ally (independent of everything else)

Scripts (EN + NO) and `npm run seed-demo` are ready.

- Only real coupling: record **after** the design pass so the video shows the final UI.
- Not a deploy blocker unless the video should be live at launch.

### 4. Production deployment — task #9 (last)

Infrastructure is templated and waiting: `cloud-init-example.yaml` (Node 22, nginx,
certbot, fail2ban, ufw, systemd, daily SQLite backup) and `first-deploy.sh`.

Pre-flight checklist:

- [ ] Fill `cloud-init.yaml` placeholders (deploy user, SSH key, domain, email).
- [ ] Set a real `SESSION_SECRET` — the server refuses to boot in production without one
      (cloud-init auto-generates via `openssl rand -hex 32`; confirm that path works).
- [ ] Real Resend key + verified `kjell.solutions` sender in `.env.prod` (already
      configured per project notes).
- [ ] Run `npm run migrate` on the server DB before real traffic — several columns
      (`supervisor`, `hidden_by`, `edited_at`, …) arrive via migration, not just
      `schema.sql`.
- [ ] Smoke-test the OTP email flow against the live domain (dev logs OTPs; production
      actually sends).
- [ ] Confirm the 03:00 backup cron and certbot renewal.

**Optional (noted, not a blocker):** a private `votetext-ops` repo for the filled-in
cloud-init and deploy scripts — version history + offsite backup instead of manual
copies. Worth doing around deploy time.

---

## Recommended order

```
Design direction (owner decides) → Design pass (#8) + regression
        |                                    |
   Video recording  <----------------  Manual validation (#2, owner sign-off)
        |                                    |
                    Prod deploy (#9)
```

The design pass is the critical path — manual validation and the video both want the
final UI, and deploy wants the sign-off.

**Blocking decision:** the visual direction is the one thing only the owner can decide
before the biggest piece starts. Recommended next step is to prepare concrete design
options (palette / typography / density with previews) so the design pass starts from a
chosen direction rather than a guess.

---

## Small doc cleanups to fold in along the way

- ~~Add UC-20 to the manual-validation sign-off table (+ a UC-20 walkthrough).~~ Done 2026-07-13.
- Decide on the `votetext-ops` repo at deploy time.
