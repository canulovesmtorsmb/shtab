#!/usr/bin/env bash
# Все проверки ШТАБа на вымышленных данных. Нужны node 20+, python3, npm.
# Запуск из корня репозитория: bash tests/run.sh
set -u
cd "$(dirname "$0")"
T="$PWD"; W="$T/.work"
mkdir -p "$W"
[ -d node_modules/playwright ] || npm install --no-audit --no-fund
node make-fixtures.mjs "$W" || exit 1
# копия приложения, которой разрешено ходить в локальный Worker
sed 's#connect-src https://shtab-sync.siroqmanpilot.workers.dev;#connect-src https://shtab-sync.siroqmanpilot.workers.dev http://127.0.0.1:8787;#' ../index.html > "$W/index.html"
grep -q "127.0.0.1:8787" "$W/index.html" || { echo "не нашёл connect-src в index.html"; exit 1; }
cp ./*.js "$W/"
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$W" >/dev/null 2>&1 & SRV=$!
# каждый запуск со своей пустой базой D1: отдельная папка Worker, база в её .wrangler
export SHTAB_WR_DIR="$W/worker-$(date +%s)-$RANDOM"
mkdir -p "$SHTAB_WR_DIR"
sed "s#^main = .*#main = \"$(cd .. && pwd)/worker.js\"#" wrangler.toml > "$SHTAB_WR_DIR/wrangler.toml"
(cd "$SHTAB_WR_DIR" && exec "$T/node_modules/.bin/wrangler" dev --local --port 8787 >"$W/wrangler.log" 2>&1) & WR=$!
kill_tree() { for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done; kill "$1" 2>/dev/null; }
trap 'kill $SRV 2>/dev/null; kill_tree $WR' EXIT
for i in $(seq 90); do curl -sf http://127.0.0.1:8787/health >/dev/null && curl -sf http://127.0.0.1:8000/index.html >/dev/null && break; sleep 1; done
export NODE_PATH="$T/node_modules"
fail=0; failed=""
run() { echo; echo "=== $1"; if ! "${@:2}"; then fail=$((fail+1)); failed="$failed $1"; fi; }
for t in server-sync server-ics server-snapshots; do run "$t" node "$t.mjs" "$W/backup.json"; done
cd "$W"
for t in tz_view e2e link fresh_join sync_school import_safety student_actions schedule_tools snap_ui tz_autoclose; do
  run "$t" node -r "$T/clock.cjs" "$t.js" backup.json
done
echo
if [ "$fail" = 0 ]; then echo "ВСЕ ПРОВЕРКИ ПРОШЛИ (13 наборов)"; else echo "ПРОВАЛЕНО НАБОРОВ: $fail –$failed"; fi
exit "$fail"
