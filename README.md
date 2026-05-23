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
| Auth | **Email OTP** (via Nodemailer) | No passwords to store or leak |
| Deployment | **Single VPS** (Hetzner cx23) | €4.5/month, 2 vCPU, 4 GB RAM — more than enough |

There is **no bundler, no transpiler, no framework**. The frontend is a single HTML page with progressive enhancement. The backend is a thin REST API that serves JSON + static files.

---

### Features

#### Document Management
- Import from `.txt` or `.md` files
- Automatic page/line structuring (configurable lines per page, default 30)
- Preserve existing line numbers or auto-generate
- Documents support 1–200 pages, 27–40 lines per page
- Document status lifecycle: `draft → open → voting → resolved → archived`

#### Variant Proposals
- Target specific character ranges in the original text
- Three operations: **INSERT**, **REPLACE**, **DELETE**
- Title and rationale fields for context
- Variant relationships: `based_on`, `overlaps`, `conflicts`, `supersedes`
- Withdraw your own proposals

#### Voting
- One vote per user per variant: **for** (+1), **against** (−1), or **abstain** (0)
- Change or retract votes until the document enters resolution phase
- Denormalized vote tallies for fast display
- Resolution modes: majority, supermajority, owner decides

#### Discussion
- Two-level threaded comments under each variant
- Moderation support (hide comments)

#### Access Control
- Per-document access levels: viewer, commenter, proposer, voter, editor, admin
- Configurable anonymous/read-only viewing
- User blocking per document
- Document owner controls all settings

#### User Activity Feed
- "My proposals and comments" view
- Activity log tracking all significant events
- Configurable polling interval for real-time-ish updates

#### Authentication
- Passwordless email OTP login
- Session-based auth with secure cookies
- OTP rate limiting and lockout protection

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
| `GET`  | `/api/auth/me` | Get current user info |

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

#### Variants
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/documents/:id/variants` | List all variants for a document |
| `POST`   | `/api/documents/:id/variants` | Propose a new variant |
| `GET`    | `/api/variants/:id` | Get variant details |
| `PATCH`  | `/api/variants/:id` | Update variant (author only, while pending) |
| `DELETE` | `/api/variants/:id` | Withdraw variant |
| `POST`   | `/api/variants/:id/relations` | Add a variant relation |
| `GET`    | `/api/variants/:id/relations` | List variant relations |

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
| `GET` | `/api/activity` | Current user's activity feed |
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
- An SMTP server for sending OTP emails (or use a dev tool like [Ethereal](https://ethereal.email/) for testing)

#### Installation

```bash
# Clone the repository
git clone <repo-url> votetext
cd votetext

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your SMTP credentials and a random SESSION_SECRET

# Initialize the database
npm run init-db

# Start the development server
npm run dev
```

The application will be available at `http://localhost:3000`.

#### Directory Structure

```
votetext/
├── schema.sql              # Database schema definition
├── package.json            # Dependencies and scripts
├── .env.example            # Environment template
├── .gitignore
├── data/                   # SQLite database (gitignored)
│   └── votetext.db
├── scripts/
│   ├── init-db.js          # Create/migrate database
│   └── seed.js             # Optional: seed with sample data
├── src/
│   ├── server.js           # Express app entry point
│   ├── db.js               # Database connection + helpers
│   ├── middleware/
│   │   ├── auth.js         # Session validation middleware
│   │   ├── access.js       # Document access control
│   │   └── errors.js       # Error handling middleware
│   └── routes/
│       ├── auth.js         # OTP login/logout
│       ├── documents.js    # Document CRUD + import
│       ├── variants.js     # Variant proposals + relations
│       ├── votes.js        # Voting
│       ├── comments.js     # Discussion threads
│       ├── activity.js     # Activity feed
│       └── access.js       # User access management
└── public/
    ├── index.html          # Single-page application shell
    ├── app.js              # Client-side logic (vanilla JS)
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

#### Dev SMTP

For local development without a real SMTP server, use [Ethereal](https://ethereal.email/):

1. Go to https://ethereal.email/ and create a free account
2. Use the provided SMTP credentials in your `.env`
3. OTP emails will appear in Ethereal's web inbox

---

### Deployment (Hetzner cx23)

The application is designed to run on a single Hetzner cx23 VPS (2 vCPU, 4 GB RAM, €4.51/month).

#### Server Setup

```bash
# On the VPS (Ubuntu 22.04+)
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

# Clone and install
git clone <repo-url> /opt/votetext
cd /opt/votetext
npm ci --production
cp .env.example .env
# Edit .env for production settings

# Initialize database
npm run init-db

# Create systemd service
sudo tee /etc/systemd/system/votetext.service << 'EOF'
[Unit]
Description=VoteText
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/votetext
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable votetext
sudo systemctl start votetext
```

#### Nginx Reverse Proxy

```nginx
server {
    server_name votetext.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable HTTPS
sudo certbot --nginx -d votetext.example.com
```

#### Backups

```bash
# SQLite backup (safe with WAL mode)
sqlite3 /opt/votetext/data/votetext.db ".backup /backup/votetext-$(date +%F).db"
```

---

### Technology Choices

| Choice | Why |
|--------|-----|
| **Express** over Fastify | More widely known, more middleware ecosystem, good enough perf for this use case |
| **better-sqlite3** over knex/prisma | Synchronous API = simpler code, faster for single-server SQLite |
| **Vanilla JS** over React/Vue | Zero build step, smaller bundle, works without JS for basic reading |
| **Email OTP** over passwords | No password storage liability, simpler UX, good enough security for this audience |
| **SQLite** over Postgres | Single-file, zero-config, trivial backups, handles thousands of concurrent readers in WAL mode |
| **Single HTML page** over SPA router | Simplicity — URL hash routing for views, no build tool needed |

---

### Roadmap

- [ ] Core server setup (Express, middleware, DB connection)
- [ ] Authentication flow (OTP request → verify → session)
- [ ] Document CRUD and text import
- [ ] Document line parsing and pagination
- [ ] Variant proposal creation and management
- [ ] Variant relationship tracking
- [ ] Voting system with tally updates
- [ ] Comment threads (two-level)
- [ ] User activity feed
- [ ] Access control and invitation system
- [ ] Frontend: document viewer with line numbers
- [ ] Frontend: variant overlay / diff display
- [ ] Frontend: voting interface
- [ ] Frontend: comment threads
- [ ] Frontend: activity feed
- [ ] Moderation tools
- [ ] Resolution workflow
- [ ] Export resolved document
- [ ] Mobile-responsive design
- [ ] Rate limiting and security hardening
