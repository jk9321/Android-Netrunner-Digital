/**
 * Issue #47 (spec /mnt/project-files/netrunner-ai/fixes/spec-nan-fix.md): the Corp's board value was NaN from the move the
 * Runner installed Slap Vandal on R&D's Event Horizon. bestBreakPlan priced Slap Vandal's (and Umbrella's) boosts as
 * `0 * boostCost`, and their boostCost is Infinity (they cannot boost): 0 * Infinity = NaN, so iceWorth, evaluate and
 * modelRezGain were NaN and the Corp declined every rez, never used Send a Message and ranked every action NaN.
 *
 * Card text: Slap Vandal "Interface -> 1[credit]: Break 1 subroutine on host ice. Use this ability only once per
 * encounter." Send a Message "When this agenda is scored or stolen, you may rez 1 installed piece of ice, ignoring all
 * costs." Rules (Comprehensive Rules v26.03): 6.9.2b the Corp may rez the approached ice; 6.9.2c unrezzed ice is passed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { evaluate } from '../src/ai/evaluate';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { rezCandidates } from '../src/ai/playout';
import { bestBreakPlan } from '../src/ai/runs';
import { countedRez } from '../src/ai/corp/rez';
import { FUZZ_CORPS, FUZZ_RUNNERS, fuzzEngineGame, pairing } from '../scripts/engine-fuzz-check';

const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-47.json', import.meta.url), 'utf8'));
const moves = report.moves as GameAction[];

/** The states of Jeff's game before each recorded move, from `from` to `to`. */
function states(from: number, to: number): GameState[] {
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const out: GameState[] = [];
  for (let i = 0; i <= to; i++) {
    if (i >= from) out.push(s);
    s = executeAction(s, moves[i]);
  }
  return out;
}

const finite = (s: GameState) => (['corp', 'runner'] as const).every(side => Number.isFinite(asSide(side, () => (decisionContext(s, side), evaluate(s, side)))));
const title = (c: CardInstance | undefined) => (c ? cardDef(c).title : '');
const iceById = (s: GameState, id: string) => Object.values(s.corp.servers).flatMap(v => v.ice).find(c => c.instanceId === id);

describe('issue #47: no NaN board value with Slap Vandal installed', () => {
  // Moves 175-199: Slap Vandal installed on Event Horizon (180-181), then the turn-11 run on remote-5 and the steal
  const game = states(175, 199);
  const at = (i: number) => game[i - 175];

  it('evaluate is finite for both sides from the Slap Vandal install through the turn-11 steal', () => {
    expect(game.filter(s => !finite(s)).length).toBe(0);
  }, 120_000);

  it('Slap Vandal prices one subroutine on its host for 1 credit, never two (its card text: once per encounter)', () => {
    const s = at(195);
    const host = s.corp.servers.rd.ice.find(c => title(c) === 'Event Horizon')!;
    const one = bestBreakPlan(s, host, 1);
    expect(title(one?.breaker)).toBe('Slap Vandal');
    expect(one?.credits).toBe(1);
    // No other installed breaker breaks a sentry (Principia is a fracter): two subroutines can't be broken
    expect(bestBreakPlan(s, host, 2)).toBeNull();
  });

  it('turn-11 run on remote-5 (Send a Message behind Pharos and Bumi 1.0, Corp 18 credits): the Corp rezzes both (6.9.2b)', () => {
    const corp = createAgent('corp', 'normal');
    for (const [i, ice] of [
      [192, 'Bumi 1.0'],
      [195, 'Pharos'],
    ] as const) {
      const s = at(i);
      const approached = s.corp.servers['remote-5'].ice[s.activeRun!.icePosition!];
      expect(title(approached)).toBe(ice);
      // The counted rule has no opinion (the Runner can pay through: Principia breaks Pharos for 6 of its 9 credits,
      // Bumi 1.0 has no end-the-run subroutine), so the rez model decides, and it is no longer NaN
      expect(asSide('corp', () => (decisionContext(s, 'corp'), countedRez(s, approached)))).toBeNull();
      expect(corp.chooseRez!(s, rezCandidates(s, 'approach_ice'))).toMatchObject({ type: 'REZ_CARD', cardInstanceId: approached.instanceId });
    }
  }, 60_000);

  it("Send a Message stolen: the Corp uses its free rez on Pharos (it declined it with the NaN)", () => {
    const s = at(199);
    const pick = createAgent('corp', 'normal').chooseAction(s) as { type: string; choice?: { cardInstanceIds?: string[] } };
    expect(pick.type).toBe('RESOLVE_PROMPT');
    expect((pick.choice?.cardInstanceIds ?? []).map(id => title(iceById(s, id)))).toEqual(['Pharos']);
  }, 60_000);
});

// Guard: the next NaN in the AI's board value fails CI. The tier-1 fuzz games (tests/engineFuzz.test.ts: fixed seeds,
// every deck on its side, random legal moves), replayed with evaluate checked for both sides every 10th action and at
// the end. It catches issue #47 on the code before the fix (game 18, step 19). About 30 s.
describe('evaluate stays finite (guard)', () => {
  it('over the tier-1 fuzz games, both sides, every 10th action', () => {
    const bad: string[] = [];
    const games = Math.max(FUZZ_CORPS.length, FUZZ_RUNNERS.length);
    for (let g = 0; g < games; g++) {
      const { corp, runner } = pairing(g);
      const res = fuzzEngineGame(1 + g, corp, runner, { maxSteps: 250 });
      let s: GameState = { ...createInitialGameState(deckGameSetup(1 + g, corp, runner)), stops: res.stops };
      res.actions.forEach((a, i) => {
        s = executeAction(s, a);
        if ((i % 10 === 9 || i === res.actions.length - 1) && !finite(s)) bad.push(`game ${g} (${corp.id} v ${runner.id}) step ${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  }, 180_000);
});
