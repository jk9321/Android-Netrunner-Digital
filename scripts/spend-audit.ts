/**
 * Phase 2 item S, the spend audit (spec-phase2.md "S. Spend audit", Jeff 2026-11-09: "how often did it spend a credit
 * it didn't need to spend?"). Watches an AI-vs-AI game step by step, like AlarmTracker, and tags every credit the Corp
 * spends with what it bought, decided when the outcome is known (the run ends, the card leaves play, the game ends).
 * Measurement only: it reads states and never changes one. loss-summary.mjs prints the table.
 *
 * One item per spend: [kind, credits, outcome, bought nothing (1/0), detail]. Kinds and what "bought nothing" means:
 *  - 'rez ice in a run' / 'rez ice' (outside a run): over the ice's life (until it leaves play or the game ends) it
 *    never ended a run, never fired a subroutine and never made the Runner pay to break it. The outcome is this run's
 *    result for an in-run rez; the detail is the life ('stopped a run' | 'subs fired' | 'taxed only, >= rez cost' |
 *    'taxed only, < rez cost' | 'nothing') and whether
 *    the server held something at stake when it was rezzed ('stake' | 'empty': lossLog.ts lowValue).
 *  - 'rez asset/upgrade': the card never fired (no log line naming it after the rez other than its access or trash,
 *    no credits it paid out). Outcome: 'paid back' (credits out >= rez cost) | 'fired' | 'trashed unfired' | 'unfired'.
 *  - 'advance' (credits paid with the advance action): the agenda was stolen, trashed or still installed at the end;
 *    a non-agenda card never fired; advanced ice (Pharos) is judged by the ice's life, as a rez is.
 *  - 'install ice' (the install cost, rules 1.16.6b and 8.5.11a: 1 credit per ice already protecting the server; 0-credit installs
 *    are counted too, for the clicks): never rezzed.
 *    Detail: whether the Runner ever ran that server while the ice stood.
 *  - 'operation' (counted GROSS: the play cost, so Hedge Fund spends 5 and returns 9), 'trash resource', 'ability'
 *    (a paid card ability on the Corp's turn) and "runner's turn" (traces and other paid abilities on the Runner's
 *    turn, not rezzes): nothing observable changed by the time the prompts it opened were resolved (no credits back,
 *    no card drawn, nothing installed, moved, rezzed or advanced, no tag, damage, trash or Runner credit loss).
 *    Detail: the card's title.
 * Deterrence (runs the Runner never made because of a rezzed ice) cannot be seen this way: 'nothing' ice may still
 * have turned runs away. The lifetime read counts every run the ice met, not just the one it was rezzed in.
 */
import { CardInstance, GameAction, GameState } from '../src/core';
import { cardDef } from '../src/core/cards';

export type SpendItem = [kind: string, credits: number, outcome: string, nothing: 0 | 1, detail: string];

export interface SpendRecord {
  items: SpendItem[];
  /** Corp turns played (the per-turn denominator) */
  corpTurns: number;
}

type Server = GameState['corp']['servers'][string];
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const titleOf = (c: { cardCode: string }) => cardDef(c as CardInstance).title;

/** lossLog.ts lowValue: nothing at stake on this server (no agenda in it; R&D always matters). */
function lowValue(state: GameState, server: Server): boolean {
  if (server.id === 'rd') return false;
  if (server.id === 'hq') return !state.corp.hq.some(isAgenda);
  if (server.id === 'archives') return !state.corp.archives.faceDown.some(isAgenda);
  return !server.root.some(isAgenda);
}

interface IceLife {
  title: string;
  stops: number;
  fired: number;
  tax: number;
  /** Spends waiting on this ice's life: rez items (credits, kind, this run's outcome or '', stake) */
  rezzes: { kind: string; credits: number; outcome: string; stake: string }[];
  /** Install items (credits) waiting on whether it is ever rezzed, and whether its server is run while it stands */
  installs: { credits: number; server: string; ran: boolean; rezzed: boolean }[];
  /** Credits paid to advance this ice (Pharos, Syailendra): judged by the ice's life too */
  advanceCredits: number;
}

interface RootLife {
  title: string;
  agenda: boolean;
  /** Rez cost paid (null: not rezzed by the Corp paying for it, only advanced) */
  rezCost: number | null;
  paidOut: number;
  fired: boolean;
  advanceCredits: number;
  advances: number;
}

interface Window {
  kind: string;
  title: string;
  paid: number;
  start: GameState;
}

/** The observable state an operation or a paid ability can change, Corp credits aside. */
function signature(s: GameState): number[] {
  const roots = Object.values(s.corp.servers).flatMap(sv => sv.root);
  const ice = Object.values(s.corp.servers).flatMap(sv => sv.ice);
  const all = [...roots, ...ice];
  const rig = Object.values(s.runner.rig).flat().length;
  return [
    s.runner.tags,
    s.runner.grip.length,
    rig,
    s.runner.credits,
    s.runner.heap.length,
    s.runner.coreDamage,
    s.runner.score,
    s.runner.stack.length,
    s.corp.rd.length,
    all.length,
    all.filter(c => c.isRezzed).length,
    all.reduce((n, c) => n + c.advancementCounters, 0),
    s.corp.score,
    s.corp.badPublicity,
    s.corp.archives.faceDown.length,
  ];
}

export class SpendTracker {
  readonly items: SpendItem[] = [];
  private corpTurns = 0;
  private ice = new Map<string, IceLife>();
  private roots = new Map<string, RootLife>();
  /** Ice rezzed during the current run, awaiting the run's result */
  private runRezzes: { id: string; credits: number; stake: string; passed: boolean }[] = [];
  private lastEncountered: string | null = null;
  private runStole = false;
  private runTrashed = false;
  private window: Window | null = null;

  private iceLife(c: CardInstance): IceLife {
    let life = this.ice.get(c.instanceId);
    if (!life) this.ice.set(c.instanceId, (life = { title: titleOf(c), stops: 0, fired: 0, tax: 0, rezzes: [], installs: [], advanceCredits: 0 }));
    return life;
  }

  private rootLife(c: CardInstance): RootLife {
    let life = this.roots.get(c.instanceId);
    if (!life) this.roots.set(c.instanceId, (life = { title: titleOf(c), agenda: isAgenda(c), rezCost: null, paidOut: 0, fired: false, advanceCredits: 0, advances: 0 }));
    return life;
  }

  private push(kind: string, credits: number, outcome: string, nothing: boolean, detail: string) {
    this.items.push([kind, credits, outcome, nothing ? 1 : 0, detail]);
  }

  step(before: GameState, after: GameState, action?: GameAction) {
    if (before.activePlayer === 'corp' && after.activePlayer === 'runner') this.corpTurns++;
    const delta = after.corp.credits - before.corp.credits;
    const spent = Math.max(0, -delta);
    const newLogs = after.log.slice(before.log.length);
    // An open operation / ability window closes once its prompts are resolved and a new action starts
    if (this.window && before.pendingPrompts.length === 0 && action?.type !== 'RESOLVE_PROMPT') this.closeWindow(before);

    const iceOf = (s: GameState) => new Map(Object.values(s.corp.servers).flatMap(sv => sv.ice.map(i => [i.instanceId, { card: i, server: sv.id }] as const)));
    const rootOf = (s: GameState) => new Map(Object.values(s.corp.servers).flatMap(sv => sv.root.map(c => [c.instanceId, { card: c, server: sv.id }] as const)));
    const iceBefore = iceOf(before);
    const iceAfter = iceOf(after);
    const rootBefore = rootOf(before);
    const rootAfter = rootOf(after);
    const run = before.activeRun;

    // Rezzes this step: split the credits by printed cost when more than one card was rezzed at once
    const rezzedIce = [...iceAfter.values()].filter(x => x.card.isRezzed && iceBefore.get(x.card.instanceId)?.card.isRezzed === false);
    const rezzedRoot = [...rootAfter.values()].filter(x => x.card.isRezzed && rootBefore.get(x.card.instanceId)?.card.isRezzed === false);
    const rezzes = [...rezzedIce, ...rezzedRoot];
    const printed = rezzes.map(x => cardDef(x.card).cost ?? 0);
    const printedSum = printed.reduce((a, b) => a + b, 0);
    let accounted = 0;
    rezzes.forEach((x, i) => {
      const share = rezzes.length === 1 ? spent : printedSum > 0 ? Math.round((spent * printed[i]) / printedSum) : 0;
      accounted += share;
      if (rezzedIce.includes(x)) {
        const life = this.iceLife(x.card);
        const server = before.corp.servers[x.server];
        const stake = server && lowValue(before, server) ? 'empty' : 'stake';
        if (run) {
          // in-run rezzes wait for the run's result
          this.runRezzes.push({ id: x.card.instanceId, credits: share, stake, passed: false });
        } else life.rezzes.push({ kind: 'rez ice', credits: share, outcome: '', stake });
        for (const inst of life.installs) inst.rezzed = true;
      } else {
        const life = this.rootLife(x.card);
        life.rezCost = (life.rezCost ?? 0) + share;
        // A "when rezzed" effect (Spin Doctor draws 2): HQ grew or the Runner's side changed on the rez step
        const sa = signature(before);
        const sb = signature(after);
        if (after.corp.hq.length > before.corp.hq.length || [0, 1, 2, 3, 4, 5].some(j => sa[j] !== sb[j])) life.fired = true;
      }
    });

    // Ice installed this step (every install, 0-credit ones too, for the clicks)
    const installed = [...iceAfter.values()].filter(x => !iceBefore.has(x.card.instanceId));
    if (installed.length) {
      installed.forEach((x, i) => {
        const credits = i === 0 && !rezzes.length ? spent : 0;
        accounted += credits;
        this.iceLife(x.card).installs.push({ credits, server: x.server, ran: false, rezzed: x.card.isRezzed });
      });
    }

    // Advances paid with credits (the advance action; Seamless Launch's free counters are its own effect)
    if (action?.type === 'ADVANCE_CARD' && spent > 0) {
      const ice = iceAfter.get(action.cardInstanceId)?.card;
      if (ice) {
        this.iceLife(ice).advanceCredits += spent;
        accounted += spent;
      }
      const target = rootAfter.get(action.cardInstanceId)?.card;
      if (target) {
        const life = this.rootLife(target);
        life.advanceCredits += spent;
        life.advances++;
        accounted += spent;
      }
    }

    // Cards firing: a credit gain or a log line naming an installed card, other than its rez, access, trash or advance
    for (const line of newLogs) {
      if (line.event === 'access' || /trash|rez |\brezz|advance|install|accesses|exposes|derez/i.test(line.message)) continue;
      for (const [id, x] of rootAfter) {
        const life = this.roots.get(id);
        if (!life || (!x.card.isRezzed && !life.agenda) || rezzedRoot.some(r => r.card.instanceId === id)) continue;
        if (line.message.includes(life.title) || line.cardCode === x.card.cardCode) life.fired = true;
      }
    }
    if (delta > 0 && before.activePlayer === 'corp' && !run) {
      const named = newLogs.map(l => l.message).join(' ');
      for (const [id, x] of rootBefore) {
        const life = this.roots.get(id);
        if (life && x.card.isRezzed && named.includes(life.title)) {
          life.paidOut += delta;
          life.fired = true;
          break;
        }
      }
    }

    // Ice value during runs: subroutines firing, the Runner paying to break, the run ending at it
    if (run?.encounter) {
      const id = run.encounter.iceId;
      const life = this.ice.get(id) ?? (iceBefore.get(id) ? this.iceLife(iceBefore.get(id)!.card) : undefined);
      if (life) {
        this.lastEncountered = id;
        if (newLogs.some(l => /subroutine fires/i.test(l.message))) life.fired++;
        const pool = (st: GameState) => st.runner.credits + (st.activeRun?.bonusCredits ?? 0);
        if (after.activeRun?.encounter && run.encounter.resolvingIndex === null && after.activeRun.encounter.resolvingIndex === null) {
          life.tax += Math.max(0, pool(before) - pool(after));
        }
        if (action?.type === 'BIOROID_BREAK') life.tax += 1;
      }
    }
    if (run) {
      // Ice passed this step: the Runner moved inward of it, or reached the server
      const a = after.activeRun;
      const ices = before.corp.servers[run.server]?.ice ?? [];
      for (const r of this.runRezzes) {
        const idx = ices.findIndex(i => i.instanceId === r.id);
        if (idx >= 0 && a && ((a.icePosition !== null && a.icePosition < idx) || a.phase === 'approach_server' || a.breached || a.isSuccessful)) r.passed = true;
      }
      // An advanced trap firing on access (Urtica Cipher): damage while it is the card being accessed
      const lastAccess = (a ?? run).accessed?.[(a ?? run).accessed.length - 1]?.id;
      const trap = lastAccess ? this.roots.get(lastAccess) : undefined;
      if (trap && !trap.agenda && (newLogs.some(l => l.event === 'damage') || after.runner.grip.length < before.runner.grip.length)) trap.fired = true;
      if (after.runner.score > before.runner.score) this.runStole = true;
      if (after.corp.archives.faceUp.length + after.corp.archives.faceDown.length > before.corp.archives.faceUp.length + before.corp.archives.faceDown.length && (run.breached || after.activeRun?.breached)) this.runTrashed = true;
    }
    if (!run && after.activeRun) {
      this.runRezzes = [];
      this.lastEncountered = null;
      this.runStole = false;
      this.runTrashed = false;
      // Mark installs on this server as run
      for (const ice of after.corp.servers[after.activeRun.server]?.ice ?? []) for (const inst of this.ice.get(ice.instanceId)?.installs ?? []) inst.ran = true;
    }
    if (run && !after.activeRun) this.endRun(before, after);

    // Operations, trashing a resource, paid abilities and Runner's-turn payments open a window that closes on the next action
    const left = spent - accounted;
    if (action?.type === 'PLAY_OPERATION_OR_EVENT' && before.activePlayer === 'corp') {
      // Counted gross: the play cost from its log line (Hedge Fund: -5 +9 = +4 in one step)
      if (this.window) this.closeWindow(before);
      const line = newLogs.find(l => /\d+ \[credit\] to play/.test(l.message));
      const paid = line ? Number(/(\d+) \[credit\] to play/.exec(line.message)![1]) : left;
      const card = before.corp.hq.find(c => c.instanceId === action.cardInstanceId);
      this.window = { kind: 'operation', title: card ? titleOf(card) : '?', paid, start: before };
    } else if (left > 0 && this.window) this.window.paid += left;
    else if (left > 0) {
      const prompt = before.pendingPrompts[0] as { source?: { cardCode: string } } | undefined;
      if (action?.type === 'TRASH_RESOURCE') this.window = { kind: 'trash resource', title: 'trash resource', paid: left, start: before };
      else {
        const src = action?.type === 'USE_ABILITY' ? [...rootBefore.values(), ...iceBefore.values()].find(x => x.card.instanceId === action.cardInstanceId)?.card : undefined;
        const title = src ? titleOf(src) : prompt?.source ? titleOf(prompt.source) : (action?.type ?? '?');
        // A root card paid for on its own prompt or ability (Anoetic Void) has fired
        const srcLife = this.roots.get(src?.instanceId ?? (prompt?.source as { instanceId?: string } | undefined)?.instanceId ?? '');
        if (srcLife) srcLife.fired = true;
        const kind = before.activePlayer === 'runner' || run ? "runner's turn" : 'ability';
        this.window = { kind, title, paid: left, start: before };
      }
    }

    // Cards that left play: settle their lives
    for (const [id, x] of rootBefore) {
      if (rootAfter.has(id)) continue;
      // A card that trashes itself for its effect outside a run (Clearinghouse's meat damage) fired as it left
      const life = this.roots.get(id);
      const sa = signature(before);
      const sb = signature(after);
      if (life && !run && (newLogs.some(l => l.event === 'damage') || [0, 1, 2, 3].some(j => sa[j] !== sb[j]))) life.fired = true;
      this.settleRoot(id, after, x.card, !!run);
    }
    for (const [id] of iceBefore) if (!iceAfter.has(id)) this.settleIce(id);
  }

  private endRun(before: GameState, after: GameState) {
    const run = before.activeRun!;
    const ended = after.runsThisTurn[after.runsThisTurn.length - 1];
    const successful = !!ended?.successful;
    // The stopper: the ice being encountered (a subroutine ended it) or, for a jack out, the last ice met
    const stopper = successful ? null : (run.encounter?.iceId ?? this.lastEncountered);
    if (stopper) {
      const life = this.ice.get(stopper);
      if (life) life.stops++;
    }
    for (const r of this.runRezzes) {
      let outcome: string;
      if (r.id === stopper) outcome = run.encounter ? 'stopped this run' : 'Runner jacked out after it';
      else if (!successful) outcome = r.passed ? 'passed, run stopped later' : 'run ended at it otherwise';
      else outcome = this.runStole ? 'passed, agenda stolen' : this.runTrashed ? 'passed, card trashed' : 'passed, nothing lost';
      const life = this.ice.get(r.id);
      if (life) life.rezzes.push({ kind: 'rez ice in a run', credits: r.credits, outcome, stake: r.stake });
    }
    this.runRezzes = [];
  }

  /** The ice's life: 'stopped a run' > 'subs fired' (unbroken subroutines resolved) > 'taxed only' (the Runner paid to break it, vs its rez cost) > 'nothing' */
  private iceVerdict(life: IceLife): string {
    if (life.stops > 0) return 'stopped a run';
    if (life.fired > 0) return 'subs fired';
    if (life.tax > 0) {
      const cost = life.rezzes.reduce((n, r) => n + r.credits, 0);
      return life.tax >= cost ? 'taxed only, >= rez cost' : 'taxed only, < rez cost';
    }
    return 'nothing';
  }

  private settleIce(id: string) {
    const life = this.ice.get(id);
    if (!life) return;
    const verdict = this.iceVerdict(life);
    for (const r of life.rezzes) this.push(r.kind, r.credits, r.outcome || verdict, verdict === 'nothing', `${verdict}; ${r.stake}`);
    if (life.advanceCredits > 0) this.push('advance', life.advanceCredits, `advanced ice, ${verdict}`, verdict === 'nothing', life.title);
    for (const inst of life.installs) this.push('install ice', inst.credits, inst.rezzed ? 'rezzed' : 'never rezzed', !inst.rezzed, inst.ran ? 'server run' : 'server never run');
    this.ice.delete(id);
  }

  private settleRoot(id: string, after: GameState, card: CardInstance | null, inRun: boolean) {
    const life = this.roots.get(id);
    if (!life) return;
    if (life.rezCost !== null) {
      const outcome = life.paidOut >= life.rezCost && life.paidOut > 0 ? 'paid back' : life.fired ? 'fired' : card && inRun ? 'trashed unfired' : 'unfired';
      this.push('rez asset/upgrade', life.rezCost, outcome, !life.fired, life.title);
    }
    if (life.advances > 0) {
      let outcome: string;
      if (life.agenda) {
        outcome = !card ? 'still installed at end' : after.corp.scoreArea.some(c => c.instanceId === id) ? 'scored' : after.runner.scoreArea.some(c => c.instanceId === id) ? 'stolen' : 'agenda trashed';
      } else outcome = life.fired ? 'non-agenda, fired' : 'non-agenda, never fired';
      const nothing = outcome !== 'scored' && outcome !== 'non-agenda, fired';
      this.push('advance', life.advanceCredits, outcome, nothing, life.title);
    }
    this.roots.delete(id);
  }

  private closeWindow(end: GameState) {
    const w = this.window!;
    this.window = null;
    const returned = end.corp.credits - w.start.corp.credits + w.paid;
    const a = signature(w.start);
    const b = signature(end);
    // The operation itself leaves HQ for Archives: count draws as HQ growing past that
    const drew = end.corp.hq.length - w.start.corp.hq.length + (w.kind === 'operation' ? 1 : 0) > 0;
    // Clicks gained (Nanomanagement): more than the click the play itself cost
    const clicks = end.corp.clicks - w.start.corp.clicks + (w.kind === 'operation' ? 1 : 0) > 0;
    const changed = a.some((v, i) => v !== b[i]) || drew || clicks;
    const outcome = returned >= w.paid && returned > 0 ? 'income' : returned > 0 ? 'part refund' : changed ? 'other effect' : 'nothing observed';
    if (w.paid > 0 || w.kind === 'operation') this.push(w.kind, w.paid, outcome, returned <= 0 && !changed, w.title);
  }

  done(final: GameState): SpendRecord {
    if (this.window) this.closeWindow(final);
    if (final.activeRun && this.runRezzes.length) {
      for (const r of this.runRezzes) this.ice.get(r.id)?.rezzes.push({ kind: 'rez ice in a run', credits: r.credits, outcome: 'game ended in the run', stake: r.stake });
    }
    for (const id of [...this.ice.keys()]) this.settleIce(id);
    for (const id of [...this.roots.keys()]) this.settleRoot(id, final, null, false);
    return { items: this.items, corpTurns: this.corpTurns };
  }
}
