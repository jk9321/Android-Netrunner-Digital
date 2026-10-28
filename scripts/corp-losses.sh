#!/usr/bin/env bash
# Corp loss breakdown on 4 cores: scripts/corp-losses.sh [games per pairing] [normal|hard]
# KEEP=dir keeps each run's games in dir and sums everything there (a short batch topped up later:
#   KEEP=d scripts/corp-losses.sh 3, then KEEP=d GAME_FROM=3 scripts/corp-losses.sh 10).
set -e
cd "$(dirname "$0")/.."
out=${KEEP:-$(mktemp -d)}
mkdir -p "$out"
tag=${GAME_FROM:-0}-${1:-1}
for i in 0 1 2 3; do SHARD=$i/4 npx vite-node scripts/corp-losses.ts -- "$@" > "$out/$tag-$i.json" & done
wait
node scripts/corp-losses-sum.mjs "$out"/*.json
