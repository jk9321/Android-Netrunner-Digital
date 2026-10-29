import { describe, expect, it } from 'vitest';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { installCorpForTest, newGame, run, startRunnerTurn } from './helpers';

const NICO = '30037';

describe('money assets wait for the window before the Corp’s turn (rules 5.6.1b-d; plan.assetRezTiming)', () => {
  const rezScore = (turnStart: boolean) => {
    const s = newGame();
    s.activePlayer = 'corp';
    s.corp.credits = 10;
    const id = installCorpForTest(s, NICO, 'remote-1');
    if (turnStart) s.turnStep = { kind: 'corp_turn_start' };
    const ranked = new HeuristicCorpAI({ planner: false }).rankMainActions(s);
    return ranked.find(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === id)?.score;
  };

  it('in the action phase, Nico Campaign is not rezzed (the Runner would trash it full)', () => {
    expect(rezScore(false) ?? -Infinity).toBe(-Infinity);
  });

  it('just before the turn begins, it is rezzed and pays at once', () => {
    expect(rezScore(true)).toBeGreaterThan(0);
  });
});

describe('Spin Doctor waits for a run or the turn start (Jeff, 2026-10-29; plan.spinDoctorWait)', () => {
  const SPIN = '30053';
  const setup = (hq: number) => {
    const s = newGame();
    s.activePlayer = 'corp';
    s.corp.credits = 5;
    s.corp.hq = s.corp.hq.slice(0, hq);
    const id = installCorpForTest(s, SPIN, 'remote-1');
    return { s, id };
  };
  const score = (s: ReturnType<typeof newGame>, id: string) =>
    new HeuristicCorpAI({ planner: false }).rankMainActions(s).find(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === id)?.score ?? -Infinity;

  it('not rezzed in the action phase for an ordinary draw', () => {
    const { s, id } = setup(4);
    expect(score(s, id)).toBe(-Infinity);
  });

  it('rezzed in the action phase when HQ is all but empty', () => {
    const { s, id } = setup(1);
    expect(score(s, id)).toBeGreaterThan(0);
  });
});

describe('Spin Doctor in a run on its server', () => {
  it('is rezzed when the Runner approaches the server: the same 2 cards, and the run spent', () => {
    const s = newGame();
    const id = installCorpForTest(s, '30053', 'remote-1');
    startRunnerTurn(s);
    const r = run(s, 'remote-1');
    expect(r.activeRun?.phase).toBe('approach_server');
    const card = r.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    expect(new HeuristicCorpAI({ planner: false }).chooseRez(r, [card])).toMatchObject({ type: 'REZ_CARD', cardInstanceId: id });
  });
});
