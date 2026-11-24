/**
 * B0 rev 2 recount: summarizes JSONL from scripts/runner-rework/b0-defensive.ts (the version with `actual` and the
 * *_then_play lines) into the three-way split of brief b0-scripts.md rev 2 point 4, with point 5 applied.
 *
 * Usage: node scripts/runner-rework/b0-recount-sum.mjs <file.jsonl> ... [--detail]
 *
 * Per loss (unit: one game; pool said in every table):
 * - window: the line's Runner turn plus the next Corp turn. A line AVOIDS the loss if, in the window, the Runner is
 *   not flatlined (flatline losses) and no tag punishment fires (tag-punishment losses).
 * - reproduced: the `actual` line (Normal Runner plays the turn itself in the eval tree) does NOT avoid it.
 * - DEFENSIVE: a *_then_play line (the defensive clicks, then the Runner plays on as it would) avoids it, and its
 *   public condition held at the start of the turn (remove_tags: rc2_tag; draw_up: a damage condition of the set;
 *   both: either). Split by point 5: REMOVED (at the next Corp turn's start no tag kill and no damage above the grip
 *   is on the table) or STILL AVAILABLE (it was there and the Corp did not take it).
 * - DEFENSIVE, BLIND: as above but no public condition named the line.
 * - NOT RUNNING: no play line avoids it once its click control is applied, but a pure line (defensive clicks then
 *   clicks for credits) or the click control itself does: fewer or no runs avoided it.
 * - NOT AVOIDABLE: no line avoids it.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const detail = args.includes('--detail');
const files = args.filter(a => !a.startsWith('--'));
const games = [];
const losses = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    const o = JSON.parse(t);
    if (o.kind === 'game') games.push(o);
    else if (o.kind === 'loss') losses.push(o);
  }
}
const pct = (n, d) => (d === 0 ? '-' : `${((100 * n) / d).toFixed(1)}%`);

const SETS = {
  strict: p => ({ tag: p.rc2TagCondition, dmg: p.condDmgRezzed }),
  deck: p => ({ tag: p.rc2TagCondition, dmg: p.condDmgRezzed || p.condDmgDeck }),
  any: p => ({ tag: p.rc2TagCondition, dmg: p.condDmgRezzed || p.condDmgDeck || p.condDmgAny }),
};

function avoids(loss, r) {
  if (!r) return false;
  if (loss.isFlatline && !r.survivedNextCorpTurn) return false;
  if (!loss.isFlatline && (r.punishmentStillFired || !r.survivedNextCorpTurn)) return false;
  return true;
}
function named(set, loss, line) {
  const c = SETS[set](loss.pub);
  if (line.startsWith('remove_tags')) return c.tag;
  if (line.startsWith('draw_up')) return c.dmg;
  if (line.startsWith('both')) return c.tag || c.dmg;
  return false;
}
const killOn = k => !!k && (k.tagKill.length > 0 || k.dmgKill);

function classify(loss, set) {
  const by = Object.fromEntries(loss.lines.map(r => [r.line, r]));
  const reproduced = !avoids(loss, by.actual);
  // A play line counts only if the click control with the same number of spent clicks does not also avoid the loss.
  const clicksOf = l => (by[l] ? by[l].actions.indexOf('PLAY') : -1);
  const controlAvoids = l => clicksOf(l) > 0 && avoids(loss, by[`credits${clicksOf(l)}_then_play`]);
  const rawPlay = ['remove_tags_then_play', 'draw_up_then_play', 'both_then_play'].filter(l => avoids(loss, by[l]));
  const playLines = rawPlay.filter(l => !controlAvoids(l));
  const clicksOnly = rawPlay.length > 0 && playLines.length === 0;
  const pureLines = ['do_nothing', 'remove_tags', 'draw_up', 'both'].filter(l => avoids(loss, by[l]));
  const namedPlay = playLines.filter(l => named(set, loss, l));
  let cls;
  let removed = null;
  if (namedPlay.length > 0) {
    removed = namedPlay.some(l => !killOn(by[l].killAtCorpStart) && !killOn(by[l].killAtNextCorpStart));
    cls = removed ? 'defensive_removed' : 'defensive_still';
  } else if (playLines.length > 0) cls = 'defensive_blind';
  else if (clicksOnly || pureLines.length > 0) cls = 'not_running';
  else cls = 'not_avoidable';
  const wonAfter = loss.lines.filter(r => r.line !== 'actual' && r.finalWinner === 'runner').map(r => r.line);
  const gameWon = namedPlay.some(l => by[l].finalWinner === 'runner');
  return { cls, gameWon, clicksOnly, reproduced, playLines, pureLines, namedPlay, wonAfter, actualFinal: by.actual?.finalWinner ?? null };
}

const CLS = ['defensive_removed', 'defensive_still', 'defensive_blind', 'not_running', 'not_avoidable'];
for (const pool of [...new Set(games.map(g => g.pool))]) {
  const pg = games.filter(g => g.pool === pool);
  const pl = losses.filter(l => l.pool === pool);
  console.log(`\n## Pool ${pool}: ${pg.length} games, ${pg.filter(g => g.winner === 'corp').length} Corp wins, ${pl.length} qualifying losses (${pl.filter(l => l.isFlatline).length} flatlines: ${pl.filter(l => l.isFlatline && l.flatActivePlayer === 'runner').length} on the Runner's turn)`);
  const notRepro = pl.filter(l => classify(l, 'strict').reproduced === false).map(l => l.id);
  console.log(`replay of the actual turn does not reproduce the loss: ${notRepro.length}${notRepro.length ? ' (' + notRepro.join(', ') + ')' : ''}`);
  console.log(`\n| condition set | ${CLS.join(' | ')} | rule 3: removed / all games, / qualifying |`);
  console.log(`| --- | ${CLS.map(() => '---:').join(' | ')} | --- |`);
  for (const set of Object.keys(SETS)) {
    const counts = Object.fromEntries(CLS.map(c => [c, 0]));
    for (const l of pl) counts[classify(l, set).cls]++;
    const n = counts.defensive_removed;
    const won = pl.filter(l => { const c = classify(l, set); return c.cls === 'defensive_removed' && c.gameWon; }).length;
    console.log(`| ${set} | ${CLS.map(c => counts[c]).join(' | ')} | ${n}: ${pct(n, pg.length)} / ${pct(n, pl.length)} (Runner then won the game: ${won}) |`);
  }
  if (detail) {
    console.log('\n| loss | event | rewind | pub | class (strict) | clicks only | reproduced | play lines that avoid | pure lines that avoid | kill at next Corp turn (best play line) | Runner won the game after |');
    console.log('| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const l of pl) {
      const c = classify(l, 'strict');
      const best = l.lines.find(r => r.line === (c.namedPlay[0] ?? c.playLines[0]));
      const k = best?.killAtCorpStart;
      const ks = k ? `tag[${k.tagKill.join('+')}] dmg ${k.maxDmg} vs grip ${k.grip}` : '-';
      console.log(`| ${l.id} ${l.corpDeck} vs ${l.runnerDeck} | ${l.eventKind} T${l.eventTurn} | T${l.rewindTurn} | ${l.pub.reasons.join(',') || '-'} | ${c.cls} | ${c.clicksOnly ? 'yes' : '-'} | ${c.reproduced ? 'yes' : 'NO'} | ${c.playLines.join(',') || '-'} | ${c.pureLines.join(',') || '-'} | ${ks} | ${c.wonAfter.join(',') || '-'} |`);
    }
  }
  // Reading rule 4: condition prevalence on Runner turns of games that were not qualifying losses.
  const ng = pg.filter(g => !g.qualifying);
  const sum = k => ng.reduce((a, g) => a + (g.turnStats?.[k] ?? 0), 0);
  const T = sum('totalRunnerTurns');
  console.log(`\nRule 4 (${ng.length} non-qualifying games, ${T} Runner turns): rc2_tag ${pct(sum('rc2TagTurns'), T)}, dmg_rezzed ${pct(sum('dmgRezzedTurns'), T)}, dmg_deck ${pct(sum('dmgDeckTurns'), T)}, dmg_any ${pct(sum('dmgAnyTurns'), T)}`);
}
