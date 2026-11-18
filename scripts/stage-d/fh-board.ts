// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Needs hold-oracle-local.diff (beside this file) applied to hold-oracle.ts, for PV and the replay options. print a dumped hold-baseline question's board and ask the walk and the oracle.
import { readFileSync } from 'node:fs';
import { cardDef } from '../../src/core';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { oracleGetsIn } from './hold-oracle';
const j = JSON.parse(readFileSync(process.env.F!, 'utf8'));
const s = j.state;
if (j.opts.corpCredits === null || j.opts.corpCredits === 'Infinity') j.opts.corpCredits = Infinity;
const srv = s.corp.servers[j.server];
const t = (c: { cardCode: string; isRezzed?: boolean; instanceId: string; tokens?: object }) => `${cardDef(c as never).title}${c.isRezzed ? '*' : ''}(${c.instanceId}${c.tokens && Object.keys(c.tokens).length ? ' ' + JSON.stringify(c.tokens) : ''})`;
console.log('server', j.server, 'ice inner->outer:', srv.ice.map(t).join(', '), '| root:', srv.root.map(t).join(', '));
console.log('rig programs:', s.runner.rig.programs.map(t).join(', '));
console.log('rig hardware:', s.runner.rig.hardware.map(t).join(', '), '| resources:', s.runner.rig.resources.map(t).join(', '));
console.log('runner $', s.runner.credits, 'clicks', s.runner.clicks, 'max', s.runner.maxClicks, 'tags', s.runner.tags, 'grip', s.runner.grip.map(t).join(', '), '| corp $', s.corp.credits, 'active', s.activePlayer, 'turn', s.turnNumber, 'identity', cardDef(s.runner.identity).title);
console.log('opts', JSON.stringify(j.opts), 'line count', JSON.stringify(j.line?.count), 'oracle', JSON.stringify(j.line?.oracle));
const h = asSide('corp', () => (decisionContext(s, 'corp'), serverHold(s, j.server, j.opts)));
console.log('walk here:', JSON.stringify({ holds: h.holds, rez: h.rez, need: h.need, budget: h.budget }));
if (h.rez) console.log("oracle on the walk set:", oracleGetsIn(s, j.server, j.opts.when, h.rez, j.opts.corpCredits ?? undefined, Number(process.env.CAP) || undefined, true).answer);
if (process.env.DROP) {
  const rez = h.rez ?? [];
  for (const where of ['grip', 'programs', 'resources'] as const) {
    const list = where === 'grip' ? s.runner.grip : s.runner.rig[where];
    for (let k = 0; k < list.length; k++) {
      const c = structuredClone(s);
      const l2 = where === 'grip' ? c.runner.grip : c.runner.rig[where];
      const [gone] = l2.splice(k, 1);
      console.log(`without ${where} ${t(gone)}: oracle ${oracleGetsIn(c, j.server, j.opts.when, rez, j.opts.corpCredits ?? undefined, undefined, true).answer}`);
    }
  }
}
if (process.env.VARY) {
  const rez = h.rez ?? [];
  const vary: [string, (c: typeof s) => void][] = [
    ['runner $2', c => (c.runner.credits = 2)],
    ['runner $4', c => (c.runner.credits = 4)],
    ['max clicks 3', c => (c.runner.maxClicks = 3)],
    ['Telework empty', c => (c.runner.rig.resources.find((x: { cardCode: string }) => cardDef(x as never).title === 'Telework Contract')!.tokens = {})],
    ['no Manegarm', c => (c.corp.servers[j.server].root = c.corp.servers[j.server].root.filter((x: { cardCode: string }) => cardDef(x as never).title !== 'Manegarm Skunkworks'))],
    ['Ansel not rezzable (rez set empty)', () => {}],
  ];
  for (const [name, f] of vary) {
    const c = structuredClone(s);
    f(c);
    const set = name.startsWith('Ansel not') ? [] : rez;
    const w = asSide('corp', () => (decisionContext(c, 'corp'), serverHold(c, j.server, j.opts)));
    console.log(`${name}: oracle(${set.length ? 'Ansel rezzed' : 'none'}) ${oracleGetsIn(c, j.server, j.opts.when, set, j.opts.corpCredits ?? undefined, undefined, true).answer}; walk holds ${w.holds} need ${w.need} budget ${w.budget} rez ${w.rez}`);
  }
}
if (process.env.PVLINE) {
  const { PV } = await import('./hold-oracle');
  const a = oracleGetsIn(s, j.server, j.opts.when, h.rez ?? [], j.opts.corpCredits ?? undefined, undefined, true).answer;
  console.log('PV for', a);
  for (const l of PV.found ?? []) if (process.env.ALL || !/"PASS"/.test(l) || /approach|encounter/.test(l)) console.log('  ' + l.slice(0, 260));
}
if (process.env.MUT) {
  const c = structuredClone(s);
  new Function('c', process.env.MUT)(c);
  const w = asSide('corp', () => (decisionContext(c, 'corp'), serverHold(c, j.server, j.opts)));
  console.log(`MUT: walk holds ${w.holds} need ${w.need} budget ${w.budget} rez ${w.rez}; oracle on walk set ${oracleGetsIn(c, j.server, j.opts.when, w.rez ?? h.rez ?? [], j.opts.corpCredits ?? undefined, undefined, true).answer}`);
}
if (process.env.REPLAY) {
  const { PV, oracleStart } = await import('./hold-oracle');
  const { executeAction } = await import('../../src/core');
  oracleGetsIn(s, j.server, j.opts.when, h.rez ?? [], j.opts.corpCredits ?? undefined, undefined, true);
  const st = oracleStart(s, { when: j.opts.when, targets: [j.server], rez: new Set(h.rez ?? []), corpCredits: j.opts.corpCredits ?? undefined } as never);
  if ('state' in st) {
    let g = st.state;
    const from = g.log.length;
    for (const l of PV.found ?? []) g = executeAction(g, JSON.parse(l.slice(l.indexOf(': ') + 2, l.indexOf(' | '))));
    for (const e of g.log.slice(from)) console.log('  log:', typeof e === 'string' ? e : JSON.stringify((e as { text?: string }).text ?? e).slice(0, 200));
  }
}
