// R0 count 2 (Runner ranking cost): sums the output of scripts/runner-rework/rank-cost.ts (PART C, D or X).
//   node scripts/runner-rework/rank-cost-sum.mjs <dir with *.txt shard outputs> [more dirs] > sum.md
// Source kinds are kept apart: self; human = every human file but the cuts report-40b and report-40c (their boards are
// report-40's), with the people's Runner games (hr, hrHard) and Corp games (hcHard, hcNormal) apart where it matters.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.txt')) files.push(p);
  }
};
for (const d of process.argv.slice(2)) walk(d);
const rows = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const p = (...x) => console.log(...x);
const f1 = x => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : '-');
const f2 = x => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(2) : '-');
const f3 = x => (Number.isFinite(x) ? (Math.round(x * 1000) / 1000).toFixed(3) : '-');
const pc = x => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const CUT = /report-40[bc]\.json/;
const isHuman = r => r.sk !== 'self';
const group = r => (r.sk === 'self' ? 'self' : 'human');

const mem = rows.filter(r => r.k === 'mem');
const part = mem[0]?.part ?? '?';
const corp = rows.filter(r => r.k === 'c');
const runner = rows.filter(r => r.k === 'r');
const games = rows.filter(r => r.k === 'g');
// ASKED order as the script builds it
const ASKED = (() => {
  const any = corp[0] ?? runner[0];
  if (!any) return [];
  const n = any.ms.length;
  if (part === 'C') return ['beta', 'control', 'promptOpen', 'promptOwner', 'deckRoot', 'plainOwners', 'plainOwnersClick', 'hostedRule'].slice(0, n);
  if (part === 'D') return ['beta', 'dBigHand', 'dDigBreakers', 'dDigValue', 'dTrojan', 'dSaving', 'dFreeCut', 'dNudge', 'dChain', 'dTagFlat', 'dEndFlat'].slice(0, n);
  return ['beta', ...Object.keys(any.rep ?? {})];
})();
const ARMS = ASKED.filter(a => a !== 'beta' && a !== 'control');
const idx = Object.fromEntries(ASKED.map((a, i) => [a, i]));
const ctl = part === 'C' ? 'control' : 'beta';

p(`# R0 count 2, PART ${part}: sums\n`);
p(`Shard outputs read: ${files.length}. Corp decisions ${corp.length} (self ${corp.filter(r => r.sk === 'self').length}, human ${corp.filter(isHuman).length}); Runner decisions ${runner.length} (self ${runner.filter(r => r.sk === 'self').length}, human ${runner.filter(isHuman).length}).`);
const dealSeeds = new Set(games.map(g => g.src));
const bad = games.filter(g => !g.matchesBatch);
p(`Deals played: ${dealSeeds.size} (plays ${games.length}); plays that do not match the batch record: ${bad.length}${bad.length ? ` (${[...new Set(bad.map(g => g.src))].join(', ')})` : ''}.`);
const ctlDiff = [...corp, ...runner].filter(r => r.controlDiffers);
p(`Control differs from beta: ${ctlDiff.length}${ctlDiff.length ? `: ${ctlDiff.slice(0, 10).map(r => `${r.src}#${r.i} ${r.cls}`).join('; ')}` : ''}.`);
const errs = [...corp, ...runner].filter(r => r.errors);
p(`Asks with an error: ${errs.length}${errs.length ? `: ${errs.slice(0, 8).map(r => `${r.src}#${r.i} ${JSON.stringify(r.errors).slice(0, 160)}`).join('; ')}` : ''}.`);
const stops = rows.filter(r => r.k === 'h');
p(`Human replays stopped: ${stops.length}${stops.length ? `: ${stops.map(r => `${r.src} ${r.stopped}`).join('; ')}` : ''}.`);
if (part === 'C') {
  const instr = corp.filter(r => r.instr);
  p(`Instr tree answer unlike beta's: ${instr.filter(r => !r.instr.same).length} of ${instr.length}.`);
  // Control against control in the reply: beta and control samples beside each other
  const rr = corp.map(r => r.rep?.control).filter(Boolean);
  p(`Reply samples, control beside beta: ${rr.reduce((n, x) => n + x[1] + x[2], 0)} differing picks in ${rr.reduce((n, x) => n + x[0], 0)} Runner steps; unaligned samples ${rr.reduce((n, x) => n + x[3], 0)}.`);
}
p(`Max RSS per process: ${Math.max(...mem.map(m => m.maxRssMB))} MB. Slowest unit: ${Math.max(...rows.filter(r => r.k === 's').map(r => r.ms)) / 1000 | 0} s.`);
const humanCorp = corp.filter(r => isHuman(r) && !CUT.test(r.src));
const slowFound = corp.filter(r => r.slow).length;
p(`Slow decisions of count-bound-slow.json found: ${slowFound} of 2,497 (self ${corp.filter(r => r.slow && r.sk === 'self').length}, human ${corp.filter(r => r.slow && isHuman(r)).length}).\n`);

// --------------------------------------------------------------------------------------------- time
const sets = {
  'slow, self': corp.filter(r => r.slow && r.sk === 'self'),
  'slow, human': corp.filter(r => r.slow && isHuman(r)),
  'all, self': corp.filter(r => r.sk === 'self'),
  'all, human': corp.filter(isHuman),
};
p('## Time of Corp decisions (mean ms per tree; arm / control)\n');
p(`| set | n | ${ASKED.join(' | ')} |`);
p(`| --- | --- | ${ASKED.map(() => '---').join(' | ')} |`);
const ratio = {};
for (const [name, rs] of Object.entries(sets)) {
  const m = ASKED.map(a => mean(rs.map(r => r.ms[idx[a]])));
  ratio[name] = Object.fromEntries(ASKED.map((a, i) => [a, m[i] / m[idx[ctl]]]));
  p(`| ${name} | ${rs.length} | ${m.map((x, i) => `${f1(x)}${ASKED[i] === ctl ? '' : ` (${f3(x / m[idx[ctl]])})`}`).join(' | ')} |`);
}
if (corp[0]?.rk) {
  p('\nThe Runner inside the reply, as a share of the Corp decision (mean of the Runner agent / of its ranking, over mean decision time):\n');
  p(`| set | ${ASKED.join(' | ')} |`);
  p(`| --- | ${ASKED.map(() => '---').join(' | ')} |`);
  for (const [name, rs] of Object.entries(sets)) {
    p(`| ${name} | ${ASKED.map(a => `${pc(mean(rs.map(r => r.rn[idx[a]])) / mean(rs.map(r => r.ms[idx[a]])))} / ${pc(mean(rs.map(r => r.rk[idx[a]])) / mean(rs.map(r => r.ms[idx[a]])))}`).join(' | ')} |`);
  }
}
// Runner decisions: time
p('\n## Time of the deciding Runner\'s decisions (main phase; mean ms; arm / control)\n');
p(`| set | n | ${ASKED.join(' | ')} |`);
p(`| --- | --- | ${ASKED.map(() => '---').join(' | ')} |`);
for (const [name, rs] of Object.entries({ self: runner.filter(r => r.sk === 'self' && r.cls === 'runnerMain'), human: runner.filter(r => isHuman(r) && r.cls === 'runnerMain') })) {
  const m = ASKED.map(a => mean(rs.map(r => r.ms[idx[a]])));
  p(`| ${name} | ${rs.length} | ${m.map((x, i) => `${f1(x)}${ASKED[i] === ctl ? '' : ` (${f3(x / m[idx[ctl]])})`}`).join(' | ')} |`);
}

// --------------------------------------------------------------------------------------------- T: the split
if (part === 'C') {
  p('\n## T. Where the ranking\'s time goes inside the reply (instr tree; exclusive time, shares of the ranking\'s own time)\n');
  for (const [name, rs0] of Object.entries(sets)) {
    const rs = rs0.filter(r => r.instr);
    const leaf = {};
    const kind = {};
    const kindLeaf = {};
    let total = 0;
    const cnt = {};
    for (const r of rs) {
      for (const [k, v] of Object.entries(r.instr.split)) {
        const [ctx, kd, path] = k.split('|');
        if (ctx !== 'reply') continue;
        const l = path.split('>').pop();
        leaf[l] = (leaf[l] ?? 0) + v;
        kind[kd] = (kind[kd] ?? 0) + v;
        kindLeaf[`${kd}|${l}`] = (kindLeaf[`${kd}|${l}`] ?? 0) + v;
        total += v;
      }
      for (const [k, v] of Object.entries(r.instr.cnt)) {
        const [ctx, kd, n] = k.split('|');
        if (ctx !== 'reply') continue;
        cnt[n] = (cnt[n] ?? 0) + v;
        cnt[`${kd}|${n}`] = (cnt[`${kd}|${n}`] ?? 0) + v;
      }
    }
    const instrMs = rs.reduce((n, r) => n + r.instr.ms, 0);
    const steps = rs.reduce((n, r) => n + r.st[0], 0);
    // Rankings inside the reply: beta's count (rkn; instr's own `rank` count is not kept at 4383be7)
    const ranks = rs.reduce((n, r) => n + r.rkn[0], 0);
    p(`### ${name} (${rs.length} decisions; the ranking is ${pc(total / instrMs)} of the instr tree's decision time)\n`);
    p('By part (leaf region: `rank` = the ranking\'s own code outside the named parts; `score` = scoreMain\'s own code):\n');
    p('| part | share |');
    p('| --- | --- |');
    for (const [l, v] of Object.entries(leaf).sort((a, b) => b[1] - a[1])) p(`| ${l} | ${pc(v / total)} |`);
    p('\nBy kind of candidate (`setup`: the ranking before and around the candidates: the baseline board, the dig and saving-up checks, the make-room list, nudge outside a candidate):\n');
    const leaves = Object.keys(leaf).sort((a, b) => leaf[b] - leaf[a]);
    p(`| kind | share | candidates per ranking | ${leaves.join(' | ')} |`);
    p(`| --- | --- | --- | ${leaves.map(() => '---').join(' | ')} |`);
    for (const [kd, v] of Object.entries(kind).sort((a, b) => b[1] - a[1])) p(`| ${kd} | ${pc(v / total)} | ${f2((cnt[`${kd}|score`] ?? 0) / ranks)} | ${leaves.map(l => pc((kindLeaf[`${kd}|${l}`] ?? 0) / total)).join(' | ')} |`);
    p(`\nCounts: ${ranks} rankings, ${steps} reply Runner steps (${f2(ranks / steps)} rankings a step). Per reply step: simulated plays ${f2((cnt.simulate ?? 0) / steps)}, prompt answers ${f2((cnt.answerPrompt ?? 0) / steps)}, options scored inside prompt answers ${f2((cnt.options ?? 0) / steps)}, board prices (evaluate) ${f2((cnt.evaluate ?? 0) / steps)}, run prices ${f2((cnt.runScore ?? 0) / steps)}, drawWorth ${f2((cnt.drawWorth ?? 0) / steps)}. Per ranking: simulated plays ${f2((cnt.simulate ?? 0) / ranks)}, prompt answers ${f2((cnt.answerPrompt ?? 0) / ranks)}, options ${f2((cnt.options ?? 0) / ranks)}.\n`);
    const pk = Object.entries(cnt).filter(([k]) => k.endsWith('|answerPrompt')).sort((a, b) => b[1] - a[1]);
    if (pk.length) p(`Prompt answers by kind of candidate: ${pk.map(([k, v]) => `${k.split('|')[0]} ${v}`).join(', ')}.\n`);
  }
  // Audit
  const au = corp.filter(r => r.audit);
  const sum = (side, i) => au.reduce((n, r) => n + r.audit[side][i], 0);
  p('## runnerDeckRoot: values served from the root prices, priced again on the asking board (deckRootA)\n');
  for (const side of ['corp', 'runner']) p(`- ${side}: ${sum(side, 1)} differ of ${sum(side, 0)} served (${pc(sum(side, 1) / sum(side, 0))}), mean absolute difference over the differing ${f3(sum(side, 2) / sum(side, 1))}.`);
  p(`- The drawAudit map (V4's measure: a value served from drawWorth's map, priced again on the asking board): ${au.reduce((n, r) => n + r.audit.map[1], 0)} wrong of ${au.reduce((n, r) => n + r.audit.map[0], 0)} hits on the arm tree (V4's record on beta: 24 of 401k). Over ${au.length} audited Corp decisions.\n`);
}

// --------------------------------------------------------------------------------------------- picks
const perGame = { self: dealSeeds.size };
const humanGames = new Set(humanCorp.map(r => r.src).concat(runner.filter(r => isHuman(r) && !CUT.test(r.src)).map(r => r.src)));
p(`## Picks changed (self-play per game over ${perGame.self} games; human counts over ${humanGames.size} files, the cuts 40b and 40c left out)\n`);
p('Corp: the Corp\'s top-level decision. Reply: first differing pick per reply sample, the Runner\'s (r) or the Corp\'s (c), per 1,000 Runner steps compared. Runner: the deciding Runner\'s own decision (self: the batch Runner; human: hcHard/hcNormal = the AI Runner\'s boards, hr = the person\'s boards asked of our Runner).\n');
p('| arm | Corp self (/game) | Corp human | reply self r /1k steps (c) | reply human r /1k (c) | Runner self (/game) | Runner hcNormal | Runner hcHard | Runner on people\'s boards (hr) |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const repOf = (rs, a) => {
  let st = 0;
  let r = 0;
  let c = 0;
  for (const x of rs) {
    const v = x.rep?.[a];
    if (!v) continue;
    st += v[0];
    r += v[1];
    c += v[2];
  }
  return `${f2((1000 * r) / st)} (${f2((1000 * c) / st)}) [${r}/${st}]`;
};
const armRows = {};
for (const a of [...(part === 'C' ? ['control'] : []), ...ARMS]) {
  const ch = r => r.ch && r.ch[a] !== undefined;
  const cs = corp.filter(r => r.sk === 'self' && ch(r)).length;
  const chh = humanCorp.filter(ch).length;
  const rs = runner.filter(r => r.sk === 'self' && ch(r)).length;
  const hcN = runner.filter(r => r.sk === 'hcNormal' && ch(r)).length;
  const hcH = runner.filter(r => r.sk === 'hcHard' && ch(r)).length;
  const hr = runner.filter(r => (r.sk === 'hr' || r.sk === 'hrHard') && !CUT.test(r.src) && ch(r)).length;
  armRows[a] = { cs, chh, rs, hcN, hcH, hr };
  const ctlNote = a === 'control' ? ctlDiff.length : null;
  p(`| ${a} | ${ctlNote ?? cs} (${f3((ctlNote ?? cs) / perGame.self)}) | ${chh} | ${repOf(corp.filter(r => r.sk === 'self'), a)} | ${repOf(humanCorp, a)} | ${rs} (${f3(rs / perGame.self)}) | ${hcN} | ${hcH} | ${hr} |`);
}
p('\nRunner decisions changed by class (self-play):\n');
for (const a of ARMS) {
  const by = {};
  for (const r of runner.filter(r => r.sk === 'self' && r.ch && r.ch[a] !== undefined)) by[r.cls] = (by[r.cls] ?? 0) + 1;
  p(`- ${a}: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
}
if (part === 'C') {
  p('\n## Time saved per changed Corp decision (self-play; slow mean saved in ms over the changed Corp decisions a game)\n');
  p('| arm | slow self saved | slow human saved | all self saved | all human saved | changed Corp a game (self) | changed Corp (human) |');
  p('| --- | --- | --- | --- | --- | --- | --- |');
  for (const a of ARMS) p(`| ${a} | ${pc(1 - ratio['slow, self'][a])} | ${pc(1 - ratio['slow, human'][a])} | ${pc(1 - ratio['all, self'][a])} | ${pc(1 - ratio['all, human'][a])} | ${f3(armRows[a].cs / perGame.self)} | ${armRows[a].chh} |`);
}
// Changed top-level decisions, listed
p('\n## Changed top-level decisions (up to 60 a source kind and arm; Corp and the deciding Runner)\n');
for (const a of ARMS) {
  p(`### ${a}\n`);
  for (const sk of ['self', 'hr', 'hrHard', 'hcHard', 'hcNormal']) {
    const ch = [...corp, ...runner].filter(r => r.sk === sk && !CUT.test(r.src) && r.ch && r.ch[a] !== undefined);
    if (!ch.length) continue;
    p(`- **${sk}** (${ch.length}):`);
    for (const r of ch.slice(0, 60)) p(`  - ${r.src}#${r.i} T${r.T} ${r.k === 'c' ? 'Corp' : 'Runner'} ${r.cls}${r.who === 'person' ? ' (person\'s board)' : ''}${r.hold ? ` [hold class ${r.hold}]` : ''}: beta ${r.beta}; arm ${r.ch[a]}`);
  }
  p('');
}

// --------------------------------------------------------------------------------------------- O
const ord = rows.filter(r => r.k === 'o' && r.open);
if (ord.length) {
  const KIND = { runCentral: 'runCentral', runRemote: 'runRemote', installBreaker: 'installBreaker', install: 'install', money: 'money', moneyAbility: 'money', draw: 'draw', credit: 'credit', tag: 'tag' };
  const K = ['runCentral', 'runRemote', 'installBreaker', 'install', 'money', 'draw', 'credit', 'tag'];
  const opens = r => {
    const o = new Set();
    for (const k of Object.keys(r.open)) if (KIND[k]) o.add(KIND[k]);
    return o;
  };
  const conds = r => ({ ...r.cond, lowCredits: r.cond.credits < 3, lastClick: r.cond.clicks === 1, firstClick: r.cond.clicks >= 4, gripLow: r.cond.grip <= 2 });
  const CONDS = ['inCentral', 'inRemote', 'hasRemote', 'missingType', 'noBreakers', 'tagged', 'breakerInGrip', 'lowCredits', 'lastClick', 'firstClick', 'gripLow'];
  const groups = { 'self-play (the batch Normal Runner)': ord.filter(r => r.sk === 'self'), 'people as Runner (hr, against our Corp; 40b/40c left out)': ord.filter(r => r.sk === 'hr' && r.who === 'person' && !CUT.test(r.src)), 'report-33 (person v the Hard Corp, apart)': ord.filter(r => r.sk === 'hrHard' && r.who === 'person') };
  p('## O. An order between kinds of move\n');
  p('Kinds: runCentral, runRemote, installBreaker, install (other installs; make-room installs left out), money (an event or ability whose text gains or takes credits), draw, credit, tag. A pair counts on a board where both kinds were legal and scored above the cut (a finite score in beta\'s ranking) and one of the two was played. Bar: 80%; a pair under it is tested on each condition (both sides must reach 80% on their side of the split, 3+ boards each side).\n');
  for (const [gname, rs] of Object.entries(groups)) {
    const thin = gname.startsWith('self') ? 1 : 10;
    p(`### ${gname}: ${rs.length} boards\n`);
    const playedCount = {};
    for (const r of rs) playedCount[r.played ?? 'none'] = (playedCount[r.played ?? 'none'] ?? 0) + 1;
    p(`Played: ${Object.entries(playedCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}.\n`);
    p('| pair A / B | boards both open | A played | B played | A share | reading |');
    p('| --- | --- | --- | --- | --- | --- |');
    const edges = {};
    for (let i = 0; i < K.length; i++)
      for (let j = i + 1; j < K.length; j++) {
        const A = K[i];
        const B = K[j];
        const both = rs.filter(r => {
          const o = opens(r);
          return o.has(A) && o.has(B);
        });
        const pa = both.filter(r => KIND[r.played] === A);
        const pb = both.filter(r => KIND[r.played] === B);
        const n = pa.length + pb.length;
        if (!n) continue;
        const share = pa.length / n;
        let reading;
        if (n < thin) reading = 'too thin';
        else if (share >= 0.8) reading = `order: ${A} over ${B}`;
        else if (share <= 0.2) reading = `order: ${B} over ${A}`;
        else {
          const turns = [];
          for (const c of CONDS) {
            const yes = [...pa, ...pb].filter(r => conds(r)[c]);
            const no = [...pa, ...pb].filter(r => !conds(r)[c]);
            if (yes.length < 3 || no.length < 3) continue;
            const sy = yes.filter(r => KIND[r.played] === A).length / yes.length;
            const sn = no.filter(r => KIND[r.played] === A).length / no.length;
            if ((sy >= 0.8 && sn <= 0.2) || (sy <= 0.2 && sn >= 0.8)) turns.push(`${c} (${sy >= 0.8 ? A : B} ${pc(Math.max(sy, 1 - sy))} of ${yes.length} when true, ${sn >= 0.8 ? A : B} ${pc(Math.max(sn, 1 - sn))} of ${no.length} when false)`);
          }
          reading = turns.length ? `turns on ${turns.join('; ')}` : 'no order';
        }
        if (n >= thin) {
          if (share > 0.5) edges[`${A}>${B}`] = 1;
          else if (share < 0.5) edges[`${B}>${A}`] = 1;
        }
        p(`| ${A} / ${B} | ${both.length} | ${pa.length} | ${pb.length} | ${pc(share)} | ${reading} |`);
      }
    // Cycles of three in the majority relation
    const cyc = [];
    for (const a of K) for (const b of K) for (const c of K) if (a < b && a < c && b !== c && edges[`${a}>${b}`] && edges[`${b}>${c}`] && edges[`${c}>${a}`]) cyc.push(`${a} > ${b} > ${c} > ${a}`);
    p(`\nCycles (majority relation, pairs not thin): ${cyc.length ? cyc.join('; ') : 'none'}.\n`);
  }
}
