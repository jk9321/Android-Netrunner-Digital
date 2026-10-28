import { describe, expect, it } from 'vitest';
import { PETTY_CASH_REPLAY, iceAdvanceWorth, placedCounterWorth, rezEffectWorth, rezzedWorth, topDownWorth } from '../src/ai/effectValues';
import { CLICK, RATES } from '../src/ai/valueModel';
import { createCardInstance } from '../src/core/engine/gameState';
import { newGame } from './helpers';
import { HeuristicCorpAI } from '../src/ai';
import { GameState, cardDef } from '../src/core';

describe('value hacks replaced by the model (Jeff, 2026-10-28; plan.modelHacks)', () => {
  it('Ping: its rez tag is worth a tag', () => {
    const s = newGame();
    expect(rezEffectWorth(createCardInstance(s, '30055'), 3)).toBe(3);
    expect(rezEffectWorth(createCardInstance(s, '30072'), 3)).toBe(0); // Palisade: nothing on rez
  });

  it('Idiosyncresis and Clearinghouse are worth rezzing only with counters on them', () => {
    const s = newGame();
    const idio = createCardInstance(s, '35061');
    expect(rezzedWorth(s, idio, 1)).toBeLessThan(0);
    idio.advancementCounters = 2;
    expect(rezzedWorth(s, idio, 1)).toBe(9);
    const clearing = createCardInstance(s, '30061');
    expect(rezzedWorth(s, clearing, 0)).toBeLessThan(0);
  });

  it('Pharos: an advance is worth its share of the +5 strength at 3 counters, nothing once there', () => {
    const s = newGame();
    const pharos = createCardInstance(s, '30063');
    pharos.advancementCounters = 2;
    const at = (n: number) => (n >= 3 ? 8 : 2);
    expect(iceAdvanceWorth(s, pharos, at)).toBe(6);
    pharos.advancementCounters = 3;
    expect(iceAdvanceWorth(s, pharos, at)).toBe(0);
  });

  it('a placed counter: on an agenda behind ice, its share of the points; on a bare trap, the bluff and the damage', () => {
    const s = newGame();
    const agenda = createCardInstance(s, '30069');
    expect(placedCounterWorth(s, agenda, true)).toBeGreaterThan(placedCounterWorth(s, agenda, false));
    const urtica = createCardInstance(s, '30045');
    expect(placedCounterWorth(s, urtica, false)).toBeGreaterThan(1);
  });

  it('Petty Cash replays for its net 2 credits; Top-Down Solutions is 2 cards and free installs', () => {
    expect(PETTY_CASH_REPLAY).toBeCloseTo(1.7);
    expect(topDownWorth(2)).toBeCloseTo(2 * RATES.drawnCard + CLICK);
    expect(topDownWorth(0)).toBeCloseTo(2 * RATES.drawnCard - CLICK);
  });
});

describe('the last two hacks on the model (Jeff, 2026-10-28; plan.modelHacks.finish, .conduit)', () => {
  const nanoGame = (agendaCost: boolean) => {
    const s = structuredClone(newGame());
    const nano = createCardInstance(s, '35043');
    s.corp.hq = [nano, ...s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda').slice(0, 2)];
    const agenda = createCardInstance(s, agendaCost ? '30068' : '30069'); // Orbital Superiority (4) or Send a Message (5)
    const ice = createCardInstance(s, '30072');
    ice.isRezzed = true;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'remote-9', isRemote: true, ice: [ice], root: [agenda] };
    s.corp.clicks = 3;
    s.corp.credits = 10;
    agenda.advancementCounters = (cardDef(agenda).advancement_cost ?? 0) - 4; // 4 to go: 3 clicks can't, Nanomanagement's 4 can
    return { s, nano };
  };
  const score = (s: GameState, id: string) => new HeuristicCorpAI({ planner: false }).rankMainActions(s).find(r => r.action.type === 'PLAY_OPERATION_OR_EVENT' && r.action.cardInstanceId === id)?.score ?? -Infinity;
  const credit = (s: GameState) => new HeuristicCorpAI({ planner: false }).rankMainActions(s).find(r => r.action.type === 'GAIN_CREDIT')!.score;

  it('Nanomanagement: worth the agenda it lets the Corp score this turn, in points on the clock', () => {
    const { s, nano } = nanoGame(true);
    expect(score(s, nano.instanceId)).toBeGreaterThan(credit(s) + 5);
    expect(score(s, nano.instanceId)).toBeLessThan(40); // a value, not a priority tier
  });

  it('Nanomanagement with nothing to finish: just 2 clicks for 4 credits and a click', () => {
    const { s, nano } = nanoGame(true);
    s.corp.servers['remote-9'].root = [];
    expect(score(s, nano.instanceId)).toBeLessThan(credit(s));
  });

  it('Conduit: ice on R&D is worth more the more counters it has', () => {
    const s = structuredClone(newGame());
    const palisade = createCardInstance(s, '30072');
    s.corp.hq = [palisade];
    const conduit = createCardInstance(s, '30024');
    s.runner.rig.programs = [conduit];
    const rdIce = () => new HeuristicCorpAI({ planner: false }).rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === palisade.instanceId && r.action.targetServerId === 'rd')!.score;
    const none = rdIce();
    conduit.tokens = { ...conduit.tokens, virus: 3 };
    expect(rdIce()).toBeGreaterThan(none);
  });
});
