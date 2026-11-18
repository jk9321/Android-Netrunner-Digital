#!/usr/bin/env node
/**
 * Item 5: the continuations of changed main-phase decisions, split direct (the same card installed elsewhere) and
 * indirect (the arm picked another move), with the points stolen on the Runner turn after, base vs arm.
 *    node scripts/stage-d/place-open-cont.mjs <dir of place-open.ts output files>
 */
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2];
const recs = [];
for (const f of readdirSync(dir)) for (const l of readFileSync(dir + '/' + f, 'utf8').split('\n')) { if (!l.startsWith('{"kind":"cont"') && !l.startsWith('{"kind":"decision"')) continue; recs.push(JSON.parse(l)); }
const conts = recs.filter(r => r.kind === 'cont');
const by = new Map();
for (const c of conts) { const k = `${c.src}#${c.i}`; (by.get(k) ?? by.set(k, {}).get(k))[c.arm] = c; }
const decs = new Map(recs.filter(r => r.kind === 'decision').map(d => [`${d.src}#${d.i}`, d]));
const pts = c => (c.runs ?? []).reduce((n, r) => n + (r.pts ?? 0), 0);
for (const arm of ['a1', 'a2', 'b', 'c1', 'c2']) {
  const rows = { all: [0, 0, 0, 0, 0], self: [0, 0, 0, 0, 0], 'person-runner': [0, 0, 0, 0, 0], 'person-corp': [0, 0, 0, 0, 0], direct: [0, 0, 0, 0, 0], indirect: [0, 0, 0, 0, 0] };
  for (const [k, g] of by) {
    if (!g.base || !g[arm]) continue;
    const d = decs.get(k);
    const bp = d?.picks?.base ?? '', ap = d?.picks?.[arm] ?? '';
    const direct = /^INSTALL_CARD/.test(bp) && /^INSTALL_CARD/.test(ap) && bp.split('->')[0] === ap.split('->')[0];
    const b = pts(g.base), a = pts(g[arm]);
    for (const key of ['all', g.base.who, direct ? 'direct' : 'indirect']) {
      const r = rows[key]; r[0]++; r[1] += b; r[2] += a; r[3] += a > b ? 1 : 0; r[4] += a < b ? 1 : 0;
    }
  }
  console.log(arm, Object.entries(rows).map(([k, r]) => `${k}: n ${r[0]} stolen base ${r[1]} arm ${r[2]} (arm worse ${r[3]}, better ${r[4]})`).join(' | '));
}
