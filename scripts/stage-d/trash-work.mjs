// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// The work cap's number (AI Coordinator's time ruling, followup2-trash/time-ruling.md 2.3): the hold walk's own work, as
// the approaches it works out (memo misses), over the fire count's sample. One arm, `all` (every change of
// trash-arms.json put back: plays as beta), and a `_probe` patch in every tree: each walk counts its worked approaches;
// the probe hook gets `work` once per worked approach (tl.work: the decision's total) and `wmax` with the rise of the
// largest walk so far (tl.wmaxms: the decision's largest walk). Writes trash-work.json.
//   node scripts/stage-d/trash-work.mjs
//   ARGS=scripts/stage-d/trash-work.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
// gate-time.ts with WORK=1 reads the same hook on the built boards, in a tree with this patch made.
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = JSON.parse(readFileSync('scripts/stage-d/trash-arms.json', 'utf8'));
const anchor = '    const ice = this.targets[j].ice[pos];\n';
const probe = `${anchor}    { const t = this as unknown as { __w?: number }; t.__w = (t.__w ?? 0) + 1; const g = globalThis as { __tl?: (v: string, ms?: number) => void; __wfn?: unknown; __wmax?: number }; if (g.__wfn !== g.__tl) { g.__wfn = g.__tl; g.__wmax = 0; } g.__tl?.('work'); if (t.__w > (g.__wmax ?? 0)) { g.__tl?.('wmax', t.__w - (g.__wmax ?? 0)); g.__wmax = t.__w; } }\n`;
const src = readFileSync(`src/${F}`, 'utf8');
if (src.split(anchor).length !== 2) throw new Error('probe anchor: not exactly one match');
// fire-count applies a patch with String.replace, which reads `$` patterns in the replacement (trash-arms.json's are escaped)
const out = { all: Object.values(arms).flat(), _probe: [[F, anchor, probe.replace(/\$/g, '$$$$')]] };
writeFileSync('scripts/stage-d/trash-work.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${out.all.length} patches in one arm, 1 probe`);
