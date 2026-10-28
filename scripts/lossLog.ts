/**
 * Game logging for AI batches: plays one AI-vs-AI game and records how it
 * ended and where each Runner point came from (which server, how much ice,
 * how advanced the agenda was). Used by ai-match.ts and corp-losses.ts;
 * loss-summary.mjs prints the breakdown.
 */
import { GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { rezCost } from '../src/core/engine/cardEffects';
import { CardInstance } from '../src/core';
import { iceCost } from '../src/ai/runs';
import { Agent, GameRunner } from '../src/ai';

export interface Steal {
  turn: number;
  points: number;
  /** hq, rd, archives, remote, or other (points not from a run) */
  from: string;
  ice: number;
  rezzedIce: number;
  /** Advancement counters on the agenda (remote steals) */
  advanced: number;
  /** The agenda could have been scored already (remote steals) */
  scoreable: boolean;
  corpCredits: number;
  /** Agendas in HQ just before the steal (HQ steals) */
  hqAgendas: number;
  hqSize: number;
  title: string;
  /** Remotes with ice when it was stolen (spread) */
  icedRemotes: number;
  /**
   * Unrezzed ice on the server at the steal: none, 'declined' (the Corp had
   * the credits to rez the cheapest of it and didn't), or 'broke' (it
   * couldn't afford any of it)
   */
  unrezzed?: 'none' | 'declined' | 'broke';
  /** Broke steals: was the Corp already short of rezzing all this server's ice when the Runner's turn began, or did it spend the money during that turn? */
  brokeWhen?: 'turn start' | 'during turn';
  /** Remote steals: the agenda was installed during the Corp's last turn */
  freshAgenda?: boolean;
  /** Credits the Runner spent during the run that stole it */
  runnerPaid?: number;
  /**
   * Ice that would have stopped this Runner (its rig can't break it, or it
   * costs more than the Runner had at the start of the run): installed on a
   * server holding nothing that matters, held in HQ, or nowhere
   */
  stopperAt?: 'low-value server' | 'hq' | 'none';
  /** Broke steals: a rez on a low-value server in the last 2 turns cost enough to have rezzed the cheapest ice here */
  savedRezWouldCover?: boolean;
}

export interface AgendaInstall {
  turn: number;
  ice: number;
  rezzed: number;
  /** Unrezzed ice the Corp could still pay to rez after the install, cheapest first */
  affordable: number;
  /** What the rezzed and affordable ice would cost this Runner to get through (Infinity: can't) */
  entryCost: number;
  runnerCredits: number;
  /** Advancements still needed, and whether the rest of this turn's clicks could finish it */
  need: number;
  finishable: boolean;
  outcome: 'scored' | 'stolen' | 'other' | 'still out';
  /** Corp turns it sat installed before the outcome */
  turnsOut: number;
}

/** Rezzes during runs, and how many were on servers holding nothing that matters to the Corp */
export interface RezLog {
  total: number;
  credits: number;
  low: number;
  lowCredits: number;
}

export interface GameRecord {
  corpDeck: string;
  runnerDeck: string;
  winner: string;
  reason: string;
  turns: number;
  corpScore: number;
  runnerScore: number;
  steals: Steal[];
  /** Agendas still in R&D / HQ when the game ended */
  agendasInRD: number;
  agendasInHQ: number;
  /** Turns the Corp spent with an agenda in hand and no remote holding one */
  idleAgendaTurns: number;
  /** Averages over the Corp's turns: remotes, remotes with ice, ice in remotes, ice on the best-iced remote, ice on HQ and R&D */
  board: { remotes: number; icedRemotes: number; remoteIce: number; maxRemoteIce: number; hqIce: number; rdIce: number };
  /** Runner runs: how many, and the failed ones where it had already paid to break ice (see RunWaste) */
  runs: RunWaste;
  /** Corp credits spent and gained over the game, by what for (see moneyKind) */
  rezzes: RezLog;
  /** Every agenda installed in a remote: the server when it went in, and what became of it */
  agendaInstalls: AgendaInstall[];
  /** At the start of the Runner's turns 1 and 2: which centrals had ice, and what ice the Corp still held */
  early: { turn: number; rdIce: number; hqIce: number; remoteIce: number; iceInHand: number; cheapIceInHand: number; hqAgendas: number; credits: number }[];
  money: { spent: Record<string, number>; gained: Record<string, number>; corpTurns: number; creditsAtTurnEnd: number; clicks: number; creditClicks: number };
}

/** What a step that changed the Corp's credits did, read from the state change. */
function moneyKind(before: GameState, after: GameState): string {
  const ice = (st: GameState) => Object.values(st.corp.servers).flatMap(sv => sv.ice);
  const root = (st: GameState) => Object.values(st.corp.servers).flatMap(sv => sv.root);
  const rezzed = (list: { isRezzed: boolean }[]) => list.filter(c => c.isRezzed).length;
  const counters = (st: GameState) => [...root(st), ...ice(st)].reduce((n, c) => n + c.advancementCounters, 0);
  if (rezzed(ice(after)) > rezzed(ice(before))) return before.activeRun ? 'rez ice in a run' : 'rez ice';
  if (rezzed(root(after)) > rezzed(root(before))) return 'rez asset/upgrade';
  if (ice(after).length > ice(before).length) return 'install ice';
  if (counters(after) > counters(before)) return 'advance';
  if (before.activePlayer === 'runner' || before.activeRun) return "runner's turn";
  if (after.corp.clicks === before.corp.clicks - 1 && after.corp.hq.length === before.corp.hq.length && after.corp.credits === before.corp.credits + 1) return 'click for credit';
  if (after.corp.archives.faceUp.length > before.corp.archives.faceUp.length || after.corp.hq.length < before.corp.hq.length) return 'operation/install';
  if (after.corp.clicks === before.corp.clicks) return 'turn start/assets';
  return 'other';
}

/**
 * Runs the Runner paid into (boosting or breaking) and then lost: jacked out
 * or stopped by ice. `known` means the ice that stopped it was rezzed when
 * the run began (it could have budgeted for it); `fresh` means the Corp
 * rezzed it during the run.
 */
export interface RunWaste {
  total: number;
  paidAndFailed: number;
  credits: number;
  jackOutKnown: number;
  jackOutFresh: number;
  stoppedKnown: number;
  stoppedFresh: number;
}

function unrezzedAtSteal(state: GameState, server: GameState['corp']['servers'][string] | undefined): Steal['unrezzed'] {
  const costs = (server?.ice ?? []).filter(i => !i.isRezzed).map(i => rezCost(state, i));
  if (costs.length === 0) return 'none';
  return Math.min(...costs) <= state.corp.credits ? 'declined' : 'broke';
}

function brokeWhen(start: GameState | null, serverId: string | null): Steal['brokeWhen'] {
  const server = start && serverId ? start.corp.servers[serverId] : undefined;
  if (!start || !server) return undefined;
  const total = server.ice.filter(i => !i.isRezzed).reduce((n, i) => n + rezCost(start, i), 0);
  return total > start.corp.credits ? 'turn start' : 'during turn';
}

type Server = GameState['corp']['servers'][string];

/** A server where the Corp knows nothing important is at stake: no agenda in it (HQ, Archives, remotes); R&D always matters. */
function lowValue(state: GameState, server: Server): boolean {
  if (server.id === 'rd') return false;
  if (server.id === 'hq') return !state.corp.hq.some(isAgenda);
  if (server.id === 'archives') return !state.corp.archives.faceDown.some(isAgenda);
  return !server.root.some(isAgenda);
}

/** Would this ice stop the Runner: its rig can't break it, or it costs more than `credits`? */
function stops(state: GameState, ice: CardInstance, credits: number): boolean {
  const cost = iceCost(state, { ...ice, isRezzed: true });
  return cost === Infinity || cost > credits;
}

function stopperAt(state: GameState, serverId: string, credits: number): Steal['stopperAt'] {
  const elsewhere = Object.values(state.corp.servers).filter(sv => sv.id !== serverId && lowValue(state, sv));
  if (elsewhere.some(sv => sv.ice.some(i => stops(state, i, credits)))) return 'low-value server';
  if (state.corp.hq.some(c => cardDef(c).type_code === 'ice' && stops(state, c, credits))) return 'hq';
  return 'none';
}

function trackAgendas(state: GameState, all: AgendaInstall[], open: Map<string, AgendaInstall>) {
  const seen = new Set<string>();
  for (const server of Object.values(state.corp.servers)) {
    if (!server.isRemote) continue;
    for (const card of server.root) {
      if (!isAgenda(card)) continue;
      seen.add(card.instanceId);
      if (open.has(card.instanceId)) continue;
      let credits = state.corp.credits;
      let affordable = 0;
      let entryCost = 0;
      for (const ice of [...server.ice].sort((a, b) => rezCost(state, a) - rezCost(state, b))) {
        if (!ice.isRezzed) {
          if (rezCost(state, ice) > credits) continue;
          credits -= rezCost(state, ice);
          affordable++;
        }
        entryCost += iceCost(state, { ...ice, isRezzed: true });
      }
      const need = (cardDef(card).advancement_cost ?? 0) - card.advancementCounters;
      const record: AgendaInstall = {
        turn: state.turnNumber,
        ice: server.ice.length,
        rezzed: server.ice.filter(i => i.isRezzed).length,
        affordable,
        entryCost,
        runnerCredits: state.runner.credits,
        need,
        finishable: need <= Math.min(state.corp.clicks, state.corp.credits),
        outcome: 'still out',
        turnsOut: 0,
      };
      open.set(card.instanceId, record);
      all.push(record);
    }
  }
  for (const [id, record] of open) {
    if (seen.has(id)) continue;
    record.outcome = state.corp.scoreArea.some(c => c.instanceId === id) ? 'scored' : state.runner.scoreArea.some(c => c.instanceId === id) ? 'stolen' : 'other';
    record.turnsOut = state.turnNumber - record.turn;
    open.delete(id);
  }
}

const isAgenda = (c: { cardCode: string }) => cardDef(c as never).type_code === 'agenda';

function reasonOf(state: GameState): string {
  const r = state.winReason ?? '';
  if (!state.winner) return 'unfinished';
  if (/flatline/i.test(r)) return 'flatline';
  if (/decked/i.test(r)) return 'corp decked';
  if (/conceded/i.test(r)) return 'conceded';
  return state.winner === 'corp' ? 'corp points' : 'runner points';
}

/** Plays a game to the end (or the step/turn limits) and records it. */
export function playLogged(start: GameState, agents: { corp: Agent; runner: Agent }, decks: { corp: string; runner: string }): GameRecord {
  const runner = new GameRunner(start, agents);
  const steals: Steal[] = [];
  let idleAgendaTurns = 0;
  const board = { remotes: 0, icedRemotes: 0, remoteIce: 0, maxRemoteIce: 0, hqIce: 0, rdIce: 0 };
  let corpTurns = 0;
  let lastTurn = -1;
  const money: GameRecord['money'] = { spent: {}, gained: {}, corpTurns: 0, creditsAtTurnEnd: 0, clicks: 0, creditClicks: 0 };
  const runs: RunWaste = { total: 0, paidAndFailed: 0, credits: 0, jackOutKnown: 0, jackOutFresh: 0, stoppedKnown: 0, stoppedFresh: 0 };
  let rezzedAtStart = new Set<string>();
  let paid = 0;
  let startCredits = 0;
  const early: GameRecord['early'] = [];
  const agendaInstalls: AgendaInstall[] = [];
  const openAgendas = new Map<string, AgendaInstall>();
  const rezzes: RezLog = { total: 0, credits: 0, low: 0, lowCredits: 0 };
  const lowRezzes: { turn: number; cost: number }[] = [];
  let runnerTurnStart: GameState | null = null;
  let corpTurnStart: GameState | null = null;
  const traced = !!process.env.TRACE;
  let tracedTurn = -1;
  let t0 = Date.now();
  for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
    const before = runner.state;
    if (traced && before.turnNumber !== tracedTurn) {
      console.error(`  turn ${before.turnNumber} ${before.activePlayer} step ${steps} +${((Date.now() - t0) / 1000).toFixed(1)} s`);
      tracedTurn = before.turnNumber;
      if (Number(process.env.STOP_TURN ?? 0) === before.turnNumber) process.exit(0);
      t0 = Date.now();
    }
    if (before.activePlayer === 'runner' && runnerTurnStart?.turnNumber !== before.turnNumber) {
      runnerTurnStart = before;
      if (before.turnNumber <= 2) {
        const ice = before.corp.hq.filter(c => cardDef(c).type_code === 'ice');
        early.push({
          turn: before.turnNumber,
          rdIce: before.corp.servers.rd.ice.length,
          hqIce: before.corp.servers.hq.ice.length,
          remoteIce: Object.values(before.corp.servers).filter(sv => sv.isRemote).reduce((n, sv) => n + sv.ice.length, 0),
          iceInHand: ice.length,
          cheapIceInHand: ice.filter(c => (cardDef(c).cost ?? 0) <= before.corp.credits).length,
          hqAgendas: before.corp.hq.filter(isAgenda).length,
          credits: before.corp.credits,
        });
      }
    }
    if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
      corpTurnStart = before;
      lastTurn = before.turnNumber;
      const remoteAgenda = Object.entries(before.corp.servers).some(([id, s]) => id.startsWith('remote') && s.root.some(isAgenda));
      if (!remoteAgenda && before.corp.hq.some(isAgenda)) idleAgendaTurns++;
      const remotes = Object.values(before.corp.servers).filter(s => s.isRemote);
      corpTurns++;
      board.remotes += remotes.length;
      board.icedRemotes += remotes.filter(s => s.ice.length > 0).length;
      board.remoteIce += remotes.reduce((n, s) => n + s.ice.length, 0);
      board.maxRemoteIce += Math.max(0, ...remotes.map(s => s.ice.length));
      board.hqIce += before.corp.servers.hq.ice.length;
      board.rdIce += before.corp.servers.rd.ice.length;
    }
    if (!runner.step()) break;
    const after = runner.state;
    trackAgendas(after, agendaInstalls, openAgendas);
    const delta = after.corp.credits - before.corp.credits;
    if (delta !== 0) {
      const kind = moneyKind(before, after);
      const book = delta < 0 ? money.spent : money.gained;
      book[kind] = (book[kind] ?? 0) + Math.abs(delta);
    }
    if (before.activePlayer === 'corp' && !before.activeRun && after.corp.clicks < before.corp.clicks) {
      money.clicks += before.corp.clicks - after.corp.clicks;
      if (moneyKind(before, after) === 'click for credit') money.creditClicks++;
    }
    if (before.activePlayer === 'corp' && after.activePlayer === 'runner') {
      money.corpTurns++;
      money.creditsAtTurnEnd += after.corp.credits;
    }
    const run = before.activeRun;
    if (run) {
      const server = before.corp.servers[run.server];
      const fresh = server?.ice.find(i => !i.isRezzed && after.corp.servers[run.server]?.ice.some(a => a.instanceId === i.instanceId && a.isRezzed));
      if (server && fresh) {
        const cost = Math.max(0, before.corp.credits - after.corp.credits);
        rezzes.total++;
        rezzes.credits += cost;
        if (lowValue(before, server)) {
          rezzes.low++;
          rezzes.lowCredits += cost;
          lowRezzes.push({ turn: before.turnNumber, cost });
        }
      }
    }
    if (!run && after.activeRun) {
      runs.total++;
      paid = 0;
      startCredits = after.runner.credits + after.activeRun.bonusCredits;
      rezzedAtStart = new Set(Object.values(after.corp.servers).flatMap(sv => sv.ice.filter(i => i.isRezzed).map(i => i.instanceId)));
    }
    // Credits spent while the encounter stays open: boosts and breaks (subroutines resolve as it closes)
    const pool = (st: GameState) => st.runner.credits + (st.activeRun?.bonusCredits ?? 0);
    if (run?.encounter && after.activeRun?.encounter && run.encounter.resolvingIndex === null && after.activeRun.encounter.resolvingIndex === null) {
      paid += Math.max(0, pool(before) - pool(after));
    }
    if (run && !after.activeRun) {
      const ended = after.runsThisTurn[after.runsThisTurn.length - 1];
      if (ended && !ended.successful && paid > 0) {
        const ice = before.corp.servers[run.server]?.ice ?? [];
        runs.paidAndFailed++;
        runs.credits += paid;
        if (run.phase === 'movement') {
          // Jacked out: what lay ahead
          const ahead = ice.slice(0, run.icePosition ?? 0).filter(i => i.isRezzed);
          if (ahead.some(i => rezzedAtStart.has(i.instanceId))) runs.jackOutKnown++;
          else runs.jackOutFresh++;
          if (process.env.RUN_DEBUG)
            console.error(
              `JACKOUT ${run.server} credits@start=${startCredits} now=${pool(before)} paid=${paid} ice(out->in)=${[...ice]
                .reverse()
                .map(i => `${cardDef(i).title}${rezzedAtStart.has(i.instanceId) ? '[K]' : i.isRezzed ? '[R]' : '[u]'}`)
                .join(',')} pos=${run.icePosition} bonus=${run.bonusCredits}`
            );
        } else {
          const stopper = run.icePosition !== null ? ice[run.icePosition] : undefined;
          if (stopper && rezzedAtStart.has(stopper.instanceId)) runs.stoppedKnown++;
          else runs.stoppedFresh++;
        }
      }
    }
    const gained = after.runner.score - before.runner.score;
    if (gained <= 0) continue;
    const serverId = before.activeRun?.server ?? after.activeRun?.server ?? null;
    const server = serverId ? before.corp.servers[serverId] : undefined;
    const stolen = after.runner.scoreArea.filter(a => !before.runner.scoreArea.some(b => b.instanceId === a.instanceId));
    const agenda = stolen[0] ? (server?.root.find(x => x.instanceId === stolen[0].instanceId) ?? null) : null;
    const def = agenda ? cardDef(agenda) : null;
    steals.push({
      turn: before.turnNumber,
      points: gained,
      from: !serverId ? 'other' : serverId.startsWith('remote') ? 'remote' : serverId,
      ice: server?.ice.length ?? 0,
      rezzedIce: server?.ice.filter(i => i.isRezzed).length ?? 0,
      advanced: agenda?.advancementCounters ?? 0,
      scoreable: !!agenda && !!def && (agenda.advancementCounters ?? 0) >= (def.advancement_cost ?? 99),
      corpCredits: before.corp.credits,
      hqAgendas: before.corp.hq.filter(isAgenda).length,
      hqSize: before.corp.hq.length,
      title: stolen[0] ? cardDef(stolen[0]).title : '?',
      icedRemotes: Object.values(before.corp.servers).filter(s => s.isRemote && s.ice.length > 0).length,
      unrezzed: unrezzedAtSteal(before, server),
      brokeWhen: brokeWhen(runnerTurnStart, serverId),
      runnerPaid: before.activeRun ? Math.max(0, startCredits - pool(before)) : undefined,
      stopperAt: serverId && before.activeRun ? stopperAt(before, serverId, startCredits) : undefined,
      savedRezWouldCover: (() => {
        const costs = (server?.ice ?? []).filter(i => !i.isRezzed).map(i => rezCost(before, i));
        if (costs.length === 0 || Math.min(...costs) <= before.corp.credits) return false;
        return lowRezzes.some(r => before.turnNumber - r.turn <= 2 && r.cost + before.corp.credits >= Math.min(...costs));
      })(),
      freshAgenda: !!agenda && !!corpTurnStart && !Object.values(corpTurnStart.corp.servers).some(sv => sv.root.some(c => c.instanceId === agenda.instanceId)),
    });
  }
  const s = runner.state;
  return {
    corpDeck: decks.corp,
    runnerDeck: decks.runner,
    winner: s.winner ?? 'draw',
    reason: reasonOf(s),
    turns: s.turnNumber,
    corpScore: s.corp.score,
    runnerScore: s.runner.score,
    steals,
    agendasInRD: s.corp.rd.filter(isAgenda).length,
    agendasInHQ: s.corp.hq.filter(isAgenda).length,
    idleAgendaTurns,
    board: Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v / Math.max(corpTurns, 1)])) as GameRecord['board'],
    runs,
    rezzes,
    agendaInstalls,
    early,
    money,
  };
}
