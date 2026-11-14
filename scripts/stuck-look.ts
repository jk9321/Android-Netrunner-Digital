/**
 * Count inputs F0 (/mnt/project-files/netrunner-ai/redesign/spec-count-inputs.md): plays deals with the shipped AI and,
 * at each 'agenda stuck in HQ' firing (scripts/alarms.ts), writes what plan.scoreInTwo's count saw at that Corp turn's
 * first main-phase decision: for each agenda in HQ the best try per server and which test refused it, the Runner's
 * budget and installed cards, and what the Corp then did that turn. One JSON line per firing.
 *
 *   SEEDS=1001,1212 npx vite-node scripts/stuck-look.ts
 */
import { CardInstance, GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { AlarmTracker } from './alarms';
import { holdCost, runnerBudget } from '../src/ai/corp/hold';
import { isCorpMain, knownIncome, scoreInTwo } from '../src/ai/corp/lines';
import { withIceInstalled } from '../src/ai/iceValues';
import { iceCreditNeed } from '../src/ai/runs';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const title = (c: CardInstance) => cardDef(c).title;
const typeOf = (c: CardInstance) => cardDef(c).type_code;
const isAgenda = (c: CardInstance) => typeOf(c) === 'agenda';

/** The per-try tests of scoreInTwo, with the reason each refused try failed (its first advance count that got furthest). */
function diagnose(state: GameState) {
  const C = state.corp.clicks;
  const N = state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);
  const K = state.corp.credits;
  const income = knownIncome(state);
  const hqIce = [...new Map(state.corp.hq.filter(c => typeOf(c) === 'ice').map(c => [c.cardCode, c])).values()];
  const remotes = Object.values(state.corp.servers).filter(v => v.isRemote);
  const open = remotes.filter(v => !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset'));
  const rows: string[] = [];
  for (const agenda of state.corp.hq.filter(isAgenda)) {
    const left = (cardDef(agenda).advancement_cost ?? 0) - agenda.advancementCounters;
    const tries: { where: string; ice: CardInstance[]; clicks: number; credits: number; view: GameState }[] = [];
    for (const v of open) {
      if (v.ice.length) tries.push({ where: `${v.id}`, ice: v.ice, clicks: 1, credits: 0, view: state });
      for (const ice of hqIce) {
        const view = withIceInstalled(state, ice, v);
        tries.push({ where: `${v.id}+${title(ice)}`, ice: view.corp.servers[v.id].ice, clicks: 2, credits: v.ice.length, view });
      }
    }
    for (const ice of hqIce) {
      const view = withIceInstalled(state, ice, null);
      tries.push({ where: `new+${title(ice)}`, ice: view.corp.servers['remote-placed'].ice, clicks: 2, credits: 0, view });
    }
    if (!tries.length) rows.push(`${cardDef(agenda).title}(${left}): no try (open remotes ${open.length}, HQ ice 0)`);
    for (const t of tries) {
      const needs = t.ice.map(i => {
        const up = i.isRezzed ? i : { ...i, isRezzed: true };
        const view: GameState = { ...t.view, runner: { ...t.view.runner, clicks: Math.max(0, t.view.runner.maxClicks - 1) } };
        const n = iceCreditNeed(view, up);
        return `${title(i)}${i.isRezzed ? '*' : ''}:${n > 99 ? 'BLOCK' : n}`;
      });
      let why = '';
      for (let a = 0; a <= Math.min(left - 1, C - t.clicks); a++) {
        const r = left - a;
        if (r > N) { why = `a=${a}: ${r} left > ${N} clicks`; continue; }
        const end = K - t.credits - a + (C - t.clicks - a);
        if (end < 0) { why = `a=${a}: end ${end}`; continue; }
        const rez = holdCost(t.view, t.ice, end);
        if (rez === null) {
          const rich = holdCost(t.view, t.ice, 99);
          why = `a=${a}: no hold with ${end} (${rich === null ? 'no set holds at any price' : `holds for ${rich}`})`;
          continue;
        }
        const next = end - rez + income + (N - r);
        if (next < r) { why = `a=${a}: next ${next} < ${r}`; continue; }
        why = `OK a=${a} rez ${rez} end ${end} next ${next}`;
        break;
      }
      if (C - t.clicks < 0) why = `needs ${t.clicks} clicks, has ${C}`;
      rows.push(`${cardDef(agenda).title}(${left}) ${t.where} [${needs.join(' ')}]: ${why}`);
    }
  }
  const rig = Object.values(state.runner.rig).flat().map(c => title(c));
  return { corpCredits: K, clicks: C, income, runnerCredits: state.runner.credits, runnerBudget: runnerBudget(state), rig, line: scoreInTwo(state), rows };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const stride = 10;
for (const seed of seeds) {
  const p = Math.floor((seed - 1001) / stride);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const runner = new GameRunner(start, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const alarms = new AlarmTracker();
  const startCredits: number[] = [];
  let pending: { alarm: (typeof alarms.alarms)[number]; credits: number[]; diag?: ReturnType<typeof diagnose>; did: string[] } | null = null;
  const done: NonNullable<typeof pending>[] = [];
  let lastCorpTurn = -1;
  for (let i = 0; i < 6000; i++) {
    const before = runner.state;
    if (before.activePlayer === 'corp' && before.turnNumber !== lastCorpTurn) {
      lastCorpTurn = before.turnNumber;
      startCredits.push(before.corp.credits);
    }
    if (pending && !pending.diag && isCorpMain(before) && before.corp.clicks > 0) pending.diag = diagnose(before);
    if (!runner.step()) break;
    const after = runner.state;
    const a = runner.last;
    if (pending?.diag && before.activePlayer === 'corp' && a && a.player === 'corp' && !before.activeRun) {
      const id = (a as { cardInstanceId?: string }).cardInstanceId;
      const card = id ? [...before.corp.hq, ...Object.values(before.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(x => x.instanceId === id) : undefined;
      if (a.type !== 'PASS') pending.did.push(a.type.replace('_CARD', '').toLowerCase() + (card ? ` ${title(card)}` : '') + ((a as { serverId?: string }).serverId ? `@${(a as { serverId?: string }).serverId}` : ''));
    }
    const n = alarms.alarms.length;
    alarms.step(before, after, a ?? undefined);
    for (const al of alarms.alarms.slice(n)) {
      if (al.kind !== 'agenda stuck in HQ') continue;
      if (pending) done.push(pending);
      pending = { alarm: al, credits: startCredits.slice(-6), did: [] };
    }
    if (pending?.diag && before.activePlayer === 'corp' && after.activePlayer === 'runner') {
      done.push(pending);
      pending = null;
    }
  }
  if (pending) done.push(pending);
  for (const f of done)
    console.log(JSON.stringify({ seed, corp: c.name, runner: r.name, turn: f.alarm.turn, cause: f.alarm.detail, note: f.alarm.note, ...f.diag, startCredits: f.credits, did: f.did, winner: runner.state.winner }));
}
