/**
 * Symptom alarms for AI batches (Jeff, 2026-11-04: "iron this out earlier
 * rather than plugging the leaks one by one"). Self-play hides holes both
 * AIs share, so each alarm flags a pattern a human opponent would punish,
 * whoever wins the game. Bug reports #4, #13, #15 and Jeff's A Teia and
 * Archives notes were all one of these.
 *
 * Each alarm keeps the turn it fired, so the position can be dumped and
 * turned into a test: SEED=<deal> DUMP_TURN=<turn> DUMP_SIDE=<side>
 * DUMP_FILE=x.json npx vite-node scripts/corp-losses.ts -- 1 normal
 * (with the batch's DECKS / NRDB settings), see lossLog.ts.
 */
import { CardInstance, GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { iceCost, isTrap } from '../src/ai/runs';
import { GameAction } from '../src/core';

export type AlarmKind =
  /** Corp: an agenda sat in HQ 4+ Corp turns while the Runner got into HQ on 2+ of the Runner's turns in between */
  | 'agenda stuck in HQ'
  /** Corp: the Runner was tagged all through a Corp turn with a resource the Corp could afford to trash, and it clicked for a credit or a card instead of trashing or using the tag */
  | 'tag not used'
  /** Runner: 3 Runner turns running in a row on HQ or Archives that got nothing (no points, no Corp card trashed) */
  | 'fruitless runs'
  /** Runner: an advanced agenda sat in a remote the Runner could get into (no unrezzed ice, rezzed ice affordable) and it didn't run there; detail says what it really was */
  | 'open target skipped'
  /** Runner: a successful run on an empty Archives */
  | 'empty Archives run';

export interface Alarm {
  kind: AlarmKind;
  turn: number;
  /** Whose turn to dump to get the position before the mistake */
  side: 'corp' | 'runner';
  note: string;
  /** A short category to count by (what the skipped card really was, ...) */
  detail?: string;
}

const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const corpCardsGone = (s: GameState) => s.corp.archives.faceUp.length + s.corp.archives.faceDown.length;
const title = (c: CardInstance) => cardDef(c).title;

/** Watches a game step by step; call step() after every engine step, then done(). */
export class AlarmTracker {
  readonly alarms: Alarm[] = [];
  private hqSince = new Map<string, { turn: number; breaches: number; fired: boolean }>();
  private corpStart: GameState | null = null;
  private corpTurnUsedTags = false;
  private runnerStart: GameState | null = null;
  private fruitless = new Map<string, number>();

  private corpTurnIdleClicks = 0;

  private fire(kind: AlarmKind, turn: number, side: 'corp' | 'runner', note: string, detail?: string) {
    this.alarms.push({ kind, turn, side, note, ...(detail ? { detail } : {}) });
  }

  step(before: GameState, after: GameState, action?: GameAction) {
    // Clicks the Corp spent on a credit or a card: the low-value actions a trash could have replaced
    if (before.activePlayer === 'corp' && (action?.type === 'GAIN_CREDIT' || action?.type === 'DRAW_CARD')) this.corpTurnIdleClicks++;
    // Turn boundaries
    if (before.activePlayer === 'corp' && after.activePlayer === 'runner') this.endCorpTurn(after);
    if (before.activePlayer === 'runner' && after.activePlayer === 'corp') this.endRunnerTurn(before, after);
    if (after.activePlayer === 'corp' && this.corpStart?.turnNumber !== after.turnNumber && !after.pendingPrompts.length) this.startCorpTurn(after);
    if (after.activePlayer === 'runner' && this.runnerStart?.turnNumber !== after.turnNumber) this.runnerStart = after;

    // The Corp used the tag: a resource left the rig on its turn, or the tag count dropped
    // (any rig card trashed, Retribution included; damage; or the tag count dropped)
    const rig = (st: GameState) => Object.values(st.runner.rig).flat().length;
    if (after.activePlayer === 'corp' && !after.activeRun && (rig(after) < rig(before) || after.runner.grip.length < before.runner.grip.length || after.runner.tags < before.runner.tags)) this.corpTurnUsedTags = true;

    // A successful run on an empty Archives
    if (after.runsThisTurn.length > before.runsThisTurn.length) {
      const run = after.runsThisTurn[after.runsThisTurn.length - 1];
      if (run?.server === 'archives' && run.successful && corpCardsGone(before) === 0) this.fire('empty Archives run', after.turnNumber, 'runner', 'Archives held no cards');
    }
  }

  private startCorpTurn(s: GameState) {
    this.corpStart = s;
    this.corpTurnUsedTags = false;
    this.corpTurnIdleClicks = 0;
    for (const c of s.corp.hq.filter(isAgenda)) {
      const entry = this.hqSince.get(c.instanceId);
      if (!entry) {
        this.hqSince.set(c.instanceId, { turn: s.turnNumber, breaches: 0, fired: false });
        continue;
      }
      if (!entry.fired && s.turnNumber - entry.turn >= 3 && entry.breaches >= 2) {
        entry.fired = true;
        this.fire('agenda stuck in HQ', s.turnNumber, 'corp', `${title(c)} in HQ since turn ${entry.turn}; the Runner got into HQ ${entry.breaches} times`);
      }
    }
    for (const id of [...this.hqSince.keys()]) if (!s.corp.hq.some(c => c.instanceId === id)) this.hqSince.delete(id);
  }

  private endCorpTurn(after: GameState) {
    const start = this.corpStart;
    if (!start || start.turnNumber !== after.turnNumber) return;
    // Tagged all turn, a trashable resource (base trash cost 2 credits, rule 4.4.1), and the click and credits for it
    const trashable = start.runner.rig.resources.length > 0 && start.corp.credits >= 2 && start.corp.clicks >= 1;
    if (start.runner.tags > 0 && after.runner.tags > 0 && trashable && !this.corpTurnUsedTags && this.corpTurnIdleClicks > 0) {
      this.fire('tag not used', start.turnNumber, 'corp', `${start.runner.tags} tag(s), ${start.corp.credits} credits, resources: ${start.runner.rig.resources.map(title).join(', ')}`);
    }
  }

  private endRunnerTurn(before: GameState, after: GameState) {
    const start = this.runnerStart;
    if (!start) return;
    const runs = before.runsThisTurn;
    // HQ breaches for the agendas waiting in HQ
    if (runs.some(r => r.server === 'hq' && r.successful)) for (const entry of this.hqSince.values()) entry.breaches++;
    // Fruitless turns on a central: got in, but no points and no Corp card trashed or stolen
    const gained = before.runner.score > start.runner.score || corpCardsGone(before) > corpCardsGone(start);
    // (R&D digs come up empty often enough to be no sign of a mistake)
    for (const server of ['hq', 'archives']) {
      const ran = runs.some(r => r.server === server && r.successful);
      if (!ran) {
        this.fruitless.delete(server);
        continue;
      }
      const n = gained ? 0 : (this.fruitless.get(server) ?? 0) + 1;
      this.fruitless.set(server, n);
      if (n === 3) this.fire('fruitless runs', start.turnNumber, 'runner', `3 turns in a row into ${server} for nothing`);
    }
    // An advanced card in a remote the Runner could afford to get into, left alone
    if (start.runner.clicks > 0) {
      for (const sv of Object.values(start.corp.servers)) {
        // Only real agendas: skipped traps and assets were 98% of skips in the first batch (the Runner reads trap odds from the decklist)
        const target = sv.isRemote ? sv.root.find(c => c.advancementCounters > 0 && !c.isRezzed && isAgenda(c)) : undefined;
        if (!target) continue;
        if (sv.ice.some(i => !i.isRezzed)) continue;
        const cost = sv.ice.reduce((n, i) => n + iceCost(start, i), 0);
        if (cost > start.runner.credits) continue;
        if (runs.some(r => r.server === sv.id)) continue;
        const what = isAgenda(target) ? 'agenda' : isTrap(target.cardCode) ? 'trap' : cardDef(target).type_code;
        this.fire('open target skipped', start.turnNumber, 'runner', `${sv.id}: ${title(target)} (${target.advancementCounters} counters) behind ${sv.ice.length} rezzed ice costing about ${cost.toFixed(1)}, Runner had ${start.runner.credits} credits`, what);
      }
    }
    void after;
  }
}
