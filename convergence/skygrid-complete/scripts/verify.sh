#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="${TMPDIR:-/tmp}/skygrid-verify-$$"
HTTP_PORT="${SKYGRID_VERIFY_PORT:-18081}"
mkdir -p "$RUNTIME/data" "$ROOT/bin"
pids=()
cleanup(){ for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; sleep .2; for p in "${pids[@]:-}"; do kill -9 "$p" 2>/dev/null || true; done; rm -rf "$RUNTIME"; }
trap cleanup EXIT

cmake -S "$ROOT/simulator" -B "$ROOT/simulator/build" >/dev/null
cmake --build "$ROOT/simulator/build" -j >/dev/null
ctest --test-dir "$ROOT/simulator/build" --output-on-failure
GOTOOLCHAIN=local go -C "$ROOT/control" test ./...
GOTOOLCHAIN=local go -C "$ROOT/control" vet ./...
GOTOOLCHAIN=local go -C "$ROOT/control" build -o "$ROOT/bin/skygrid-control" ./cmd/control
GOTOOLCHAIN=local go -C "$ROOT/loadgen" test ./...
GOTOOLCHAIN=local go -C "$ROOT/loadgen" vet ./...
GOTOOLCHAIN=local go -C "$ROOT/loadgen" build -o "$ROOT/bin/skygrid-loadgen" .
npm --prefix "$ROOT/web" install --silent
npm --prefix "$ROOT/web" run build >/dev/null

HTTP_PORT="$HTTP_PORT" DATA_DIR="$RUNTIME/data" SHARD_TIMEOUT=3s "$ROOT/bin/skygrid-control" >"$RUNTIME/control.log" 2>&1 & pids+=("$!")
sleep 1
for shard in west central east; do
 SHARD_ID="$shard" CONTROL_HOST=127.0.0.1 CONTROL_PORT=7000 SEED_COUNT=250 "$ROOT/simulator/build/skygrid-sim" >"$RUNTIME/$shard.log" 2>&1 & pids+=("$!")
done
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$HTTP_PORT/api/status" >/dev/null 2>&1 && break; sleep .2; done
sleep 3
python - "$HTTP_PORT" <<'PY'
import json,sys,urllib.request
p=sys.argv[1]
d=json.load(urllib.request.urlopen(f'http://127.0.0.1:{p}/api/status'))
assert len(d['aircraft'])==750, len(d['aircraft'])
assert len(d['shards'])==3
assert all(s['healthy'] for s in d['shards']), d['shards']
print('initial status passed:', sorted((s['id'],s['aircraft']) for s in d['shards']))
PY
"$ROOT/bin/skygrid-loadgen" -clients 20 -duration 2s -url "ws://127.0.0.1:$HTTP_PORT/ws"
for _ in $(seq 1 50); do
 ID=$(python - "$RUNTIME/data/events.jsonl" <<'PY'
import json,sys
try:
 with open(sys.argv[1]) as f:
  ids=[json.loads(x)['aircraft']['id'] for x in f if 'handoff_commit' in x]
 print(ids[-1] if ids else '')
except FileNotFoundError: print('')
PY
)
 [ -n "$ID" ] && break
 sleep .2
done
[ -n "${ID:-}" ]
python - "$HTTP_PORT" "$ID" <<'PY'
import json,sys,urllib.request
p,i=sys.argv[1:]
e=json.load(urllib.request.urlopen(f'http://127.0.0.1:{p}/api/aircraft/{i}/replay'))
t={x['type'] for x in e}
assert 'handoff_prepare' in t and 'handoff_commit' in t, t
print('replay passed:', len(e), sorted(t))
PY
curl -fsS -X POST "http://127.0.0.1:$HTTP_PORT/api/shards/central/terminate" >/dev/null
sleep 3
python - "$HTTP_PORT" <<'PY'
import json,sys,urllib.request
p=sys.argv[1]
d=json.load(urllib.request.urlopen(f'http://127.0.0.1:{p}/api/status'))
assert len(d['aircraft'])==750, len(d['aircraft'])
central=next(s for s in d['shards'] if s['id']=='central')
assert central['healthy'] is False and central['aircraft']==0, central
m=urllib.request.urlopen(f'http://127.0.0.1:{p}/metrics').read().decode()
line=next(x for x in m.splitlines() if x.startswith('skygrid_recoveries_total '))
assert int(line.split()[1])>0, line
print('failure recovery passed:', central, line)
PY
sleep 5
[ -s "$RUNTIME/data/events.jsonl.snapshot.json" ]
echo "snapshot persistence passed"
echo "SKYGRID VERIFICATION PASSED"
