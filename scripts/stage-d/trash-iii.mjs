// Design (iii) of the work-cap answer (work-cap-answer.md 2.3): no counter, a condition on the walk. The trash is walked
// exactly when no target's ice holds more than one trash ice, and is inert as on beta otherwise. Built as `_probe`
// patches (into every tree; the base tree has the trash inert already, so the condition changes nothing there), with
// one arm `all` (every change of trash-arms.json put back: plays as beta). The fire count then counts the decisions
// design (iii) changes against beta. Writes trash-iii.json.
//   node scripts/stage-d/trash-iii.mjs
//   ARGS=scripts/stage-d/trash-iii.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = JSON.parse(readFileSync('scripts/stage-d/trash-arms.json', 'utf8'));
const src = readFileSync(`src/${F}`, 'utf8');
const patches = [
  [
    "    const kinds = [...new Set(allEffects.flatMap(e => (e.kind === 'trashInstalled' ? [e.what] : [])))];\n    if (kinds.length) {",
    "    const kinds = [...new Set(allEffects.flatMap(e => (e.kind === 'trashInstalled' ? [e.what] : [])))];\n    const trashIce = (i: SearchIce) => [...i.subs, ...(i.rezGains ? [i.rezGains] : [])].some(f => f.does.some(e => e.kind === 'trashInstalled'));\n    this.trashInert = targets.some(t => t.ice.filter(trashIce).length > 1);\n    if (kinds.length && !this.trashInert) {",
  ],
  ['        return this.corpTrash(ws, e.what, next, at);', '        return this.trashInert ? next(ws) : this.corpTrash(ws, e.what, next, at);'],
  ['  private readonly trashReads?:', '  private readonly trashInert: boolean;\n  private readonly trashReads?:'],
];
for (const [a] of patches) if (src.split(a).length !== 2) throw new Error(`anchor: not exactly one match: ${a.slice(0, 60)}`);
const out = { all: Object.values(arms).flat(), _probe: patches.map(([a, b]) => [F, a, b.replace(/\$/g, '$$$$')]) };
writeFileSync('scripts/stage-d/trash-iii.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${out.all.length} patches in one arm, ${patches.length} probe patches`);
