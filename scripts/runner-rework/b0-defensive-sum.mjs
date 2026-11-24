/**
 * Summarizes JSONL output from scripts/runner-rework/b0-defensive.ts.
 *
 * Usage:
 *   node scripts/runner-rework/b0-defensive-sum.mjs <file1.jsonl> [file2.jsonl ...]
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/runner-rework/b0-defensive-sum.mjs <file.jsonl> ...');
  process.exit(1);
}

const games = [];
const losses = [];
for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  for (const line of txt.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    const obj = JSON.parse(trimmed);
    if (obj.kind === 'game') games.push(obj);
    else if (obj.kind === 'loss') losses.push(obj);
  }
}

const pools = [...new Set(games.map(g => g.pool))];

function pct(n, d) {
  return d === 0 ? '0.0%' : `${((100 * n) / d).toFixed(1)}%`;
}

function lineNamedBy(loss, lineRes, mode) {
  const pub = loss.pub;
  if (!lineRes.survivedNextCorpTurn) return false;
  if (mode === 'strict') {
    // Publicly visible on board OR R-C2 tag condition (strictest public set)
    if (lineRes.line === 'remove_tags') return pub.rc2TagCondition;
    if (lineRes.line === 'draw_up') return pub.condDmgRezzed;
    if (lineRes.line === 'both') return pub.rc2TagCondition || pub.condDmgRezzed;
    if (lineRes.line === 'do_nothing') return pub.condDmgRezzed;
    return false;
  }
  if (mode === 'deck_corp') {
    // R-C2 tag condition OR public live decklist Corp-turn damage burst
    if (lineRes.line === 'remove_tags') return pub.rc2TagCondition;
    if (lineRes.line === 'draw_up') return pub.condDmgDeck || pub.condDmgRezzed;
    if (lineRes.line === 'both') return pub.rc2TagCondition || pub.condDmgDeck || pub.condDmgRezzed;
    if (lineRes.line === 'do_nothing') return pub.condDmgDeck || pub.condDmgRezzed;
    return false;
  }
  if (mode === 'deck_any') {
    // Includes run-phase decklist damage threat (relevant for ice/access flatlines)
    if (lineRes.line === 'remove_tags') return pub.rc2TagCondition;
    if (lineRes.line === 'draw_up') return pub.condDmgDeck || pub.condDmgRezzed || pub.condDmgAny;
    if (lineRes.line === 'both') return pub.rc2TagCondition || pub.condDmgDeck || pub.condDmgRezzed || pub.condDmgAny;
    if (lineRes.line === 'do_nothing') return pub.condDmgDeck || pub.condDmgRezzed || pub.condDmgAny;
    return false;
  }
  return false;
}

for (const pool of pools) {
  const pg = games.filter(g => g.pool === pool);
  const pl = losses.filter(l => l.pool === pool);
  const corpWins = pg.filter(g => g.winner === 'corp').length;
  const flatlines = pg.filter(g => g.isFlatline);
  const tagLosses = pg.filter(g => g.isTagPunishLoss);
  const flatByCause = {};
  for (const g of flatlines) flatByCause[g.flatCause ?? 'other'] = (flatByCause[g.flatCause ?? 'other'] ?? 0) + 1;

  console.log(`\n=== Pool: ${pool} (${pg.length} games, ${corpWins} Corp wins) ===`);
  console.log(`Qualifying losses: ${pl.length} (${pct(pl.length, pg.length)} of all games)`);
  console.log(`  Flatlines: ${flatlines.length} (${JSON.stringify(flatByCause)})`);
  console.log(`  Tag-punishment losses (last 3 Corp turns): ${tagLosses.length}`);

  const anySurvived = pl.filter(l => l.lines.some(r => r.survivedNextCorpTurn));
  console.log(`  Any defensive line survived next Corp turn: ${anySurvived.length}/${pl.length}`);

  for (const [mode, label] of [
    ['strict', 'Public: rc2_tag OR dmg_rezzed (on-board only)'],
    ['deck_corp', 'Public: rc2_tag OR dmg_deck (live decklist Corp-turn burst)'],
    ['deck_any', 'Public: rc2_tag OR dmg_deck OR dmg_any (incl. run damage)'],
  ]) {
    const avoidable = pl.filter(l => l.lines.some(r => lineNamedBy(l, r, mode)));
    const blind = anySurvived.filter(l => !avoidable.includes(l));
    console.log(`\n  [${label}]`);
    console.log(`    Avoidable:       ${avoidable.length} (${pct(avoidable.length, pg.length)} of all games [2% line]; ${pct(avoidable.length, pl.length)} of qualifying losses [10% line])`);
    console.log(`    Avoidable blind: ${blind.length} (${pct(blind.length, pg.length)} of all games; ${pct(blind.length, pl.length)} of qualifying losses)`);
    console.log(`    Unavoidable:     ${pl.length - anySurvived.length}`);
  }

  // Timing summary
  if (pl.length > 0) {
    const evalTimes = pl.map(l => l.evalMs ?? 0);
    const meanEval = evalTimes.reduce((a, b) => a + b, 0) / evalTimes.length;
    const gameTimes = pg.map(g => g.gameMs ?? 0);
    const meanGame = gameTimes.reduce((a, b) => a + b, 0) / Math.max(1, gameTimes.length);
    console.log(`\n  Timing: mean game ${(meanGame / 1000).toFixed(2)}s, mean loss eval (4 lines) ${(meanEval / 1000).toFixed(2)}s`);
  }

  // Reading rule 4: public condition prevalence in non-loss games (Runner won or Corp points without tag punish)
  const nonLoss = pg.filter(g => !g.qualifying);
  const runnerWins = pg.filter(g => g.winner === 'runner');
  const sumTurns = (arr, field) => arr.reduce((n, g) => n + (g.turnStats?.[field] ?? 0), 0);
  const gamesWith = (arr, field) => arr.filter(g => (g.turnStats?.[field] ?? 0) > 0).length;

  console.log(`\n  Reading rule 4 — public condition prevalence:`);
  for (const [label, arr] of [
    ['Non-qualifying games', nonLoss],
    ['Runner wins only', runnerWins],
    ['All games', pg],
  ]) {
    const totT = sumTurns(arr, 'totalRunnerTurns');
    console.log(`    ${label} (${arr.length} games, ${totT} Runner turns):`);
    for (const [f, name] of [
      ['taggedTurns', 'Runner tagged'],
      ['rc2TagTurns', 'R-C2 tag condition (Corp can punish tag)'],
      ['tagCardTurns', 'Live tag card affordable'],
      ['dmgRezzedTurns', 'Grip < rezzed Corp-turn dmg'],
      ['dmgDeckTurns', 'Grip < live deck Corp-turn dmg'],
      ['dmgAnyTurns', 'Grip < live deck any dmg'],
    ]) {
      const t = sumTurns(arr, f);
      const gw = gamesWith(arr, f);
      console.log(`      ${name.padEnd(42)} ${String(t).padStart(4)} turns (${pct(t, totT).padStart(5)}), ${String(gw).padStart(3)}/${arr.length} games (${pct(gw, arr.length)})`);
    }
  }

  // Per-loss table
  if (pl.length > 0) {
    console.log(`\n  Per-loss breakdown:`);
    for (const l of pl) {
      const surv = l.lines.filter(r => r.survivedNextCorpTurn).map(r => r.line);
      const best = l.lines.find(r => r.survivedNextCorpTurn);
      const gave = best ? `gaveUp(st=${best.gaveUp.stolen},br=${best.gaveUp.breachedLost},tr=${best.gaveUp.trashed},cr=${best.gaveUp.crDiff})` : '-';
      console.log(
        `    ${l.id.padEnd(10)} ${l.corpDeck} vs ${l.runnerDeck} | ${l.eventKind} @T${l.eventTurn} (rewind T${l.rewindTurn}) | tags=${l.pub.runnerTags} grip=${l.pub.runnerGrip} cr=${l.pub.runnerCredits} corpCr=${l.pub.corpCredits} | pub=[${l.pub.reasons.join(',')}] | survived=[${surv.join(',')}] | ${gave}`
      );
    }
  }
}
