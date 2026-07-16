#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

docker version >/dev/null
docker compose version >/dev/null
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up --build -d

for _ in $(seq 1 90); do
  if status="$(curl -fsS http://127.0.0.1:8080/api/status 2>/dev/null)" && \
     python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["aircraft"])==750 and len(d["shards"])==3 and all(s["healthy"] for s in d["shards"])' <<<"$status"; then
    break
  fi
  sleep 2
done

status="$(curl -fsS http://127.0.0.1:8080/api/status)"
python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["aircraft"])==750 and all(s["healthy"] for s in d["shards"])' <<<"$status"

handoff_id=""
for _ in $(seq 1 30); do
  event="$(docker compose exec -T control sh -lc "grep '\"type\":\"handoff_commit\"' /data/events.jsonl 2>/dev/null | tail -n 1" || true)"
  if [[ -n "$event" ]]; then handoff_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["aircraft"]["id"])' <<<"$event")"; break; fi
  sleep 2
done
[[ -n "$handoff_id" ]]
curl -fsS "http://127.0.0.1:8080/api/aircraft/$handoff_id/replay" | python3 -c 'import json,sys; t={e["type"] for e in json.load(sys.stdin)}; assert {"handoff_prepare","handoff_commit"} <= t'

curl -fsS -X POST http://127.0.0.1:8080/api/shards/central/terminate >/dev/null
sleep 5
curl -fsS http://127.0.0.1:8080/api/status | python3 -c 'import json,sys; d=json.load(sys.stdin); c=next(s for s in d["shards"] if s["id"]=="central"); assert len(d["aircraft"])==750 and not c["healthy"] and c["aircraft"]==0'
curl -fsS http://127.0.0.1:8080/metrics | grep -Eq '^skygrid_recoveries_total [1-9][0-9]*$'
curl -fsS http://127.0.0.1:5173 >/dev/null
curl -fsS http://127.0.0.1:9090/-/ready >/dev/null

echo "SKYGRID DOCKER VERIFICATION PASSED"
echo "Open http://localhost:5173 and visually confirm aircraft render and move."
echo "The stack is left running. Stop with: docker compose down -v"
