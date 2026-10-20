#!/usr/bin/env bash
# Exercises scripts/deploy.sh end to end against a local stand-in "server":
# stand-in ssh/sudo/systemctl (and sqlite3 if missing) on PATH, the app installed
# into tests/deploy/.tmp/opt and really started/stopped. Needs network for npm ci.
#
#   npm run test:deploy
#
# Scenarios: refusal without .env → first deploy with --env → redeploy keeps data →
# forced start failure restores code + database → older ref deploys without migration
# → dry run changes nothing → --check audit runs → simulated separate service user.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$ROOT/tests/deploy/.tmp"
rm -rf "$T"; mkdir -p "$T/bin" "$T/opt" "$T/home"
PORT=3097
FAIL=0
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; FAIL=1; }
expect() { local desc=$1 pattern=$2 text=$3; if grep -qE -- "$pattern" <<<"$text"; then pass "$desc"; else fail "$desc (no match for /$pattern/)"; fi; }

cat > "$T/bin/ssh" <<'EOS'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case "$1" in -p|-i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
HOME="$FAKE_HOME" exec bash -c "$*"
EOS
cat > "$T/bin/sudo" <<'EOS'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do
  case "$1" in -n) shift ;; -u) shift 2 ;; -l) echo "(ALL : ALL) NOPASSWD: ALL"; exit 0 ;; *) break ;; esac
done
PID="$FAKE_APP/../service.pid"; LOG="$FAKE_APP/../service.log"
case "$1 $2" in
  "systemctl stop")  [ -f "$PID" ] && kill "$(cat "$PID")" 2>/dev/null; rm -f "$PID"; sleep 0.3; exit 0 ;;
  "systemctl start")
    if [ -f "$FAKE_APP/../fail-next-start" ]; then rm -f "$FAKE_APP/../fail-next-start"; echo "simulated crash on start" >> "$LOG"; exit 0; fi
    cd "$FAKE_APP" || exit 1
    NODE_ENV=production nohup node src/server.js >> "$LOG" 2>&1 < /dev/null &
    echo $! > "$PID"; exit 0 ;;
  "journalctl -u") tail -5 "$LOG" 2>/dev/null; exit 0 ;;
  "ufw status") echo "Status: active"; exit 0 ;;
  *) exec "$@" ;;
esac
EOS
cat > "$T/bin/systemctl" <<'EOS'
#!/usr/bin/env bash
case "$1 $2" in
  "show -p") echo "${FAKE_SVC_USER:-}"; exit 0 ;;
  "is-active --quiet") [ -f "$FAKE_APP/../service.pid" ] && exit 0 || exit 3 ;;
  "is-enabled --quiet") exit 0 ;;
  *) exit 0 ;;
esac
EOS
if ! command -v sqlite3 >/dev/null; then
cat > "$T/bin/sqlite3" <<EOS
#!/usr/bin/env bash
DEST=\$(printf '%s' "\$2" | sed -E "s/^VACUUM INTO '(.*)'\$/\\1/")
exec node -e "const D=require('$ROOT/node_modules/better-sqlite3');const d=new D(process.argv[1]);d.backup(process.argv[2]).then(()=>d.close()).catch(e=>{console.error(e.message);process.exit(1)})" "\$1" "\$DEST"
EOS
fi
chmod +x "$T"/bin/*
printf 'PORT=%s\nDATABASE_PATH=./data/votetext.db\nSESSION_SECRET=local-harness\nRESEND_API_KEY=re_dummy\nCORS_ORIGINS=http://localhost:%s\n' "$PORT" "$PORT" > "$T/envfile"

export PATH="$T/bin:$PATH" FAKE_HOME="$T/home" FAKE_APP="$T/opt" FAKE_SVC_USER=
export DEPLOY_HOST=fake@localhost.invalid DEPLOY_SSH_PORT=22 DEPLOY_SSH_KEY= DEPLOY_APP_DIR="$T/opt" DEPLOY_SERVICE=votetext DEPLOY_PUBLIC_URL= DEPLOY_ENV_FILE="$T/envfile"
D="$ROOT/scripts/deploy.sh"
stop() { "$T/bin/sudo" systemctl stop votetext; }
trap stop EXIT
cd "$ROOT"

echo "1. no .env on the server"
out=$("$D" --skip-tests --yes 2>&1 || true); expect "refused" 'run again with --env' "$out"

echo "2. first deploy with --env"
out=$("$D" --skip-tests --yes --env 2>&1 || true); expect "healthy" 'service is healthy' "$out"
expect "version marker" '.' "$(cat "$T/opt/.deployed-version")"
[ "$(stat -c %a "$T/opt/.env")" = 600 ] && pass ".env mode 600" || fail ".env mode"
curl -s -X POST -H 'Content-Type: application/json' -d '{"email":"keep@harness.test"}' "http://127.0.0.1:$PORT/api/auth/request-otp" >/dev/null
rows() { node -e "const D=require('$ROOT/node_modules/better-sqlite3');const d=new D('$T/opt/data/votetext.db',{readonly:true});console.log(d.prepare('SELECT COUNT(*) n FROM otp_codes').get().n)"; }
[ "$(rows)" = 1 ] || fail "seed row not written"

echo "3. redeploy same commit"
out=$("$D" --skip-tests --yes 2>&1 || true); expect "deps unchanged" 'Dependencies unchanged' "$out"; expect "backup taken" 'Database backed up' "$out"; expect "healthy" 'service is healthy' "$out"
[ "$(rows)" = 1 ] && pass "data kept" || fail "data lost on redeploy"

echo "4. forced start failure restores the previous version"
echo marker > "$T/opt/public/harness-marker.txt"; touch "$T/fail-next-start"
out=$("$D" --skip-tests --yes 2>&1 || true); expect "restored" 'Previous version is running again' "$out"
[ -f "$T/opt/public/harness-marker.txt" ] && pass "previous code back" || fail "previous code not restored"
[ "$(rows)" = 1 ] && pass "database restored" || fail "database not restored"

echo "5. older ref is a rollback without migration"
out=$("$D" HEAD~1 --skip-tests --yes 2>&1 || true); expect "rollback detected" 'older than the live version' "$out"; expect "no migration" 'Database left as it is' "$out"

echo "6. dry run"
before=$(cat "$T/opt/.deployed-version"); out=$("$D" --skip-tests --dry-run 2>&1 || true); expect "dry run" 'Dry run — nothing changed' "$out"
[ "$before" = "$(cat "$T/opt/.deployed-version")" ] && pass "nothing changed" || fail "dry run changed the server"

echo "7. audit"
out=$("$D" --check 2>&1 || true); expect "audit ran" 'Server audit' "$out"; expect "service user line" "service runs as" "$out"; expect "deployed line" 'deployed [0-9a-f]{7}' "$out"

echo "8. separate service user"
FAKE_SVC_USER=votetext out=$("$D" --skip-tests --yes 2>&1 || true); expect "healthy" 'service is healthy' "$out"
[ "$(stat -c %a "$T/opt/.env")" = 640 ] && pass ".env 640 for the service group" || fail ".env mode with service user"
ls "$T/opt/backups"/votetext-predeploy-*.db >/dev/null 2>&1 && pass "backup under the app dir" || fail "no backup under the app dir"

stop; trap - EXIT
[ "$FAIL" = 0 ] && echo "deploy harness: all scenarios passed" || { echo "deploy harness: FAILURES"; exit 1; }
