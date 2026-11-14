/**
 * Roadmap step 3 Part A (/mnt/project-files/netrunner-ai/redesign/spec-step3-rez.md): measure the Corp's in-run rez
 * decisions with no behaviour change. Plays deals with the shipped AI (Normal v Normal) and watches every rez window
 * on approached ice (rules 6.4.3, 6.9.2b-c), counting:
 *  M1 held line broken: a two-turn line held (corpAI heldLine), and in the Runner's turn the Corp (a) declined ice in
 *     the line's hold set (countedScore.ts holdCost's cheapest set) or (b) rezzed ice outside it and then could not
 *     afford the set;
 *  M2 declined stopper: declined a rez the Runner could not have paid through (iceCreditNeed against its credits then),
 *     then the Runner stole an agenda on that run;
 *  M3 paid for nothing: rezzed ice the Runner paid through and still got in, no agenda in the root, rez cost > toll;
 *  M4 Jeff's HQ rule: an HQ run with an agenda in HQ, affordable rezzable ice approached, declined;
 *  M5 Jeff's R&D rule: an R&D run with installed R&D multi-access, or no agenda in HQ while agendas remain unseen,
 *     affordable rezzable ice approached, declined;
 *  M6 Archives: ice installed or rezzed on Archives with no agenda there and no Runner Archives card (installed or in
 *     its deck list); and agendas discarded at hand size while a non-agenda stayed in HQ.
 * One JSON line per deal on stdout; scripts/rez-look-sum.mjs sums them.
 *
 *   SEEDS=1001,1011 npx vite-node scripts/rez-look.ts
 *   REPORTS=33,34 npx vite-node scripts/rez-look.ts   (Jeff's Runner games: the recorded moves replayed)
 */
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, rezCostOf } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner, rezCandidates } from '../src/ai/playout';
import { HeldLine, runnerBudget } from '../src/ai/countedScore';
import { iceCreditNeed } from '../src/ai/runs';
import { valueLoops } from '../src/ai/valueModel';

const title = (c: CardInstance) => cardDef(c).title;
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const BLOCKED = 1e6;

// Measurement-only card lists (Part B moves the kept ones into card entries): Runner cards that access more of R&D
// while installed (Conduit with virus counters, Devadatta Drone with power counters, Rotary, Manuel Lattes de Moura
// while tagged, "Pretty" Mary da Silva, Mercury's identity), and Runner cards that turn an Archives run into something
// else (Maintenance Access, Baker, Eru Ayase-Pessoa, Privileged Access, Charm Offensive, Heliamphora, Nurse Hạnh, and
// the three-centrals cards Chain Reaction, The Wizard's Chest, Jeitinho)
const RD_MULTI = new Set(['30024', '35031', '36014', '34075', '34093', '34010']);
const ARCHIVES_PAYOFF = new Set(['35016', '36015', '34007', '34068', '35003', '34072', '36007', '36001', '34070', '34079']);

function rdMultiAccess(s: GameState): boolean {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources, s.runner.identity];
  return rig.some(c => {
    if (!RD_MULTI.has(c.cardCode)) return false;
    if (c.cardCode === '30024') return (c.tokens.virus ?? 0) > 0;
    if (c.cardCode === '35031') return (c.tokens.power ?? 0) > 0;
    if (c.cardCode === '34075') return s.runner.tags > 0;
    return true;
  });
}

/** Agendas the Corp knows are not in R&D: HQ, installed, either score area, Archives (its own, both faces). */
function agendasKnown(s: GameState): number {
  const zones = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root), ...s.corp.scoreArea, ...s.runner.scoreArea, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown];
  return zones.filter(isAgenda).length;
}

/** A view with this ice rezzed (iceCreditNeed reads the board for strength). */
function withRezzed(s: GameState, ice: CardInstance): { view: GameState; up: CardInstance } {
  const up = { ...ice, isRezzed: true };
  const server = Object.values(s.corp.servers).find(v => v.ice.some(c => c.instanceId === ice.instanceId))!;
  const view = { ...s, corp: { ...s.corp, servers: { ...s.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
  return { view, up };
}

/** holdCost's cheapest rez set (countedScore.ts), returned as the set itself: the ice ids to rez, and their rez cost. */
function holdSet(s: GameState, ice: CardInstance[], corpCredits: number): { ids: Set<string>; cost: number } | null {
  const budget = runnerBudget(s);
  const view: GameState = { ...s, runner: { ...s.runner, clicks: Math.max(0, s.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  let best: { ids: Set<string>; cost: number } | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    const ids = new Set<string>();
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) {
        rez = Infinity;
        break;
      }
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) {
        rez += rezCostOf(view, c);
        ids.add(c.instanceId);
      }
      const { view: v, up } = withRezzed(view, c);
      need += iceCreditNeed(v, up);
    }
    if (rez <= corpCredits && need > budget && (!best || rez < best.cost)) best = { ids, cost: rez };
  }
  return best;
}

interface Hit {
  m: string;
  turn: number;
  server: string;
  ice: string;
  note: string;
  stolen?: number;
}

interface RunRec {
  server: string;
  runnerScore: number;
  pending: { hit: Hit; needSteal?: boolean }[];
  rezzes: { iceId: string; cost: number; credits: number; icePos: number | null; toll?: number; rootAgenda: boolean; title: string; turn: number }[];
}


/** Watches one game: call before(state) at every step, rezWindow(state, choice) at every approached-ice rez window. */
class RezWatch {
  hits: Hit[] = [];
  runs = 0;
  rezWindows = 0;
  private run: RunRec | null = null;
  private lineSet: { server: string; ids: Set<string>; cost: number; turn: number } | null = null;
  private lastActive: 'corp' | 'runner' | null = null;
  readonly totalAgendas: number;
  readonly runnerDeck: Set<string>;

  constructor(start: GameState, private heldOf: () => HeldLine | null) {
    this.totalAgendas = [...start.corp.rd, ...start.corp.hq].filter(isAgenda).length;
    this.runnerDeck = new Set([...start.runner.stack, ...start.runner.grip].map(c => c.cardCode));
  }

  /** Before each step: the turn change (the held line's hold set as the Runner's turn begins) and the run's lifecycle. */
  before(s: GameState) {
    if (s.activePlayer === 'runner' && this.lastActive === 'corp') {
      const held = this.heldOf();
      const server = held?.server ?? null;
      const sv = server ? s.corp.servers[server] : undefined;
      const set = sv ? holdSet(s, sv.ice, s.corp.credits) : null;
      this.lineSet = sv && set ? { server: sv.id, ids: set.ids, cost: set.cost, turn: s.turnNumber } : null;
    }
    if (s.activePlayer === 'corp') this.lineSet = null;
    this.lastActive = s.activePlayer;
    const run = s.activeRun;
    if (run && !this.run) {
      this.runs++;
      this.run = { server: run.server, runnerScore: s.runner.score, pending: [], rezzes: [] };
    }
    if (this.run) {
      // The toll each rezzed ice took: the Runner's credits once the run has moved past it
      for (const r of this.run.rezzes) if (r.toll === undefined && (!run || run.icePosition !== r.icePos)) r.toll = Math.max(0, r.credits - s.runner.credits);
    }
    if (!run && this.run) this.endRun(s);
  }

  private endRun(s: GameState) {
    const rec = this.run!;
    this.run = null;
    const last = s.runsThisTurn[s.runsThisTurn.length - 1];
    const success = !!last?.successful;
    const stolen = s.runner.score - rec.runnerScore;
    for (const p of rec.pending) {
      if (p.needSteal && stolen <= 0) continue;
      this.hits.push({ ...p.hit, stolen });
    }
    for (const r of rec.rezzes) {
      if (!success || r.rootAgenda) continue;
      if (r.cost > (r.toll ?? 0)) this.hits.push({ m: rec.server === 'hq' || rec.server === 'rd' || rec.server === 'archives' ? 'M3 central' : 'M3 remote', turn: r.turn, server: rec.server, ice: r.title, note: `rez ${r.cost}, toll ${r.toll ?? 0}, run got in` });
    }
  }

  /** At an approached-ice rez window, with the Corp's choice (a REZ_CARD or null). */
  rezWindow(s: GameState, choice: GameAction | null) {
    const run = s.activeRun!;
    const server = s.corp.servers[run.server];
    const cands = rezCandidates(s, 'approach_ice').filter(c => cardDef(c).type_code === 'ice');
    if (!cands.length || !this.run) return;
    this.rezWindows++;
    const ice = cands[0];
    const cost = rezCostOf(s, ice);
    const rezzed = choice?.type === 'REZ_CARD' && choice.cardInstanceId === ice.instanceId;
    const affordable = s.corp.credits >= cost;
    const { view, up } = withRezzed(s, ice);
    const need = iceCreditNeed(view, up);
    const stops = need > s.runner.credits || need >= BLOCKED;
    // stop: the Runner can't pay through it now; toll: it can, for credits; free: it passes for no credits (no end-the-run
    // subroutine it can't take, or clicks)
    const kind = stops ? 'stop' : need > 0 ? 'toll' : 'free';
    const rootAgenda = server.root.some(isAgenda);
    const hqAgendas = s.corp.hq.filter(isAgenda).length;
    const base = { turn: s.turnNumber, server: run.server, ice: `${title(ice)} (${cost})` };
    // M1 held line
    const ls = this.lineSet;
    if (ls) {
      if (run.server === ls.server && ls.ids.has(ice.instanceId) && !rezzed) this.run.pending.push({ hit: { m: 'M1a', ...base, note: `declined ice in the held line's hold set (set cost ${ls.cost}, Corp ${s.corp.credits})` } });
      if (rezzed && !ls.ids.has(ice.instanceId)) {
        const left = [...ls.ids].map(id => s.corp.servers[ls.server]?.ice.find(c => c.instanceId === id)).filter((c): c is CardInstance => !!c && !c.isRezzed);
        const need2 = left.reduce((n, c) => n + rezCostOf(s, c), 0);
        if (need2 > 0 && s.corp.credits - cost < need2) this.run.pending.push({ hit: { m: 'M1b', ...base, note: `rezzed outside the hold set, leaving ${s.corp.credits - cost} for a set needing ${need2}` } });
      }
    }
    if (rezzed) this.run.rezzes.push({ iceId: ice.instanceId, cost, credits: s.runner.credits, icePos: run.icePosition, rootAgenda, title: base.ice, turn: s.turnNumber });
    if (rezzed || !affordable) return;
    // M2 declined stopper, an agenda then stolen on this run
    if (stops) this.run.pending.push({ hit: { m: 'M2', ...base, note: `declined; Runner needed ${need >= BLOCKED ? 'BLOCK' : need} with ${s.runner.credits}` }, needSteal: true });
    // M4 HQ rule
    if (run.server === 'hq' && hqAgendas > 0) this.run.pending.push({ hit: { m: `M4 ${hqAgendas > 1 ? '2+' : '1'} ${kind}`, ...base, note: `${hqAgendas} agenda(s) in HQ, declined; need ${need >= BLOCKED ? 'BLOCK' : need} vs ${s.runner.credits}` } });
    // M5 R&D rule
    if (run.server === 'rd') {
      const multi = rdMultiAccess(s);
      const unseen = this.totalAgendas - agendasKnown(s);
      if (multi || (hqAgendas === 0 && unseen > 0)) this.run.pending.push({ hit: { m: `M5 ${multi ? 'multi' : 'no HQ agenda'} ${kind}`, ...base, note: `${multi ? 'R&D multi-access installed' : `no agenda in HQ, ${unseen} unseen`}; declined; need ${need >= BLOCKED ? 'BLOCK' : need} vs ${s.runner.credits}` } });
    }
  }

  /** Every Corp action outside a rez window: Archives ice installed or rezzed, and the hand-size discard. */
  corpAction(s: GameState, a: GameAction) {
    const archivesAgenda = [...s.corp.archives.faceUp, ...s.corp.archives.faceDown].some(isAgenda);
    const payoff = [...this.runnerDeck].some(c => ARCHIVES_PAYOFF.has(c)) || [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].some(c => ARCHIVES_PAYOFF.has(c.cardCode));
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    if (a.type === 'INSTALL_CARD' && (a as { targetServerId?: string }).targetServerId === 'archives' && !archivesAgenda && !payoff) {
      const c = s.corp.hq.find(x => x.instanceId === id);
      this.hits.push({ m: 'M6 ice', turn: s.turnNumber, server: 'archives', ice: c ? title(c) : '?', note: 'ice installed on Archives, no agenda there, no Runner Archives card' });
    }
    if (a.type === 'REZ_CARD' && s.corp.servers.archives.ice.some(c => c.instanceId === id) && !archivesAgenda && !payoff)
      this.hits.push({ m: 'M6 ice', turn: s.turnNumber, server: 'archives', ice: '?', note: 'Archives ice rezzed, no agenda there, no Runner Archives card' });
    const choice = (a as { choice?: { kind?: string; cardInstanceIds?: string[] } }).choice;
    if (a.type === 'RESOLVE_PROMPT' && choice?.kind === 'discard') {
      const gone = new Set(choice.cardInstanceIds ?? []);
      const out = s.corp.hq.filter(c => gone.has(c.instanceId));
      const kept = s.corp.hq.filter(c => !gone.has(c.instanceId));
      if (out.some(isAgenda) && kept.some(c => !isAgenda(c))) this.hits.push({ m: 'M6 discard', turn: s.turnNumber, server: 'hq', ice: out.filter(isAgenda).map(title).join(', '), note: `discarded an agenda, kept ${kept.filter(c => !isAgenda(c)).map(title).join(', ')}` });
    }
  }
}

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const watch = new RezWatch(start, () => (corp as unknown as { heldLine: HeldLine | null }).heldLine);
  const chooseRez = corp.chooseRez!.bind(corp);
  corp.chooseRez = (s, cards) => {
    const choice = chooseRez(s, cards);
    if (s.activeRun?.phase === 'approach_ice') watch.rezWindow(s, choice);
    return choice;
  };
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = s => {
    const a = choose(s);
    watch.corpAction(s, a);
    return a;
  };
  const game = new GameRunner(start, { corp, runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000; i++) {
    watch.before(game.state);
    if (!game.step()) break;
  }
  watch.before(game.state);
  return { seed, corp: c.name, runner: r.name, winner: game.state.winner ?? null, runs: watch.runs, rezWindows: watch.rezWindows, hits: watch.hits };
}

/** A recorded human game (Jeff as the Runner, issues #33-#45): the Corp's in-run rez choices as they were made. */
function playReport(n: number) {
  const rep = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8')) as {
    config: { seed: number; corpDeck: Parameters<typeof deckGameSetup>[1]; runnerDeck: Parameters<typeof deckGameSetup>[2]; ai: string };
    startStops?: GameState['stops'];
    moves: GameAction[];
  };
  const fresh = createInitialGameState(deckGameSetup(rep.config.seed, rep.config.corpDeck, rep.config.runnerDeck));
  const start = rep.startStops ? { ...fresh, stops: rep.startStops } : fresh;
  let s = start;
  const watch = new RezWatch(s, () => null);
  for (let i = 0; i < rep.moves.length; i++) {
    const a = rep.moves[i];
    watch.before(s);
    const win = s.priority;
    if (a.player === 'corp' && s.activeRun?.phase === 'approach_ice' && win?.holder === 'corp' && (a.type === 'REZ_CARD' || a.type === 'PASS')) watch.rezWindow(s, a.type === 'REZ_CARD' ? a : null);
    else if (a.player === 'corp') watch.corpAction(s, a);
    try {
      s = executeAction(s, a);
    } catch {
      break;
    }
  }
  watch.before(s);
  return { report: n, winner: s.winner ?? null, runs: watch.runs, rezWindows: watch.rezWindows, hits: watch.hits };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
const reports = (process.env.REPORTS ?? '').split(',').filter(Boolean).map(Number);
for (const n of reports) console.log(JSON.stringify(playReport(n)));
