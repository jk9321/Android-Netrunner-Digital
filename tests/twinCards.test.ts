import { describe, expect, it } from 'vitest';
import { GameAction, GameState, SideCode, StopLevel, actingSide, cardDef, createCardInstance, executeAction, getLegalActions, newViewIds, viewFor } from '../src/core';
import { markSubroutinesBroken } from '../src/core/engine/ice';
import { twinCompare, twinCompareDeclined } from '../scripts/leak-check-twin';
import { installCorpForTest, installIceForTest, newGame, setIdentity, startRunnerTurn } from './helpers';

// Card prompts that depend on a hidden card (multiplayer phase 2, chunk 2a-2). A "you may" follow-up offered only
// when a card hidden from the Runner qualifies lets the Runner read that card from who the game waits on (rules
// 4.2.2, 4.6.3). With the Corp's stops on ALL the question is always asked (askEvenIfNone); below that, the tell is
// accepted like the paid windows' AUTO tell (Jeff, 2026-11-08). Each case builds the state just before the action
// that would raise the prompt and checks the blind side's views with twinCompare (scripts/leak-check-twin.ts), then
// one answer further with twinCompareDeclined: S declines the real question, the twin gives the one answer (2a-3).
// The same holds for the Runner's grip and stack against the Corp (4.2.2, 4.3.2).

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
const MALAPERT = '30066';
const EMBEDDED = '35059'; // Embedded Reporting
const INGATAN = '35038'; // Project Ingatan
const TOP_DOWN = '35044'; // Top-Down Solutions
const HUMANOID = '35039'; // Humanoid Resources
const MERCIA = '35045';
const MITRA = '35056'; // Mitra Aman
const ABLATIVE = '34034'; // Ablative Barrier
const A_TEIA = '34039';
const TATU = '34044'; // Tatu-Bola
const PIVOT = '34062';
const TRIBUTARY = '34111';
const KINGMAKING = '34113';
const SUDDEN = '34119'; // Sudden Commandment
const EMINENT = '34122'; // Eminent Domain
const DESCENT = '34125';
const SKIMMING = '34011'; // Chrysopoeian Skimming
const BAZ = '35012'; // Barry "Baz" Wong
const SEBASTIAO = '34066';
const MEETING = '34076'; // Meeting of Minds
const WINDOW = '34077'; // Window of Opportunity
const FOF = '34074'; // Friend of a Friend (connection resource)
const TELEWORK = '30027'; // resource
const SURE_GAMBLE = '30030'; // event
const CLEAVER = '30006'; // program
const PING = '30055'; // ice: gives a tag when rezzed during a run on its server

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

/** S just before `action`; S and the twin (codes of `a` and `b` swapped) differ in a card hidden from `blind`. */
type Case = { s: GameState; action: GameAction; a: string; b: string; blind: SideCode };
const idsOf = (c: Case) => viewFor(c.s, c.blind, newViewIds(), 'g').ids;
const compare = (c: Case) => twinCompare(c.s, c.action, executeAction(c.s, c.action), idsOf(c), c.blind, c.a, c.b);
const declined = (c: Case) => twinCompareDeclined(c.s, c.action, idsOf(c), c.blind, c.a, c.b);

const corpStops = (s: GameState, level: StopLevel) => void (s.stops = { corp: level, runner: 'full' });
const runnerStops = (s: GameState, level: StopLevel) => void (s.stops = { corp: 'full', runner: level });
const make = (s: GameState, code: string) => createCardInstance(s, code);
/** Replaces HQ with new cards; returns their ids. */
const setHQ = (s: GameState, ...codes: string[]) => (s.corp.hq.splice(0, s.corp.hq.length, ...codes.map(c => make(s, c))), s.corp.hq.map(c => c.instanceId));
const setGrip = (s: GameState, ...codes: string[]) => (s.runner.grip.splice(0, s.runner.grip.length, ...codes.map(c => make(s, c))), s.runner.grip.map(c => c.instanceId));
const facedownInArchives = (s: GameState, code: string) => (s.corp.archives.faceDown.push(make(s, code)), s.corp.archives.faceDown.at(-1)!.instanceId);
const rdBottom = (s: GameState, code: string) => (s.corp.rd.push(make(s, code)), s.corp.rd.at(-1)!.instanceId);
const stackBottom = (s: GameState, code: string) => (s.runner.stack.push(make(s, code)), s.runner.stack.at(-1)!.instanceId);
function advanced(s: GameState, code: string, server: string): string {
  const id = installCorpForTest(s, code, server);
  const agenda = s.corp.servers[server].root.find(c => c.instanceId === id)!;
  agenda.advancementCounters = cardDef(agenda).advancement_cost ?? 0;
  return id;
}
/** Plays plain moves until `action` (matched on its own fields) is legal for its player. */
function driveToLegal(s: GameState, action: GameAction): GameState {
  const matches = (x: GameAction) => Object.entries(action).every(([k, v]) => (x as unknown as Record<string, unknown>)[k] === v);
  return driveTo(s, st => actingSide(st) === action.player && getLegalActions(st, action.player).some(matches));
}
/** Plays `action` and the plain moves after it (the other side's window to respond) until `code` asks. */
function playThrough(s: GameState, action: GameAction, code: string, step?: string): GameState {
  return driveTo(executeAction(driveToLegal(s, action), action), prompted(code, step));
}
/** The move that makes `code` ask: `action` itself, or the plain move after it (the other side passing its window). */
function lastMoveBefore(s: GameState, action: GameAction, code: string, step?: string): { s: GameState; action: GameAction } {
  const before = driveToLegal(s, action);
  const next = executeAction(before, action);
  if (prompted(code, step)(next)) return { s: before, action };
  const last = driveTo(next, st => prompted(code, step)(plainMove(st).next));
  return { s: last, action: plainMove(last).action };
}
/** The asked side's "no" to the pending question. */
function decline(s: GameState): GameAction {
  const side = actingSide(s)!;
  const no = getLegalActions(s, side).find(
    a => a.type === 'RESOLVE_PROMPT' && ((a.choice.kind === 'effect_cards' && a.choice.cardInstanceIds.length === 0) || (a.choice.kind === 'effect_choice' && a.choice.optionId === 'no'))
  );
  if (!no) throw new Error('no decline');
  return no;
}
const choose = (s: GameState, optionId: string): GameAction => {
  const p = s.pendingPrompts[0];
  return { type: 'RESOLVE_PROMPT', player: p.side, promptId: p.id, choice: { kind: 'effect_choice', optionId } };
};
/** The Corp's last move before its action or discard phase ends, when `code` asks. */
function corpTurnEnd(s: GameState, code: string): GameState {
  s.corp.clicks = 0;
  s = driveTo(s, st => prompted(code)(plainMove(st).next) || st.activePlayer === 'runner');
  expect(s.activePlayer).toBe('corp');
  return s;
}

function balancedCoverage(corpStops: StopLevel): Case {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  installCorpForTest(s, BALANCED_COVERAGE, 'remote-1', true);
  s.corp.rd.unshift(createCardInstance(s, ICE_WALL), createCardInstance(s, HEDGE_FUND));
  startRunnerTurn(s);
  s.runner.clicks = 0;
  s = driveTo(s, prompted(BALANCED_COVERAGE, 'type'));
  const p = s.pendingPrompts[0];
  const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'ice' } };
  return { s, action, a: s.corp.rd[0].instanceId, b: s.corp.rd[1].instanceId, blind: 'runner' };
}

function ptUntaian(corpStops: StopLevel): Case {
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
  return { s, action: plainMove(s).action, a: agenda, b: s.corp.hq[0].instanceId, blind: 'runner' };
}

/** Poétrï, an agenda stolen: may install a non-agenda card from HQ. HQ holds Nico or (twin) an agenda. */
function poetriStolen(corpStops: StopLevel): Case {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', POETRI);
  s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, NICO));
  installCorpForTest(s, OFFWORLD, 'remote-1');
  const facedown = installCorpForTest(s, HUB, 'remote-2');
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
  s = driveTo(s, st => prompted(POETRI)(plainMove(st).next));
  return { s, action: plainMove(s).action, a: facedown, b: s.corp.hq[0].instanceId, blind: 'runner' };
}

/** Poétrï, an agenda scored: may install a non-agenda card from the top 3 of R&D. One of them is ice or (twin) an agenda. */
function poetriScored(corpStops: StopLevel): Case {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', POETRI);
  s.corp.rd.unshift(createCardInstance(s, ICE_WALL), createCardInstance(s, OFFWORLD), createCardInstance(s, OFFWORLD), createCardInstance(s, HUB));
  const id = advanced(s, OFFWORLD, 'remote-1');
  s = driveTo(s, st => getLegalActions(st, 'corp').some(a => a.type === 'SCORE_AGENDA'));
  const action: GameAction = { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id };
  return { s, action, a: s.corp.rd[0].instanceId, b: s.corp.rd[3].instanceId, blind: 'runner' };
}

/**
 * A run into a rezzed Mycoweb on R&D, its subroutines resolving. `which` 'rez': an unrezzed Palisade on HQ the Corp
 * can afford at 2 less, twin an Ansel 1.0 from HQ it can't. 'install': a facedown ice in Archives, twin a facedown Hedge Fund.
 */
function mycoweb(corpStops: StopLevel, which: 'rez' | 'install'): Case {
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
  return { s, action: plainMove(s).action, a: hidden, b: s.corp.hq[0].instanceId, blind: 'runner' };
}

// --- Chunk 2a-3: the cards the fuzz did not reach ---------------------------------------------------------------

/** Malapert Data Vault, an agenda scored from its server: R&D holds a non-agenda card or (twin) only agendas (4.2.2). */
function malapert(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  s.corp.rd.splice(0, s.corp.rd.length, make(s, OFFWORLD), make(s, OFFWORLD), make(s, ICE_WALL));
  const ice = s.corp.rd[2].instanceId;
  const [agenda] = setHQ(s, HUB); // not the scored agenda's title: its log line would name the hidden card
  installCorpForTest(s, MALAPERT, 'remote-1', true);
  const id = advanced(s, OFFWORLD, 'remote-1');
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  const action: GameAction = { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id };
  s = driveToLegal(s, action);
  return { s, action, a: ice, b: agenda, blind: 'runner' };
}

/** A dividend agenda with a counter as the discard phase ends. Embedded Reporting: an operation in R&D or (twin) none (4.2.2). Project Ingatan: a facedown ice in Archives or (twin) an operation (4.4.6c). */
function dividend(code: string, level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const agenda = make(s, code);
  agenda.isRezzed = true;
  agenda.tokens.agenda = 1;
  s.corp.scoreArea.push(agenda);
  let a: string, b: string;
  if (code === EMBEDDED) {
    s.corp.rd.splice(0, s.corp.rd.length, make(s, ICE_WALL), make(s, ICE_WALL), make(s, HEDGE_FUND));
    a = s.corp.rd[2].instanceId;
    [b] = setHQ(s, ICE_WALL);
  } else {
    a = facedownInArchives(s, ICE_WALL);
    [b] = setHQ(s, HEDGE_FUND);
  }
  s = corpTurnEnd(s, code);
  return { s, action: plainMove(s).action, a, b, blind: 'runner' };
}

/** Top-Down Solutions: install up to 2 cards from HQ. HQ holds a Palisade or (twin) only operations (4.3.2). */
function topDown(level: StopLevel): Case {
  const s = newGame(5);
  corpStops(s, level);
  const [td, ice] = setHQ(s, TOP_DOWN, ICE_WALL);
  s.corp.rd.unshift(make(s, HEDGE_FUND), make(s, HEDGE_FUND));
  const b = facedownInArchives(s, HEDGE_FUND);
  s.corp.credits = 10;
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  const m = lastMoveBefore(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: td }, TOP_DOWN);
  return { ...m, a: ice, b, blind: 'runner' };
}

/** Humanoid Resources, the install declined: you may play 1 operation from HQ. HQ holds Hedge Fund or (twin) Nico (4.3.2). */
function humanoid(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [, hedge] = setHQ(s, NICO, HEDGE_FUND);
  const b = facedownInArchives(s, NICO);
  const hr = installCorpForTest(s, HUMANOID, 'remote-1', true);
  s.corp.rd.unshift(make(s, OFFWORLD), make(s, OFFWORLD), make(s, OFFWORLD));
  s.corp.credits = 10;
  const use: GameAction = { type: 'USE_ABILITY', player: 'corp', cardInstanceId: hr, abilityIndex: 0 };
  s = playThrough(s, use, HUMANOID, 'install_pick');
  return { s, action: decline(s), a: hedge, b, blind: 'runner' };
}

/** Mercia B4LL4RD as the action phase ends: HQ holds a Palisade or (twin) Hedge Fund (4.3.2). */
function mercia(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [ice] = setHQ(s, ICE_WALL);
  const b = facedownInArchives(s, HEDGE_FUND);
  installCorpForTest(s, MERCIA, 'remote-1', true);
  s = corpTurnEnd(s, MERCIA);
  return { s, action: plainMove(s).action, a: ice, b, blind: 'runner' };
}

/** Mitra Aman, trashed as the Runner approaches: may swap in ice from HQ, which holds a Palisade or (twin) Hedge Fund (4.3.2). */
function mitra(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [ice] = setHQ(s, ICE_WALL);
  const b = rdBottom(s, HEDGE_FUND);
  installCorpForTest(s, MITRA, 'remote-1', true);
  installIceForTest(s, ICE_WALL, 'remote-1', true);
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
  s = driveTo(s, prompted(MITRA, 'trash'));
  return { s, action: choose(s, 'trash'), a: ice, b, blind: 'runner' };
}

/** Ablative Barrier rezzed during a run on its server (Threat 3): HQ holds Nico or (twin) an agenda (4.3.2). */
function ablative(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  s.corp.score = 3;
  const [nico] = setHQ(s, NICO);
  const b = rdBottom(s, OFFWORLD);
  const abl = installIceForTest(s, ABLATIVE, 'remote-1', false);
  s.corp.credits = 20;
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
  const action: GameAction = { type: 'REZ_CARD', player: 'corp', cardInstanceId: abl };
  return { s: driveToLegal(s, action), action, a: nico, b, blind: 'runner' };
}

/** A Teia, the first install in a remote this turn: HQ still holds Nico or (twin) Hedge Fund (4.3.2). */
function aTeia(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  setIdentity(s, 'corp', A_TEIA);
  const [first, nico] = setHQ(s, OFFWORLD, NICO);
  const b = facedownInArchives(s, HEDGE_FUND);
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  s = driveTo(s, st => actingSide(st) === 'corp' && getLegalActions(st, 'corp').some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === first));
  const install = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === first && (a.asNewRemote || a.targetServerId?.startsWith('remote')))!;
  expect(install).toBeDefined();
  return { ...lastMoveBefore(s, install, A_TEIA), a: nico, b, blind: 'runner' };
}

/** Tatu-Bola passed: may swap in ice from HQ, which holds a Palisade or (twin) Hedge Fund (4.3.2). */
function tatuBola(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [ice] = setHQ(s, ICE_WALL);
  const b = rdBottom(s, HEDGE_FUND);
  installIceForTest(s, TATU, 'archives', true);
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
  s = structuredClone(driveTo(s, st => !!st.activeRun?.encounter));
  markSubroutinesBroken(s, [0], null);
  s = driveTo(s, st => prompted(TATU)(plainMove(st).next));
  return { s, action: plainMove(s).action, a: ice, b, blind: 'runner' };
}

/** Pivot (Threat 3), the search come up empty: may play or install from HQ, which holds Nico or (twin) a Hedge Fund the Corp can't afford (4.3.2). */
function pivot(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  s.corp.score = 3;
  s.corp.rd.splice(0, s.corp.rd.length, make(s, ICE_WALL), make(s, ICE_WALL), make(s, ICE_WALL));
  const [pv, nico] = setHQ(s, PIVOT, NICO);
  const b = facedownInArchives(s, HEDGE_FUND);
  s.corp.credits = 1;
  s.corp.clicks = 2; // Pivot's click and its extra click are the last: without a question the turn moves on
  const play: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: pv };
  s = playThrough(s, play, PIVOT, 'search');
  return { s, action: decline(s), a: nico, b, blind: 'runner' };
}

/** Tributary's first subroutine, the draw declined: may install ice from HQ, which holds a Palisade or (twin) Hedge Fund (4.3.2). */
function tributary(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [ice] = setHQ(s, ICE_WALL);
  const b = rdBottom(s, HEDGE_FUND);
  installIceForTest(s, TRIBUTARY, 'archives', true);
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
  s = driveTo(s, prompted(TRIBUTARY, 'draw'));
  return { s, action: decline(s), a: ice, b, blind: 'runner' };
}

/** Kingmaking scored, no cards drawn: HQ holds a 1-point agenda or (twin) Hedge Fund (4.3.2). */
function kingmaking(level: StopLevel): Case {
  let s = newGame(5);
  corpStops(s, level);
  const [hub] = setHQ(s, HUB);
  const b = facedownInArchives(s, HEDGE_FUND);
  const id = advanced(s, KINGMAKING, 'remote-1');
  const score: GameAction = { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id };
  s = playThrough(s, score, KINGMAKING, 'draw');
  return { s, action: choose(s, '0'), a: hub, b, blind: 'runner' };
}

/** Sudden Commandment: may play a non-terminal operation from HQ, which holds Hedge Fund or (twin) Nico (4.3.2). */
function sudden(level: StopLevel): Case {
  const s = newGame(5);
  corpStops(s, level);
  const [sc, hedge] = setHQ(s, SUDDEN, HEDGE_FUND);
  const b = facedownInArchives(s, NICO);
  s.corp.rd.unshift(make(s, OFFWORLD), make(s, OFFWORLD));
  s.corp.credits = 10;
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  return { ...lastMoveBefore(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: sc }, SUDDEN), a: hedge, b, blind: 'runner' };
}

/** Eminent Domain trashed from HQ: install and rez 1 card from HQ, which holds Nico or (twin) Hedge Fund (4.3.2). */
function eminent(level: StopLevel): Case {
  const s = newGame(5);
  corpStops(s, level);
  const [ed, nico] = setHQ(s, EMINENT, NICO);
  const b = facedownInArchives(s, HEDGE_FUND);
  s.corp.credits = 10;
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  return { ...lastMoveBefore(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: ed, abilityIndex: 0 }, EMINENT), a: nico, b, blind: 'runner' };
}

/** Descent trashed from HQ: reveal up to 2 agendas in HQ or Archives. HQ holds an agenda or (twin) Nico (4.3.2). */
function descent(level: StopLevel): Case {
  const s = newGame(5);
  corpStops(s, level);
  const [d, agenda] = setHQ(s, DESCENT, OFFWORLD);
  const b = rdBottom(s, NICO);
  s.corp.rd.unshift(make(s, HEDGE_FUND));
  s.corp.credits = 10;
  s.corp.clicks = 1; // the last click: without a question the turn moves on
  return { ...lastMoveBefore(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: d, abilityIndex: 0 }, DESCENT), a: agenda, b, blind: 'runner' };
}

/** Chrysopoeian Skimming: the Corp may reveal an agenda from HQ, which holds one or (twin) Nico (4.3.2). The Corp is asked. */
function skimming(level: StopLevel): Case {
  const s = newGame(5);
  corpStops(s, level);
  const [agenda] = setHQ(s, OFFWORLD);
  const b = rdBottom(s, NICO);
  startRunnerTurn(s);
  const [ev] = setGrip(s, SKIMMING);
  s.runner.credits = 5;
  return { ...lastMoveBefore(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: ev }, SKIMMING), a: agenda, b, blind: 'runner' };
}

/** Baz Wong as the Corp rezzes ice: the grip holds Telework Contract or (twin) Sure Gamble (4.3.2). */
function baz(level: StopLevel): Case {
  let s = newGame(5);
  runnerStops(s, level);
  setIdentity(s, 'runner', BAZ);
  const [res] = setGrip(s, TELEWORK);
  const b = stackBottom(s, SURE_GAMBLE);
  const ice = installIceForTest(s, ICE_WALL, 'hq', false);
  s.corp.credits = 10;
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
  const action: GameAction = { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice };
  return { s: driveToLegal(s, action), action, a: res, b, blind: 'corp' };
}

/** Sebastião tagged by Ping's rez: the grip holds Friend of a Friend or (twin) Sure Gamble (4.3.2). */
function sebastiao(level: StopLevel): Case {
  let s = newGame(5);
  runnerStops(s, level);
  setIdentity(s, 'runner', SEBASTIAO);
  const [fof] = setGrip(s, FOF);
  const b = stackBottom(s, SURE_GAMBLE);
  const ice = installIceForTest(s, PING, 'hq', false);
  s.corp.credits = 10;
  startRunnerTurn(s);
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
  const action: GameAction = { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice };
  return { s: driveToLegal(s, action), action, a: fof, b, blind: 'corp' };
}

/**
 * Meeting of Minds, connection named. 'search': the stack holds a connection or (twin) none (4.2.2). 'reveal': the
 * search declined, the grip holds Friend of a Friend or (twin) Sure Gamble (4.3.2).
 */
function meeting(level: StopLevel, which: 'search' | 'reveal'): Case {
  let s = newGame(5);
  runnerStops(s, level);
  startRunnerTurn(s);
  s.runner.credits = 10;
  s.runner.clicks = 1; // the last click: without a question the turn moves on
  const [m, other] = setGrip(s, MEETING, which === 'search' ? SURE_GAMBLE : FOF);
  s.runner.stack.splice(0, s.runner.stack.length, make(s, SURE_GAMBLE), make(s, SURE_GAMBLE), make(s, FOF), make(s, FOF));
  const play: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: m };
  s = playThrough(s, play, MEETING, 'subtype');
  if (which === 'search') {
    s.runner.stack.splice(2, 1); // one connection left in the stack
    return { s, action: choose(s, 'connection'), a: s.runner.stack[2].instanceId, b: other, blind: 'corp' };
  }
  s = executeAction(s, choose(s, 'connection'));
  expect(prompted(MEETING, 'search')(s)).toBe(true);
  return { s, action: decline(s), a: other, b: s.runner.stack[0].instanceId, blind: 'corp' };
}

/** Window of Opportunity: may install a program or hardware from the grip, which holds Cleaver or (twin) Sure Gamble (4.3.2). */
function windowOf(level: StopLevel): Case {
  const s = newGame(5);
  runnerStops(s, level);
  startRunnerTurn(s);
  s.runner.credits = 10;
  const [w, prog] = setGrip(s, WINDOW, CLEAVER);
  const b = stackBottom(s, SURE_GAMBLE);
  return { ...lastMoveBefore(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: w }, WINDOW, 'install'), a: prog, b, blind: 'corp' };
}

/**
 * name, rule, case, and whether at AUTO the wait shows in one step. It does when, without the question, the game
 * would move on to the other side (PT Untaian at the end of the turn, a run going on past Tatu-Bola). It doesn't when
 * the asked side acts next anyway (its own action phase, its rez window): there the question adds one exchange the
 * blind side sees nothing of but the time it takes, and ALL still asks every time (Jeff's stops policy, 2026-11-09).
 */
const CASES: [string, string, (level: StopLevel) => Case, boolean][] = [
  ['Mycoweb rez', '4.6.3', l => mycoweb(l, 'rez'), true],
  ['Mycoweb install from Archives', '4.4.6c', l => mycoweb(l, 'install'), true],
  ['Poétrï, agenda stolen', '4.3.2', poetriStolen, true],
  ['Poétrï, agenda scored', '4.2.2', poetriScored, true],
  ['Balanced Coverage', '4.2.2', balancedCoverage, true],
  ['PT Untaian', '4.6.3', ptUntaian, true],
  ['Embedded Reporting', '4.2.2', l => dividend(EMBEDDED, l), true],
  ['Project Ingatan', '4.4.6c', l => dividend(INGATAN, l), true],
  ['Mercia B4LL4RD', '4.3.2', mercia, true],
  ['Mitra Aman', '4.3.2', mitra, true],
  ['Tatu-Bola', '4.3.2', tatuBola, true],
  ['Tributary', '4.3.2', tributary, true],
  ['Kingmaking', '4.3.2', kingmaking, true],
  ['Humanoid Resources, play an operation', '4.3.2', humanoid, true],
  ['Chrysopoeian Skimming (the Corp asked)', '4.3.2', skimming, true],
  ['Barry "Baz" Wong', '4.3.2', baz, true],
  ['Sebastião Souza Pessoa', '4.3.2', sebastiao, true],
  ['Malapert Data Vault', '4.2.2', malapert, false],
  ['Top-Down Solutions', '4.3.2', topDown, false],
  ['Ablative Barrier', '4.3.2', ablative, false],
  ['A Teia', '4.3.2', aTeia, false],
  ['Pivot', '4.3.2', pivot, false],
  ['Sudden Commandment', '4.3.2', sudden, false],
  ['Eminent Domain', '4.3.2', eminent, false],
  ['Descent', '4.3.2', descent, false],
  ['Meeting of Minds, reveal from the grip', '4.3.2', l => meeting(l, 'reveal'), false],
  ['Meeting of Minds, search the stack', '4.2.2', l => meeting(l, 'search'), false],
  ['Window of Opportunity', '4.3.2', windowOf, false],
];

describe('Card prompts that depend on a hidden card (4.2.2, 4.3.2, 4.4.6c, 4.6.3)', () => {
  for (const [name, rule, build, waitShows] of CASES) {
    it(`${name}, stops on ALL: the blind side can't tell the hidden card, before or after the answer (${rule})`, () => {
      expect(compare(build('full'))).toMatchObject({ kind: 'same' });
      expect(declined(build('full'))).toMatchObject({ kind: 'same' });
    });
    it(`${name}, stops on AUTO: unchanged, the question comes only when a card qualifies (accepted tell)`, () => {
      const c = build('auto');
      if (waitShows) expect(compare(c)).toMatchObject({ kind: 'differ' });
      else {
        // The asked side acts next either way: the views match, and only S has the question
        expect(compare(c)).toMatchObject({ kind: 'same' });
        expect(executeAction(c.s, c.action).pendingPrompts.some(p => p.side === (c.blind === 'corp' ? 'runner' : 'corp') && 'source' in p)).toBe(true);
      }
    });
  }

  it('Window of Opportunity, stops on AUTO: the twin skips the install question (accepted tell, one decision fewer)', () => {
    const c = windowOf('auto');
    expect(prompted(WINDOW, 'install')(executeAction(c.s, c.action))).toBe(true);
    const twin = structuredClone(c.s);
    const grip = twin.runner.grip.find(x => x.instanceId === c.a)!;
    const stack = twin.runner.stack.find(x => x.instanceId === c.b)!;
    [grip.cardCode, stack.cardCode] = [stack.cardCode, grip.cardCode];
    expect(prompted(WINDOW, 'run')(executeAction(twin, c.action))).toBe(true);
  });
});
