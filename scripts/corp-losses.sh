#!/usr/bin/env bash
# Corp loss breakdown on 4 cores: scripts/corp-losses.sh [games per pairing] [normal|hard]
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
for i in 0 1 2 3; do SHARD=$i/4 npx vite-node scripts/corp-losses.ts -- "$@" > "$out/$i.json" & done
wait
node scripts/corp-losses-sum.mjs "$out"/*.json
