import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { agendaWorth } from '../src/ai/evaluate';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { clickOnly } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';
import { sideCreditValue } from '../src/ai/valueModel';

/**
 * Jeff's bug report (issue #2, 2026-10-31; LEO Construction vs Vic, Hard Corp): at 0 credits
 * with Petty Cash x3 and Hedge Fund in HQ, the Corp installed agenda after agenda in bare
 * remotes (turns 14-19) instead of clicking for credits, and the Runner took three of them in
 * one turn. Advancing is "[click], 1[credit]" (rule 5.2.6), so at 0 credits an agenda can't be
 * finished this turn on clicks alone. Agenda tempo counted only clicks: a bare agenda the Corp
 * had 3 clicks for looked scoreable this turn, every click spent looked like a lost score,
 * and taking a credit ranked far below another bare install.
 *
 * The fixture is the reported game rebuilt at the start of the Corp's turn 17 (the steals and
 * installs of turns 17-19 put back): 0 credits; HQ Petty Cash x3, Hedge Fund, Project Ingatan,
 * Méliès City Luxury Line, Anthill Excavation Contract; Méliès bare in Remote 4, Project Ingatan bare in Remote 9.
 */
const turn17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-2-turn17.json', import.meta.url), 'utf8'));

const bareAgendas = (s: GameState) =>
  Object.values(s.corp.servers).filter(sv => sv.isRemote && sv.ice.length === 0 && sv.root.some(c => cardDef(c).type_code === 'agenda')).length;

function playTurn(s: GameState, corp = createAgent('corp', 'normal')): GameState {
  for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
    const action = corp.chooseAction(s);
    s = executeAction(s, action);
    if (action.type === 'END_TURN') break;
  }
  return s;
}

describe('a Corp with no credits (Jeff’s bug report, plan.agendaCredits)', () => {
  it('an agenda it can’t pay to advance is not counted as scored this turn', () => {
    const s = turn17();
    const rich = { ...s, corp: { ...s.corp, credits: 3 } };
    expect(agendaWorth(s, 0, 3, 2, 'remote-9')).toBeLessThan(agendaWorth(rich, 0, 3, 2, 'remote-9') - 5);
  });

  it('ranks taking a credit above another bare agenda', () => {
    const s = turn17();
    const ranked = new HeuristicCorpAI({ planner: false }).rankMainActions(s);
    const credit = ranked.findIndex(r => r.action.type === 'GAIN_CREDIT');
    const bare = ranked.findIndex(r => r.action.type === 'INSTALL_CARD' && r.action.asNewRemote && cardDef(s.corp.hq.find(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId)!).type_code === 'agenda');
    expect(credit).toBeGreaterThanOrEqual(0);
    expect(credit).toBeLessThan(bare);
  });

  it('installs no more bare agendas (Normal and Hard)', () => {
    expect(bareAgendas(turn17())).toBe(2);
    // At most the two already out (an asset installed over a bare agenda trashes it facedown, rules 8.5.6a, 4.4.6b)
    expect(bareAgendas(playTurn(turn17()))).toBeLessThanOrEqual(2);
    expect(bareAgendas(playTurn(turn17(), createAgent('corp', 'hard', { samples: 6, seed: 1 })))).toBeLessThanOrEqual(2);
  // 410 s: twice the slowest of the last five beta CI runs (205 s, run 43507030194; 144-205 s in runs 43504371759 to
  // 43510792338, audit Step 0d)
  }, 410_000);

});

/**
 * Jeff, same report: "a broke Corp can't do anything since it can't rez ice". The credit slide prices each
 * credit at up to 1.8 when broke, but credits are lumpy: Petty Cash needs 3 before the turn's first action.
 * The same position at 3 credits and a Corp score of 1 (so Send a Message doesn't win the game).
 */
/** The same board with no agendas out or in HQ and no operations in HQ: Humanoid Resources is the play. */
function idle(): GameState {
  const s = threeCredits();
  for (const server of Object.values(s.corp.servers)) {
    s.corp.rd.push(...server.root.filter(c => cardDef(c).type_code === 'agenda'));
    server.root = server.root.filter(c => cardDef(c).type_code !== 'agenda');
  }
  s.corp.hq = s.corp.hq.filter(c => !['operation', 'agenda'].includes(cardDef(c).type_code));
  return s;
}

function threeCredits(): GameState {
  const s = turn17();
  s.corp.credits = 3;
  s.corp.score = 1;
  s.corp.scoreArea = [];
  return s;
}

describe('credits a broke Corp needs (Jeff, plan.moneyReach, agendaBudget, plannerScores, rezWhenUsed, openStealUnrun)', () => {
  it('credits that pay for Petty Cash in HQ are worth the money it unlocks', () => {
    const s = threeCredits();
    const at = (credits: number) => sideCreditValue({ ...s, corp: { ...s.corp, credits } }, 'corp', 'corp');
    // dropping to 2 loses Petty Cash for next turn (plan.heldMoney: half its gain less the click's credit, 0.5)
    expect(at(3) - at(2)).toBeGreaterThan(0.4);
    expect(sideCreditValue(s, 'corp', 'runner')).toBeLessThan(at(3)); // the Runner can't see HQ
  });

  // (2026-11-03, bug report #5) Petty Cash first, or the two advances first and a credit click: the planner
  // scores the lines 30.4 vs 30.9, a call its sampled Runner reply decides (the Runner no longer trashes the
  // spent Spin Doctor in it). Either way Send a Message is finished and the Corp isn't left broke.
  // (2026-11-04, plan.archivesChosen at 0.05: the Petty Cash line, then 1 credit on The Red Room, leaves 6; a
  // 1-credit rez is not going broke, so 6 is the floor.)
  it('finishes Send a Message this turn and keeps credits to rez with (Normal)', () => {
    let s = threeCredits();
    const corp = createAgent('corp', 'normal');
    s = playTurn(s, corp);
    expect(s.corp.score).toBe(4);
    expect(s.corp.credits + s.corp.hq.filter(c => cardDef(c).title === 'Petty Cash').length * 2).toBeGreaterThanOrEqual(6);
  }, 60_000); // a whole planned turn: about 4 s here, over vitest's 5 s default on CI since the Corp's effect values came back on

  it('two agendas share one turn’s clicks: only one of them looks scored this turn', { timeout: 30_000 }, () => {
    const s = threeCredits();
    // Send a Message (2 to go) and Project Ingatan (3 to go) with 3 clicks: Petty Cash is still a candidate
    const ranked = new HeuristicCorpAI({ planner: false }).rankMainActions(s);
    const petty = ranked.findIndex(r => r.action.type === 'PLAY_OPERATION_OR_EVENT');
    expect(petty).toBeGreaterThanOrEqual(0);
    expect(petty).toBeLessThan(4); // in the planner's four candidates
  });

  it('Humanoid Resources is rezzed only with the 3 clicks to use it (rule 5.6.2a: a rez window before every action)', () => {
    const s = idle();
    const hr = Object.values(s.corp.servers).flatMap(v => v.root).find(c => c.cardCode === '35039')!;
    expect(clickOnly(hr)).toBe(3);
    const rezzesHr = (clicks: number) => {
      const st = { ...s, corp: { ...s.corp, clicks } };
      return new HeuristicCorpAI({ planner: false }).rankMainActions(st).some(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === hr.instanceId && r.score > -Infinity);
    };
    // plan.ownIceKnown (2026-11-09) pinned off for the one-step check: with it a credit no longer buys the Brân on empty
    // Archives the rez budget won't fund, so using Humanoid Resources scores 2.06 against the free The Red Room rez's 2.15
    // and rezToUse's "the use is the next best play" reads no; the turn still rezzes and uses it (below)
    tuning.plan.ownIceKnown = false;
    try {
      expect(rezzesHr(1)).toBe(false);
      expect(rezzesHr(3)).toBe(true);
    } finally {
      tuning.plan.ownIceKnown = true;
    }
    // The whole turn with it on: The Red Room, then Humanoid Resources rezzed and used
    let t: GameState = { ...s, corp: { ...s.corp, clicks: 3 } };
    const ai = new HeuristicCorpAI({ planner: false });
    for (let i = 0; i < 6 && t.activePlayer === 'corp'; i++) {
      const action = ai.chooseAction(t);
      t = executeAction(t, action);
      if (action.type === 'END_TURN') break;
    }
    expect([...t.corp.archives.faceUp, ...t.corp.archives.faceDown].some(c => c.instanceId === hr.instanceId)).toBe(true);
  }, 60_000);
});

describe('Humanoid Resources is rezzed to be used (Jeff 2026-10-31: "it rezzes it but never seems to use it"; plan.rezToUse)', () => {
  const hrOf = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root).find(c => c.cardCode === '35039')!;

  it('not in the window before the turn begins (rule 5.6.1b), where it would sit rezzed and unused', () => {
    const s = { ...threeCredits(), turnStep: { kind: 'corp_turn_start' as const } };
    const hr = hrOf(s);
    expect(new HeuristicCorpAI({ planner: false }).rankMainActions(s).some(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === hr.instanceId && r.score > -Infinity)).toBe(false);
  });

  it('a rez in the action phase is followed by using it (the rule-based ranking)', () => {
    let s = idle();
    const hr = hrOf(s);
    const corp = new HeuristicCorpAI({ planner: false });
    let rezzed = false;
    for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
      const action = corp.chooseAction(s);
      if (rezzed) {
        expect(action).toMatchObject({ type: 'USE_ABILITY', cardInstanceId: hr.instanceId });
        return;
      }
      if (action.type === 'REZ_CARD' && action.cardInstanceId === hr.instanceId) rezzed = true;
      s = executeAction(s, action);
      if (action.type === 'END_TURN') break;
    }
    expect(rezzed).toBe(true);
  });
});
