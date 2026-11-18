// Sums scripts/stage-d/rez-keep-a.ts output: node scripts/stage-d/rez-keep-a-sum.mjs <files or dirs...> [--list]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const list = args.includes('--list');
const files = args.filter(a => !a.startsWith('--')).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const windows = rows.filter(r => r.kind === 'window');
const dealsRows = rows.filter(r => r.kind === 'deal');
const games = { self: dealsRows.length, 'person-runner': 0, 'person-corp': 0 };
const humanGames = {};
for (const w of windows) if (w.who !== 'self') humanGames[w.src] = w.who;
for (const who of Object.values(humanGames)) games[who]++;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const per = (a, b) => (b ? (a / b).toFixed(2) : '-');

console.log(`Sources: ${dealsRows.length} deals; human games with a Corp rez window on ice: ${games['person-runner']} (person as Runner), ${games['person-corp']} (person as Corp)`);
console.log('Note: a human game with no Corp approach-ice window does not appear; per-game rates for human games use the games listed.\n');

for (const who of ['self', 'person-runner', 'person-corp']) {
  const ws = windows.filter(w => w.who === who);
  if (!ws.length) continue;
  console.log(`== ${who}: ${ws.length} approach-ice windows, ${games[who]} games`);
  const rules = [...new Set(ws.map(w => w.rule))].sort();
  console.log('rule   windows  rez   short(rez)  toll-short  stop-short  wasEnough(toll-short)  restBreached  stolePts');
  for (const rule of rules) {
    const r = ws.filter(w => w.rule === rule);
    const rez = r.filter(w => w.pick === 'rez');
    const short = rez.filter(w => w.short && w.keepRest > 0);
    const toll = short.filter(w => !w.w.stopsWithFurther);
    const stop = short.filter(w => w.w.stopsWithFurther);
    const enough = toll.filter(w => w.wasEnough);
    // The exploit made real: after a short toll rez, a later run this turn breached a server that needed the money
    const real = toll.filter(w => w.rest.slice(1).some(x => x.breached && w.restBy[x.server] > 0));
    const pts = toll.reduce((n, w) => n + w.rest.slice(1).filter(x => w.restBy[x.server] > 0).reduce((m, x) => m + x.points, 0), 0);
    console.log(`${rule.padEnd(6)} ${String(r.length).padStart(7)} ${String(rez.length).padStart(5)} ${String(short.length).padStart(11)} ${String(toll.length).padStart(11)} ${String(stop.length).padStart(11)} ${String(enough.length).padStart(22)} ${String(real.length).padStart(13)} ${String(pts).padStart(9)}`);
  }
  const fires = ws.filter(w => w.arm);
  console.log(`arm fires (toll rez short of keepRest): ${fires.length} = ${per(fires.length, games[who])} a game; of which the Corp had keepRest before the rez: ${fires.filter(w => w.wasEnough).length}`);
  const real = fires.filter(w => w.rest.slice(1).some(x => x.breached && w.restBy[x.server] > 0));
  console.log(`  then a later run this turn breached a server that needed the money: ${real.length}; points stolen there: ${fires.reduce((n, w) => n + w.rest.slice(1).filter(x => w.restBy[x.server] > 0).reduce((m, x) => m + x.points, 0), 0)}`);
  const stopShort = ws.filter(w => w.stopShort);
  console.log(`stop direction (reported only): stop rezzes short of keepRest ${stopShort.length} (${per(stopShort.length, games[who])} a game), by rule ${JSON.stringify(count(stopShort.map(w => w.rule)))}`);
  if (who !== 'self') {
    const rec = ws.filter(w => w.recorded);
    console.log(`recorded move at the window: rez ${rec.filter(w => w.recorded === 'rez').length}, pass ${rec.filter(w => w.recorded === 'pass').length}; AI and record agree ${rec.filter(w => w.recorded === w.pick).length}/${rec.length}; at arm fires the record rezzed ${fires.filter(w => w.recorded === 'rez').length}/${fires.length}`);
  }
  // keepRest (rest of this turn) against keepNext (rezMoney's 'runnerTurn': the Runner's next turn)
  const both = ws.filter(w => w.keepRest > 0 || w.keepNext > 0);
  const diffs = both.map(w => w.keepNext - w.keepRest);
  console.log(`keepRest vs keepNext on ${both.length} windows with either > 0: equal ${diffs.filter(d => d === 0).length}, next higher ${diffs.filter(d => d > 0).length} (mean +${mean(diffs.filter(d => d > 0))}), next lower ${diffs.filter(d => d < 0).length} (mean ${mean(diffs.filter(d => d < 0))}); next includes the run's own server`);
  console.log(`count time per window (lib facts): mean ${mean(ws.map(w => w.ms))} ms, max ${Math.max(...ws.map(w => w.ms))} ms\n`);
  if (list)
    for (const w of fires)
      console.log(
        `  FIRE ${w.src} T${w.turn} ${w.rule} ${w.w.title}@${w.w.server} rez ${w.w.rezCost} corp ${w.w.corp} keepRest ${w.keepRest} ${JSON.stringify(w.restBy)} runner ${w.w.runner}->${w.w.runnerAfter} clicks ${w.w.clicksLeft}${w.recorded ? ` rec:${w.recorded}` : ''} | rest: ${w.rest.map(x => `${x.server}${x.breached ? '!' : ''}${x.points ? `+${x.points}pt` : ''}${x.trashed ? `t${x.trashed}` : ''} c${x.corpStart} ur${x.unrezzedLeft}`).join(', ')}`,
      );
}

const changedDeals = dealsRows.filter(d => !d.same && d.arm);
console.log(`== deals with the arm: ${dealsRows.filter(d => d.fired).length} deals where it fires; result changed in ${changedDeals.filter(d => d.base.winner !== d.arm.winner).length} (Corp wins base ${dealsRows.filter(d => d.base.winner === 'corp').length}, arm ${dealsRows.filter(d => (d.arm ?? d.base).winner === 'corp').length})`);
for (const d of changedDeals) {
  console.log(`  ${d.src}: base ${JSON.stringify(d.base)} arm ${JSON.stringify(d.arm)} fired(base) ${d.fired}`);
  if (list)
    for (const c of d.changed)
      console.log(
        `    T${c.turn} ${c.rule} ${c.w.title}@${c.w.server} rez ${c.w.rezCost} corp ${c.w.corp} keepRest ${c.keepRest} ${JSON.stringify(c.restBy)} | arm rest: ${c.armRest.map(x => `${x.server}${x.breached ? '!' : ''}${x.points ? `+${x.points}pt` : ''} c${x.corpStart}`).join(', ')} | base rest: ${(c.baseRest ?? []).map(x => `${x.server}${x.breached ? '!' : ''}${x.points ? `+${x.points}pt` : ''} c${x.corpStart}`).join(', ')}`,
      );
}

function mean(xs) {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-';
}
function count(xs) {
  const o = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}
