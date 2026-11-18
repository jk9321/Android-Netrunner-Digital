// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// the hold questions of named Corp decisions, asked on this tree, judged by the oracle.
//   MODE=dump  PICKS="deal:1161:188,human:report-36:131" OUT=<dir>    the decision states (this tree plays the deals)
//   MODE=ask   OUT=<dir> TAG=branch|beta                              every distinct serverHold question of each decision
//   MODE=judge OUT=<dir>                                              flips (branch holds, beta does not) through the oracle
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import * as holdModule from '../../src/ai/corp/hold';
import { deckGameSetup } from '../../src/data/decks';
import { clearCaches, dealState } from '../stage-a/harness';
import { oracleGetsIn } from './hold-oracle';

const OUT = process.env.OUT!;
const mode = process.env.MODE;
mkdirSync(OUT, { recursive: true });
const enc = (o: unknown) => JSON.stringify(o, (_k, v) => (v === Infinity ? 'Infinity' : v));
const dec = (t: string) => JSON.parse(t, (_k, v) => (v === 'Infinity' ? Infinity : v));

if (mode === 'dump') {
  for (const p of (process.env.PICKS ?? '').split(',').filter(Boolean)) {
    const [kind, name, iStr] = p.split(':');
    const want = Number(iStr);
    let got: GameState | null = null;
    if (kind === 'deal') {
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction')
              return (state: GameState) => {
                if (i++ === want && !got) got = structuredClone(state);
                return target.chooseAction(state);
              };
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(Number(name)), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
      for (let k = 0; k < 4000 && !got && game.step(); k++);
    } else if (kind === 'step') {
      // trace-deal.ts numbering: the state before game step `want`
      const game = new GameRunner(dealState(Number(name)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
      for (let k = 0; k < want && game.step(); k++);
      got = structuredClone(game.state);
    } else {
      const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${name}.json`, 'utf8'));
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        if (actingSide(s) === move.player && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) {
          if (i === want) {
            got = structuredClone(s);
            break;
          }
          i++;
        }
        s = executeAction(s, move);
      }
    }
    const st = got as GameState | null;
    console.log(p, st ? `T${st.turnNumber} acting ${actingSide(st)}` : 'NOT FOUND');
    if (st) writeFileSync(join(OUT, `${p.replace(/:/g, '_')}.state.json`), JSON.stringify(st));
  }
}

if (mode === 'ask') {
  const original = holdModule.serverHold;
  let rec: Map<string, { server: string; opts: unknown; holds: boolean; rez: string[] | null; need: number; budget: number; state?: GameState }> | null = null;
  const watched = (state: GameState, server: string, opts: holdModule.HoldOptions) => {
    const h = original(state, server, opts);
    if (rec) {
      const rest: Partial<GameState> = { ...state };
      delete rest.log;
      const key = createHash('sha1').update(JSON.stringify(rest)).update(`|${server}|${enc(opts)}`).digest('hex').slice(0, 16);
      if (!rec.has(key)) rec.set(key, { server, opts: structuredClone(opts), holds: h.holds, rez: h.rez, need: h.need, budget: h.budget, state: process.env.TAG === 'branch' ? structuredClone(state) : undefined });
    }
    return h;
  };
  Object.defineProperty(holdModule, 'serverHold', { get: () => watched, configurable: true, enumerable: true });
  for (const f of readdirSync(OUT).filter(f => f.endsWith('.state.json')).sort()) {
    const s = JSON.parse(readFileSync(join(OUT, f), 'utf8')) as GameState;
    clearCaches();
    rec = new Map();
    const pick = JSON.stringify(createAgent(actingSide(s) ?? 'corp', 'normal').chooseAction(structuredClone(s))).slice(0, 120);
    const qs = [...rec.entries()];
    rec = null;
    const name = f.replace('.state.json', '');
    if (process.env.TAG === 'branch') {
      mkdirSync(join(OUT, 'q'), { recursive: true });
      for (const [k, q] of qs) if (q.holds) writeFileSync(join(OUT, 'q', `${name}.${k}.json`), enc(q));
    }
    writeFileSync(join(OUT, `${name}.${process.env.TAG}.answers.json`), enc({ pick, qs: qs.map(([k, q]) => ({ key: k, server: q.server, opts: q.opts, holds: q.holds, rez: q.rez, need: q.need, budget: q.budget })) }));
    console.log(name, process.env.TAG, 'questions', qs.length, 'pick', pick);
  }
}

if (mode === 'judge') {
  const A = new Set(['35034', '35033', '34089']);
  for (const f of readdirSync(OUT).filter(f => f.endsWith('.state.json')).sort()) {
    const name = f.replace('.state.json', '');
    if (process.env.NAMES && !process.env.NAMES.split(',').some(n => name.includes(n))) continue;
    const s = JSON.parse(readFileSync(join(OUT, f), 'utf8')) as GameState;
    const br = dec(readFileSync(join(OUT, `${name}.branch.answers.json`), 'utf8'));
    const be = existsSync(join(OUT, `${name}.beta.answers.json`)) ? dec(readFileSync(join(OUT, `${name}.beta.answers.json`), 'utf8')) : { qs: [], pick: '?' };
    const beta = new Map<string, { holds: boolean }>(be.qs.map((q: { key: string; holds: boolean }) => [q.key, q]));
    const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
    const a = [...new Set(rig.filter(c => A.has(c.cardCode)).map(c => cardDef(c).title))];
    const lab = s.corp.scoreArea.some(c => c.cardCode === '34097') ? (Object.keys(s.turnFlags ?? {}).some(k => k.startsWith('lightning:')) ? 'Lab used this turn' : 'Lab scored') : '';
    let notAsked = 0, flips = 0;
    const ft = { right: 0, false: 0, unknown: 0 }, xt = { right: 0, false: 0, unknown: 0 };
    const servers = new Set<string>();
    for (const q of br.qs as { key: string; server: string; opts: { when: 'runnerTurn' | 'thisRun'; corpCredits?: number }; holds: boolean; rez: string[] | null }[]) {
      const b = beta.get(q.key);
      const extra = !b && q.holds && !!process.env.ALLH;
      if (!b && !extra) { if (q.holds) notAsked++; continue; }
      if (!extra && !(q.holds && !b!.holds)) continue;
      if (extra) notAsked++;
      else flips++;
      const full = dec(readFileSync(join(OUT, 'q', `${name}.${q.key}.json`), 'utf8'));
      const ans = oracleGetsIn(full.state, q.server, q.opts.when, q.rez ?? [], q.opts.corpCredits, Number(process.env.CAP) || undefined, true).answer;
      const tally = extra ? xt : ft;
      if (ans === 'holds') tally.right++;
      else if (ans === 'getsIn') { tally.false++; servers.add(q.server); }
      else tally.unknown++;
    }
    console.log(JSON.stringify({ name, T: s.turnNumber, pickBranch: br.pick.slice(0, 70), pickBeta: be.pick.slice(0, 70), questions: br.qs.length, flips, flipsJudged: ft, notAskedOnBetaJudged: xt, falseServers: [...servers], branchHoldsNotAskedOnBeta: notAsked, A: a, C: lab }));
  }
}
