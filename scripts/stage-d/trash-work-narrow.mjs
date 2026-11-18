// The work cap's narrow count (work-cap-answer.md 2.2, 2.3 iii): as trash-work.mjs (one arm `all`, plays as beta, and a
// `_probe` patch in every tree), but the probe counts only the work the cap would limit: approaches worked in walks
// that have a trash ice among their targets (Walk.trashReads set). The hook gets `nwork` once per such approach
// (tl.nwork: the decision's total) and `nwmax` with the rise of the largest such walk (tl.nwmaxms). A second probe, at
// each walk's construction, gives `t<k>` for the most trash ice on one of its targets' paths (k = 1, 2, 3, ...), so a
// decision's largest k is read from its tl keys. Writes trash-work-narrow.json.
//   node scripts/stage-d/trash-work-narrow.mjs
//   ARGS=scripts/stage-d/trash-work-narrow.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = JSON.parse(readFileSync('scripts/stage-d/trash-arms.json', 'utf8'));
const src = readFileSync(`src/${F}`, 'utf8');
const once = a => { if (src.split(a).length !== 2) throw new Error(`probe anchor: not exactly one match: ${a.slice(0, 50)}`); };
const g = `const g = globalThis as { __tl?: (v: string, ms?: number) => void; __nfn?: unknown; __nwmax?: number };`;
const a1 = '    const ice = this.targets[j].ice[pos];\n';
const p1 = `${a1}    { const t = this as unknown as { __n?: number; trashReads?: unknown }; if (t.trashReads) { t.__n = (t.__n ?? 0) + 1; ${g} if (g.__nfn !== g.__tl) { g.__nfn = g.__tl; g.__nwmax = 0; } g.__tl?.('nwork'); if (t.__n > (g.__nwmax ?? 0)) { g.__tl?.('nwmax', t.__n - (g.__nwmax ?? 0)); g.__nwmax = t.__n; } } }\n`;
const a2 = '    this.tagUseful = all.some(';
const p2 = `    { const k = Math.max(0, ...targets.map(t => t.ice.filter(i => [...i.subs, ...(i.rezGains ? [i.rezGains] : [])].some(f => f.does.some(e => e.kind === 'trashInstalled'))).length)); if (k) (globalThis as { __tl?: (v: string) => void }).__tl?.(\`t\${k}\`); }\n${a2}`;
once(a1);
once(a2);
// fire-count applies a patch with String.replace, which reads `$` patterns in the replacement
const esc = s => s.replace(/\$/g, '$$$$');
const out = { all: Object.values(arms).flat(), _probe: [[F, a1, esc(p1)], [F, a2, esc(p2)]] };
writeFileSync('scripts/stage-d/trash-work-narrow.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${out.all.length} patches in one arm, 2 probes`);
