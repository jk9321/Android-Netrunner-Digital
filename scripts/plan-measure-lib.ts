/**
 * Corp redesign stage 0 (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0.md): the pieces of the plan-coherence
 * measure, kept apart from the CLI (scripts/plan-measure.ts) so tests/planMeasure.test.ts can check them on hand-built
 * positions. Measurement only: nothing here changes how either AI plays, and every function reads states, never edits one
 * (a state some check needs changed is a structuredClone).
 *
 * Viewpoint (spec "Viewpoint rule"): every read is something the Corp may know: its own cards, HQ, the contents (never
 * the order) of R&D, the public board, the Runner's installed cards, credits, clicks, tags and grip SIZE, and the
 * Runner's deck list. Nothing reads the Runner's grip contents or either deck's order. The one engine search used
 * (winNowAction, M2 "this turn") cuts every line that changes R&D, so it never depends on an unseen card.
 *
 *  - Turns: replayGame() steps a recorded game (the human-games report shape) and cuts it into Corp turns.
 *  - M1: labelTurn() gives each Corp turn one plan shape; commitments() / followUp() find intent flips.
 *  - M2: scoreThisTurn() (an exact engine search, plan.winNow's own) and scoreInTwo() (counting only).
 */
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere, installedIcebreakers } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { scoreThisTurn } from '../src/ai/countedScore';
import { isCorpMain } from '../src/ai/corp/lines';
import type { GameConfig } from '../src/ui/savedGame';

// ---------------------------------------------------------------------------------------------------------------- turns

export interface CorpTurn {
  turn: number;
  /** The first Corp main-phase decision of the turn (after the mandatory draw, rule 5.6.1c): full clicks. */
  start: GameState;
  /**
   * Every Corp action of the turn (prompt answers included) with the state it was taken in: from the end of the Runner's
   * turn before (its off-turn moves outside runs) through its turn-start windows to its discard.
   */
  steps: { before: GameState; action: GameAction; after: GameState }[];
  /** The state when the Runner's turn begins (the Corp's turn is over). */
  end: GameState;
  /** The Runner's actions between `end` and the next Corp turn's start. */
  runnerActions: GameAction[];
}

export interface ReplayedGame {
  config: GameConfig | { seed: number; corpDeck: GameConfig['corpDeck']; runnerDeck: GameConfig['runnerDeck']; ai: string };
  turns: CorpTurn[];
  final: GameState;
  winner: string | null;
}


/**
 * Replays a game from its seed, decks and moves (as scripts/replay-report.ts does) and cuts it into Corp turns. AI games
 * recorded by plan-measure-record.ts were played with both stops at 'ai' (GameRunner); human reports carry startStops.
 */
export function replayGame(report: { config: ReplayedGame['config']; moves: GameAction[]; startStops?: GameState['stops'] }): ReplayedGame {
  const { config, moves } = report;
  let state: GameState = createInitialGameState(deckGameSetup(config.seed, config.corpDeck, config.runnerDeck));
  const stops = report.startStops ?? (config.ai === 'both' ? { corp: 'ai', runner: 'ai' } : undefined);
  if (stops) state = { ...state, stops };
  const turns: CorpTurn[] = [];
  let current: CorpTurn | null = null;
  let offTurn: CorpTurn['steps'] = [];
  for (const action of moves) {
    if (state.winner) break;
    // The turn's record opens as the Corp's turn begins (actions in its turn-start windows count, rule 5.6.1), and its
    // start is the first main-phase decision
    if (!current && state.activePlayer === 'corp' && turns[turns.length - 1]?.turn !== state.turnNumber) {
      current = { turn: state.turnNumber, start: null as unknown as GameState, steps: offTurn, end: state, runnerActions: [] };
      offTurn = [];
    }
    if (current && !current.start && isCorpMain(state)) current.start = state;
    const side = actingSide(state);
    let after: GameState;
    try {
      after = executeAction(state, action);
    } catch {
      break; // a report cut mid-move: keep what replayed
    }
    if (current && state.activePlayer === 'corp' && side === 'corp' && current.turn === state.turnNumber) current.steps.push({ before: state, action, after });
    if (current && after.activePlayer === 'runner' && state.activePlayer === 'corp') {
      current.end = after;
      if (current.start) turns.push(current);
      current = null;
    } else if (!current && state.activePlayer === 'runner' && side === 'runner' && turns.length) {
      turns[turns.length - 1].runnerActions.push(action);
    } else if (!current && state.activePlayer === 'runner' && side === 'corp') {
      // The Corp's moves on the Runner's turn (an off-turn install, Synapse Global): steps of its next turn
      offTurn.push({ before: state, action, after });
    }
    state = after;
  }
  return { config, turns, final: state, winner: state.winner ?? null };
}

// ------------------------------------------------------------------------------------------------------------- helpers

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
export const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const idOf = (a: GameAction) => (a as { cardInstanceId?: string }).cardInstanceId;
export const serverOf = (s: GameState, id: string): string | undefined => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
const isCentral = (id: string | undefined) => id === 'hq' || id === 'rd' || id === 'archives';
const installedAgendas = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root.filter(isAgenda).map(c => ({ card: c, server: v.id })));
const text = (c: CardInstance) => cardDef(c).stripped_text ?? '';
/** An asset that makes money (its text gains credits or takes them from the Runner). */
const economyCard = (c: CardInstance) => /gain \d+\s*\[?credit|take \d+\s*\[?credit|credits? from|place \d+ \[?credit|\[credit\] on this|gain \[credit\]/i.test(text(c));
const damageCard = (c: CardInstance) => /(net|meat|core|brain) damage|give the runner \d* ?tags?|give the runner a tag|tag the runner/i.test(text(c));

/** Credits, tags and Runner damage over one step. */
const gained = (b: GameState, a: GameState) => a.corp.credits - b.corp.credits;
const hurt = (b: GameState, a: GameState) =>
  a.runner.tags > b.runner.tags || a.runner.coreDamage > b.runner.coreDamage || a.log.slice(b.log.length).some(l => l.event === 'damage');

// ---------------------------------------------------------------------------------------------------------------- M1

export type Shape = 'score' | 'kill' | 'build' | 'shore' | 'money' | 'mixed';

export interface TurnFacts {
  /** Agendas installed, advanced or scored this turn: [instance id, server id at the end of the action] */
  agendaMoves: { id: string; server: string; kind: 'install' | 'advance' | 'score' }[];
  /** Remotes that got ice (or an upgrade) this turn and hold no agenda or asset at the turn's end */
  builtRemotes: string[];
  /** Ice installed or rezzed on a central */
  centralIce: string[];
  /** Ice installed on a remote that holds an asset */
  assetIce: string[];
  hurt: boolean;
  trashedResource: boolean;
  credits: number;
  economy: number;
  draws: number;
  /** Non-agenda cards advanced (bluffs, Pharos-type ice, advanceable assets) */
  otherAdvances: number;
  other: string[];
}

/** What a Corp turn did, read from its actions (the rules for each shape: see labelTurn). */
export function turnFacts(t: CorpTurn): TurnFacts {
  const f: TurnFacts = { agendaMoves: [], builtRemotes: [], centralIce: [], assetIce: [], hurt: false, trashedResource: false, credits: 0, economy: 0, draws: 0, otherAdvances: 0, other: [] };
  const icedRemotes = new Set<string>();
  for (const { before, action, after } of t.steps) {
    const id = idOf(action);
    const card = id ? findCardAnywhere(before, id) : undefined;
    // Reactions in the Runner's runs (rezzes on approach, subroutines that hurt) are not the Corp's turn plan
    if (before.activeRun) continue;
    if (hurt(before, after)) f.hurt = true;
    // Agendas that became installed in this step, however (a basic install, or a card's install in a prompt answer)
    if (action.type !== 'INSTALL_CARD')
      for (const a of installedAgendas(after)) if (!serverOf(before, a.card.instanceId)) f.agendaMoves.push({ id: a.card.instanceId, server: a.server, kind: 'install' });
    switch (action.type) {
      case 'GAIN_CREDIT':
        f.credits++;
        break;
      case 'DRAW_CARD':
        f.draws++;
        break;
      case 'INSTALL_CARD': {
        const where = id ? serverOf(after, id) : undefined;
        if (!card || !where) break;
        if (isAgenda(card)) f.agendaMoves.push({ id: card.instanceId, server: where, kind: 'install' });
        else if (typeOf(card) === 'ice' || typeOf(card) === 'upgrade') {
          // An upgrade protects or taxes its server as ice does (Manegarm Skunkworks, Mahkota Langit Grid): the same plan step
          if (isCentral(where)) f.centralIce.push(where);
          else icedRemotes.add(where);
        } else if (typeOf(card) === 'asset' && economyCard(card)) f.economy++;
        else f.other.push(`install ${cardDef(card).title}`);
        break;
      }
      case 'ADVANCE_CARD':
        if (card && isAgenda(card)) f.agendaMoves.push({ id: card.instanceId, server: serverOf(before, card.instanceId) ?? '?', kind: 'advance' });
        else f.otherAdvances++;
        break;
      case 'SCORE_AGENDA':
        if (card) f.agendaMoves.push({ id: card.instanceId, server: serverOf(before, card.instanceId) ?? '?', kind: 'score' });
        break;
      case 'REZ_CARD': {
        const where = id ? serverOf(before, id) : undefined;
        if (typeOf(card) === 'ice' && isCentral(where)) f.centralIce.push(where!);
        else if (card && economyCard(card)) f.economy++;
        break;
      }
      case 'TRASH_RESOURCE':
        f.trashedResource = true;
        break;
      case 'PLAY_OPERATION_OR_EVENT':
      case 'USE_ABILITY': {
        // Settled when the prompts it opened are answered: judge by the turn's next main-phase state
        const settled = settledAfter(t, before);
        // Counters placed on an agenda by a card (Holo Man, Seamless Launch): an advance of that agenda (rule 1.18.2: not
        // "advancing", but the same plan step)
        for (const a of installedAgendas(settled)) {
          const was = findCardAnywhere(before, a.card.instanceId);
          if (a.card.advancementCounters > (was && serverOf(before, was.instanceId) ? was.advancementCounters : 0)) f.agendaMoves.push({ id: a.card.instanceId, server: a.server, kind: 'advance' });
        }
        if (card && (gained(before, settled) > 0 || economyCard(card))) f.economy++;
        else if (card && (hurt(before, settled) || damageCard(card))) f.hurt = f.hurt || hurt(before, settled);
        else if (card) f.other.push(`${action.type === 'USE_ABILITY' ? 'use' : 'play'} ${cardDef(card).title}`);
        break;
      }
      case 'RESOLVE_PROMPT':
      case 'PASS':
      case 'END_TURN':
        break;
      default:
        f.other.push(action.type.toLowerCase());
    }
  }
  for (const r of icedRemotes) {
    const root = t.end.corp.servers[r]?.root ?? [];
    if (root.some(isAgenda)) continue; // ice over an agenda this turn: part of the score move
    if (root.some(c => typeOf(c) === 'asset')) f.assetIce.push(r);
    else f.builtRemotes.push(r);
  }
  return f;
}

function settledAfter(t: CorpTurn, before: GameState): GameState {
  const i = t.steps.findIndex(s => s.before === before);
  for (let j = i; j < t.steps.length; j++) if (isCorpMain(t.steps[j].after) || t.steps[j].after.activePlayer !== 'corp') return t.steps[j].after;
  return t.end;
}

/**
 * One plan shape per turn, the first that applies:
 *  - score: an agenda installed, advanced or scored (target: that agenda and its server);
 *  - kill: the Runner took a tag or damage on the Corp's turn, or the Corp trashed a resource (the tag punish);
 *  - build: ice or an upgrade installed on a remote that holds no agenda or asset at the turn's end;
 *  - shore: ice or an upgrade installed on HQ, R&D or Archives, or ice rezzed there on the Corp's turn;
 *  - money: credit clicks or economy cards (operations or abilities that gained credits, economy assets), nothing
 *    committed to a server;
 *  - mixed: anything else (named: draws, a bluff advance, ice over an asset, a trap install, purge...).
 */
export function labelTurn(t: CorpTurn): { shape: Shape; detail: string } {
  const f = turnFacts(t);
  if (f.agendaMoves.length) {
    const titles = [...new Set(f.agendaMoves.map(m => `${title(t, m.id)} in ${m.server}`))].join(', ');
    return { shape: 'score', detail: `${f.agendaMoves.map(m => m.kind).join('+')}: ${titles}` };
  }
  if (f.hurt || f.trashedResource) return { shape: 'kill', detail: f.trashedResource ? 'trash resource' : 'tag/damage' };
  if (f.builtRemotes.length) return { shape: 'build', detail: f.builtRemotes.join(',') };
  if (f.centralIce.length) return { shape: 'shore', detail: [...new Set(f.centralIce)].join(',') };
  if (f.credits || f.economy) return { shape: 'money', detail: `${f.credits} credit clicks, ${f.economy} economy` };
  const named = [...(f.draws ? [`${f.draws} draws`] : []), ...(f.otherAdvances ? ['bluff/other advance'] : []), ...(f.assetIce.length ? ['ice over asset'] : []), ...f.other];
  return { shape: 'mixed', detail: named.join(', ') || 'nothing' };
}

const title = (t: CorpTurn, id: string) => {
  const c = findCardAnywhere(t.end, id) ?? findCardAnywhere(t.start, id);
  return c ? cardDef(c).title : id;
};

/** What a turn leaves committed for the next one (spec M1: a remote being built, an agenda being advanced, a tag line). */
export type Commitment = { kind: 'agenda'; id: string; server: string } | { kind: 'build'; server: string } | { kind: 'kill' };

export function commitments(t: CorpTurn, f = turnFacts(t)): Commitment[] {
  const out: Commitment[] = [];
  const standing = new Map(installedAgendas(t.end).map(a => [a.card.instanceId, a.server]));
  for (const id of new Set(f.agendaMoves.map(m => m.id))) if (standing.has(id)) out.push({ kind: 'agenda', id, server: standing.get(id)! });
  for (const r of f.builtRemotes) out.push({ kind: 'build', server: r });
  if ((f.hurt || f.trashedResource) && t.end.runner.tags > 0) out.push({ kind: 'kill' });
  return out;
}

/** Board events between two Corp turns that re-open a plan (spec M1 list). */
export interface Reasons {
  successfulRun: boolean;
  /** A successful run on the committed server (the narrow reading). */
  runOnTarget: boolean;
  lostCard: boolean;
  rigChanged: boolean;
  eventPlayed: boolean;
}

export function reasonsBetween(t: CorpTurn, next: CorpTurn, target?: string): Reasons {
  const runs = next.start.runnerLastTurnRuns ?? [];
  const cards = (s: GameState) =>
    new Set([...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]).map(c => `${c.instanceId}:${c.isRezzed ? 1 : 0}`), ...s.corp.scoreArea.map(c => c.instanceId)]);
  const before = cards(t.end);
  const after = cards(next.start);
  const lostCard = [...before].some(k => !after.has(k)) || next.start.runner.score > t.end.runner.score;
  const breakers = (s: GameState) => installedIcebreakers(s).map(c => c.instanceId).sort().join();
  const eventPlayed = t.runnerActions.some(a => a.type === 'PLAY_OPERATION_OR_EVENT');
  return {
    successfulRun: runs.some(r => r.successful),
    runOnTarget: !!target && runs.some(r => r.successful && r.server === target),
    lostCard,
    rigChanged: breakers(t.end) !== breakers(next.start),
    eventPlayed,
  };
}

/** Whether turn `next` continues or completes a commitment of the turn before. */
export function continues(c: Commitment, next: CorpTurn, f = turnFacts(next)): boolean {
  if (c.kind === 'agenda') {
    if (next.start.corp.scoreArea.some(x => x.instanceId === c.id)) return true; // completed
    if (!serverOf(next.start, c.id)) return false; // stolen or trashed: the reasons (lostCard) re-open it
    if (f.agendaMoves.some(m => m.id === c.id)) return true;
    return next.steps.some(s => s.action.type === 'INSTALL_CARD' && typeOf(findCardAnywhere(s.before, idOf(s.action)!)) === 'ice' && serverOf(s.after, idOf(s.action)!) === c.server);
  }
  if (c.kind === 'build') {
    if (!next.start.corp.servers[c.server]) return false; // the remote is gone: the reasons judge it
    return next.steps.some(s => {
      const id = idOf(s.action);
      if (!id || !['INSTALL_CARD', 'ADVANCE_CARD'].includes(s.action.type)) return false;
      return serverOf(s.after, id) === c.server && typeOf(findCardAnywhere(s.before, id)) !== 'asset';
    });
  }
  return f.hurt || f.trashedResource || next.start.runner.tags === 0;
}

/** A build commitment that could not be continued: no agenda in HQ at the next turn's start nor drawn during it. */
export function blocked(c: Commitment, next: CorpTurn): boolean {
  if (c.kind === 'build') return !next.start.corp.hq.some(isAgenda) && !next.end.corp.hq.some(isAgenda) && !next.steps.some(s => isAgenda(findCardAnywhere(s.before, idOf(s.action) ?? '')));
  if (c.kind === 'agenda') return next.start.corp.credits + next.start.corp.clicks < 2; // can't afford a single advance
  return false;
}

/**
 * A drawn card that makes a strictly cheaper plan possible: an agenda in HQ at the next turn that wasn't there before
 * and that can be scored that turn (scoreThisTurn finds a line), or that needs fewer advancements than the committed one
 * still does.
 */
export function cheaperDraw(c: Commitment, t: CorpTurn, next: CorpTurn): boolean {
  const had = new Set(t.end.corp.hq.map(x => x.instanceId));
  const fresh = next.start.corp.hq.filter(x => isAgenda(x) && !had.has(x.instanceId));
  if (!fresh.length) return false;
  if (c.kind === 'agenda') {
    const target = findCardAnywhere(next.start, c.id);
    const left = target ? (cardDef(target).advancement_cost ?? 0) - target.advancementCounters : 0;
    // install click + advancements, against the advancements the committed agenda still needs
    if (fresh.some(x => (cardDef(x).advancement_cost ?? 0) + 1 < left)) return true;
  }
  const now = scoreThisTurn(next.start);
  return now.feasible && fresh.some(x => x.instanceId === now.agendaId);
}

// ---------------------------------------------------------------------------------------------------------------- M2

// Moved to src/ai/countedScore.ts for stage 0b (spec-stage0b.md): the AI's instruments use the same check
export { scoreThisTurn } from '../src/ai/countedScore';
export { CHECK, holdCost, runnerBudget } from '../src/ai/corp/hold';
export { knownIncome, scoreInTwo } from '../src/ai/corp/lines';
export type { ThisTurn } from '../src/ai/countedScore';
export type { TwoTurnLine } from '../src/ai/corp/lines';

/** Agendas the counting cannot cost: a requirement missing, or text that changes a requirement or places counters. */
export const uncostable = (c: CardInstance) => isAgenda(c) && (cardDef(c).advancement_cost == null || /advancement requirement/i.test(text(c)));
