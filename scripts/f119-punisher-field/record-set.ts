/**
 * F119 phase A step 3 (brief /mnt/project-files/netrunner-ai/f119-punisher-field/brief.md rev 1, final; ruling-redteam.md
 * open point 1 ADOPTED): THE RECORD SET, fixed before any arm tree and read the same on every arm. It is always priced by
 * the BASE tree (the merge base's src, switches off): the arm decides what the Corp does, never what a use is worth.
 * Started from scripts/tag-clock-input/record-set.ts (its rule for a use, its kill, its windows); two things change.
 *
 * 1. THE RULE FOR A USE (as the tag clock's): a use is counted when a tag was used: the Runner's tags fell over a Corp
 *    action's resolution (the action and every prompt it opened), or an effect that needs a tagged Runner resolved. A mode
 *    that uses no tag is not a use (Mindscaping's credits and cards, Bigger Picture's "give 1 tag", Predictive Planogram
 *    with one mode, Greasing the Palm with the "may" declined).
 * 2. THE MEASURE IS THE SWING A TAG BUYS (open point 1, ADOPTED): for each use, the Runner's loss (the fall in the Runner's
 *    standing: sideStrength of the Runner plus the tag clock, both in the Runner's view, the Runner's strength without its
 *    tag term; floored at 0) plus the Corp's gain (the Corp side's change in its own view, from the board with the use
 *    paid to the board after: for IP Enforcement this includes the agenda installed back), less what the Corp paid (by
 *    `from`, the reader's rule: `hq` a click and the play cost, `identity` and `runnerScoreArea` a click, `onScore`
 *    nothing; clicks at clickPrice and credits by the credit's owner, the Corp deciding), less the same for the card's
 *    best untagged use where it has one (its gain less the same cost, floored at 0), the whole floored at 0. The Corp's
 *    gain is read only for a card whose use gives the Corp something (GAIN below); for the others it is 0 (the Corp side's
 *    change is then only the card leaving HQ, which no clock line prices).
 *    The untagged uses, each card's text quoted from the card data (src/data/*-cards.json stripped_text; ruling 1's
 *    condition), are built on the board with the use paid (the HIDDEN-READ of a measuring script: R&D's top cards):
 *      Mindscaping 34045: "Gain 4 credits and draw 2 cards. Add 1 card from HQ to the top of R&D." -> 4 credits and R&D's
 *        top card into HQ (2 drawn, 1 back: net 1; the known top card is unpriced, approximation 10).
 *      Predictive Planogram 30056: the better of "Gain 3 credits." and "Draw 3 cards." -> the better of 3 credits and R&D's
 *        top 3 cards into HQ.
 *      Greasing the Palm 34037: "Gain 5 credits. You may install 1 card from HQ." -> the board after the use with its
 *        tag back and the counter it placed taken off ("You may remove 1 tag to place 1 advancement counter on that card."
 *        is the tag's part).
 *    Oracle Thinktank 34049: its "Shuffle this agenda into R&D." is LEFT OUT of the record as well as the clock
 *    (approximation 5): its use is the Runner's loss of the points only, no Corp gain.
 * 3. EACH LINE WITH ITS OWNER (the tag clock's lines after F119):
 *      trash    a resource trashed by the basic action                       the clock's trash part
 *      take     Retribution, IP Enforcement, Bigger Picture's remove-tags      the clock's use part, U
 *               mode, Mindscaping's damage, a score of Orbital Superiority
 *               while tagged, Oracle Thinktank's click
 *      gain     Predictive Planogram's both modes, Synapse Global's click,     the clock's use part under G
 *               Greasing the Palm's tag
 *      freeRez  Unleash                                                      freeRez.ts's readers, reported apart
 *      runTime  B-1001, Valentão, Piranhas (a tag spent in the Runner's run)  F111: reported, never in a gap
 *      other    any other Corp action over which the tags fell (Rotary)      reported by card
 *    The damage uses (Mindscaping, Orbital) carry `damage: true`: reported on both owners (the clock and V18, D1).
 * 4. A KILL: a flatline from a tagged-only effect is valued at valueModel.ts flatlineWorth on the board before the use (the
 *    damage clock's owner, V18), as the tag clock's record did.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CardInstance, GameState } from '../../src/core';
import type { Tree } from '../corp-owed/trees';

export type Line = 'trash' | 'take' | 'gain' | 'freeRez' | 'runTime' | 'other';
/** The clock's lines: U reads trash and take; U+G adds gain. */
export const CLOCK_LINES_U: Line[] = ['trash', 'take'];
export const CLOCK_LINES_UG: Line[] = ['trash', 'take', 'gain'];

type From = 'hq' | 'identity' | 'runnerScoreArea' | 'onScore' | 'trash' | 'none';
/** What happened over one Corp action's resolution, as the detector sees it. */
export interface Window {
  a: any;
  code: string | null;
  before: GameState;
  after: GameState;
  tagsFell: number;
  taggedBefore: boolean;
  gripFell: number;
  creditsUp: number;
  hqUp: number;
  scored: string[];
  flatline: boolean;
}
interface Detect {
  title: string;
  from: From;
  line: (w: Window) => Line | null;
  /** the use gives the Corp something: its gain is read */
  gain?: true;
  damage?: true;
}
const play = (w: Window) => w.a.type === 'PLAY_OPERATION_OR_EVENT';
/** The detector, by card code (codes from the card data). */
export const DETECT: Record<string, Detect> = {
  '30065': { title: 'Retribution', from: 'hq', line: w => (play(w) && w.taggedBefore ? 'take' : null) },
  '35066': { title: 'IP Enforcement', from: 'hq', gain: true, line: w => (play(w) && w.tagsFell > 0 ? 'take' : null) },
  '35065': { title: 'Bigger Picture', from: 'hq', gain: true, line: w => (play(w) && w.tagsFell > 0 ? 'take' : null) },
  '34045': { title: 'Mindscaping', from: 'hq', damage: true, line: w => (play(w) && w.taggedBefore && (w.gripFell > 0 || w.flatline) ? 'take' : null) },
  '34049': { title: 'Oracle Thinktank', from: 'runnerScoreArea', line: w => (w.tagsFell > 0 ? 'take' : null) },
  // both modes: 3 credits and 3 cards (the card itself leaves HQ: HQ up by 2 at least)
  '30056': { title: 'Predictive Planogram', from: 'hq', gain: true, line: w => (play(w) && w.taggedBefore && w.creditsUp >= 3 && w.hqUp >= 2 ? 'gain' : null) },
  '35058': { title: 'Synapse Global', from: 'identity', gain: true, line: w => (w.a.type === 'USE_ABILITY' && w.tagsFell > 0 ? 'gain' : null) },
  '34037': { title: 'Greasing the Palm', from: 'hq', gain: true, line: w => (play(w) && w.tagsFell > 0 ? 'gain' : null) },
  '36044': { title: 'Unleash', from: 'hq', gain: true, line: w => (play(w) && w.tagsFell > 0 ? 'freeRez' : null) },
  '34065': { title: 'B-1001', from: 'none', line: w => (w.tagsFell > 0 ? 'runTime' : null) },
  '34060': { title: 'Valentão', from: 'none', line: w => (w.a.type === 'REZ_CARD' && w.tagsFell > 0 ? 'runTime' : null) },
  '34117': { title: 'Piranhas', from: 'none', line: w => (w.a.type === 'REZ_CARD' && w.tagsFell > 0 ? 'runTime' : null) },
  '36014': { title: 'Rotary', from: 'none', line: w => (w.a.type === 'USE_ABILITY' && w.a.player === 'corp' ? 'other' : null) },
};
/** Orbital Superiority: a score while the Runner is tagged (its score does 4 meat damage; untagged it gives a tag). */
export const ORBITAL = '30068';

export interface Use {
  line: Line;
  card: string;
  T: number;
  active: 'corp' | 'runner';
  tags: number;
  /** the Runner's standing's fall (floored at 0; a kill's value instead), the Corp's gain, the cost, the untagged use's gain */
  drop: number;
  gain: number;
  paid: number;
  without?: number;
  kill?: number;
  damage?: true;
  /** the swing a tag buys */
  swing: number;
  /** IP Enforcement: the agenda taken back (its printed points) */
  ipPoints?: number;
  /** Greasing the Palm: the type of the card the counter went on */
  greasedType?: string;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Watches a game step by step (`step(before, action, after)`), opens a window at each Corp action and closes it when no
 * prompt is left, and records the uses. `B` is the base tree; `off()` sets its switches off; `S` the playing tree (codes).
 */
export class UseRecorder {
  uses: Use[] = [];
  private open: { a: any; code: string | null; before: GameState } | null = null;
  constructor(
    private B: Tree,
    private off: () => void,
    private S: Tree,
  ) {}

  private inCtx<X>(s: GameState, side: 'corp' | 'runner', f: (st: GameState) => X): X {
    this.off();
    this.B.clear();
    const st = structuredClone(s);
    return this.B.pricing.asSide(side, () => this.B.hv.inDecision(st, side, () => f(st)));
  }
  /** The Runner's strength without its tag term, the Runner's view. */
  standing(s: GameState): number {
    return this.inCtx(s, 'runner', st => (this.B.ev.sideStrength(st, 'runner', 'runner') as number) + (this.B.ev.tagsWorth(st, 'runner') as number));
  }
  corpSide(s: GameState): number {
    return this.inCtx(s, 'corp', st => this.B.ev.sideStrength(st, 'corp', 'corp') as number);
  }
  flatlineWorth(s: GameState): number {
    return this.inCtx(s, 'runner', st => this.B.vm.flatlineWorth(st) as number);
  }
  /** What a use costs by `from` on `before`, the Corp deciding: clicks at clickPrice, credits by the credit's owner. */
  paid(before: GameState, from: From, credits: number): number {
    if (from === 'onScore' || from === 'none') return 0;
    return this.inCtx(before, 'corp', st => {
      const click = this.B.hv.clickPrice(st, 'corp', 'corp') as number;
      const less = { ...st, corp: { ...st.corp, credits: st.corp.credits - credits } };
      return click + (credits ? (this.B.vm.sideCreditValue(st, 'corp', 'corp') as number) - (this.B.vm.sideCreditValue(less, 'corp', 'corp') as number) : 0);
    });
  }
  /** The board with the use paid and nothing resolved: a click and the play cost gone, the card out of HQ (`hq`). */
  paidBoard(before: GameState, from: From, credits: number, played?: string): GameState {
    const s = structuredClone(before);
    if (from === 'hq' || from === 'identity' || from === 'runnerScoreArea' || from === 'trash') {
      s.corp.clicks = Math.max(0, s.corp.clicks - 1);
      s.corp.credits -= credits;
    }
    if (from === 'hq' && played) {
      const i = s.corp.hq.findIndex(c => c.instanceId === played);
      if (i >= 0) s.corp.archives.faceUp.push(...s.corp.hq.splice(i, 1));
    }
    return s;
  }

  /** One engine step of the game being watched. */
  step(before: GameState, a: any, after: GameState) {
    if (!this.open && a && a.player === 'corp' && a.type !== 'RESOLVE_PROMPT' && a.type !== 'PASS' && a.type !== 'END_TURN' && a.type !== 'START_TURN') {
      const card = a.cardInstanceId ? (this.S.core.findCardAnywhere(before, a.cardInstanceId) as CardInstance | undefined) : undefined;
      // the identity's ability (Synapse Global's click) names the identity's instance
      this.open = { a, code: a.type === 'TRASH_RESOURCE' ? 'TRASH' : (card?.cardCode ?? null), before };
    }
    if (this.open && !after.pendingPrompts.length) {
      const w = this.open;
      this.open = null;
      this.close(w.a, w.code, w.before, after);
    }
  }
  /** A game that ended or a leg that stops with a window open closes it on the last board. */
  flush(last: GameState) {
    if (this.open) {
      const w = this.open;
      this.open = null;
      this.close(w.a, w.code, w.before, last);
    }
  }

  private close(a: any, code: string | null, before: GameState, after: GameState) {
    const scored = after.corp.scoreArea.filter(c => !before.corp.scoreArea.some(b => b.instanceId === c.instanceId)).map(c => c.cardCode);
    const w: Window = {
      a,
      code,
      before,
      after,
      tagsFell: Math.max(0, before.runner.tags - after.runner.tags),
      taggedBefore: before.runner.tags > 0,
      gripFell: Math.max(0, before.runner.grip.length - after.runner.grip.length),
      creditsUp: after.corp.credits - before.corp.credits,
      hqUp: after.corp.hq.length - before.corp.hq.length,
      scored,
      flatline: after.winner === 'corp' && !before.winner && /flatlined/i.test(after.winReason ?? ''),
    };
    if (code === 'TRASH' && w.taggedBefore) {
      const r = before.runner.rig.resources.find(c => c.instanceId === a.cardInstanceId);
      this.record('trash', r ? this.title(r.cardCode) : '?', w, { title: 'trash', from: 'trash', line: () => 'trash' }, 2);
      return;
    }
    let any = false;
    if (code && DETECT[code]) {
      const d = DETECT[code];
      const l = d.line(w);
      if (l) {
        any = true;
        this.record(l, d.title, w, d, d.from === 'hq' ? (this.S.core.getCardDefinition(code).cost ?? 0) : 0, code);
      }
    }
    if (w.taggedBefore && scored.includes(ORBITAL)) {
      any = true;
      this.record('take', 'Orbital Superiority', w, { title: 'Orbital Superiority', from: 'onScore', damage: true, line: () => 'take' }, 0);
    }
    if (!any && w.tagsFell > 0) this.record('other', code && code !== 'TRASH' ? this.title(code) : String(a.type), w, { title: '', from: 'none', line: () => 'other' }, 0);
  }
  private title(code: string): string {
    try {
      return this.S.core.getCardDefinition(code).title as string;
    } catch {
      return code;
    }
  }
  /** The untagged use's board (from the board with the use paid), or undefined if the card has none. */
  private withoutBoard(code: string | undefined, paid: GameState, after: GameState): GameState[] | undefined {
    const draw = (s: GameState, k: number) => {
      const t = structuredClone(s);
      t.corp.hq.push(...t.corp.rd.splice(0, k));
      return t;
    };
    const cred = (s: GameState, k: number) => ({ ...structuredClone(s), corp: { ...s.corp, credits: s.corp.credits + k } });
    if (code === '34045') return [draw(cred(paid, 4), 1)];
    if (code === '30056') return [cred(paid, 3), draw(paid, 3)];
    if (code === '34037') {
      // the board after, with the tag back and the placed counter off the card that gained one
      const t = structuredClone(after);
      t.runner.tags += 1;
      for (const s of Object.values(t.corp.servers))
        for (const c of [...s.root, ...s.ice]) {
          const was = Object.values(paid.corp.servers).flatMap(x => [...x.root, ...x.ice]).find(b => b.instanceId === c.instanceId);
          if (c.advancementCounters > (was?.advancementCounters ?? 0)) {
            c.advancementCounters -= 1;
            return [t];
          }
        }
      return [t];
    }
    return undefined;
  }
  private record(line: Line, card: string, w: Window, d: Detect, credits: number, code?: string) {
    const u: Use = { line, card, T: w.before.turnNumber, active: w.before.activePlayer, tags: w.before.runner.tags, drop: 0, gain: 0, paid: 0, swing: 0 };
    if (d.damage) u.damage = true;
    const played = w.a.cardInstanceId as string | undefined;
    u.paid = r3(this.paid(w.before, d.from, credits));
    if (d.damage && w.flatline) {
      u.kill = r3(this.flatlineWorth(w.before));
      u.drop = u.kill;
    } else u.drop = w.after.winner ? 0 : r3(Math.max(0, this.standing(w.before) - this.standing(w.after)));
    const paidB = this.paidBoard(w.before, d.from, credits, played);
    const base = d.gain || this.withoutBoard(code, paidB, w.after) ? this.corpSide(paidB) : 0;
    if (d.gain && !w.after.winner) u.gain = r3(this.corpSide(w.after) - base);
    const wo = this.withoutBoard(code, paidB, w.after);
    if (wo) u.without = r3(Math.max(0, Math.max(...wo.map(b => this.corpSide(b) - base)) - u.paid));
    u.swing = r3(Math.max(0, u.drop + u.gain - u.paid - (u.without ?? 0)));
    if (code === '35066') {
      const back = Object.values(w.after.corp.servers).flatMap(s => s.root).find(c => w.before.runner.scoreArea.some(b => b.instanceId === c.instanceId));
      if (back) u.ipPoints = this.S.core.getCardDefinition(back.cardCode).agenda_points ?? 0;
    }
    if (code === '34037') {
      const before = Object.values(w.before.corp.servers).flatMap(s => [...s.root, ...s.ice]);
      const c = Object.values(w.after.corp.servers)
        .flatMap(s => [...s.root, ...s.ice])
        .find(x => x.advancementCounters > (before.find(b => b.instanceId === x.instanceId)?.advancementCounters ?? 0));
      if (c) u.greasedType = this.S.core.getCardDefinition(c.cardCode).type_code;
    }
    this.uses.push(u);
  }
}
