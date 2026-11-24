/**
 * R-27 Part 4: sums host-prompts.ts output (JSON lines) per pool, never across pools.
 *   node scripts/runner-rework/host-prompts-sum.mjs <file or dir> [...]
 * Rows (brief i67-i68-pins-count.md): 1 prompts met by card and by effect; 2 two or more answers equal at the top (1e-9);
 * 3 a second copy on a host that has one while another legal host has none; 4 facedown picks, picks off the owner's first;
 * 5 the step before: the install action's own score for the card on its best host at the card-choice board.
 * Under 10 prompts in a pool: "not shown" for its rates (the reading rule); counts are always given.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (p.endsWith('.txt') || p.endsWith('.jsonl')) files.push(p);
};
for (const a of process.argv.slice(2)) walk(a);
const lines = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* not a record */
    }
  }

const games = lines.filter(x => x.kind === 'g');
const files_ = lines.filter(x => x.kind === 'h');
console.log(`source check: ${games.length} self-play games, ${games.filter(g => g.matchesBatch).length} match the batch record; ${files_.length} files replayed, ${files_.filter(h => h.stopped).length} stopped early (${files_.filter(h => h.stopped).map(h => h.src).join(', ') || 'none'})`);
for (const g of games.filter(g => !g.matchesBatch)) console.log(`  MISMATCH ${g.src}`);

const tally = (xs, f) => {
  const m = new Map();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ') || '-';
};
const rate = (n, d) => (d < 10 ? 'not shown' : `${((100 * n) / d).toFixed(1)}%`);

const POOLS = ['batch', 'nrdb', 'human', 'issues'];
for (const pool of POOLS) {
  const all = lines.filter(x => x.kind === 'hp' && x.pool === pool);
  const groups = pool === 'human' ? ['humanRunner', 'humanCorp'] : [null];
  for (const sk of groups) {
    const hp = sk ? all.filter(x => x.sk === sk) : all;
    const label = sk ? `${pool} (${sk === 'humanRunner' ? 'a person as the Runner: picks are the person\'s' : 'our Runner against a person'})` : pool;
    const n = hp.length;
    console.log(`\n## ${label}: ${n} effect host prompts${n < 10 ? ' (under 10: rates not shown)' : ''}`);
    if (!n) continue;
    const games = new Set(hp.map(x => x.src)).size;
    console.log(`row 1 by card: ${tally(hp, x => x.card)}`);
    console.log(`row 1 by effect: ${tally(hp, x => x.effect)}   (${games} games)`);
    console.log(`      options per prompt: ${tally(hp, x => x.n)}; eval Runner's pick = played: ${hp.filter(x => x.agree === true).length} of ${hp.filter(x => x.agree !== null).length}`);
    const tied = hp.filter(x => x.tiedTop >= 2);
    console.log(`row 2 two or more answers equal at the top: ${tied.length} of ${n} (${rate(tied.length, n)}); of these the played pick is the first listed of the tied: ${tied.filter(x => x.played === x.options.find(o => Math.abs((o.score ?? -1e18) - Math.max(...x.options.map(p => p.score ?? -1e18))) <= 1e-9)?.id).length}`);
    const multi = hp.filter(x => x.n >= 2);
    console.log(`      (prompts with 2+ options: ${multi.length}; all options scored: ${hp.filter(x => x.scored === x.n).length})`);
    const second = hp.filter(x => x.second);
    const couldSecond = hp.filter(x => x.options.some(o => o.same > 0) && x.options.some(o => o.same === 0));
    console.log(`row 3 second copy on a host that has one while another hosts none: ${second.length} of ${n} (${rate(second.length, n)}); boards where that was possible: ${couldSecond.length}`);
    const hostOf = x => x.options.find(o => o.id === (x.played ?? x.evalPick));
    console.log(`      host that got the second copy: rezzed ${second.filter(x => hostOf(x)?.rezzed).length}, facedown ${second.filter(x => hostOf(x) && !hostOf(x).rezzed).length}`);
    for (const x of second) console.log(`      ${x.src} T${x.T} ${x.card} via ${x.effect}, host ${hostOf(x)?.rezzed ? 'rezzed' : 'facedown'}`);
    const fd = hp.filter(x => x.facedown === true);
    const owned = hp.filter(x => x.differsFromOwner !== null);
    const one = owned.filter(x => x.ownerFirst.length === 1);
    const oneIs = one.filter(x => !x.differsFromOwner);
    const none = owned.filter(x => x.ownerFirst.length >= 2);
    console.log(`row 4 facedown picks: ${fd.length} of ${n} (${rate(fd.length, n)})`);
    console.log(`      owner prices the card (a trojan): ${owned.length}; no owner (not a trojan the owner prices): ${n - owned.length} (${tally(hp.filter(x => x.differsFromOwner === null), x => x.card)})`);
    console.log(`      (a) owner ranks one host first and the pick is it: ${oneIs.length}; (b) owner ranks one host first and the pick is another: ${one.length - oneIs.length}; (c) owner ranks no host first (its top hosts equal): ${none.length}`);
    for (const x of one.filter(x => x.differsFromOwner)) console.log(`      (b) ${x.src} T${x.T} ${x.card}: pick ${x.played ?? x.evalPick}, owner first ${x.ownerFirst.join(',')}`);
    for (const x of none) console.log(`      (c) ${x.src} T${x.T} ${x.card}: ${x.ownerFirst.length} hosts at owner ${x.options.find(o => o.id === x.ownerFirst[0])?.owner}, all facedown ${x.options.every(o => !o.rezzed)}`);
    const st = hp.filter(x => x.before);
    const scored = st.filter(x => typeof x.before.score === 'number');
    console.log(`row 5 card chosen by the effect one step before: ${st.length} of ${n}; action path not available there: ${tally(st.filter(x => !(typeof x.before.score === 'number')), x => x.before.why)}`);
    console.log(`      scored: ${scored.length}; install score < 0 (worse than not installing): ${scored.filter(x => x.before.score < 0).length}; best host facedown: ${scored.filter(x => x.before.hostRezzed === false).length}; ranked first: ${scored.filter(x => x.before.rank === 1).length}`);
    for (const x of scored) console.log(`      ${x.src} T${x.T} ${x.card} via ${x.effect}: score ${x.before.score}, rank ${x.before.rank}/${x.before.of}, host rezzed ${x.before.hostRezzed}, top ${x.before.top?.type} ${x.before.top?.score}${x.before.moved ? `, card moved from ${x.before.moved}` : ''}`);
  }
}
