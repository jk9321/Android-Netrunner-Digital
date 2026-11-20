/**
 * V-C item 2 (the hand's price), count step: the traces of G4 and G5 (brief, "What to count"). For each board, on beta's
 * tree and each arm's (hand-price-trees.ts):
 *  - the list: the order (corpCandidates through the agent's rankMainActions: each candidate's line, behind, card) and
 *    plannerIntake's picks with the slot that brought each in (is the agenda install there, in which slot);
 *  - the counted rule: line 9's condition for each agenda install (the server `place` gives, its 'runnerTurn' hold and
 *    margin), HQ's own hold and entries, __hqSteal and the remote's steal chance (agendaWorth's input);
 *  - the value: the planner's value of each candidate (diagnostics onCandidates), its reply samples (onReplySamples),
 *    and the leaf (the planner's leaf pricing: `leaves` on) term by term on four boards built from this one: the agenda
 *    held, the agenda installed where `place` puts it, the agenda held and then taken from HQ, the agenda installed and
 *    then stolen (evaluate, the Corp's hand and clicks, ownHandValue, each agenda's heldWorth, the Runner's side);
 *  - the decision each tree makes (a fresh agent's chooseAction).
 * Boards: BOARDS=f4,report15,deal1001 (tests/fixtures; the F4 board is tests/fixtures/adversarial/stage-d-f4-rich-runner-t13.json),
 * and STATES=<file.jsonl of {name, state}> for class boards a run wrote. Local: not on Actions.
 *   npx vite-node scripts/stage-vc/hand-price-trace.ts -- BOARDS=f4 ARMS=beta,heldRisk,leastBad
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { ARMS, Arm, Tree, loadTree, makeTrees } from './hand-price-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const FIX: Record<string, string> = {
  f4: 'tests/fixtures/adversarial/stage-d-f4-rich-runner-t13.json',
  report15: 'tests/fixtures/bug-report-15-turn10.json',
  deal1001: 'tests/fixtures/ice-redirect-1001-t10.json',
};

function terms(t: Tree, s: GameState, agendaIds: string[]) {
  return t.pricing.asSide('corp', () => {
    t.clear();
    t.hv.decisionContext(s, 'corp');
    return t.pricing.withPricing({ leaves: [{ side: 'corp', plan: t.pricing.plan() }] }, () => ({
      evaluate: r2(t.ev.evaluate(s, 'corp')),
      corpSide: r2(t.ev.sideStrength(s, 'corp', 'corp')),
      runnerSide: r2(t.ev.sideStrength(s, 'runner', 'corp')),
      handAndClicks: r2(t.ev.handAndClicks(s, 'corp', 'corp')),
      ownHand: r2(t.hv.ownHandValue(s, 'corp')),
      held: Object.fromEntries(agendaIds.filter(id => s.corp.hq.some((c: any) => c.instanceId === id)).map(id => [t.core.cardDef(t.core.findCardAnywhere(s, id)).title, r2(t.hv.heldWorth(s, t.core.findCardAnywhere(s, id), 'corp'))])),
      hqSteal: r2(t.hv.__hqSteal(s)),
      scores: `${s.corp.score}-${s.runner.score}`,
    }));
  });
}
/** The board with an agenda taken by the Runner from wherever it is (HIDDEN-READ is not needed: the Corp's own card). */
function stealOf(s: GameState, id: string, core: any): GameState {
  const x = structuredClone(s);
  const pull = (list: any[]) => {
    const i = list.findIndex(c => c.instanceId === id);
    return i >= 0 ? list.splice(i, 1)[0] : null;
  };
  let card = pull(x.corp.hq);
  for (const v of Object.values(x.corp.servers) as any[]) card ??= pull(v.root);
  if (card) {
    x.runner.scoreArea.push({ ...card, advancementCounters: 0 });
    x.runner.score += core.cardDef(card).agenda_points ?? 1;
  }
  return x;
}

async function main() {
  const arms = (process.env.ARMS ?? 'beta,heldRisk,leastBad,ownerOne,flatEverywhere').split(',') as Arm[];
  const dirs = makeTrees(resolve('node_modules/.cache/hand-price-trace'), arms.filter(a => ARMS.includes(a)));
  const boards: { name: string; s: GameState }[] = [];
  for (const b of (process.env.BOARDS ?? 'f4,report15,deal1001').split(',').filter(Boolean)) boards.push({ name: b, s: JSON.parse(readFileSync(FIX[b] ?? b, 'utf8')) });
  if (process.env.STATES)
    for (const line of readFileSync(process.env.STATES, 'utf8').split('\n'))
      if (line.startsWith('{')) {
        const r = JSON.parse(line);
        boards.push({ name: r.name, s: r.state });
      }
  for (const arm of arms) {
    const t = await loadTree(arm, dirs[arm]);
    for (const { name, s } of boards) {
      const core = t.core;
      const agendas = s.corp.hq.filter((c: any) => core.cardDef(c).type_code === 'agenda').map((c: any) => c.instanceId);
      const ag = t.createAgent('corp', 'normal');
      // the list
      t.clear();
      const ranked: any[] = t.pricing.asSide('corp', () => ag.rankMainActions(s));
      const label = (a: any) => `${a.type}${a.cardInstanceId ? ' ' + core.cardDef(core.findCardAnywhere(s, a.cardInstanceId)).title : ''}${a.targetServerId ? '>' + a.targetServerId : a.asNewRemote ? '>new' : ''}`;
      const open = ranked.filter(r => r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN');
      const intake = t.cand.plannerIntake(open, Number(process.env.K ?? 4));
      const order = ranked.slice(0, 14).map((r, i) => `${i}:${r.line}${r.behind ? 'b' : ''} ${label(r.action)}`);
      const picks = intake.picked.map((r: any) => `${label(r.action)}${intake.slots.get(r) ? ` [${intake.slots.get(r)} slot]` : ''}`);
      // the counted rule
      const rule = t.pricing.asSide('corp', () => {
        t.clear();
        t.hv.decisionContext(s, 'corp');
        const hq = t.hold.serverHold(s, 'hq', { when: 'runnerTurn', corpCredits: s.corp.credits });
        const per = agendas.map((id: string) => {
          const r = ranked.find(x => x.card === id && x.action.type === 'INSTALL_CARD');
          if (!r) return { agenda: core.cardDef(core.findCardAnywhere(s, id)).title, none: true };
          const after = core.executeAction(structuredClone(s), r.action);
          const server = (Object.values(after.corp.servers) as any[]).find(v => v.root.some((c: any) => c.instanceId === id))?.id;
          const h = server ? t.hold.serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }) : null;
          return { agenda: core.cardDef(core.findCardAnywhere(s, id)).title, line: r.line, behind: r.behind, server, holds: h?.holds, margin: r2(h?.margin), need: r2(h?.need), budget: r2(h?.budget), entries: h?.entries, remoteSteal: server ? r2(t.hv.__remoteSteal(after, server)) : null, action: r.action };
        });
        return { hq: { holds: hq.holds, entries: hq.entries, need: r2(hq.need), budget: r2(hq.budget) }, hqSteal: r2(t.hv.__hqSteal(s)), per };
      });
      // the value: four boards for the first agenda with an install candidate
      const first = rule.per.find((p: any) => p.action);
      let value: any = null;
      if (first) {
        const id = first.action.cardInstanceId;
        const installed = core.executeAction(structuredClone(s), first.action);
        value = {
          agenda: first.agenda,
          held: terms(t, s, agendas),
          installed: terms(t, installed, agendas),
          heldThenTaken: terms(t, stealOf(s, id, core), agendas),
          installedThenStolen: terms(t, stealOf(installed, id, core), agendas),
        };
      }
      // the planner's values and reply samples, and the decision
      const cands: any[] = [];
      const samples: number[][] = [];
      const dmod = await import(/* @vite-ignore */ resolve(dirs[arm], 'src/ai/diagnostics.ts'));
      t.clear();
      const decided = dmod.withDiagnostics((d: any) => {
        d.onCandidates = (side: string, values: number[], actions: GameAction[]) => {
          if (side === 'corp' && !cands.length) cands.push(...actions.map((a, i) => `${label(a)} = ${r2(values[i])}`));
        };
        d.onReplySamples = (v: number[]) => samples.push(v.map(r2));
        return t.createAgent('corp', 'normal').chooseAction(structuredClone(s));
      });
      console.log(JSON.stringify({ arm, board: name, T: s.turnNumber, cr: s.corp.credits, rcr: s.runner.credits, hq: s.corp.hq.map((c: any) => core.cardDef(c).title), decision: label(decided), order, picks, rule, value, planner: cands, replySamples: samples.slice(0, 12) }, null, 1));
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
