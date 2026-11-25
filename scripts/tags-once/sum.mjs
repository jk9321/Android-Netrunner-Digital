// Sum of scripts/tags-once/count.ts (brief netrunner-ai/tags-once/brief.md rev 0): node scripts/tags-once/sum.mjs <dir with *.txt> [...]
// Pools are never summed. The reading rule is the brief's, applied as written: (3)'s mean realized cost per tag nearer
// to one tagsWorth than to two in batch and in nrdb, each with at least 30 tags: shown; nearer to two in both: not
// shown; else open. (1) and (2) size it: under 1 changed pick in 10 games is small, at or over 1 a game is large.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const POOLS = ['batch', 'nrdb', 'people', 'issue58'];
const ARMS = ['once', 'onceNoWait', 'onceNoRisk'];
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const sum = (xs, f = x => x) => xs.reduce((n, x) => n + (Number(f(x)) || 0), 0);
const mean = (xs, f) => (xs.length ? sum(xs, f) / xs.length : NaN);
const line = cells => `| ${cells.join(' | ')} |`;
const head = cells => `${line(cells)}\n${line(cells.map(() => '---'))}`;

const games = rows.filter(r => r.kind === 'g');
const decs = rows.filter(r => r.kind === 'd');
const tags = rows.filter(r => r.kind === 'tag');
const errs = rows.filter(r => r.kind === 'err');
console.log(`# tags-once count: sum of ${files.length} files\n`);

console.log('## Checks');
console.log(head(['pool', 'games', 'decisions', 'replays the batch record', 'base pick != source pick (corp / runner)', 'onceR pick != once (of asked)', 'max |evaluate once - onceR|', 'errors']));
for (const p of POOLS) {
  const g = games.filter(x => x.pool === p);
  if (!g.length) continue;
  const c = k => sum(g, x => x.counts[k]);
  const rep = p === 'batch' || p === 'nrdb' ? `${g.filter(x => x.matchesBatch).length}/${g.length}` : p === 'people' ? `${g.filter(x => !x.err).length}/${g.length} replay to the end` : '-';
  console.log(line([p, g.length, sum(g, x => x.decisions), rep, `${c('baseDiffers corp')} / ${c('baseDiffers runner')}`, `${c('onceR differs from once')} of ${c('onceR asked')}`, Math.max(...g.map(x => x.evMax)).toExponential(2), errs.filter(e => e.pool === p).length]));
}
for (const e of errs) console.log(`- err ${e.pool} ${e.src}: ${String(e.error).slice(0, 200)}`);

const KINDS = { corp: ['main', 'rez', 'prompt'], runner: ['main', 'run', 'prompt', 'offTurn'] };
for (const side of ['corp', 'runner']) {
  console.log(`\n## (${side === 'corp' ? 1 : 2}) ${side === 'corp' ? 'Corp' : 'Runner'} decisions: changed picks against base`);
  console.log('Unit: one decision the source game asks of the agent (GameRunner.step). Per pool; "per game" = changed picks / games; "tag board" = a tag in play or a tag-giving card in HQ or on the Corp board.\n');
  console.log(head(['pool', 'kind', 'decisions', 'on tag boards', ...ARMS.flatMap(a => [`${a} changed`, `${a} per game`, `${a} on tag boards`])]));
  for (const p of POOLS) {
    const g = games.filter(x => x.pool === p);
    if (!g.length) continue;
    const c = k => sum(g, x => x.counts[k]);
    for (const kind of [...KINDS[side], 'all']) {
      const ks = kind === 'all' ? KINDS[side] : [kind];
      const n = sum(ks, k => c(`n ${side}:${k}`));
      const ntb = sum(ks, k => c(`n ${side}:${k} tagBoard`));
      const cells = ARMS.flatMap(a => {
        const ch = sum(ks, k => c(`ch ${a} ${side}:${k}`));
        const chtb = sum(ks, k => c(`ch ${a} ${side}:${k} tagBoard`));
        return [ch, r2(ch / g.length), chtb];
      });
      console.log(line([p, kind, n, ntb, ...cells]));
    }
  }
  console.log('\nSize (all kinds, by the brief: under 1 changed pick in 10 games small, at or over 1 a game large, between: neither):');
  for (const p of POOLS) {
    const g = games.filter(x => x.pool === p);
    if (!g.length) continue;
    for (const a of ARMS) {
      const ch = sum(KINDS[side], k => sum(g, x => x.counts[`ch ${a} ${side}:${k}`]));
      const pg = ch / g.length;
      console.log(`- ${p} ${a}: ${r2(pg)} a game, ${pg < 0.1 ? 'small' : pg >= 1 ? 'large' : 'between small and large'}`);
    }
  }
}

console.log('\n## (2) access_trash answers that flip, by card');
for (const [label, f] of [
  ['every access_trash decision', d => d.access],
  ['the 150 declined trashes of the decided-twice count (batch, nrdb)', d => d.access?.d150],
  ['issue #58 board (T3 to T6)', d => d.access && d.pool === 'issue58'],
]) {
  const xs = decs.filter(f);
  console.log(`\n### ${label}: ${xs.length} answers`);
  console.log(head(['pool', 'card', 'answers', 'base trash', ...ARMS.flatMap(a => [`${a} keep>trash`, `${a} trash>keep`])]));
  for (const [k, ys] of Object.entries(by(xs, d => `${d.pool}|${d.access.title}`)).sort((a, b) => b[1].length - a[1].length)) {
    const [p, t] = k.split('|');
    const cells = ARMS.flatMap(a => [ys.filter(d => d.access.answers.base === 'keep' && d.access.answers[a] === 'trash').length, ys.filter(d => d.access.answers.base === 'trash' && d.access.answers[a] === 'keep').length]);
    if (label.startsWith('every') && cells.every(x => x === 0)) continue;
    console.log(line([p, t, ys.length, ys.filter(d => d.access.answers.base === 'trash').length, ...cells]));
  }
  if (label.startsWith('every')) console.log('(cards with no flip left out of this table)');
}
const d150 = decs.filter(d => d.access?.d150);
console.log(`\nDeclined-150 entries met in this run: ${d150.length} (the list has 158 entries over the 150 units). Of them base answers keep: ${d150.filter(d => d.access.answers.base === 'keep').length}.`);


console.log('\n## (2, rev 1) Where a tag sits in evaluate: the change for one more tag, in parts');
console.log('Boards: every access whose trash gives a tag (the access board), and every board a tag was taken from (count 3). The board with one more tag and nothing else, base tree, the viewer\'s context; each part signed as it enters evaluate(·, viewer). rig by card: addRigCard from 0; its payoutWait part = the card\'s change less its change with the tagged risk off (onceNoWait tree).\n');
const PARTS = ['total', 'tagsRunner', 'tagsCorp', 'rig', 'payoutWait', 'perTurn', 'rigRest', 'runnerCredits', 'runnerHand', 'corpCredits', 'corpHand', 'corpBoard', 'unsplit'];
const splitRows = (label, xs) => {
  for (const view of ['runner', 'corp']) {
    const ys = xs.map(x => x[view]).filter(Boolean);
    if (!ys.length) continue;
    console.log(line([label, view, ys.length, ...PARTS.map(k => r2(mean(ys, y => y[k])))]));
  }
};
console.log(head(['boards', 'view', 'n', ...PARTS.map(k => `mean ${k}`)]));
for (const p of POOLS) {
  splitRows(`${p}: tag-giving accesses`, decs.filter(d => d.pool === p && d.access?.tagTrash).map(d => d.access.tagTrash));
  splitRows(`${p}: tags taken`, tags.filter(t => t.pool === p && t.split).map(t => t.split));
}
console.log('\nRig parts by card (Runner view; sum over boards, and boards it moved on), tag-giving accesses and tags taken together, per pool:');
for (const p of POOLS) {
  const all = [...decs.filter(d => d.pool === p && d.access?.tagTrash).map(d => d.access.tagTrash.runner), ...tags.filter(t => t.pool === p && t.split).map(t => t.split.runner)];
  const cards = {};
  for (const x of all) for (const [k, v] of Object.entries(x.byCard ?? {})) {
    const name = k.replace(/ inst-\d+$/, '');
    const c = (cards[name] ??= { n: 0, all: 0, payoutWait: 0, perTurn: 0, other: 0 });
    c.n++;
    c.all += v.all;
    c.payoutWait += v.payoutWait;
    c.perTurn += v.perTurn;
    c.other += v.other;
  }
  const top = Object.entries(cards).sort((a, b) => a[1].all - b[1].all).slice(0, 8);
  if (top.length) console.log(`- ${p} (${all.length} boards): ${top.map(([k, c]) => `${k} ${r2(c.all)} on ${c.n} (payoutWait ${r2(c.payoutWait)}, perTurn ${r2(c.perTurn)}, other ${r2(c.other)})`).join('; ')}`);
}
console.log('\nIssue #58 board, each access of the Plaza (Runner view): T, total, tagsRunner, tagsCorp, rig (payoutWait), rig by card');
for (const d of decs.filter(x => x.pool === 'issue58' && x.access?.tagTrash)) {
  const r = d.access.tagTrash.runner;
  console.log(`- T${d.T} ${d.access.title}: total ${r.total}, tags ${r.tagsRunner} + ${r.tagsCorp}, rig ${r.rig} (payoutWait ${r.payoutWait}, perTurn ${r.perTurn}, rest ${r.rigRest}), corpBoard ${r.corpBoard}, unsplit ${r.unsplit}; ${Object.entries(r.byCard).map(([k, v]) => `${k} ${v.all} (pw ${v.payoutWait}, perTurn ${v.perTurn})`).join(', ')}; answers ${JSON.stringify(d.access.answers)}`);
}

console.log('\n## (3) The record as the oracle: what each tag the Runner took then cost');
console.log('Unit: one tag taken (each +1 to the Runner\'s tags). cost = what the clearing spent (clicks and credits at base\'s rates on that board) + the share of each loss while it was open (a resource the Corp trashed, by tagLoss\'s owner; a tag punisher, the Runner\'s strength drop without its tag term). net = the loss less what the Corp paid for it. priced = tagsWorth of that tag on the board it was taken from (marginal, as runs.ts tagCost), each view.\n');
console.log(head(['pool', 'tags', 'cleared', 'other removal', 'kept to end', 'with a loss', 'mean cost', 'mean net', 'mean priced (Runner view)', 'x2', 'whole change of evaluate (Runner view)', 'mean priced (Corp view)', 'x2', 'whole change (Corp view)', 'Runner view: nearer', 'Corp view: nearer']));
const verdicts = {};
for (const p of POOLS) {
  const xs = tags.filter(t => t.pool === p);
  if (!xs.length) continue;
  const cost = mean(xs, t => t.cost);
  const net = mean(xs, t => t.net);
  const pr = mean(xs, t => t.priced.runner);
  const pc = mean(xs, t => t.priced.corp);
  const near = w => (Math.abs(cost - w) < Math.abs(cost - 2 * w) ? 'one' : Math.abs(cost - w) > Math.abs(cost - 2 * w) ? 'two' : 'tie');
  // The whole change of evaluate for one more tag, as a price (the Runner's evaluate falls by it; the Corp's rises)
  const wr = mean(xs.filter(t => t.split), t => -t.split.runner.total);
  const wc = mean(xs.filter(t => t.split), t => t.split.corp.total);
  verdicts[p] = { n: xs.length, runner: near(pr), corp: near(pc), cost, wr, wc, split: xs.filter(t => t.split).map(t => t.split) };
  console.log(
    line([
      p,
      xs.length,
      xs.filter(t => t.end === 'cleared').length,
      xs.filter(t => t.end.startsWith('removed')).length,
      xs.filter(t => t.end.startsWith('kept')).length,
      xs.filter(t => t.how.length).length,
      r2(cost),
      r2(net),
      r2(pr),
      r2(2 * pr),
      r2(wr),
      r2(pc),
      r2(2 * pc),
      r2(wc),
      `${near(pr)} (|c-W| ${r2(Math.abs(cost - pr))}, |c-2W| ${r2(Math.abs(cost - 2 * pr))})`,
      `${near(pc)} (|c-W| ${r2(Math.abs(cost - pc))}, |c-2W| ${r2(Math.abs(cost - 2 * pc))})`,
    ])
  );
}
console.log('\nBy end and by what gave the tag (per pool):');
for (const p of POOLS) {
  const xs = tags.filter(t => t.pool === p);
  if (!xs.length) continue;
  const ends = Object.entries(by(xs, t => t.end)).map(([k, v]) => `${k} ${v.length} (mean cost ${r2(mean(v, t => t.cost))}, priced R ${r2(mean(v, t => t.priced.runner))})`);
  const gives = Object.entries(by(xs, t => t.by)).map(([k, v]) => `${k} ${v.length}`);
  const losses = Object.entries(by(xs.flatMap(t => t.how), h => h.split(':')[0])).map(([k, v]) => `${k} ${v.length}`);
  console.log(`- ${p}: ends ${ends.join('; ')}. given by ${gives.join(', ')}. loss events seen by open tags: ${losses.join(', ') || 'none'}`);
}
console.log('\nReading (the brief\'s rule, applied to each view):');
for (const view of ['runner', 'corp']) {
  const b = verdicts.batch;
  const n = verdicts.nrdb;
  let v;
  if (!b || !n || b.n < 30 || n.n < 30) v = `open: under 30 tags in ${!b || b.n < 30 ? 'batch' : 'nrdb'}`;
  else if (b[view] === 'one' && n[view] === 'one') v = 'SHOWN (nearer one tagsWorth in batch and nrdb)';
  else if (b[view] === 'two' && n[view] === 'two') v = 'NOT SHOWN (nearer two in both)';
  else v = `open: batch nearer ${b[view]}, nrdb nearer ${n[view]}`;
  console.log(`- ${view} view: ${v}`);
}

for (const view of ['runner', 'corp']) {
  const b = verdicts.batch;
  const n = verdicts.nrdb;
  if (!b || !n) continue;
  const w = view === 'runner' ? 'wr' : 'wc';
  const over = b[w] > 2 * b.cost && n[w] > 2 * n.cost;
  // The largest part (mean over both pools' tag boards, as it enters the price)
  const sg = view === 'runner' ? -1 : 1;
  const ps = ['tagsRunner', 'tagsCorp', 'rig', 'runnerCredits', 'runnerHand', 'corpCredits', 'corpHand', 'corpBoard', 'unsplit'].map(k => [k, mean([...b.split, ...n.split].map(x => x[view]), y => sg * y[k])]).sort((x, y) => y[1] - x[1]);
  console.log(`- ${view} view, as a whole (rev 1 line): whole change batch ${r2(b[w])} v 2 x cost ${r2(2 * b.cost)}, nrdb ${r2(n[w])} v ${r2(2 * n.cost)}: ${over ? 'OVERPRICED AS A WHOLE' : 'not overpriced as a whole'}; largest part ${ps[0][0]} ${r2(ps[0][1])} (then ${ps.slice(1, 3).map(([k, v]) => `${k} ${r2(v)}`).join(', ')})`);
}

console.log('\n## (4) Time: ms per ask, summed, per arm');
console.log(head(['pool', 'base', 'once', 'onceNoWait', 'onceNoRisk', 'once / base', 'onceNoWait / base', 'onceNoRisk / base', 'onceR (every 10th)']));
for (const p of POOLS) {
  const g = games.filter(x => x.pool === p);
  if (!g.length) continue;
  const m = a => sum(g, x => x.ms[a]);
  console.log(line([p, m('base'), m('once'), m('onceNoWait'), m('onceNoRisk'), r2(m('once') / m('base')), r2(m('onceNoWait') / m('base')), r2(m('onceNoRisk') / m('base')), m('onceR')]));
}
