# VoteText

**Collaborative text voting platform** — upload a document, let participants propose changes, discuss them, and vote to reach consensus.

---

### Overview

VoteText is a minimal, self-hosted web application for structured document collaboration. It replaces messy email threads and comment-heavy Google Docs with a focused workflow:

1. **Upload** a text or Markdown document
2. **Propose** variants — insertions, replacements, or deletions on specific character ranges
3. **Discuss** each proposal in threaded comments
4. **Vote** for, against, or abstain on each variant
5. **Resolve** — the document owner applies the winning changes

The platform is designed for committees, working groups, legal teams, standards bodies, or any group that needs transparent, auditable text decision-making.

---

### Architecture

VoteText follows a **minimal stack philosophy**:

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | **Node.js + Express** | Simple, well-understood, minimal overhead |
| Database | **SQLite** (via better-sqlite3) | Zero-config, single-file, fast for read-heavy workloads |
| Frontend | **Vanilla JS + HTML + CSS** | No build step, no framework churn, works everywhere |
| Auth | **Email OTP** (via Resend SDK) | No passwords to store or leak |
| Deployment | **Single VPS** (Hetzner cx23) | €4.5/month, 2 vCPU, 4 GB RAM — more than enough |

There is **no bundler, no transpiler, no framework**. The frontend is a single HTML page with progressive enhancement. The backend is a thin REST API that serves JSON + static files.

---

### Features

#### Document Management
- Import from `.txt` or `.md` files via drag-and-drop, file picker, or paste
- Auto-detects format: paged markdown (`---` page breaks), pre-numbered lines, or plain text
- Paged markdown: strips separators and line-number prefixes, infers lines-per-page from page structure
- Pre-numbered text: optional strip of leading line numbers before import
- Automatic page/line structuring (configurable lines per page, default 30)
- Documents support 1–200 pages, 27–60 lines per page
- Document status lifecycle: `draft → open → voting → final_voting → resolved → archived`
- **Resolved text** — on transition to `resolved`, approved variants are applied to the original text and stored; preview view shows the resolved text with line numbers, PASSED/FAILED banner (with timestamp), Export Markdown and Print HTML buttons, and a "Fork as new document" option for the owner
- **Draft visibility** — draft documents are only shown to the owner and users with `editor`/`admin` access; all other roles and anonymous users see 403 until the document is opened
- **Copy document** — owner can duplicate a document (same title + " (copy)", same text) from the viewer toolbar, with optional checkboxes to also copy proposals, votes, and comments from the source

#### Variant Proposals
- Select text in the document viewer to set the target range; character offsets are resolved automatically
- Propose modal shows the selected text in a collapsible read-only preview
- Three operations: **INSERT**, **REPLACE**, **DELETE**
- Title and rationale fields for context
- Proposals sidebar shows all proposals ordered by document position; sequential numbers, line ranges, and author tooltips (name + organisation)
- **Sidebar filter** — All N / On-page N / Top buttons filter the list to all proposals, only those overlapping the current page, or the top `PROPOSALS_TOP_PERCENT`% ranked by total votes; filter is persisted per document
- Hovering a proposal highlights its lines if on the current page; a go-to-page link is always shown, navigating and scrolling the line into view on click
- Overlapping proposals show an overlap indicator (⊕ #N, #M) on hover; clicking it highlights all cards in the overlap group in amber
- **Comment heatmap** — each proposal card shows a 💬 N comment count, coloured orange/red when the proposal holds a configurable share of all document comments (`COMMENT_HEAT_ORANGE` / `COMMENT_HEAT_RED`)
- Variant relationships: `based_on`, `overlaps`, `conflicts`, `supersedes`
- Withdraw your own proposals
- **Proposal detail page** — heading shows "Proposal #N"; ← Prev / Next → arrows navigate between proposals in document order with tooltips; Back to document scrolls to the proposal's location; line context preview (Original/Proposed toggle) shows affected lines with inline highlights
- **Share proposal** — Share button on every proposal opens a modal with a direct link and Copy button; proposer can toggle "Allow anyone to view" to enable anonymous access via the link; anonymous visitors see a simplified view (title, rationale, diff + login prompt)

#### Voting
- One vote per user per variant: **for** (+1), **against** (−1), or **abstain** (0)
- Change or retract votes until the document enters resolution phase
- Denormalized vote tallies for fast display
- Resolution: simple majority (yes > no) applied on the `final_voting → resolved` transition; configurable majority thresholds are planned (see Roadmap)

#### Discussion
- Two-level threaded comments under each variant
- Comment sorting on the proposal page: Oldest / Newest / Most replied / Author's
- Deleted comments are hidden, not removed (`is_hidden` flag); a full moderation dashboard is planned (see Roadmap)

#### Access Control
- Per-document access levels: viewer, commenter, proposer, voter, editor, admin
- **Default access** — set a fallback role (viewer–voter) granted to any signed-in user not explicitly invited; invite-only when unset
- Invite users by searching name, email, or organisation (3+ chars); non-searchable/protected users excluded from search but invitable by exact email
- Invitation email sent to new users (fire-and-forget via Resend); names inviter, document, and role
- Inviters cannot assign a level higher than their own
- Configurable anonymous/read-only viewing
- User blocking per document
- Document owner controls all settings

#### User Activity Feed
- Default view: all activity on documents you own or have access to
- `?mine=true` filter: only your own actions
- Activity log tracking all significant events
- Configurable polling interval for real-time-ish updates
- **Unread badge** — red counter next to the Activity nav link shows new events since last visit; resets on page open; persisted via `localStorage`

#### Authentication
- Passwordless email OTP login
- Session-based auth with secure cookies
- OTP rate limiting and lockout protection
- **Non-searchable profile** — users can opt out of appearing in user search results (profile toggle)
- **Profile completion** — new users without a display name are prompted to fill in their name and organisation in a modal overlay immediately after their first login

---

### Database Schema

All data lives in a single SQLite file (`data/votetext.db`). The schema is defined in [`schema.sql`](./schema.sql).

#### Tables

| Table | Purpose |
|-------|---------|
| `users` | Registered users (email, display name, organization, role) |
| `otp_codes` | Temporary one-time password codes for email auth |
| `sessions` | Active user sessions (token, expiry, IP) |
| `documents` | Uploaded documents with metadata and JSON settings |
| `document_lines` | Original text broken into page/line/char-offset structure |
| `variants` | Proposed text changes (operation, char range, new text, vote tallies) |
| `variant_relations` | Relationships between variants (based_on, overlaps, conflicts, supersedes) |
| `votes` | One vote per user per variant (+1 / −1 / 0) |
| `comments` | Two-level threaded discussion under each variant |
| `user_document_access` | Per-user, per-document access level + block flag |
| `activity_log` | Event log for activity feeds and audit trails |
| `final_vote_log` | Append-only tally audit trail (one row per final-vote save, Unix ms timestamp) |

#### Key Design Decisions

- **Character offsets**: Variants target absolute character ranges (`char_start`, `char_end`) in the original document, enabling precise diffs regardless of line/page structure.
- **Denormalized vote tallies**: `variants.votes_for/against/abstain` are maintained alongside the normalized `votes` table for O(1) display reads.
- **JSON settings**: `documents.settings` stores per-document configuration as a flexible JSON blob, avoiding schema bloat for rarely-used options.
- **WAL mode**: SQLite runs in Write-Ahead Logging mode for concurrent read performance.

---

### API Endpoints

#### Authentication
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/request-otp` | Send OTP code to email |
| `POST` | `/api/auth/verify-otp` | Verify OTP and create session |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET`  | `/api/auth/me` | Get current user info + client config |
| `PATCH` | `/api/auth/profile` | Update display name, organisation, searchability |
| `GET`  | `/api/auth/search` | Search users by name/email/organisation (3+ chars; non-searchable/protected excluded) |

#### Documents
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/documents` | List documents accessible to current user |
| `POST`   | `/api/documents` | Create new document (upload text/md) |
| `GET`    | `/api/documents/:id` | Get document with full text and metadata |
| `PATCH`  | `/api/documents/:id` | Update document metadata/settings |
| `DELETE` | `/api/documents/:id` | Delete document (owner/admin only) |
| `POST`   | `/api/documents/:id/status` | Change document status |
| `GET`    | `/api/documents/:id/lines` | Get paginated document lines |
| `GET`    | `/api/documents/:id/lines?page=N` | Get lines for specific page |
| `GET`    | `/api/documents/:id/text` | Full reconstructed document text (for copy/export) |
| `POST`   | `/api/documents/:id/copy-data` | Copy proposals/votes/comments from source `:id` into a target doc (owner of both) |
| `PATCH`  | `/api/documents/:id/doc-vote` | Record overall document vote tallies (editor/admin, `final_voting` only) |

#### Variants
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/documents/:id/variants` | List all variants for a document |
| `POST`   | `/api/documents/:id/variants` | Propose a new variant |
| `GET`    | `/api/variants/:id` | Get variant details |
| `PATCH`  | `/api/variants/:id` | Update variant (author only, while pending) |
| `DELETE` | `/api/variants/:id` | Withdraw variant |
| `PATCH`  | `/api/variants/:id/share` | Enable / disable anonymous share link (proposer only) |
| `PATCH`  | `/api/variants/:id/review-status` | Set review status: pending/conflict/rejected/not_applicable/withdrawn (editor/admin) |
| `PATCH`  | `/api/variants/:id/conflict-order` | Set `vote_order` / `parent_variant_id` for conflict resolution (editor/admin, `voting` only) |
| `POST`   | `/api/variants/:id/relations` | Add a variant relation |
| `GET`    | `/api/variants/:id/relations` | List variant relations |
| `PATCH`  | `/api/variants/:id/final-vote` | Record final tally (editor/admin, final_voting only) |
| `GET`    | `/api/variants/:id/final-vote-log` | Full audit trail of tally saves (editor/admin only) |

#### Resolved Text
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/documents/:id/resolved-text` | Resolved text with approved variants applied; on-the-fly for `final_voting`, stored for `resolved`/`archived` (editor+ only) |

#### Votes
| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/variants/:id/vote` | Cast or change vote |
| `DELETE` | `/api/variants/:id/vote` | Retract vote |
| `GET`    | `/api/variants/:id/votes` | Get vote breakdown |

#### Comments
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/variants/:id/comments` | List comments for a variant |
| `POST`   | `/api/variants/:id/comments` | Add a comment |
| `PATCH`  | `/api/comments/:id` | Edit a comment (author only) |
| `DELETE` | `/api/comments/:id` | Delete a comment |

#### Activity Feed
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/activity` | Activity feed (all docs user owns/has access to; `?mine=true` for own actions) |
| `GET` | `/api/documents/:id/activity` | Activity feed for a specific document |

#### Access Control
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/documents/:id/access` | List users with access |
| `POST`   | `/api/documents/:id/access` | Invite user / set access level |
| `PATCH`  | `/api/documents/:id/access/:userId` | Update access level |
| `DELETE` | `/api/documents/:id/access/:userId` | Revoke access |

---

### Setup

#### Prerequisites
- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- A [Resend](https://resend.com/) account with a verified sender domain (for production email; not required for local dev)

#### Installation

```bash
# Clone the repository
git clone <repo-url> votetext
cd votetext

# Install dependencies
npm install

# Configure environment — fill in RESEND_API_KEY (see Configuration below)
# cp .env.prod .env   ← for production
# (dev .env is already present with safe defaults)

# Initialize the database
npm run init-db

# Start the development server
npm run dev
```

The application will be available at `http://localhost:3000`.

#### Configuration (environment variables)

All variables are optional except `RESEND_API_KEY` (production email). Defaults shown.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | `production` / `development` / `test` — controls email behaviour and cookie flags |
| `DATABASE_PATH` | `./data/votetext.db` | SQLite file location |
| `SESSION_LIFETIME_HOURS` | `72` | Session cookie/token lifetime |
| `SESSION_SECRET` | — | Present in env templates; **not yet used by code** (see Roadmap: signed session tokens) |
| `OTP_LENGTH` | `6` | OTP code digits |
| `OTP_EXPIRY_MINUTES` | `10` | OTP validity window |
| `OTP_MAX_ATTEMPTS` | `5` | OTP requests per email per 15 min |
| `RESEND_API_KEY` | — | Resend API key for OTP + invite email |
| `MAIL_FROM_ADDRESS` | — | Sender address (verified domain in Resend) |
| `MAIL_FROM_NAME` | `VoteText` | Sender display name |
| `VOTETEXT_URL` | request origin | Absolute app URL used in invite emails |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins (comma-separated) |
| `MAX_DOCUMENT_CHARS` | `1000000` | Maximum document size on import |
| `DEFAULT_LINES_PER_PAGE` | `30` | Lines per page when not specified |
| `COMMENT_EDIT_WINDOW_MINUTES` | `30` | How long authors can edit their comments |
| `COMMENT_COOLDOWN_SECONDS` | `5` | Minimum interval between comments per user |
| `VARIANT_COOLDOWN_SECONDS` | `5` | Minimum interval between proposals per user |
| `COMMENT_HEAT_ORANGE` | `10` | Heatmap: % of document comments for orange |
| `COMMENT_HEAT_RED` | `25` | Heatmap: % of document comments for red |
| `PROPOSALS_TOP_PERCENT` | `10` | Sidebar "Top" filter percentage |
| `TOAST_DISMISS_SECONDS` | `30` | Toast notification auto-dismiss |
| `VOTING_COUNTDOWN_DEFAULT_MINUTES` | `5` | Default countdown in the schedule-voting form |

#### Directory Structure

```
votetext/
├── schema.sql              # Database schema definition
├── package.json            # Dependencies and scripts
├── .env                    # Dev environment (gitignored)
├── .env.prod               # Production environment template (gitignored)
├── .gitignore
├── cloud-init-example.yaml # Hetzner provisioning template (copy to cloud-init.yaml, gitignored)
├── data/                   # SQLite database (gitignored)
│   └── votetext.db
├── scripts/
│   ├── init-db.js          # Create database from schema.sql
│   ├── migrate.js          # Add columns to existing databases (idempotent)
│   └── seed.js             # Optional: seed with sample data
├── src/
│   ├── server.js           # Express app entry point
│   ├── db.js               # Database connection + helpers
│   ├── middleware/
│   │   ├── auth.js         # Session validation middleware
│   │   ├── access.js       # Document access control
│   │   └── errors.js       # Error handling middleware
│   └── routes/
│       ├── auth.js         # OTP login/logout + profile
│       ├── documents.js    # Document CRUD + import + access sub-routes
│       ├── variants.js     # Variant proposals, relations, voting, comments
│       ├── comments.js     # Comment edit/delete (standalone path)
│       └── activity.js     # Activity feed
├── specs/
│   ├── test-plan.md        # Test scenarios (automated + manual checklist)
│   └── use-cases.md        # Detailed user flows (UC-1 …)
├── tests/
│   └── api.test.js         # Integration tests (node:test, isolated DB)
└── public/
    ├── index.html          # Single-page application shell
    ├── app.js              # Client-side logic (vanilla JS, < 2000 lines)
    ├── review.js           # Editor/admin views: review, conflicts, final voting, resolved text
    └── style.css           # Styles
```

---

### Local Development

```bash
# Start with auto-reload
npm run dev

# Reset database
npm run clean-db

# View database (optional — install sqlite3 CLI)
sqlite3 data/votetext.db ".tables"
sqlite3 data/votetext.db "SELECT * FROM users;"
```

#### Dev email

No email account is needed for local development. In `development` mode, the OTP code and invite details are always printed to the console via `console.debug` before the send attempt — copy the code from the terminal to log in. Send failures are non-fatal and logged. In `test` mode (`npm test`), email sending is skipped entirely; tests read OTPs directly from the database.

---

### Deployment (Hetzner CX23)

The application is designed to run on a single Hetzner CX23 VPS (2 vCPU, 4 GB RAM, ~€4.5/month).

Server provisioning is templated in [`cloud-init-example.yaml`](./cloud-init-example.yaml) — copy it to `cloud-init.yaml` (gitignored), fill in the `<PLACEHOLDER>` values (deploy user, SSH key, domain, email), and paste it into the Hetzner console when creating the server. It installs Node.js 22 LTS, nginx, certbot, fail2ban, ufw, and configures the systemd service automatically.

#### First deploy (after server boot)

```bash
# 1. Copy code (excluding node_modules, data, and env files)
rsync -av --exclude node_modules --exclude data --exclude .env --exclude .env.prod \
  -e "ssh -p 2222" \
  . <DEPLOY_USER>@<YOUR_DOMAIN>:/opt/votetext/

# 2. Copy production env
scp -P 2222 .env.prod <DEPLOY_USER>@<YOUR_DOMAIN>:/opt/votetext/.env

# 3. Point DNS A record to the server IP, then on the server:
ssh -p 2222 <DEPLOY_USER>@<YOUR_DOMAIN>
~/first-deploy.sh
```

`first-deploy.sh` runs `npm install --omit=dev`, initialises the database, starts the systemd service, and obtains a Let's Encrypt certificate via certbot.

#### Backups

A daily cron job at 03:00 backs up the SQLite database to `~/backups/` on the server with 30-day retention (configured in the cloud-init template).

```bash
# Manual backup
sqlite3 /opt/votetext/data/votetext.db ".backup ~/backups/votetext-$(date +%F).db"
```

---

### Technology Choices

| Choice | Why |
|--------|-----|
| **Express** over Fastify | More widely known, more middleware ecosystem, good enough perf for this use case |
| **better-sqlite3** over knex/prisma | Synchronous API = simpler code, faster for single-server SQLite |
| **Vanilla JS** over React/Vue | Zero build step, smaller bundle, no framework churn |
| **Email OTP** over passwords | No password storage liability, simpler UX, good enough security for this audience |
| **SQLite** over Postgres | Single-file, zero-config, trivial backups, handles thousands of concurrent readers in WAL mode |
| **Single HTML page** over SPA router | Simplicity — URL hash routing for views, no build tool needed |

---

### Roadmap

- [x] Core server setup (Express, middleware, DB connection)
- [x] Authentication flow (OTP request → verify → session)
- [x] Document CRUD and text import
- [x] Document line parsing and pagination
- [x] Variant proposal creation and management
- [x] Variant relationship tracking
- [x] Voting system with tally updates
- [x] Comment threads (two-level)
- [x] User activity feed
- [x] Access control and invitation system
- [x] Frontend: document viewer with line numbers
- [x] Frontend: variant overlay / diff display
- [x] Frontend: voting interface
- [x] Frontend: comment threads
- [x] Frontend: activity feed
- [x] Mobile-responsive design
- [x] Rate limiting and security hardening
- [x] Document status lifecycle (draft → open → voting → final_voting → resolved → archived)
- [x] Review view (two-panel, per-proposal action buttons)
- [x] Conflict resolution view (drag-and-drop ordering, parent/child hierarchy)
- [x] Final voting walkthrough (tally recording, export CSV, print HTML, audit trail)
- [x] Voting countdown with live banner and toast notifications
- [x] Share proposal via direct link (proposer controls anonymous access)
- [x] Profile completion modal on first login
- [x] Activity unread badge
- [x] Draft document visibility restriction
- [x] Resolution workflow — resolved text stored on `final_voting → resolved` transition; editor preview, export as Markdown/HTML, PASSED/FAILED banner, fork as new document
- [ ] Export resolved document (further polish)
- [ ] Moderation dashboard — UI to hide/unhide variants (`variants.is_hidden` currently has no setter endpoint), hide comments as a moderation action distinct from author delete, and manage `users.is_protected` (enforced in search, admin-settable only via SQL today)
- [ ] Signed session tokens — use `SESSION_SECRET` (already in env templates, unused) to HMAC-sign session IDs
- [ ] Configurable majority thresholds — absolute majority, 2/3 majority, 3/4 majority (current behaviour: simple majority yes > no). Open design question: per-document setting vs per-proposal setting chosen while preparing the vote (same phase as conflict resolution)
- [ ] Fork a variant (UC-16) — propose a new variant based on an existing one via the `based_on` relation
- [ ] **Ops:** `votetext-ops` — separate private repository for deployment/ops files (filled-in cloud-init, ssh/deploy scripts, prompt log), giving them version history and offsite backup instead of manual zip copies
