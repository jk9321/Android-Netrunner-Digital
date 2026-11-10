// Counted scoring C3 (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md): does the Corp sit broke after
// it scores? For every Corp score (its score higher at the start of its next turn), the next three Corp turns that begin
// under 3 credits, and how those games end against the base batch on the same deals (its winner; its own count too
// when its records carry the per-turn trace). Prints nothing for records without the trace (money.scoreAtTurnStart).
//   imported by corp-losses-sum.mjs; also: node scripts/counted-broke-sum.mjs out/*.json [--base base/*.json]
import { pathToFileURL } from 'node:url';
import { readGames, splitArgs } from './paired-summary.mjs';

const BROKE = 3;
const AFTER = 3;
const trace = g => (g.money?.scoreAtTurnStart ? { cr: g.money.creditsAtTurnStart, sc: g.money.scoreAtTurnStart } : g.sc ? { cr: g.cr, sc: g.sc } : null);
const key = g => `${g.seed}|${g.corpDeck}|${g.runnerDeck}`;

/** Per game: its score events and, for each, the broke turns among the next AFTER Corp turns. */
function events(g) {
  const t = trace(g);
  if (!t) return null;
  const out = [];
  for (let i = 0; i + 1 < t.sc.length; i++) {
    if (t.sc[i + 1] <= t.sc[i]) continue;
    const next = t.cr.slice(i + 1, i + 1 + AFTER);
    out.push({ turn: i + 1, broke: next.filter(c => c < BROKE).length, seen: next.length });
  }
  return out;
}

function line(label, games) {
  const ev = games.flatMap(g => events(g) ?? []);
  const n = ev.length;
  const pct = k => (n ? ((100 * ev.filter(e => e.broke >= k).length) / n).toFixed(1) : '-');
  const mean = n ? (ev.reduce((s, e) => s + e.broke, 0) / n).toFixed(2) : '-';
  console.log(`  ${label}: ${n} Corp scores in ${games.length} games; next ${AFTER} turns under ${BROKE} credits: mean ${mean}, at least 1 ${pct(1)}%, at least 2 ${pct(2)}%`);
}

export function printBrokeAfterScoring(games, baseGames = []) {
  const traced = games.filter(g => !g.crashed && trace(g));
  if (!traced.length) return;
  console.log(`\nCounted scoring C3: broke after scoring (a Corp turn begun under ${BROKE} credits, in the ${AFTER} after a score)`);
  line('this batch', traced);
  const base = new Map(baseGames.filter(g => !g.crashed).map(g => [key(g), g]));
  const baseTraced = [...base.values()].filter(g => trace(g));
  if (baseTraced.length) line('base', baseTraced);
  // Games where a score was followed by 2 or more broke turns: how they ended, against the base game on the same deal
  const spells = traced.filter(g => events(g).some(e => e.broke >= 2));
  const rest = traced.filter(g => !spells.includes(g) && events(g).length);
  const rate = (list, of = g => g) => {
    const known = list.map(of).filter(Boolean);
    return known.length ? `${((100 * known.filter(g => g.winner === 'corp').length) / known.length).toFixed(1)}% of ${known.length}` : '-';
  };
  const inBase = g => base.get(key(g));
  console.log(`  games with a broke spell (2+ of the ${AFTER} turns) after a score: ${spells.length}; Corp won ${rate(spells)}, base on the same deals ${rate(spells, inBase)}`);
  console.log(`  other games with a score: ${rest.length}; Corp won ${rate(rest)}, base on the same deals ${rate(rest, inBase)}`);
  // The losing pattern to look at: a broke spell after a score, lost here, won by the base
  const turned = spells.filter(g => g.winner !== 'corp' && inBase(g)?.winner === 'corp');
  if (turned.length) console.log(`  broke spell, lost here, won in the base (${turned.length}): ${turned.slice(0, 20).map(g => `${g.seed} ${g.corpDeck} v ${g.runnerDeck} (turns ${events(g).filter(e => e.broke >= 2).map(e => e.turn).join(',')})`).join('; ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, base } = splitArgs(process.argv.slice(2));
  printBrokeAfterScoring(readGames(files), base.length ? readGames(base) : []);
}
