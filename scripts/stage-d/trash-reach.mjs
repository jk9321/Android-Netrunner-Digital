// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// How far real boards are from the built worst case (AI Coordinator, ai-hold-trash stop, item a): over every hold walk
// of the fire count's sample, the number of distinct sets of trashed Runner cards the walk reaches. One arm, `all`
// (every change of trash-arms.json put back: plays as beta), and a `_probe` patch in every tree: each walk keeps the
// sets it has met (`gone`, at each approach worked out), and the probe hook counts `g<n>` when a walk reaches its n-th
// set (so tl.g5 is the number of walks of that decision that reached 5 or more). Writes trash-reach.json.
//   node scripts/stage-d/trash-reach.mjs
//   ARGS=scripts/stage-d/trash-reach.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = JSON.parse(readFileSync('scripts/stage-d/trash-arms.json', 'utf8'));
const anchor = '    const ice = this.targets[j].ice[pos];\n';
const probe = `${anchor}    { const g = ((this as unknown as { __g?: Set<string> }).__g ??= new Set<string>()); const k = String(ws.gone); if (!g.has(k)) { g.add(k); (globalThis as { __tl?: (v: string) => void }).__tl?.(\`g\${g.size}\`); } }\n`;
const src = readFileSync(`src/${F}`, 'utf8');
if (src.split(anchor).length !== 2) throw new Error('probe anchor: not exactly one match');
// fire-count applies a patch with String.replace, which reads `$` patterns in the replacement (trash-arms.json's are escaped)
const out = { all: Object.values(arms).flat(), _probe: [[F, anchor, probe.replace(/\$/g, '$$$$')]] };
writeFileSync('scripts/stage-d/trash-reach.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${out.all.length} patches in one arm, 1 probe`);
