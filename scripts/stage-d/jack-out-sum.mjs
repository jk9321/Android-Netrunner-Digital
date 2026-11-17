// Sums hold-baseline.ts COMPARE=1 JACKOUT=1 lines (the hold-retry brief, section 2: jacking out measured before it is
// built): on the 'runnerTurn' questions whose whole-turn truth (retries on) is "holds", how many turn to "does not hold"
// when the Runner may jack out, how many the count's own holding set turns on, and the boards.
//   node scripts/stage-d/jack-out-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const lines = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{'));
const qs = lines.map(l => JSON.parse(l)).filter(q => q.when === 'runnerTurn' && q.oracle);
const held = qs.filter(q => q.oracle.holds === true);
const asked = held.filter(q => q.jack);
const turned = asked.filter(q => q.jack.holds === false);
const unknown = asked.filter(q => q.jack.holds === null);
const countTurned = asked.filter(q => q.count.holds && q.label === 'agree' && q.jack.count === 'getsIn');
const sources = new Set(qs.map(q => q.src));
console.log(`runnerTurn questions ${qs.length} from ${sources.size} sources; truth "holds" ${held.length}, asked with jacking out ${asked.length}`);
console.log(`truth turned to "does not hold" by jacking out: ${turned.length} (flips ${turned.filter(q => q.flip).length}); unknown at the cap ${unknown.length}`);
console.log(`the count's holding set (right without jacking out) gets in with it: ${countTurned.length}`);
const board = q =>
  `${q.src} T${q.turn} ${q.server}: [${q.ice.join(', ')}] rig [${q.rig.join(', ')}] $${q.runner.credits} tags ${q.runner.tags} corp $${q.corp.credits}` +
  `${q.corpCredits === null ? '' : ` (asked ${q.corpCredits})`} | count ${q.count.holds ? `holds ${q.count.rez}` : 'does not'}; held by ${q.oracle.set}` +
  `${q.jack.set ? `, with jacking out ${q.jack.set}` : ''}`;
const seen = new Map();
for (const q of [...turned, ...countTurned]) {
  const k = board(q);
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
console.log(`distinct boards: ${seen.size}`);
for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${k}`);
