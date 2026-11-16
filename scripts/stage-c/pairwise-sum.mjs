// Step 4 Stage C, piece C0: sums the shards of scripts/stage-c/pairwise.ts into the pairwise table (markdown), and the
// order of the lines that agrees with the most decided pairs (every permutation tried; the spec's 1.3 rule).
//   node scripts/stage-c/pairwise-sum.mjs pairs-*.json > 7-pairwise-c.md
import { readFileSync } from 'node:fs';

const NAMES = {
  1: '1 expiring play (tag punishment, Petty Cash)',
  2: '2 ice that changes a count (staked server)',
  3: '3 agenda install or advance, the server holds after',
  4: '4 build pair (ice into a new remote, a root card in HQ)',
  5: '5 economy (money operation, econ asset, ability)',
  6: '6 other play',
  7: '7 purge',
  8: '8 draw or credit',
  9: '9 ice that changes no count',
  10: '10 agenda install or advance, the server does not hold, bare or ice unpaid',
  11: '11 agenda install or advance, the server does not hold, ice rezzed or paid (line 7a)',
};
const LINES = Object.keys(NAMES).map(Number);

const files = process.argv.slice(2);
const sum = { reached: 0, q5: 0, played: {}, counts: {}, finite: {}, positive: {}, cond: {}, failed: {}, bySrc: {}, iceKinds: {}, examples: {}, errors: 0 };
const add = (to, from) => {
  for (const [k, v] of Object.entries(from ?? {})) to[k] = (to[k] ?? 0) + v;
};
for (const f of files) {
  const text = readFileSync(f, 'utf8').trim().split('\n').pop();
  const o = JSON.parse(text);
  sum.reached += o.reached;
  sum.q5 += o.q5;
  sum.errors += o.errors;
  add(sum.played, o.played);
  add(sum.counts, o.counts);
  add(sum.finite, o.finite);
  add(sum.cond, o.cond);
  add(sum.failed, o.failed);
  add(sum.positive, o.positive);
  add(sum.iceKinds, o.iceKinds);
  for (const [src, b] of Object.entries(o.bySrc)) {
    const t = (sum.bySrc[src] ??= { reached: 0, played: {}, counts: {} });
    t.reached += b.reached;
    add(t.played, b.played);
    add(t.counts, b.counts);
  }
  for (const [k, list] of Object.entries(o.examples)) (sum.examples[k] ??= []).push(...list);
}

function reading(counts, a, b) {
  const x = counts[`${a}>${b}`] ?? 0;
  const y = counts[`${b}>${a}`] ?? 0;
  const n = x + y;
  const share = n ? x / n : 0;
  const decided = n >= 20 && (share >= 0.55 || share <= 0.45);
  return { x, y, n, share, decided, winner: !decided ? null : share >= 0.55 ? a : b };
}

function tableOf(counts, title) {
  const rows = [`### ${title}`, '', '| Line A | Line B | Both possible | A chosen | B chosen | A share | Reading |', '|---|---|---|---|---|---|---|'];
  for (const a of LINES)
    for (const b of LINES) {
      if (b <= a) continue;
      const r = reading(counts, a, b);
      if (!r.n) continue;
      const read = r.decided ? `${r.winner === a ? a : b} over ${r.winner === a ? b : a}` : 'undetermined';
      rows.push(`| ${NAMES[a]} | ${NAMES[b]} | ${r.n} | ${r.x} | ${r.y} | ${Math.round(100 * r.share)}% | ${read} |`);
    }
  return rows.join('\n');
}

// The order that agrees with the most decided pairs (ties: by observations agreed with)
function* perms(xs) {
  if (xs.length <= 1) return yield xs;
  for (let i = 0; i < xs.length; i++) for (const p of perms([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...p];
}
function bestOrders(counts, lines) {
  let best = [];
  let bestKey = [-1, -1];
  for (const p of perms(lines)) {
    let agree = 0;
    let weight = 0;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const r = reading(counts, p[i], p[j]);
        if (r.decided && r.winner === p[i]) agree++;
        weight += r.x;
      }
    if (agree > bestKey[0] || (agree === bestKey[0] && weight > bestKey[1])) {
      bestKey = [agree, weight];
      best = [p];
    } else if (agree === bestKey[0] && weight === bestKey[1]) best.push(p);
  }
  let decided = 0;
  for (const a of lines) for (const b of lines) if (a < b && reading(counts, a, b).decided) decided++;
  return { orders: best, agree: bestKey[0], decided, weight: bestKey[1] };
}

const out = [];
out.push('# Stage C table 7 (C0): pairwise table of the intent lines, lines 2 and 4 told apart by the owners');
out.push('');
out.push(`Shards: ${files.length}. Decisions that reach Q7: ${sum.reached} (deals ${sum.bySrc.deal?.reached ?? 0}, human games ${sum.bySrc.human?.reached ?? 0}); a two-turn line taking the click at Q5, left out: ${sum.q5}; probe errors: ${sum.errors}.`);
out.push('');
out.push(`Lines played: ${LINES.map(l => `${l}: ${sum.played[l] ?? 0}`).join(', ')}. Ice played: changes a count ${sum.iceKinds.two ?? 0}, build pair ${sum.iceKinds.four ?? 0}, no count ${sum.iceKinds.nine ?? 0} (existing server ${sum.iceKinds.nineExisting ?? 0}, new remote ${sum.iceKinds.nineNew ?? 0}).`);
out.push('');
out.push('Undetermined: fewer than 20 observations, or split closer than 55 to 45.');
out.push('');
out.push(`Played moves that fail their own line's condition (pass 3), by line: ${LINES.map(l => `${l}: ${sum.failed[l] ?? 0}`).join(', ')}.`);
out.push('');
out.push(tableOf(sum.cond, "All recorded states, a line available when one of its moves meets the line's own condition (the primary table, pass 3)"));
out.push('');
out.push(tableOf(sum.finite, 'All recorded states, a line available when the ranking scored one of its moves above -Infinity (pass 2)'));
out.push('');
out.push(tableOf(sum.positive, 'All recorded states, a line available when the ranking scored one of its moves above 0'));
out.push('');
out.push(tableOf(sum.counts, 'All recorded states, a line available when any of its moves was legal (Stage A convention)'));
out.push('');
for (const src of ['deal', 'human']) if (sum.bySrc[src]) out.push(tableOf(sum.bySrc[src].counts, src === 'deal' ? 'The 56 local deals only' : 'Human games only'), '');
for (const [label, lines] of [['the eight lines of the spec (9 and 10 left out)', [1, 2, 3, 4, 5, 6, 7, 8]], ['all ten (11 left out: an 11-line search is too slow)', LINES.filter(l => l !== 11)]]) {
  for (const [conv, counts] of [['by line condition (primary)', sum.cond], ['playable', sum.finite], ['above 0', sum.positive], ['legal', sum.counts]]) {
    const b = bestOrders(counts, lines);
    out.push(`### Order that agrees with the most decided pairs, ${label}, availability ${conv}`);
    out.push('');
    out.push(`${b.agree} of ${b.decided} decided pairs agree. ${b.orders.length} order(s) tie: ${b.orders.slice(0, 12).map(o => o.join(' ')).join('; ')}${b.orders.length > 12 ? '; ...' : ''}`);
    out.push('');
  }
}
out.push('### Examples');
out.push('');
for (const [k, list] of Object.entries(sum.examples).sort()) {
  out.push(`- **${k}**`);
  for (const e of list.slice(0, 8)) out.push(`  - ${e}`);
}
console.log(out.join('\n'));
