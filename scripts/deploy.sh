#!/usr/bin/env bash
# VoteText deploy — ships committed files only, in place, with backup and rollback.
#
#   ./scripts/deploy.sh          deploy HEAD
#   ./scripts/deploy.sh <ref>        deploy another commit, tag or branch (this is also how you roll back)
#
#   --env          also upload .env.prod as the server .env (first deploy, or when config changed)
#   --skip-tests   do not run npm test first
#   --no-migrate   leave the database schema as it is
#   --dry-run      show what would be deployed and stop
#   --yes          do not ask for confirmation
#   --check        audit the server's hardening (service user, sudo, permissions, TLS,
#                  backups, updates, firewall) and the live app; deploys nothing
#
# On the server: install deps (only if package-lock.json changed) → stop → back up
# the database → swap code → migrate → start → health check. A failure after the
# stop restores the previous code, .env and database and starts the old version.
# Deploying a commit older than the live one is a rollback: the code goes back,
# the database is not migrated (the schema only ever grows, so old code runs on it).
#
# Works with both server layouts: everything as the deploy user (cloud-init-example.yaml),
# or the app as a dedicated service user with the deploy user limited to systemctl and
# `sudo -u <service user>` (cloud-init-hardened-example.yaml). The service user is read
# from the systemd unit; database work and backups then run as that user.
set -euo pipefail

# Server settings come from deploy.env in the repo root (gitignored; see
# deploy.env.example) or from DEPLOY_* variables already in the environment.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/deploy.env" ]; then
    while IFS='=' read -r key value; do
        case "$key" in ''|'#'*) continue ;; esac
        value="${value%\"}"; value="${value#\"}"
        [ -z "${!key:-}" ] && export "$key=$value"
    done < "$ROOT/deploy.env"
fi
HOST="${DEPLOY_HOST:-}"
SSH_PORT="${DEPLOY_SSH_PORT:-22}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"
APP="${DEPLOY_APP_DIR:-/opt/votetext}"
SERVICE="${DEPLOY_SERVICE:-votetext}"
PUBLIC_URL="${DEPLOY_PUBLIC_URL:-}"
ENV_FILE="${DEPLOY_ENV_FILE:-.env.prod}"
SHIP=(package.json package-lock.json schema.sql src public scripts)

REF=HEAD
WITH_ENV=0
SKIP_TESTS=0
RUN_MIGRATE=1
DRY_RUN=0
CHECK=0
ASSUME_YES=0

die() { echo "ERROR: $*" >&2; exit 1; }

for arg in "$@"; do
    case "$arg" in
        --env)        WITH_ENV=1 ;;
        --skip-tests) SKIP_TESTS=1 ;;
        --no-migrate) RUN_MIGRATE=0 ;;
        --dry-run)    DRY_RUN=1 ;;
        --check)      CHECK=1 ;;
        --yes)        ASSUME_YES=1 ;;
        -h|--help)    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*)           die "Unknown option: $arg" ;;
        *)            REF="$arg" ;;
    esac
done

[ -n "$HOST" ] || die "DEPLOY_HOST is not set — copy deploy.env.example to deploy.env and fill it in"
cd "$ROOT"

SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10)
[ -n "$SSH_KEY" ] && [ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
remote() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

# ── Hardening audit ──────────────────────────────────────────────────────────
if [ "$CHECK" = 1 ]; then
    echo "==> Server audit: $HOST"
    remote "APP='$APP' SERVICE='$SERVICE' bash -s" <<'AUDIT'
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\r"; }
SVC_USER=$(systemctl show -p User --value "$SERVICE" 2>/dev/null)
ME=$(id -un)

if [ -n "$SVC_USER" ] && [ "$SVC_USER" != "$ME" ]; then ok "service runs as '$SVC_USER', deploys as '$ME'"; else warn "service runs as the deploy user '$ME' — see cloud-init-hardened-example.yaml"; fi
if sudo -n -l 2>/dev/null | grep -qE '\(ALL ?(: ?ALL)?\) NOPASSWD: ALL'; then warn "'$ME' has unrestricted passwordless sudo"; else ok "'$ME' sudo is limited"; fi
for opt in NoNewPrivileges ProtectSystem PrivateTmp; do
    v=$(systemctl show -p "$opt" --value "$SERVICE" 2>/dev/null)
    case "$v" in yes|strict|full) ok "unit $opt=$v" ;; *) warn "unit $opt=${v:-unset}" ;; esac
done
systemctl is-active --quiet "$SERVICE" 2>/dev/null && ok "service active" || warn "service not active"
systemctl is-enabled --quiet "$SERVICE" 2>/dev/null && ok "service enabled at boot" || warn "service not enabled at boot"

if [ -f "$APP/.env" ]; then
    perm=$(stat -c '%a %U:%G' "$APP/.env")
    case "$perm" in 600*|640*) ok ".env is $perm" ;; *) warn ".env is $perm — should be 600 (or 640 with the service group)" ;; esac
    for k in SESSION_SECRET RESEND_API_KEY; do [ -n "$(envval "$k" "$APP/.env")" ] && ok "$k set" || warn "$k missing from .env"; done
    [ -n "$(envval NODE_ENV "$APP/.env")" ] && warn "NODE_ENV in .env — the unit sets it; remove it" || ok "NODE_ENV not in .env"
    for k in LOG_LEVEL ACTIVITY_REFRESH_INTERVAL OTP_LOCKOUT_MINUTES; do [ -n "$(envval "$k" "$APP/.env")" ] && warn "$k in .env is not read by the app"; done
    mode=$(envval SIGNUP_MODE "$APP/.env"); [ "$mode" = invited ] && ok "SIGNUP_MODE=invited" || warn "SIGNUP_MODE=${mode:-open} — anyone with an email can sign up"
else
    warn "no $APP/.env"
fi
DB=$(envval DATABASE_PATH "$APP/.env"); DB=${DB:-./data/votetext.db}; case "$DB" in /*) ;; *) DB="$APP/${DB#./}" ;; esac
if [ -f "$DB" ]; then
    perm=$(stat -c '%a' "$(dirname "$DB")"); case "$perm" in *0|*5) ok "data dir mode $perm" ;; *) warn "data dir mode $perm — should not be world-writable" ;; esac
    ok "database $(du -h "$DB" | cut -f1)"
else
    warn "no database at $DB"
fi
LEFT=$(ls -A "$APP" 2>/dev/null | grep -vxE 'src|public|scripts|node_modules|data|backups|package\.json|package-lock\.json|schema\.sql|\.env|\.previous|\.deployed-version' | tr '\n' ' ')
[ -z "$LEFT" ] && ok "no unmanaged files in $APP" || warn "unmanaged files in $APP: $LEFT"

NEWEST=$(ls -t "$HOME"/backups/*.db "$APP"/backups/*.db /var/backups/votetext/*.db 2>/dev/null | head -1)
if [ -n "$NEWEST" ]; then
    age=$(( ( $(date +%s) - $(stat -c %Y "$NEWEST") ) / 3600 ))
    [ "$age" -le 48 ] && ok "newest backup ${age}h old ($NEWEST)" || warn "newest backup is ${age}h old ($NEWEST)"
else
    warn "no backup files found"
fi
ls /etc/cron.d/votetext-backup >/dev/null 2>&1 && ok "nightly backup cron present" || warn "no /etc/cron.d/votetext-backup"
ls /etc/cron.d/votetext-offsite >/dev/null 2>&1 && ok "offsite backup cron present" || warn "no offsite backup cron — backups live only on this VM"

grep -qs 'client_max_body_size' /etc/nginx/sites-enabled/* && ok "nginx client_max_body_size set" || warn "nginx client_max_body_size not set (1 MB default rejects large documents)"
grep -qs 'limit_req' /etc/nginx/sites-enabled/* && ok "nginx rate limit on /api/auth" || warn "no nginx rate limit on /api/auth (the app limits per address itself)"
systemctl is-active --quiet certbot.timer 2>/dev/null && ok "certbot renewal timer active" || warn "certbot.timer not active"
grep -qs '^APT::Periodic::Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades && ok "unattended security upgrades on" || warn "unattended-upgrades not enabled"
[ -f /var/run/reboot-required ] && warn "reboot required (kernel/libc update pending)" || ok "no reboot pending"
if command -v ufw >/dev/null; then sudo -n ufw status 2>/dev/null | grep -q 'Status: active' && ok "ufw active" || warn "ufw status unknown (needs sudo) or inactive"; fi
systemctl is-active --quiet fail2ban 2>/dev/null && ok "fail2ban active" || warn "fail2ban not active"
ss -tln 2>/dev/null | grep -q ':22 ' && warn "sshd listening on port 22" || ok "sshd not on port 22"
PORT=$(envval PORT "$APP/.env"); PORT=${PORT:-3000}
ss -tln 2>/dev/null | grep -qE "127\.0\.0\.1:$PORT |\[::1\]:$PORT " && ok "app bound to loopback on $PORT" || { ss -tln 2>/dev/null | grep -q ":$PORT " && warn "app port $PORT is not loopback-only" || true; }
df -h "$APP" | awk 'NR==2 { gsub("%","",$5); if ($5+0 > 85) printf "  WARN  disk %s%% used\n", $5; else printf "  OK    disk %s%% used\n", $5 }'
[ -f "$APP/.deployed-version" ] && ok "deployed $(cut -c1-7 "$APP/.deployed-version") at $(cut -d' ' -f2 "$APP/.deployed-version")" || warn "no .deployed-version marker (never deployed with this script)"
AUDIT
    if [ -n "$PUBLIC_URL" ]; then
        echo "==> Public checks: $PUBLIC_URL"
        H=$(curl -sS -D - -o /dev/null --max-time 10 "$PUBLIC_URL/healthz" 2>/dev/null || true)
        echo "$H" | grep -qi '^HTTP/.* 200' && echo "  OK    /healthz 200" || echo "  WARN  /healthz did not answer 200"
        for hdr in strict-transport-security content-security-policy x-frame-options x-content-type-options; do
            echo "$H" | grep -qi "^$hdr:" && echo "  OK    $hdr" || echo "  WARN  $hdr header missing"
        done
        host=${PUBLIC_URL#https://}; host=${host%%/*}
        exp=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
        if [ -n "$exp" ]; then
            days=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
            [ "$days" -gt 14 ] && echo "  OK    TLS certificate valid $days more days" || echo "  WARN  TLS certificate expires in $days days"
        else
            echo "  WARN  could not read the TLS certificate"
        fi
        curl -sS -o /dev/null -w '  %{http_code} http → https redirect\n' --max-time 10 "http://$host/" 2>/dev/null | sed 's/^  30[12]/  OK    30x/; s/^  [0-9]\{3\}/  WARN  &/' || true
    fi
    exit 0
fi

# ── What are we deploying? ───────────────────────────────────────────────────
SHA=$(git rev-parse --verify --quiet "${REF}^{commit}") || die "Unknown git ref: $REF"
SHORT=$(git rev-parse --short "$SHA")
SUBJECT=$(git log -1 --format=%s "$SHA")
HEAD_SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

[ "$WITH_ENV" = 0 ] || [ -f "$ENV_FILE" ] || die "$ENV_FILE not found"

if [ "$SHA" = "$HEAD_SHA" ]; then
    DIRTY=$(git status --porcelain --untracked-files=no -- "${SHIP[@]}")
    if [ -n "$DIRTY" ] && [ "$SKIP_TESTS" = 0 ]; then
        echo "$DIRTY"
        die "Uncommitted changes in shipped files — they would not be deployed. Commit or stash them, or pass --skip-tests to deploy the committed state anyway."
    fi
    if [ "$SKIP_TESTS" = 0 ]; then
        echo "==> Running npm test"
        TEST_LOG=$(mktemp)
        if ! npm test >"$TEST_LOG" 2>&1; then
            tail -30 "$TEST_LOG"; rm -f "$TEST_LOG"
            die "Tests failed — nothing was deployed"
        fi
        { grep -E '^# (tests|pass|fail) ' "$TEST_LOG" || true; } | tr '\n' ' '; echo
        rm -f "$TEST_LOG"
    fi
else
    echo "==> $REF is not the checked-out commit — tests skipped (they would test the working tree, not $SHORT)"
fi

# ── What is on the server now? ───────────────────────────────────────────────
CURRENT=$(remote "head -1 '$APP/.deployed-version' 2>/dev/null" || true)
CUR_SHA=${CURRENT%% *}

echo
echo "Deploying  $SHORT  $SUBJECT"
[ "$SHA" = "$HEAD_SHA" ] && echo "     from  branch $BRANCH"
echo "       to  $HOST:$APP"
if [ -n "$CUR_SHA" ] && git cat-file -e "${CUR_SHA}^{commit}" 2>/dev/null; then
    echo "Currently  $(git rev-parse --short "$CUR_SHA")  (deployed ${CURRENT#* })"
    if [ "$CUR_SHA" = "$SHA" ]; then
        echo "  (same commit — redeploy)"
    else
        git --no-pager log --oneline -15 "$CUR_SHA..$SHA" -- "${SHIP[@]}" | sed 's/^/  + /'
        git --no-pager log --oneline -15 "$SHA..$CUR_SHA" -- "${SHIP[@]}" | sed 's/^/  - /'
        TOUCHED=$(git diff --name-only "$CUR_SHA" "$SHA" -- schema.sql scripts/migrate.js package-lock.json | tr '\n' ' ')
        [ -n "$TOUCHED" ] && echo "  changes:  $TOUCHED"
        if git merge-base --is-ancestor "$SHA" "$CUR_SHA"; then
            RUN_MIGRATE=0
            echo "  rollback: $SHORT is older than the live version — the database will not be migrated"
        fi
    fi
else
    echo "Currently  unknown (no version marker on the server yet)"
fi
[ "$WITH_ENV" = 1 ] && echo "     .env  will be replaced with $ENV_FILE"
[ "$RUN_MIGRATE" = 0 ] && echo "   schema  left as it is (no migration)"
echo

if [ "$DRY_RUN" = 1 ]; then echo "Dry run — nothing changed."; exit 0; fi

if [ "$ASSUME_YES" = 0 ]; then
    read -r -p "Deploy? [y/N] " answer
    case "$answer" in y|Y|yes) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# ── Upload ───────────────────────────────────────────────────────────────────
STAGE="$APP/.deploy-stage"
echo "==> Uploading $SHORT"
git archive --format=tar "$SHA" -- "${SHIP[@]}" | gzip \
    | remote "rm -rf '$STAGE' && mkdir -p '$STAGE' && tar -xzf - -C '$STAGE'"

if [ "$WITH_ENV" = 1 ]; then
    remote "umask 077 && cat > '$STAGE/.env.new'" < "$ENV_FILE"
fi

# ── Install, swap, migrate, start, verify — on the server ────────────────────
remote "APP='$APP' SERVICE='$SERVICE' SHA='$SHA' WITH_ENV='$WITH_ENV' RUN_MIGRATE='$RUN_MIGRATE' bash -s" <<'REMOTE' || die "Deploy failed — see the output above for what the server did"
set -Eeuo pipefail

STAGE="$APP/.deploy-stage"
PREV="$APP/.previous"
ITEMS="src public scripts package.json package-lock.json schema.sql"
BACKUP=""

say() { printf '==> %s\n' "$*"; }
envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'\r"; }

# Database work runs as the user the service runs as (hardened layout), else as ourselves
SVC_USER=$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)
[ -n "$SVC_USER" ] && [ "$SVC_USER" != "$(id -un)" ] || SVC_USER=""
as_svc() { if [ -n "$SVC_USER" ]; then sudo -n -u "$SVC_USER" "$@"; else "$@"; fi; }
if [ -n "$SVC_USER" ]; then
    BACKUP_DIR="$APP/backups"
    sudo -n -u "$SVC_USER" true 2>/dev/null || { echo "Cannot run commands as '$SVC_USER' — add 'ALL=($SVC_USER) NOPASSWD: ALL' for $(id -un) to sudoers" >&2; exit 1; }
    id -nG | tr ' ' '\n' | grep -qx "$SVC_USER" || echo "Note: $(id -un) is not in group '$SVC_USER' — .env will be made group-readable for the service anyway"
else
    BACKUP_DIR="$HOME/backups"
fi

[ -f "$STAGE/package.json" ] || { echo "Staged release is incomplete" >&2; exit 1; }
for tool in node npm sqlite3 curl; do
    command -v "$tool" >/dev/null || { echo "Missing on the server: $tool" >&2; exit 1; }
done

ENV_SRC="$APP/.env"
[ "$WITH_ENV" = 1 ] && ENV_SRC="$STAGE/.env.new"
[ -f "$ENV_SRC" ] || { echo "No $APP/.env on the server — run again with --env" >&2; exit 1; }

DB=$(envval DATABASE_PATH "$ENV_SRC"); DB=${DB:-./data/votetext.db}
case "$DB" in /*) ;; *) DB="$APP/${DB#./}" ;; esac
PORT=$(envval PORT "$ENV_SRC"); PORT=${PORT:-3000}

NEW_MODULES=0
if [ -d "$APP/node_modules" ] && cmp -s "$STAGE/package-lock.json" "$APP/package-lock.json"; then
    say "Dependencies unchanged"
else
    say "Installing dependencies"
    (cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
    NEW_MODULES=1
fi

HAD_PREVIOUS=0
[ -f "$APP/package.json" ] && HAD_PREVIOUS=1

healthy() {
    for _ in $(seq 1 20); do
        if curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/healthz"; then return 0; fi
        sleep 1
    done
    return 1
}

restore() {
    trap - ERR
    set +e
    say "FAILED — restoring the previous version"
    sudo systemctl stop "$SERVICE"
    for item in $ITEMS node_modules .env; do
        if [ -e "$PREV/$item" ]; then
            rm -rf "${APP:?}/$item"
            mv "$PREV/$item" "$APP/$item"
        fi
    done
    if [ -n "$BACKUP" ] && as_svc test -f "$BACKUP"; then
        as_svc rm -f "$DB-wal" "$DB-shm"
        as_svc cp "$BACKUP" "$DB"
        say "Database restored from $BACKUP"
    fi
    if [ "$HAD_PREVIOUS" = 1 ]; then
        sudo systemctl start "$SERVICE"
        if healthy; then
            say "Previous version is running again"
        else
            say "WARNING: the previous version did not come back — check: sudo journalctl -u $SERVICE -n 50"
        fi
    fi
    exit 1
}

say "Stopping $SERVICE"
sudo systemctl stop "$SERVICE"
trap restore ERR

if as_svc test -f "$DB"; then
    as_svc mkdir -p "$BACKUP_DIR"
    BACKUP="$BACKUP_DIR/votetext-predeploy-$(date +%Y%m%d-%H%M%S).db"
    as_svc sqlite3 "$DB" ".backup '$BACKUP'"
    say "Database backed up to $BACKUP"
fi

rm -rf "$PREV"
mkdir -p "$PREV"
for item in $ITEMS; do
    if [ -e "$APP/$item" ]; then mv "$APP/$item" "$PREV/$item"; fi
    mv "$STAGE/$item" "$APP/$item"
done
if [ "$NEW_MODULES" = 1 ]; then
    if [ -d "$APP/node_modules" ]; then mv "$APP/node_modules" "$PREV/node_modules"; fi
    mv "$STAGE/node_modules" "$APP/node_modules"
fi
if [ "$WITH_ENV" = 1 ]; then
    if [ -f "$APP/.env" ]; then cp -p "$APP/.env" "$PREV/.env"; fi
    mv "$STAGE/.env.new" "$APP/.env"
fi
if [ -n "$SVC_USER" ]; then
    chgrp "$SVC_USER" "$APP/.env" 2>/dev/null || true
    chmod 640 "$APP/.env"
    as_svc test -r "$APP/.env" || { echo "$APP/.env is not readable by $SVC_USER" >&2; false; }
else
    chmod 600 "$APP/.env"
fi

as_svc mkdir -p "$(dirname "$DB")" 2>/dev/null || mkdir -p "$(dirname "$DB")"
as_svc test -w "$(dirname "$DB")" || { echo "$(dirname "$DB") is not writable by ${SVC_USER:-$(id -un)} — fix ownership (install -d -o $SVC_USER)" >&2; false; }
if as_svc test -f "$DB" && [ "$RUN_MIGRATE" = 0 ]; then
    say "Database left as it is"
elif as_svc test -f "$DB"; then
    say "Migrating database"
    (cd "$APP" && as_svc node scripts/migrate.js)
else
    say "Initialising database"
    (cd "$APP" && as_svc node scripts/init-db.js)
fi

say "Starting $SERVICE"
sudo systemctl start "$SERVICE"
if ! healthy; then
    say "Health check failed — last service log lines:"
    sudo journalctl -u "$SERVICE" -n 20 --no-pager || true
    restore
fi
trap - ERR

echo "$SHA $(date -u +%FT%TZ)" > "$APP/.deployed-version"
rm -rf "$STAGE"
for old in $({ as_svc ls -1t "$BACKUP_DIR"/votetext-predeploy-*.db 2>/dev/null || true; } | tail -n +11); do as_svc rm -f "$old"; done

say "Deployed $SHA — service is healthy on port $PORT"

LEFTOVERS=$(ls -A "$APP" | grep -vxE 'src|public|scripts|node_modules|data|backups|package\.json|package-lock\.json|schema\.sql|\.env|\.previous|\.deployed-version' || true)
if [ -n "$LEFTOVERS" ]; then
    echo "Note: $APP also contains files this script does not manage (left by earlier rsync deploys):"
    echo "$LEFTOVERS" | sed 's/^/    /'
fi
REMOTE

if [ -n "$PUBLIC_URL" ]; then
    if curl -fsS -o /dev/null --max-time 10 "$PUBLIC_URL/healthz"; then
        echo "==> $PUBLIC_URL answers"
    else
        echo "WARNING: the app is healthy on the server but $PUBLIC_URL did not answer — check nginx and the certificate"
    fi
fi
echo "Run ./scripts/deploy.sh --check for the hardening audit."

