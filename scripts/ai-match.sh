#!/usr/bin/env bash
# New-vs-old AI batches on 4 cores: scripts/ai-match.sh [games per pairing] [normal|hard] [synergyWeight] [counterWeight]
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
for i in 0 1 2 3; do SHARD=$i/4 npx vite-node scripts/ai-match.ts -- "$@" > "$out/$i.json" & done
wait
node scripts/ai-match-sum.mjs "$out"/*.json "$@"
