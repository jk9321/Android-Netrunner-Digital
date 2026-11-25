// Sum of scripts/tag-owner/count.ts (brief netrunner-ai/tag-owner/brief-count.md rev 0):
//   node scripts/tag-owner/sum.mjs <dir or files with *.txt / *.jsonl> [...]
// Pools are never summed. The reading rules are the brief's, applied as written (section "Reading rules"); each table
// names its pool and its unit. A price is the size of the change a tag makes (the Runner's view: evaluate falls; the
// Corp's: it rises), so a price and a cost are both positive numbers.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt') || f.endsWith('.jsonl')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const ARMS = ['base', 'once', 'resOnly', 'resOnlyOnce', 'owner', 'ownerOnce'];
const SELF = ['batch', 'nrdb'];
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const sum = (xs, f = x => x) => xs.reduce((n, x) => n + (Number(f(x)) || 0), 0);
const mean = (xs, f = x => x) => (xs.length ? sum(xs, f) / xs.length : NaN);
const se = (xs, f = x => x) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs, f);
  return Math.sqrt(sum(xs, x => (Number(f(x)) - m) ** 2) / (xs.length - 1) / xs.length);
};
const ms = (xs, f) => `${r2(mean(xs, f))} ± ${r2(se(xs, f))}`;
const line = cells => `| ${cells.join(' | ')} |`;
const head = cells => `${line(cells)}\n${line(cells.map(() => '---'))}`;
const num = x => (typeof x === 'number' ? x : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : NaN);
const say = (...x) => console.log(...x);

const games = rows.filter(r => r.kind === 'g');
const decs = rows.filter(r => r.kind === 'd');
const tags = rows.filter(r => r.kind === 'tag');
const units = rows.filter(r => r.kind === 'u');
const errs = rows.filter(r => r.kind === 'err');
const shards = rows.filter(r => r.kind === 's');
const countGames = games.filter(g => g.counts);
const legGames = games.filter(g => !g.counts);
const pools = [...new Set(games.map(g => g.pool))];
say(`# F108 count (tag-owner): sum of ${files.length} files\n`);

// ---------------------------------------------------------------------------------------------------- checks
say('## Checks');
if (countGames.length) {
  say('Count mode (Parts A, C, D). Unit: one game.\n');
  say(head(['pool', 'games', 'decisions', 'replays its record (winner, cr, sc)', 'base pick != source pick (corp / runner)', 'ctl pick != base (all)', 'untagged boards checked', 'max abs(resOnly or owner - base) untagged', 'perTurn calls with no card (resOnly, tagged)', 'errors']));
  for (const p of pools) {
    const g = countGames.filter(x => x.pool === p);
    if (!g.length) continue;
    const c = k => sum(g, x => x.counts[k]);
    const ctl = sum(g, x => sum(Object.entries(x.counts).filter(([k]) => k.startsWith('ctl differs')), ([, v]) => v));
    const rep = SELF.includes(p) ? `${g.filter(x => x.matchesBatch).length}/${g.length}` : p === 'people' ? `${g.filter(x => !x.err).length}/${g.length} replay to the end` : '-';
    say(line([p, g.length, sum(g, x => x.decisions), rep, `${c('baseDiffers corp')} / ${c('baseDiffers runner')}`, ctl, sum(g, x => x.untagged.n), Math.max(...g.map(x => x.untagged.max)).toExponential(2), sum(g, x => x.toUnknown), errs.filter(e => e.pool === p).length]));
  }
}
if (legGames.length) {
  say('\nLegs mode (Part B). Unit: one source game.\n');
  say(head(['pool', 'games', 'replays its record', 'clear units', 'mirror candidates', 'mirror units', 'tagged main decisions']));
  for (const p of SELF) {
    const g = legGames.filter(x => x.pool === p);
    if (!g.length) continue;
    say(line([p, g.length, `${g.filter(x => x.matchesBatch).length}/${g.length}`, sum(g, x => x.units), sum(g, x => x.mirrorCands), sum(g, x => x.mirrors), sum(g, x => x.tagged)]));
  }
}
for (const e of errs.slice(0, 20)) say(`- err ${e.pool} ${e.src}: ${String(e.error).slice(0, 240)}`);
if (shards.length) say(`\nShards: ${shards.length}; longest ${r2(Math.max(...shards.map(s => s.ms)) / 60000)} min; most RSS ${Math.max(...shards.map(s => s.rss ?? 0))} MB.`);

// ---------------------------------------------------------------------------------------------------- Part A
const priceOf = (t, arm, v) => (v === 'runner' ? -num(t.priced.arms[arm].runner) : num(t.priced.arms[arm].corp));
const tw = (t, v) => num(t.priced.tagsWorth[v]);
if (tags.length) {
  say('\n## Part A: the arms\' price of a tag against the record');
  say('Unit: one tag the Runner took (FIFO over open tags), priced on the board it was taken from: the whole change of evaluate for one more tag under each arm (Runner view: the fall; Corp view: the rise). Cost = what the record shows it then cost (clearing: the click and credits the clearing action spent at base\'s rates; kept: a resource trashed by tagLoss\'s owner, or a punisher\'s drop of the Runner\'s strength), as tags-once counted it. Means; ± one standard error.\n');
  for (const p of pools) {
    const tp = tags.filter(t => t.pool === p);
    if (!tp.length) continue;
    for (const v of ['runner', 'corp']) {
      say(`\n### ${p}, ${v} view`);
      say(head(['tags', 'n', 'cost', 'tagsWorth', ...ARMS, 'rig risk part (base)']));
      for (const [name, f] of [['all', () => true], ['first', t => t.first], ['later', t => !t.first]]) {
        const xs = tp.filter(f);
        if (!xs.length) continue;
        say(line([name, xs.length, ms(xs, t => t.cost), r2(mean(xs, t => tw(t, v))), ...ARMS.map(a => r2(mean(xs, t => priceOf(t, a, v)))), v === 'runner' ? r2(mean(xs, t => -num(t.priced.rigRisk))) : '-']));
      }
      say('\nBy what then happened:\n');
      say(head(['outcome', 'first: n', 'cost', 'base price', 'later: n', 'cost', 'base price']));
      for (const o of ['clearedSameTurn', 'clearedLater', 'keptToEnd', 'removedOtherwise']) {
        const f = tp.filter(t => t.outcome === o && t.first);
        const l = tp.filter(t => t.outcome === o && !t.first);
        say(line([o, f.length, r2(mean(f, t => t.cost)), r2(mean(f, t => priceOf(t, 'base', v))), l.length, r2(mean(l, t => t.cost)), r2(mean(l, t => priceOf(t, 'base', v)))]));
      }
      const later = tp.filter(t => !t.first && t.clock);
      if (later.length) {
        say('\nLater tags: the branch of the clock\'s min on the board with this tag, beside what the Runner then did (counts):\n');
        say(head(['branch', 'n', 'clearedSameTurn', 'clearedLater', 'keptToEnd', 'removedOtherwise', 'mean clear-all', 'mean keep', 'mean tagLossPerTurn']));
        for (const b of ['clearAll', 'keep']) {
          const xs = later.filter(t => t.clock[v].branch === b);
          say(line([b, xs.length, ...['clearedSameTurn', 'clearedLater', 'keptToEnd', 'removedOtherwise'].map(o => xs.filter(t => t.outcome === o).length), r2(mean(xs, t => t.clock[v].clearAll)), r2(mean(xs, t => t.clock[v].keep)), r2(mean(xs, t => t.clock[v].perTurn))]));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- Part A additions (06:38Z, 06:41Z)
const tc = (t, a) => num(t.priced.tagCost?.[a]);
const sd = (xs, f) => {
  const m = mean(xs, f);
  return xs.length > 1 ? Math.sqrt(sum(xs, x => (Number(f(x)) - m) ** 2) / (xs.length - 1)) : NaN;
};
if (tags.some(t => t.priced.tagCost)) {
  say('\n## Part A, tagCost beside the arms (06:38Z, 06:41Z)');
  say('Unit: as Part A. tagCost = the run\'s price of one more tag (runs.ts tagCost, Runner view) on the board the tag was taken from, under each arm. "arm less tagCost" = the arm\'s whole change of evaluate for one more tag (Runner view) less that arm\'s tagCost: mean, SD over tags.\n');
  for (const p of pools) {
    const tp = tags.filter(t => t.pool === p && t.priced.tagCost);
    if (!tp.length) continue;
    say(`\n### ${p}`);
    say(head(['tags', 'stuck', 'n', 'cost', ...ARMS.map(a => `${a} tagCost`), ...ARMS.map(a => `${a} less tagCost (SD)`)]));
    for (const [name, f] of [['all', () => true], ['first', t => t.first], ['later', t => !t.first]])
      for (const [sn, sf] of [['any', () => true], ['stuck', t => t.stuck], ['not stuck', t => !t.stuck]]) {
        const xs = tp.filter(t => f(t) && sf(t));
        if (!xs.length) continue;
        say(line([name, sn, xs.length, ms(xs, t => t.cost), ...ARMS.map(a => r2(mean(xs, t => tc(t, a)))), ...ARMS.map(a => `${r2(mean(xs, t => priceOf(t, a, 'runner') - tc(t, a)))} (${r2(sd(xs, t => priceOf(t, a, 'runner') - tc(t, a)))})`)]));
      }
    const tr = tp.filter(t => t.trash);
    if (tr.length) {
      say(`\nTags from a trash (${tr.length}): tagCost on the access board, tagCost on its copy with the trash cost off the Runner's credits, and the one number (the arm's change of evaluate on the trash board without vs with the tag):\n`);
      say(head(['tag', 'card', 'trash cost', ...ARMS.map(a => `${a}: tagCost / after / one number`)]));
      for (const t of tr) say(line([`${t.src} T${t.T}`, t.trash.card, t.trash.trashCost, ...ARMS.map(a => `${r2(tc(t, a))} / ${r2(num(t.trash.tagCostAfter[a]))} / ${r2(num(t.trash.oneNumber[a]))}`)]));
    }
  }
}
const p58 = rows.filter(r => r.kind === 'p58');
if (p58.length) {
  say('\n## #58 boards T3 to T6 side by side (06:38Z)');
  say('Unit: one board of the #58 pin where the Runner chose a run. Plaza\'s worth less its trash, tagCost on the board, tagCost after the trash (trash cost off the credits), and the arm\'s whole change of evaluate for one more tag (Runner view).\n');
  say(head(['T', 'clicks', 'credits', 'target', 'Plaza worth less trash', 'tagCost', 'tagCost after trash', ...ARMS]));
  for (const r of p58) say(line([r.T, r.clicks, r.credits, r.target, r.arms.base.worthLessTrash, r.arms.base.tagCost, r.arms.base.tagCostAfterTrash, ...ARMS.map(a => r2(num(r.arms[a].evalTag)))]));
}

// ---------------------------------------------------------------------------------------------------- Part B
// One unit: the legs averaged over its seeds first (the seeds share the board), then the mean and its standard error over units
const legOk = u => u.legs.filter(l => !l.error);
const uMean = (u, f) => mean(legOk(u), f);
const lost = L => num(L.took.trash) + num(L.took.punish);
const B1 = {};
if (units.length) {
  say('\n## Part B: the oracle, a kept tag played out');
  say('Unit: one decision of the source Runner (a main-phase decision while tagged). `clear` units: the source took REMOVE_TAG; legs `clear` (as played) and `keep` (REMOVE_TAG barred until the Runner\'s next turn begins). `mirror` units: a tagged decision with a click and 2 credits where it did not; legs `keep` (as played) and `clear` (forced). Each leg on the legs tree (src but the bar), seeds 0 and 1 (seed 1: R&D and the stack reshuffled, both legs alike), each value averaged over the seeds, then mean ± SE over units.\n');
  for (const kind of ['clear', 'mirror']) {
    for (const p of SELF) {
      const us = units.filter(u => u.pool === p && u.unit === kind && legOk(u).length);
      if (!us.length) continue;
      say(`\n### B.1 ${p}, ${kind} units (${us.length}), through the end of the Corp's next turn`);
      say(head(['', 'mean ± SE']));
      const rowsB = [
        ['keep leg: lost (resource trashed + punisher)', u => uMean(u, l => lost(l.keep))],
        ['  of it a resource trashed', u => uMean(u, l => num(l.keep.took.trash))],
        ['  of it a punisher', u => uMean(u, l => num(l.keep.took.punish))],
        ['keep leg: what the Corp spent taking it', u => uMean(u, l => num(l.keep.corpSpent))],
        ['keep leg: lost less spent', u => uMean(u, l => lost(l.keep) - num(l.keep.corpSpent))],
        ['clear leg: lost (a tag taken again)', u => uMean(u, l => lost(l.clear))],
        ['clearing cost (a click and 2 credits, the board\'s rates)', u => num(u.beside.clearCost)],
        ['(lost less spent) less clearing cost', u => uMean(u, l => lost(l.keep) - num(l.keep.corpSpent)) - num(u.beside.clearCost)],
        ['tagLossPerTurn, Runner view', u => num(u.beside.lossPerTurn.runner)],
        ['tagLossPerTurn, Corp view', u => num(u.beside.lossPerTurn.corp)],
        ['tagLossPerTurn (Runner) less realized loss', u => num(u.beside.lossPerTurn.runner) - uMean(u, l => lost(l.keep))],
        ['tagLossPerTurn (Corp) less realized loss', u => num(u.beside.lossPerTurn.corp) - uMean(u, l => lost(l.keep))],
        ['the rig\'s tagged-risk part under base (Runner view)', u => -num(u.beside.rigRisk)],
        ['tagsWorth of the tags on the board, Runner view', u => num(u.beside.tagsWorth.runner)],
        ['keep leg: Runner credits at its next turn, less the clear leg\'s', u => uMean(u, l => l.keep.at.rc - l.clear.at.rc)],
        ['keep leg: Runner rig cards then, less the clear leg\'s', u => uMean(u, l => l.keep.at.rig - l.clear.at.rig)],
        ['keep leg: Runner points then, less the clear leg\'s', u => uMean(u, l => l.keep.at.rs - l.clear.at.rs)],
        ['keep leg: Corp points then, less the clear leg\'s', u => uMean(u, l => l.keep.at.cs - l.clear.at.cs)],
      ];
      for (const [name, f] of rowsB) say(line([name, ms(us, f)]));
      B1[`${p}:${kind}`] = { us, d: [mean(us, rowsB[7][1]), se(us, rowsB[7][1])], loss: [mean(us, rowsB[0][1]), se(us, rowsB[0][1])], lrR: [mean(us, rowsB[10][1]), se(us, rowsB[10][1])], lrC: [mean(us, rowsB[11][1]), se(us, rowsB[11][1])] };
      // The Corp that could take and did not
      const legs = us.flatMap(u => legOk(u).map(l => l.keep));
      const could = legs.filter(l => l.corpCould);
      say(`\nKeep legs (${legs.length}): the Corp had a click, 2 credits and a resource to trash while the Runner was tagged in ${could.length}; trashed one in ${could.filter(l => l.corpTrashed > 0).length}; did not in ${could.filter(l => l.corpTrashed === 0).length}. A punisher played in ${legs.filter(l => num(l.took.punish) > 0 || l.takes.some(x => x.startsWith('punish'))).length}.`);
      const firsts = {};
      for (const l of legs) firsts[l.first.split(':')[0]] = (firsts[l.first.split(':')[0]] ?? 0) + 1;
      say(`What the Runner played with the click it kept (keep legs, first action): ${Object.entries(firsts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
      const takes = {};
      for (const l of legs) for (const t of l.takes) takes[t.split(':').slice(0, 2).join(':')] = (takes[t.split(':').slice(0, 2).join(':')] ?? 0) + 1;
      say(`What the Corp took: ${Object.entries(takes).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}.`);
      // Splits
      say('\nSplit: (lost less spent) less clearing cost, and the keep leg\'s loss:\n');
      say(head(['split', 'value', 'units', 'lost less spent, less clearing', 'lost']));
      const splits = [
        ['a resource in the rig', u => (u.split.resource ? 'yes' : 'no')],
        ['a punisher (Runner\'s view)', u => u.split.punisher],
        ['tag', u => (u.split.first ? 'first' : 'later')],
        ['the Runner\'s last click', u => (u.split.lastClick ? 'yes' : 'no')],
        ['stuck (no click and 2 credits to clear)', u => (u.split.stuck ? 'yes' : 'no')],
      ];
      for (const [name, f] of splits) {
        for (const val of [...new Set(us.map(f))].sort()) {
          const xs = us.filter(u => f(u) === val);
          say(line([name, val, xs.length, ms(xs, rowsB[7][1]), ms(xs, rowsB[0][1])]));
        }
      }
      // B.2
      const ended = us.filter(u => legOk(u).every(l => l.keep.end && l.clear.end));
      if (ended.length) {
        say(`\n### B.2 ${p}, ${kind} units: to the end of the game (${ended.length} units, paired keep less clear)`);
        say(head(['', 'keep', 'clear', 'keep less clear']));
        const rw = (L, w) => (L.end.w === w ? 1 : 0);
        say(line(['Runner wins (share)', r2(mean(ended, u => uMean(u, l => rw(l.keep, 'runner')))), r2(mean(ended, u => uMean(u, l => rw(l.clear, 'runner')))), ms(ended, u => uMean(u, l => rw(l.keep, 'runner') - rw(l.clear, 'runner')))]));
        say(line(['Runner points', r2(mean(ended, u => uMean(u, l => l.keep.end.rp))), r2(mean(ended, u => uMean(u, l => l.clear.end.rp))), ms(ended, u => uMean(u, l => l.keep.end.rp - l.clear.end.rp))]));
        say(line(['Corp points', r2(mean(ended, u => uMean(u, l => l.keep.end.cp))), r2(mean(ended, u => uMean(u, l => l.clear.end.cp))), ms(ended, u => uMean(u, l => l.keep.end.cp - l.clear.end.cp))]));
        B1[`${p}:${kind}`].b2 = [mean(ended, u => uMean(u, l => rw(l.keep, 'runner') - rw(l.clear, 'runner'))), se(ended, u => uMean(u, l => rw(l.keep, 'runner') - rw(l.clear, 'runner')))];
      }
      say(`\nTime: a leg ${r2(mean(legs, l => l.ms) / 1000)} s (keep legs, to ${ended.length ? 'the end of the game' : 'the Runner\'s next turn'}).`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------- Part C
if (countGames.length) {
  say('\n## Part C: size and time');
  say('Unit: one decision the source game asks of an agent (GameRunner.step). Changed picks against base, per game; time per ask against the control arm `ctl` (base asked again).\n');
  for (const side of ['corp', 'runner']) {
    say(`\n### ${side === 'corp' ? 'Corp' : 'Runner'} decisions`);
    say(head(['pool', 'kind', 'decisions', ...ARMS.slice(1).map(a => `${a} (per game)`)]));
    for (const p of pools) {
      const g = countGames.filter(x => x.pool === p);
      if (!g.length) continue;
      const kinds = [...new Set(g.flatMap(x => Object.keys(x.counts).filter(k => k.startsWith(`n ${side}:`) && !k.endsWith('tagged')).map(k => k.slice(2 + side.length + 1))))].sort();
      for (const k of [...kinds, 'all']) {
        const c = key => sum(g, x => (k === 'all' ? sum(kinds, kk => x.counts[key.replace('%', kk)]) : x.counts[key.replace('%', k)]));
        say(line([p, k, c(`n ${side}:%`), ...ARMS.slice(1).map(a => `${c(`ch ${a} ${side}:%`)} (${r2(c(`ch ${a} ${side}:%`) / g.length)})`)]));
      }
    }
  }
  say('\n### Time per ask, against ctl');
  say(head(['pool', ...ARMS.map(a => `${a} / ctl`), 'ctl ms an ask']));
  for (const p of pools) {
    const g = countGames.filter(x => x.pool === p);
    if (!g.length) continue;
    const t = a => sum(g, x => x.ms[a]);
    say(line([p, ...ARMS.map(a => r2(t(a) / t('ctl'))), r2(t('ctl') / sum(g, x => x.decisions))]));
  }
  say('\n### Clear decisions');
  say('Unit: a Runner main decision while tagged with a click and 2 credits. "source clears, arm would not": the source took REMOVE_TAG and the arm\'s pick is another; "newly clear": the arm picks REMOVE_TAG where base does not; "drops": base picks it and the arm does not.\n');
  say(head(['pool', 'decisions', 'source clears', 'base clears', ...ARMS.map(a => `${a}: source clears, arm would not`), ...ARMS.slice(1).map(a => `${a}: newly / drops`)]));
  for (const p of pools) {
    const g = countGames.filter(x => x.pool === p);
    if (!g.length) continue;
    const c = k => sum(g, x => x.counts[k]);
    say(line([p, c('clearable'), c('clear src'), c('clear base'), ...ARMS.map(a => c(`clear srcNot ${a}`)), ...ARMS.slice(1).map(a => `${c(`clear new ${a}`)} / ${c(`clear drop ${a}`)}`)]));
  }
}

// ---------------------------------------------------------------------------------------------------- Part D
const acc = decs.filter(d => d.access?.tagTrash);
if (acc.length) {
  say('\n## Part D: accesses whose trash gives a tag (issue58: the #58 pin\'s boards T3 to T6; old150: the declined Plaza accesses of the decided-twice count met again by today\'s source; batch / nrdb / people: every such access)');
  say('Unit: one access_trash prompt where trashing gives the Runner a tag. Answers by arm; the tag\'s part of trash less keep (Runner view): the two tagsWorth lines, the rig, the Corp board; base\'s rig split by reader.\n');
  for (const p of [...new Set(acc.map(d => d.pool))]) {
    const xs = acc.filter(d => d.pool === p);
    say(`\n### ${p} (${xs.length} accesses)`);
    say(head(['arm', 'trash', 'keep', 'alt', 'total', 'tagsRunner', 'tagsCorp', 'rig', 'corpBoard', 'credits']));
    for (const a of ARMS) {
      const ans = v => xs.filter(d => d.access.answers[a] === v).length;
      const pr = k => r2(mean(xs, d => num(d.access.tagTrash.parts[a].runner[k])));
      say(line([a, ans('trash'), ans('keep'), ans('alt'), pr('total'), pr('tagsRunner'), pr('tagsCorp'), pr('rig'), pr('corpBoard'), pr('runnerCredits')]));
    }
    const byCard = {};
    for (const d of xs) for (const [k, v] of Object.entries(d.access.tagTrash.parts.base.runner.byCard)) {
      const name = k.replace(/ inst-\d+$/, '');
      const b = (byCard[name] ??= { all: 0, payoutWait: 0, perTurn: 0, other: 0 });
      for (const f of Object.keys(b)) b[f] += num(v[f]) / xs.length;
    }
    say(`\nBase's rig part by card (mean an access): ${Object.entries(byCard).sort((x, y) => x[1].all - y[1].all).slice(0, 10).map(([k, v]) => `${k} ${r2(v.all)} (perTurn ${r2(v.perTurn)}, payoutWait ${r2(v.payoutWait)}, other ${r2(v.other)})`).join('; ')}.`);
    if (p === 'issue58' || p.startsWith('old150')) for (const d of xs) say(`- ${d.src} T${d.T} ${d.access.title}: ${ARMS.map(a => `${a} ${d.access.answers[a]} (${d.access.tagTrash.parts[a].runner.total})`).join(', ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------- the reading rules
say('\n## The reading rules, as written');
const verdict = (pairs, lo, hi) => (pairs.every(([m, s]) => m + 2 * s < 0) ? lo : pairs.every(([m, s]) => m - 2 * s > 0) ? hi : 'open');
const cl = SELF.map(p => B1[`${p}:clear`]).filter(Boolean);
let clearing = null;
if (cl.length === 2) {
  clearing = verdict(cl.map(x => x.d), 'a kept tag costs less than clearing', 'a kept tag costs more than clearing');
  say(`- **Is clearing right?** (B.1, clear units, (lost less spent) less clearing cost) batch ${r2(cl[0].d[0])} ± ${r2(cl[0].d[1])}, nrdb ${r2(cl[1].d[0])} ± ${r2(cl[1].d[1])}: **${clearing}**.`);
  if (cl.every(x => x.b2)) {
    const b2 = cl.map(x => x.b2);
    const against = clearing === 'a kept tag costs less than clearing' ? b2.every(([m, s]) => m + 2 * s < 0) : clearing === 'a kept tag costs more than clearing' ? b2.every(([m, s]) => m - 2 * s > 0) : false;
    say(`  B.2 beside it (Runner wins, keep less clear): batch ${r2(b2[0][0])} ± ${r2(b2[0][1])}, nrdb ${r2(b2[1][0])} ± ${r2(b2[1][1])}; ${against ? 'beyond two standard errors the other way in both pools: it OVERRULES B.1' : 'does not overrule B.1'}.`);
  }
  for (const [name, k] of [['Runner', 'lrR'], ['Corp', 'lrC']]) {
    const xs = cl.map(x => x[k]);
    const v = xs.map(([m, s]) => (m - 2 * s > 0 ? 'over' : m + 2 * s < 0 ? 'under' : 'within two standard errors'));
    say(`- **Is the clock's input right?** (${name} view: tagLossPerTurn less the realized loss of a kept Corp turn) batch ${r2(xs[0][0])} ± ${r2(xs[0][1])} (${v[0]}), nrdb ${r2(xs[1][0])} ± ${r2(xs[1][1])} (${v[1]}).`);
  }
}
if (tags.length) {
  for (const v of ['runner', 'corp']) {
    for (const [name, f] of [['first', t => t.first], ['later', t => !t.first]]) {
      const res = SELF.map(p => {
        const xs = tags.filter(t => t.pool === p && f(t));
        const kept = B1[`${p}:clear`];
        // The kept tag's realized loss over the clear units of the same split (first or later tag), keep leg, through the Corp's next turn
        const ks = kept ? kept.us.filter(u => (name === 'first' ? u.split.first : !u.split.first)) : [];
        const target = clearing === 'a kept tag costs less than clearing' && ks.length ? mean(ks, u => uMean(u, l => lost(l.keep))) : mean(xs, t => t.cost);
        const dist = Object.fromEntries(ARMS.map(a => [a, Math.abs(mean(xs, t => priceOf(t, a, v)) - target)]));
        const best = ARMS.reduce((b, a) => (dist[a] < dist[b] ? a : b), 'base');
        return { p, n: xs.length, target, dist, best };
      });
      const nearer = ARMS.slice(1).filter(a => res.every(r => r.dist[a] < r.dist.base));
      say(`- **Nearest arm** (${v} view, ${name} tags; the cost is ${clearing === 'a kept tag costs less than clearing' ? `the kept tag's realized loss (B.1 clear units, ${name} tags, keep leg lost)` : "the record's"}): ${res.map(r => `${r.p} (${r.n} tags, cost ${r2(r.target)}) ${r.best} (distances ${ARMS.map(a => `${a} ${r2(r.dist[a])}`).join(', ')})`).join('; ')}. Nearer than base in both self-play pools: ${nearer.join(', ') || 'none'}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------- views.ts (coordinator 06:56Z)
const ws = rows.filter(r => r.kind === 'w');
const ls = rows.filter(r => r.kind === 'l');
if (ws.length) {
  say('\n## Whose clear: the flat score or the planner (views.ts)');
  say('Unit: a Runner main decision of the source game while tagged with a click and 2 credits; a fresh base-tree Runner with the source agent\'s fields ranks (rankMainActions: REMOVE_TAG at its flat score plus the deck nudge) and decides. Flat: the ranking\'s top is REMOVE_TAG and so is the pick. Planner: the pick differs from the ranking\'s top.\n');
  say(head(['pool', 'decisions', 'source clears', 'of them: top REMOVE_TAG (flat)', 'of them: top another, pick REMOVE_TAG (planner)', 'of them: the fresh pick is not REMOVE_TAG', 'not cleared by the source: top REMOVE_TAG, planner picked another', 'REMOVE_TAG\'s mean ranking score']));
  for (const p of SELF) {
    const xs = ws.filter(w => w.pool === p);
    if (!xs.length) continue;
    const cl = xs.filter(w => w.srcPick === 'REMOVE_TAG');
    const no = xs.filter(w => w.srcPick !== 'REMOVE_TAG');
    say(line([p, xs.length, cl.length, cl.filter(w => w.top === 'REMOVE_TAG' && w.pick === 'REMOVE_TAG').length, cl.filter(w => w.top !== 'REMOVE_TAG' && w.pick === 'REMOVE_TAG').length, cl.filter(w => w.pick !== 'REMOVE_TAG').length, no.filter(w => w.top === 'REMOVE_TAG' && w.pick !== 'REMOVE_TAG').length, r2(mean(xs.filter(w => w.tagScore !== null), w => w.tagScore))]));
  }
}
if (ls.length) {
  say('\n## The clock\'s input by arm and view (views.ts)');
  say('Unit: a Runner main decision board with a resource installed. tagLossPerTurn (evaluate.ts:408, skip 0) under each tree and view; tagged boards as they are, untagged boards with one tag added.\n');
  say(head(['pool', 'boards', 'n', 'base R', 'base C', 'resOnly R', 'resOnly C', 'owner R', 'owner C', 'base R = 0 while base C > 0']));
  for (const p of SELF)
    for (const tg of [true, false]) {
      const xs = ls.filter(l => l.pool === p && l.tagged === tg);
      if (!xs.length) continue;
      say(line([p, tg ? 'tagged' : 'untagged + 1 tag', xs.length, ...['base.runner', 'base.corp', 'resOnly.runner', 'resOnly.corp', 'owner.runner', 'owner.corp'].map(k => r2(mean(xs, l => num(l[k])))), xs.filter(l => num(l['base.runner']) === 0 && num(l['base.corp']) > 0).length]));
    }
}
