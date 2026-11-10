import { describe, expect, it } from 'vitest';
import { GameAction, GameState, StopLevel, actingSide, createCardInstance, executeAction, getLegalActions, newViewIds, viewFor } from '../src/core';
import { twinCompare } from '../scripts/leak-check-twin';
import { cardDef } from '../src/core';
import { installCorpForTest, newGame, setIdentity, startRunnerTurn } from './helpers';

// Card prompts that depend on a hidden card (multiplayer phase 2, chunk 2a-2). A "you may" follow-up offered only
// when a card hidden from the Runner qualifies lets the Runner read that card from who the game waits on (rules
// 4.2.2, 4.6.3). With the Corp's stops on ALL the question is always asked (askEvenIfNone); below that, the tell is
// accepted like the paid windows' AUTO tell (Jeff, 2026-11-08). Each case builds the state just before the action
// that would raise the prompt and checks the Runner's views with twinCompare (scripts/leak-check-twin.ts).

const BALANCED_COVERAGE = '34050';
const PT_UNTAIAN = '35047';
const ICE_WALL = '30072'; // Palisade (ice)
const HEDGE_FUND = '30075'; // operation
const OFFWORLD = '30067'; // agenda: can be advanced
const NICO = '30037'; // asset that can't be advanced
const POETRI = '35036'; // Poétrï Luxury Brands
const HUB = '30070'; // Superconducting Hub (agenda)
const MYCOWEB = '35053'; // code gate: install ice from Archives; rez 1 installed ice paying 2 less
const ANSEL = '30038'; // ice, rez cost 6

/** Plays the plain move (pass, continue, start or end the turn, first answer) until `until` holds for the state about to act. */
function driveTo(s: GameState, until: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 80; i++) {
    if (until(s)) return s;
    const side = actingSide(s);
    if (!side) break;
    const legal = getLegalActions(s, side);
    const pick =
      legal.find(a => a.type === 'PASS' && !a.restOfRun) ??
      legal.find(a => a.type === 'START_TURN' || a.type === 'CONTINUE_RUN') ??
      legal.find(a => a.type === 'END_TURN') ??
      legal[0];
    s = executeAction(s, pick);
  }
  throw new Error('never got there');
}

/** The first step `driveTo` would take from `s`, with the state after it. */
function plainMove(s: GameState): { action: GameAction; next: GameState } {
  const side = actingSide(s)!;
  const legal = getLegalActions(s, side);
  const action = legal.find(a => a.type === 'PASS' && !a.restOfRun) ?? legal.find(a => a.type === 'START_TURN' || a.type === 'CONTINUE_RUN') ?? legal.find(a => a.type === 'END_TURN') ?? legal[0];
  return { action, next: executeAction(s, action) };
}

const prompted = (code: string, step?: string) => (s: GameState) => s.pendingPrompts.some(p => 'source' in p && p.source.cardCode === code && (!step || p.source.step === step));

function balancedCoverage(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  installCorpForTest(s, BALANCED_COVERAGE, 'remote-1', true);
  s.corp.rd.unshift(createCardInstance(s, ICE_WALL), createCardInstance(s, HEDGE_FUND));
  startRunnerTurn(s);
  s.runner.clicks = 0;
  s = driveTo(s, prompted(BALANCED_COVERAGE, 'type'));
  const p = s.pendingPrompts[0];
  const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'ice' } };
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, executeAction(s, action), ids, 'runner', s.corp.rd[0].instanceId, s.corp.rd[1].instanceId);
}

function ptUntaian(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', PT_UNTAIAN);
  s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, NICO));
  const agenda = installCorpForTest(s, OFFWORLD, 'remote-1');
  s.corp.credits = 5;
  s.corp.clicks = 0;
  // The Corp's last move before its discard phase ends
  s = driveTo(s, st => prompted(PT_UNTAIAN)(plainMove(st).next) || st.activePlayer === 'runner');
  expect(s.activePlayer).toBe('corp');
  const { action, next } = plainMove(s);
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, next, ids, 'runner', agenda, s.corp.hq[0].instanceId);
}

/** Poétrï, an agenda stolen: may install a non-agenda card from HQ. HQ holds Nico or (twin) an agenda. */
function poetriStolen(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', POETRI);
  s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, NICO));
  installCorpForTest(s, OFFWORLD, 'remote-1');
  const facedown = installCorpForTest(s, HUB, 'remote-2');
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
  s = driveTo(s, st => prompted(POETRI)(plainMove(st).next));
  const { action, next } = plainMove(s);
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, next, ids, 'runner', facedown, s.corp.hq[0].instanceId);
}

/** Poétrï, an agenda scored: may install a non-agenda card from the top 3 of R&D. One of them is ice or (twin) an agenda. */
function poetriScored(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', POETRI);
  s.corp.rd.unshift(createCardInstance(s, ICE_WALL), createCardInstance(s, OFFWORLD), createCardInstance(s, OFFWORLD), createCardInstance(s, HUB));
  const id = installCorpForTest(s, OFFWORLD, 'remote-1');
  const agenda = s.corp.servers['remote-1'].root[0];
  agenda.advancementCounters = cardDef(agenda).advancement_cost ?? 0;
  s = driveTo(s, st => getLegalActions(st, 'corp').some(a => a.type === 'SCORE_AGENDA'));
  const action: GameAction = { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id };
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, executeAction(s, action), ids, 'runner', s.corp.rd[0].instanceId, s.corp.rd[3].instanceId);
}

/**
 * A run into a rezzed Mycoweb on R&D, its subroutines resolving. `which` 'rez': an unrezzed Palisade on HQ the Corp
 * can afford at 2 less, twin an Ansel 1.0 from HQ it can't. 'install': a facedown ice in Archives, twin a facedown Hedge Fund.
 */
function mycoweb(corpStops: StopLevel, which: 'rez' | 'install') {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, which === 'rez' ? ANSEL : HEDGE_FUND));
  const web = createCardInstance(s, MYCOWEB);
  web.isRezzed = true;
  s.corp.servers.rd.ice.push(web);
  let hidden: string;
  if (which === 'rez') {
    const wall = createCardInstance(s, ICE_WALL);
    s.corp.servers.hq.ice.push(wall);
    hidden = wall.instanceId;
  } else {
    const ice = createCardInstance(s, ICE_WALL);
    s.corp.archives.faceDown.push(ice);
    hidden = ice.instanceId;
  }
  s.corp.credits = 1;
  startRunnerTurn(s);
  s.runner.credits = 0;
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
  s = driveTo(s, st => prompted(MYCOWEB, which)(plainMove(st).next));
  const { action, next } = plainMove(s);
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, next, ids, 'runner', hidden, s.corp.hq[0].instanceId);
}

describe('Card prompts that depend on a hidden card (4.2.2, 4.6.3)', () => {
  it('Mycoweb, Corp stops on ALL: the Runner can\'t tell whether an unrezzed ice is cheap enough to rez (4.6.3)', () => {
    expect(mycoweb('full', 'rez')).toMatchObject({ kind: 'same' });
  });

  it('Mycoweb, Corp stops on AUTO: unchanged for the rez (accepted tell)', () => {
    expect(mycoweb('auto', 'rez')).toMatchObject({ kind: 'differ' });
  });

  it('Mycoweb, Corp stops on ALL: the Runner can\'t tell whether a facedown card in Archives is ice (4.4.6c)', () => {
    expect(mycoweb('full', 'install')).toMatchObject({ kind: 'same' });
  });

  it('Mycoweb, Corp stops on AUTO: unchanged for the install (accepted tell)', () => {
    expect(mycoweb('auto', 'install')).toMatchObject({ kind: 'differ' });
  });

  it('Poétrï, Corp stops on ALL: when an agenda is stolen, the Runner can\'t tell whether HQ holds a non-agenda card (4.3.2)', () => {
    expect(poetriStolen('full')).toMatchObject({ kind: 'same' });
  });

  it('Poétrï, Corp stops on AUTO: unchanged (accepted tell)', () => {
    expect(poetriStolen('auto')).toMatchObject({ kind: 'differ' });
  });

  it('Poétrï, Corp stops on ALL: when an agenda is scored, the Runner can\'t tell what the top 3 of R&D hold (4.2.2)', () => {
    expect(poetriScored('full')).toMatchObject({ kind: 'same' });
  });

  it('Poétrï, Corp stops on AUTO: unchanged after a score too (accepted tell)', () => {
    expect(poetriScored('auto')).toMatchObject({ kind: 'differ' });
  });

  it('Balanced Coverage, Corp stops on ALL: the Runner can\'t tell whether the top of R&D matched the named type (4.2.2)', () => {
    expect(balancedCoverage('full')).toMatchObject({ kind: 'same' });
  });

  it('Balanced Coverage, Corp stops on AUTO: unchanged, the follow-up comes only on a match (accepted tell)', () => {
    expect(balancedCoverage('auto')).toMatchObject({ kind: 'differ' });
  });

  it('PT Untaian, Corp stops on ALL: the Runner can\'t tell whether a facedown card can be advanced (4.6.3)', () => {
    expect(ptUntaian('full')).toMatchObject({ kind: 'same' });
  });

  it('PT Untaian, Corp stops on AUTO: unchanged, the question comes only with a target (accepted tell)', () => {
    expect(ptUntaian('auto')).toMatchObject({ kind: 'differ' });
  });
});
