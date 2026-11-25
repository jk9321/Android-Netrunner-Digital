/**
 * R-B O1b: the sums of trash-readers.ts (brief netrunner-ai/runner-rework/briefs/o1b-trash-readers-count.md rev 0).
 *
 *   node scripts/runner-rework/trash-readers-sum.mjs <dir-or-files...> [--select=K --out=pairs.json] [--md=sum.md]
 *
 * Reads every *.jsonl / *.txt / *.log line that is a JSON record (`a` access, `g` deal, `h` file, `p` pair, `err`, `s`).
 * Pools apart, never added. --select writes the pairs list: every access where the readers disagree (every class, every
 * pool but fixtures) and every K-th agreeing access by deal and turn within its pool (the order: source as listed in the
 * pool, then turn, then the access's index in the game).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const inputs = args.filter(a => !a.startsWith('--'));
const files = inputs.flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
function walk(d) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(jsonl|txt|log|out)$/.test(f) ? [p] : [];
  });
}
const recs = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      recs.push(JSON.parse(line));
    } catch {
      /* not a record */
    }
  }
const POOLS = ['batch', 'nrdb', 'people', 'fixtures'];
const CLASSES = ['C', 'Z', 'L', 'F', 'R'];
const SUSPECT = ['The Holo Man', 'Mahkota Langit Grid', 'Malapert Data Vault'];
const DIRS = ['bothTrash', 'bothKeep', 'priceTrash/decisionKeep', 'priceKeep/decisionTrash'];
const lines = [];
const say = s => lines.push(s);
const median = xs => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 1000) / 1000;
};
const mean = xs => xs.reduce((n, x) => n + x, 0) / xs.length;
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const seedOf = src => Number(String(src).split(':')[1]);

// A re-read (kind a2, the pairs run) replaces the count's record of the same access (fields added after the count)
const a2 = new Map(recs.filter(r => r.kind === 'a2').map(r => [r.key, r]));
const acc = recs.filter(r => r.kind === 'a').map(r => (a2.has(r.key) ? { ...a2.get(r.key), kind: 'a', reread: true } : r));
const errs = recs.filter(r => r.kind === 'err');
const games = recs.filter(r => r.kind === 'g');
const heads = recs.filter(r => r.kind === 'h');
say(`# O1b trash readers: sums`);
say(`Records: ${acc.length} accesses, ${games.length} deals, ${heads.length} files/fixtures, ${recs.filter(r => r.kind === 'p').length} pairs, ${errs.length} errors.`);
for (const pool of ['batch', 'nrdb']) {
  const g = games.filter(x => x.pool === pool);
  if (g.length) say(`- ${pool}: ${g.length} deals, ${g.filter(x => x.matchesBatch).length} equal to the batch's records (winner, cr, sc)${g.some(x => 'plainSame' in x) ? `, plain tree same ${g.filter(x => x.plainSame).length}` : ''}.`);
}
const ppl = heads.filter(x => x.pool === 'people');
if (ppl.length) say(`- people: ${ppl.length} files, ${ppl.reduce((n, x) => n + x.accessAnswers, 0)} recorded access_trash answers, ${ppl.reduce((n, x) => n + x.units, 0)} units.`);
if (errs.length) say(`- errors: ${errs.slice(0, 5).map(e => `${e.pool}:${e.src}#${e.idx ?? ''} ${String(e.error).slice(0, 80)}`).join(' | ')}`);
const noAdd = acc.filter(a => a.parts && a.parts.adds === false);
const missing = acc.filter(a => a.parts?.missing);
say(`- parts add up (0.001): ${acc.filter(a => a.parts?.adds).length} of ${acc.length}; not adding ${noAdd.length}; parts missing ${missing.length}${missing.length ? ` (${[...new Set(missing.flatMap(a => a.parts.missing))].join(', ')})` : ''}.`);
const selfPlay = acc.filter(a => a.pool === 'batch' || a.pool === 'nrdb' || a.pool === 'fixtures');
say(`- the decision recomputed on the eval tree picks the answer made: ${selfPlay.filter(a => a.pickMatches).length} of ${selfPlay.length} (self-play and fixtures).`);

for (const pool of POOLS) {
  const A = acc.filter(a => a.pool === pool);
  if (!A.length) continue;
  say(`\n## Pool ${pool} (unit: one affordable access of a root card by the deciding Runner${pool === 'people' ? ', the person; readers asked on a copy' : ''}): ${A.length}`);
  say(`| class | n | bothTrash | bothKeep | priceTrash/decisionKeep | priceKeep/decisionTrash | answer made: trash |`);
  say(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const c of CLASSES) {
    const x = A.filter(a => a.cls === c);
    say(`| ${c} | ${x.length} | ${DIRS.map(d => x.filter(a => a.dir === d).length).join(' | ')} | ${x.filter(a => a.answerTrash).length} |`);
    // The three cards whose worth as left is itself at fault (O1a's red team, findings 1 to 3), apart inside the class
    for (const t of SUSPECT) {
      const y = x.filter(a => a.card === t);
      if (y.length) say(`| ${c}, of them ${t} | ${y.length} | ${DIRS.map(d => y.filter(a => a.dir === d).length).join(' | ')} | ${y.filter(a => a.answerTrash).length} |`);
    }
    for (const [n, y] of [['rezzed', x.filter(a => a.rezzed)], ['seen', x.filter(a => !a.rezzed)]]) if (y.length) say(`| ${c}, ${n} | ${y.length} | ${DIRS.map(d => y.filter(a => a.dir === d).length).join(' | ')} | ${y.filter(a => a.answerTrash).length} |`);
    const z = x.filter(a => !SUSPECT.includes(a.card));
    if (z.length !== x.length) say(`| ${c}, without the three | ${z.length} | ${DIRS.map(d => z.filter(a => a.dir === d).length).join(' | ')} | ${z.filter(a => a.answerTrash).length} |`);
  }
  say(`Trash cost: printed and engine differ on ${A.filter(a => a.costDiffers).length} accesses (${[...new Set(A.filter(a => a.costDiffers).map(a => a.cls))].join(', ') || 'none'}). One credit, medians: the price's Runner slide ${median(A.map(a => a.perCredit?.priceRunner))}, the decision's Runner credit term ${median(A.map(a => a.perCredit?.decisionRunner))}, the Corp's worth as left per hosted credit ${median(A.map(a => a.perCredit?.corpLeftPerHosted))} (cards with hosted credits, n ${A.filter(a => a.perCredit?.corpLeftPerHosted !== null && a.perCredit?.corpLeftPerHosted !== undefined).length}).`);
  const sub = (c, k) => A.filter(a => a.cls === c && (a.sub ?? '').split('+').includes(k)).length;
  say(`C by kind: tag ${sub('C', 'tag')}, damage ${sub('C', 'damage')}, corpGain ${sub('C', 'corpGain')}. Z: Z1 (under the cheapest grip card it could pay) ${A.filter(a => a.cls === 'Z' && a.z1).length}, Z2 (0 to 1 credits) ${A.filter(a => a.cls === 'Z' && a.z2).length}, both ${A.filter(a => a.cls === 'Z' && a.z1 && a.z2).length}. Accesses with an alternative answer: ${A.filter(a => a.alternatives).length}. Trash floor applied: ${A.filter(a => a.price.floor).length}.`);
  // Parts medians per class
  const keys = ['card', 'corpBoardRest', 'credits', 'rig', 'grip', 'tagsRunner', 'tagsCorp', 'damage', 'runRest', 'corpCredits', 'corpHand', 'other', 'total'];
  say(`\nParts of the decision's margin (trash board less keep board), medians, and the price:`);
  say(`| class | n | ${keys.join(' | ')} | price raw | cvLeft | cvDefault | creditCost |`);
  say(`|---|---:|${keys.map(() => '---:').join('|')}|---:|---:|---:|---:|`);
  for (const c of CLASSES) {
    const x = A.filter(a => a.cls === c && a.parts && !a.parts.missing);
    if (!x.length) continue;
    say(`| ${c} | ${x.length} | ${keys.map(k => median(x.map(a => a.parts[k]))).join(' | ')} | ${median(x.map(a => a.price.raw))} | ${median(x.map(a => a.price.cvLeft))} | ${median(x.map(a => a.price.cvDefault))} | ${median(x.map(a => a.price.creditCost))} |`);
  }
  if (pool === 'people') {
    say(`\nThe people's shares: of the person's answers in each class, the share each reader agrees with (a class under 10 is "not shown").`);
    say(`| class | n | person trashed | price agrees | decision agrees | read |`);
    say(`|---|---:|---:|---:|---:|---|`);
    for (const [c, x] of CLASSES.flatMap(c => [
      [c, A.filter(a => a.cls === c)],
      [`${c}, rezzed`, A.filter(a => a.cls === c && a.rezzed)],
      [`${c}, seen`, A.filter(a => a.cls === c && !a.rezzed)],
      [`${c} without report-33 (Hard Corp)`, A.filter(a => a.cls === c && !a.hardCorp)],
      [`${c} without report-33, rezzed`, A.filter(a => a.cls === c && !a.hardCorp && a.rezzed)],
      [`${c} without report-33, seen`, A.filter(a => a.cls === c && !a.hardCorp && !a.rezzed)],
    ])) {
      if (!x.length) continue;
      const pa = x.filter(a => a.priceTrash === a.answerTrash).length / x.length;
      const da = x.filter(a => a.decisionTrash === a.answerTrash).length / x.length;
      const read = x.length < 10 ? 'not shown' : pa < 0.5 && da > 2 / 3 ? 'price shown wrong' : da < 0.5 && pa > 2 / 3 ? 'decision shown wrong' : 'neither shown wrong';
      say(`| ${c} | ${x.length} | ${x.filter(a => a.answerTrash).length} | ${(pa * 100).toFixed(0)}% | ${(da * 100).toFixed(0)}% | ${read} |`);
    }
  }
  const tagged = A.filter(a => a.rigSplit);
  if (tagged.length) {
    const by = new Map();
    for (const a of tagged) for (const [k, v] of Object.entries(a.rigSplit.byCard)) {
      const name = k.replace(/ inst-\d+$/, '');
      by.set(name, [...(by.get(name) ?? []), v]);
    }
    say(`\nThe rig term on the ${tagged.length} accesses whose trash gives a tag, by rig card (its own term, trash board less keep board): ${[...by].sort((a, b) => a[1].reduce((n, v) => n + v, 0) - b[1].reduce((n, v) => n + v, 0)).map(([k, v]) => `${k} n ${v.length} median ${median(v)}`).join('; ')}; rest (coverage, plans) median ${median(tagged.map(a => a.rigSplit.rest))}. Tag terms beside it, medians: Runner's ${median(tagged.map(a => a.parts.tagsRunner))}, Corp's ${median(tagged.map(a => a.parts.tagsCorp))}, rig ${median(tagged.map(a => a.parts.rig))}.`);
  }
  say(`\nFirst five records of each class with at least five (by deal and turn):`);
  for (const c of CLASSES) {
    const x = A.filter(a => a.cls === c).sort((a, b) => order(a) - order(b) || a.T - b.T || a.idx - b.idx);
    if (x.length < 5) continue;
    for (const a of x.slice(0, 5))
      say(`- ${c} ${a.src} T${a.T} #${a.idx}: ${a.card} (${a.rezzed ? 'rezzed' : 'seen'}, trash ${a.printedCost}${a.costDiffers ? `/engine ${a.engineCost}` : ''}, hosted ${a.hosted}${a.profiled ? ', profiled' : ''}) cr ${a.credits} -> ${a.creditsAfter}, clicks ${a.clicks}, tags ${a.tags}; price raw ${a.price.raw} (left ${a.price.cvLeft}, default ${a.price.cvDefault}, cost ${a.price.creditCost}); decision ${a.decision.trash} v ${a.decision.keep} (${a.decision.margin}); ${a.dir}; made ${a.answer}; trash did ${a.conseq.kinds.join('+')}${a.conseq.lines?.length ? ` (${a.conseq.lines.join('; ')})` : ''}${a.sub ? `; ${a.sub}` : ''}; parts ${a.parts && !a.parts.missing ? Object.entries(a.parts).filter(([k, v]) => typeof v === 'number' && v !== 0 && k !== 'total').map(([k, v]) => `${k} ${v}`).join(', ') : JSON.stringify(a.parts)}`);
  }
}
function order(a) {
  const s = seedOf(a.src);
  return Number.isFinite(s) ? s : 0;
}

// The pairs
const P = recs.filter(r => r.kind === 'p');
if (P.length) {
  say(`\n## The pairs (both answers played on to the end of the game; per access the mean over its seeds, then the mean over accesses with its standard error; trash minus keep)`);
  say(`| pool | class | direction | n | seeds | Runner wins | SE | point margin (Runner less Corp) | SE | T+2 money (Runner less Corp credits) | SE | shown (2 SE) | Corp credits at T+2 | Runner credits at T+2 | Corp scored by T+2 | Runner stole by T+2 | card's payouts taken by T+2 |`);
  say(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|`);
  for (const pool of POOLS)
    for (const c of CLASSES)
      for (const d of [...DIRS, 'agree']) {
       for (const rz of ['all', 'rezzed', 'seen']) {
        const x = P.filter(p => p.pool === pool && p.cls === c && (rz === 'all' || (rz === 'rezzed') === !!p.rezzed) && (d === 'agree' ? p.dir === 'bothTrash' || p.dir === 'bothKeep' : p.dir === d));
        if (!x.length || (d !== 'agree' && (d === 'bothTrash' || d === 'bothKeep'))) continue;
        if (rz !== 'all' && x.length === P.filter(p => p.pool === pool && p.cls === c && (d === 'agree' ? p.dir === 'bothTrash' || p.dir === 'bothKeep' : p.dir === d)).length) continue;
        const per = f => x.map(p => mean(p.pairs.map(f)));
        const win = per(q => (q.trash.w === 'runner' ? 1 : 0) - (q.keep.w === 'runner' ? 1 : 0));
        const mar = per(q => q.trash.rp - q.trash.cp - (q.keep.rp - q.keep.cp));
        const at = k => mean(per(q => q.trash.at2[k] - q.keep.at2[k]));
        const money = per(q => q.trash.at2.rc - q.trash.at2.cc - (q.keep.at2.rc - q.keep.at2.cc));
        const shown = (m, s) => (x.length < 10 ? 'not shown (n<10)' : Math.abs(m) > 2 * s ? 'SHOWN' : 'not shown');
        say(`| ${pool} | ${c}${rz === 'all' ? '' : `, ${rz}`} | ${d} | ${x.length} | ${x[0].pairs.length} | ${f3(mean(win))} | ${f3(se(win))} | ${f3(mean(mar))} | ${f3(se(mar))} | ${f3(mean(money))} | ${f3(se(money))} | wins ${shown(mean(win), se(win))}; margin ${shown(mean(mar), se(mar))}; money ${shown(mean(money), se(money))} | ${f3(at('cc'))} | ${f3(at('rc'))} | ${f3(at('cs'))} | ${f3(at('rs'))} | ${f3(at('payout'))} |`);
       }
      }
}

if (opt('select')) {
  const K = Number(opt('select'));
  const sel = [];
  for (const pool of ['batch', 'nrdb', 'people']) {
    const A = acc.filter(a => a.pool === pool).sort((a, b) => order(a) - order(b) || String(a.src).localeCompare(String(b.src)) || a.T - b.T || a.idx - b.idx);
    let n = 0;
    for (const a of A) {
      const reread = a.cls === 'C' && (a.sub ?? '').includes('tag') ? { reread: true } : {};
      if (!a.agree) sel.push({ key: a.key, pool, cls: a.cls, dir: a.dir, card: a.card, rezzed: a.rezzed, ...reread });
      else if (n++ % K === 0) sel.push({ key: a.key, pool, cls: a.cls, dir: a.dir, card: a.card, rezzed: a.rezzed, control: true, ...reread });
      else if (reread.reread) sel.push({ key: a.key, pool, cls: a.cls, dir: a.dir, card: a.card, rezzed: a.rezzed, pairs: false, reread: true });
    }
  }
  writeFileSync(opt('out') ?? 'scripts/runner-rework/trash-readers-pairs.json', JSON.stringify(sel, null, 0) + '\n');
  say(`\nPairs selected: ${sel.filter(x => x.pairs !== false).length} (${sel.filter(x => !x.control && x.pairs !== false).length} disagreeing, ${sel.filter(x => x.control).length} controls, k=${K}); re-reads of tag accesses ${sel.filter(x => x.reread).length}; by pool: ${['batch', 'nrdb', 'people'].map(p => `${p} ${sel.filter(x => x.pool === p).length}`).join(', ')}.`);
}
const text = lines.join('\n');
if (opt('md')) writeFileSync(opt('md'), text + '\n');
console.log(text);
