// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// The fire count's arms for ai-hold-trash (brief followup2-trash 5): text patches that put each change's beta text back
// in src/ai/corp/hold.ts, written to trash-arms.json for scripts/value-b1/fire-count.ts. With every arm back the tree
// plays as beta (the time design and Sorocaban's fact only act through the trash; the hygiene is comments but turnIce's
// key; the stealth split's beta form: a stealth card's credits in `hosted` too, the 'thisRun' sum, no stealth spend).
//   node scripts/stage-d/trash-arms.mjs   (checks each patch matches exactly once, writes the JSON)
//   ARGS=scripts/stage-d/trash-arms.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = {
  // Found-list row 21: "trash 1 installed X" inert again, a rig card's first draw read whatever is gone (beta's)
  trash: [
    [F, "const INERT = new Set<SubEffect['kind']>(['toGrip',", "const INERT = new Set<SubEffect['kind']>(['trashInstalled', 'toGrip',"],
    [F, "      case 'trashInstalled':\n", "      case 'trashInstalledOff':\n"],
    [F, 'this.board.rig.reduce((m, r, i) => (ws.gone.includes(i) ? m : Math.max(m, r.firstDraw)), this.board.firstDraw)', 'this.board.rig.reduce((m, r) => Math.max(m, r.firstDraw), this.board.firstDraw)'],
  ],
  // Found-list row 31: a stealth card's credits in `hosted` too, the 'thisRun' sum of beta, no stealth spend for any cost
  stealth: [
    [
      F,
      "const pool = run.poolLocked ? 0 : state.runner.credits;\n    return { hosted: availableCredits(state, 'runner') - pool - run.bonusCredits - (run.badPublicityCredits ?? 0) - stealth, stealth };",
      "return { hosted: Math.max(0, availableCredits(state, 'runner') - state.runner.credits - run.bonusCredits - (run.badPublicityCredits ?? 0)), stealth };",
    ],
    [F, 'hosted: sum((c, stealth) => !stealth && !!getCardScript(c.cardCode)?.paysDuringRuns)', 'hosted: sum(c => !!getCardScript(c.cardCode)?.paysDuringRuns)'],
    [F, '    for (let s = 1; s <= Math.min(rest, w.stealth); s++) best = Math.min(best, then({ ...w, stealth: w.stealth - s }) + rest - s);\n', ''],
  ],
  // Owner hygiene: turnIce's memo key without its start's kind (the rest is comments and an unread fact)
  hygiene: [[F, 'turnIce:${start.runnerTurn ? 1 : 0}:${server}', 'turnIce:${server}']],
};

const src = readFileSync(`src/${F}`, 'utf8');
for (const [arm, list] of Object.entries(arms))
  for (const [, from] of list) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`${arm}: ${n} matches for ${from.slice(0, 60)}`);
  }
// fire-count applies a patch with String.replace, which reads `$` patterns in the replacement
const out = Object.fromEntries(Object.entries(arms).map(([a, list]) => [a, list.map(([f, from, to]) => [f, from, to.replace(/\$/g, '$$$$')])]));
writeFileSync('scripts/stage-d/trash-arms.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${Object.keys(arms).length} arms`);
