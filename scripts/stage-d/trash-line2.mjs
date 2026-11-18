// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Rev 5 (choice 1: borrowed trash inert) of the work-cap note, after rev 4 (work-cap-answer.md section 8.3; red team finding 4's direction): the trash bounded per
// walked line. The first Corp trash of an installed card a line meets is walked exactly; every later `trashInstalled`
// effect on that line is inert. The flag (`ct`) lives in WalkState, and the three memo keys that hold a walk state
// (wsKey: approach and resolve; beforeRun's own key) read it. Built as `_probe` patches; arm `all` puts every change of
// trash-arms.json back (plays as beta), so the fire count counts what the bound changes against beta.
// A probe-only switch, globalThis.__trashMode ('exact': every trash exact, the ai-hold-trash walk; 'inert': none), lets
// one tree answer a question all three ways for the local exactness checks; unset = the bound.
//   node scripts/stage-d/trash-line.mjs            writes trash-line.json
//   APPLY=1 node scripts/stage-d/trash-line.mjs    also applies the probe patches to src (local only, never committed)
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = JSON.parse(readFileSync('scripts/stage-d/trash-arms.json', 'utf8'));
const src = readFileSync(`src/${F}`, 'utf8');
const MODE = "(globalThis as { __trashMode?: string }).__trashMode";
const patches = [
  ['  trashed: string[];\n', '  trashed: string[];\n  /** probe (trash-line): a Corp trash of an installed card happened on this line; later ones are inert. */\n  ct?: boolean;\n'],
  ['        return this.corpTrash(ws, e.what, next, at);', `        return ${MODE} === 'inert' || (ws.ct && ${MODE} !== 'exact') ? next(ws) : this.corpTrash(ws, e.what, next, at);`],
  ['      worst = Math.max(worst, next({ ...ws, gone: [...ws.gone, i].sort((a, b) => a - b) }));', '      worst = Math.max(worst, next({ ...ws, gone: [...ws.gone, i].sort((a, b) => a - b), ct: true }));'],
  ["${this.retries ? (ws.moved ? '|1' : '|0') : ''}`;", "${this.retries ? (ws.moved ? '|1' : '|0') : ''}${ws.ct ? '|t' : ''}`;"],
  ['|${ws.chose}|${ws.trashed}|${ws.bp}`;', "|${ws.chose}|${ws.trashed}|${ws.bp}${ws.ct ? '|t' : ''}`;"],
  // Choice 1 (work-cap-answer.md section 9): a trash resolved through a borrow (Mycoweb) is inert, as on beta: the lent
  // subroutine resolves without its trashInstalled effects (a rule per effect; 'exact' keeps them)
  ['      for (const f of l.facts) worst = Math.max(worst, this.subroutine(ws, l.id, l.types, f, next, at));', `      for (const f of l.facts) worst = Math.max(worst, this.subroutine(ws, l.id, l.types, ${MODE} === 'exact' ? f : { ...f, does: f.does.filter(e => e.kind !== 'trashInstalled') }, next, at));`],
];
for (const [a] of patches) if (src.split(a).length !== 2) throw new Error(`anchor: not exactly one match: ${a.slice(0, 70)}`);
const out = { all: Object.values(arms).flat(), _probe: patches.map(([a, b]) => [F, a, b.replace(/\$/g, '$$$$')]) };
writeFileSync(`scripts/stage-d/${process.env.OUTNAME ?? 'trash-line'}.json`, JSON.stringify(out, null, 1) + '\n');
if (process.env.APPLY) {
  let s = src;
  for (const [a, b] of patches) s = s.split(a).join(b);
  writeFileSync(`src/${F}`, s);
}
console.log(`ok: ${out.all.length} patches in one arm, ${patches.length} probe patches${process.env.APPLY ? ' (applied)' : ''}`);
