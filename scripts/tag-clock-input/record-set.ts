/**
 * F114 + F110, phase A step 4 (brief /mnt/project-files/netrunner-ai/tag-clock-input/brief.md rev 2; ruling point 4 in
 * ruling-redteam.md, second pass): THE RECORD SET, fixed before any arm tree exists and read the same on every arm. It
 * is always priced by the BASE tree (the merge base's src, switches off): the arm decides what the Corp does, never what a
 * use is worth.
 *
 * 1. THE RULE FOR A USE: a use is counted when a tag was used. Either the Runner's tag count fell over a Corp action's
 *    resolution (the action and every prompt it opened, until no prompt is left), or an effect that needs a tagged Runner
 *    resolved. By card (DETECT below). A mode that uses no tag is not a use: Mindscaping's 4 credits and 2 cards (no
 *    damage dealt), Bigger Picture's "give 1 tag" (the tag count rose), Greasing the Palm with the "may" declined (no tag
 *    removed). A score is a Corp action the recorder sees (SCORE_AGENDA, and any action after which a card sits newly in
 *    the Corp's score area).
 * 2. ONE MEASURE: a take is WHAT THE RUNNER LOSES: the fall in the Runner's standing (sideStrength of the Runner plus the
 *    tag clock, both in the Runner's view: the Runner's strength without its tag term; scripts/corp-owed/tags.ts
 *    standing), floored at 0, less what the Corp paid for it (spentBy: the Corp's clicks at clickPrice, its credits by
 *    sideCreditValue, the Corp deciding). A use that gives the Corp something and takes nothing from the Runner is NOT a
 *    take: it is in a second group, "the Corp's gain with a tag" (uses, and the Corp side's change: sideStrength of the
 *    Corp in its own view, after less before), outside every gap, no cost charged. Predictive Planogram's kind is treated
 *    alike: all of that kind are in the second group.
 * 3. EACH LINE WITH ITS OWNER; the tag clock's gap reads only the lines whose owner is the clock (OWNER below):
 *      trash     a resource trashed by the basic action           take   the clock's trash part
 *      punisher  Retribution; IP Enforcement; Bigger Picture's   take   the clock's punisher term
 *                remove-tags mode
 *      f119      Oracle Thinktank (an agenda back into R&D)       take   nothing yet (F119)
 *      damage    Mindscaping's damage by tags; a score of         take   the damage clock (effectValues.ts damageThreat,
 *                Orbital Superiority while tagged                        ownTurnDamage): reported on its own line,
 *                                                                        never in the tag clock's gap
 *      gain      Predictive Planogram played tagged; Synapse      gain   nothing yet (F119)
 *                Global's click; Greasing the Palm's tag;
 *                Unleash; B-1001; Valentao and Piranhas (the
 *                rez's extra cost paid with a tag)
 *      other     any other Corp action over which the tags fell,  -      reported by card; Rotary (the Corp's trash of the
 *                and the Corp's trash of Rotary                          hardware, rule text) is reported here
 *    B-1001's use is on the Runner's turn: it belongs to the Corp turn that follows it (the unit's caller assigns it; each
 *    use carries the turn and the active side it happened in).
 * 4. A KILL: standing (sideStrength) does not know the game ended. A flatline from a tagged-only effect (the damage line)
 *    is recorded as a kill, valued at what the damage clock's owner prices a flatline: valueModel.ts flatlineWorth (the
 *    owner, with effectValues.ts flatlineOdds, of the Runner's flatline exposure, registry V18), read on the board before
 *    the use. It is not counted again as a grip loss or in any tag clock gap.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CardInstance, GameState } from '../../src/core';
import type { Tree } from '../corp-owed/trees';

export type Line = 'trash' | 'punisher' | 'f119' | 'damage' | 'gain' | 'other';
export const GROUP: Record<Line, 'take' | 'gain' | 'other'> = { trash: 'take', punisher: 'take', f119: 'take', damage: 'take', gain: 'gain', other: 'other' };
export const OWNER: Record<Line, string> = {
  trash: "the tag clock's trash part",
  punisher: "the tag clock's punisher term",
  f119: 'nothing yet (F119)',
  damage: 'the damage clock (damageThreat, ownTurnDamage); never in the tag clock gap',
  gain: 'nothing yet (F119)',
  other: 'reported by card',
};
/** The lines the tag clock owns: the only ones in its gap. */
export const CLOCK_LINES: Line[] = ['trash', 'punisher'];

/** What happened over one Corp action's resolution, as the detector sees it. */
export interface Window {
  a: any;
  code: string | null;
  before: GameState;
  after: GameState;
  tagsFell: number;
  taggedBefore: boolean;
  gripFell: number;
  scored: string[];
  flatline: boolean;
}
/** The detector, by card code: the line, or null (not a use). Codes from the card data (src/data/*-cards.json). */
export const DETECT: Record<string, { title: string; line: (w: Window) => Line | null }> = {
  '30065': { title: 'Retribution', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.taggedBefore ? 'punisher' : null) },
  '35066': { title: 'IP Enforcement', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.tagsFell > 0 ? 'punisher' : null) },
  '35065': { title: 'Bigger Picture', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.tagsFell > 0 ? 'punisher' : null) },
  '34049': { title: 'Oracle Thinktank', line: w => (w.tagsFell > 0 ? 'f119' : null) },
  '34045': { title: 'Mindscaping', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.taggedBefore && (w.gripFell > 0 || w.flatline) ? 'damage' : null) },
  '30056': { title: 'Predictive Planogram', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.taggedBefore ? 'gain' : null) },
  '35058': { title: 'Synapse Global', line: w => (w.a.type === 'USE_ABILITY' && w.tagsFell > 0 ? 'gain' : null) },
  '34037': { title: 'Greasing the Palm', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.tagsFell > 0 ? 'gain' : null) },
  '36044': { title: 'Unleash', line: w => (w.a.type === 'PLAY_OPERATION_OR_EVENT' && w.tagsFell > 0 ? 'gain' : null) },
  '34065': { title: 'B-1001', line: w => (w.tagsFell > 0 ? 'gain' : null) },
  '34060': { title: 'Valentão', line: w => (w.a.type === 'REZ_CARD' && w.tagsFell > 0 ? 'gain' : null) },
  '34117': { title: 'Piranhas', line: w => (w.a.type === 'REZ_CARD' && w.tagsFell > 0 ? 'gain' : null) },
  '36014': { title: 'Rotary', line: w => (w.a.type === 'USE_ABILITY' && w.a.player === 'corp' ? 'other' : null) },
};
/** Orbital Superiority: a score while the Runner is tagged (its score does 4 meat damage; untagged it gives a tag). */
export const ORBITAL = '30068';

export interface Use {
  line: Line;
  card: string;
  T: number;
  active: 'corp' | 'runner';
  /** take lines: the standing's fall (floored at 0), the Corp's spend, the take (drop less spend); a kill's value instead of the drop */
  drop?: number;
  spent?: number;
  take?: number;
  kill?: number;
  /** gain line: the Corp side's change */
  gain?: number;
  tags: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Watches a game step by step (`step(before, action, after)`), opens a window at each Corp action and closes it when no
 * prompt is left, and records the uses. `B` is the base tree; `off()` sets its switches off (the caller's tree names).
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
  /** The Runner's strength without its tag term, the Runner's view (scripts/corp-owed/tags.ts standing). */
  standing(s: GameState): number {
    return this.inCtx(s, 'runner', st => (this.B.ev.sideStrength(st, 'runner', 'runner') as number) + (this.B.ev.tagsWorth(st, 'runner') as number));
  }
  /** What the Corp paid from `before` to `after`: clicks at clickPrice, credits by sideCreditValue (the Corp deciding). */
  spent(before: GameState, after: GameState): number {
    const dk = Math.max(0, before.corp.clicks - after.corp.clicks);
    const dc = Math.max(0, before.corp.credits - after.corp.credits);
    return this.inCtx(before, 'corp', st => {
      const click = this.B.hv.clickPrice(st, 'corp', 'corp') as number;
      const less = { ...st, corp: { ...st.corp, credits: st.corp.credits - dc } };
      return dk * click + (this.B.vm.sideCreditValue(st, 'corp', 'corp') as number) - (this.B.vm.sideCreditValue(less, 'corp', 'corp') as number);
    });
  }
  corpSide(s: GameState): number {
    return this.inCtx(s, 'corp', st => this.B.ev.sideStrength(st, 'corp', 'corp') as number);
  }
  flatlineWorth(s: GameState): number {
    return this.inCtx(s, 'runner', st => this.B.vm.flatlineWorth(st) as number);
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
      scored,
      flatline: after.winner === 'corp' && !before.winner && /flatlined/i.test(after.winReason ?? ''),
    };
    const lines: [Line, string][] = [];
    if (code === 'TRASH' && w.taggedBefore) {
      const r = before.runner.rig.resources.find(c => c.instanceId === a.cardInstanceId);
      lines.push(['trash', r ? this.title(r.cardCode) : '?']);
    } else if (code && DETECT[code]) {
      const l = DETECT[code].line(w);
      if (l) lines.push([l, DETECT[code].title]);
    }
    if (w.taggedBefore && scored.includes(ORBITAL)) lines.push(['damage', 'Orbital Superiority']);
    if (!lines.length && w.tagsFell > 0) lines.push(['other', code && code !== 'TRASH' ? this.title(code) : String(a.type)]);
    for (const [line, card] of lines) this.record(line, card, w);
  }
  private title(code: string): string {
    try {
      return this.S.core.getCardDefinition(code).title as string;
    } catch {
      return code;
    }
  }
  private record(line: Line, card: string, w: Window) {
    const u: Use = { line, card, T: w.before.turnNumber, active: w.before.activePlayer, tags: w.before.runner.tags };
    if (GROUP[line] === 'take' || line === 'other') {
      const spent = this.spent(w.before, w.after);
      if (line === 'damage' && w.flatline) {
        u.kill = r3(this.flatlineWorth(w.before));
        u.drop = u.kill;
      } else u.drop = w.after.winner ? 0 : r3(Math.max(0, this.standing(w.before) - this.standing(w.after)));
      u.spent = r3(spent);
      u.take = r3((u.drop ?? 0) - spent);
    } else u.gain = w.after.winner ? 0 : r3(this.corpSide(w.after) - this.corpSide(w.before));
    this.uses.push(u);
  }
}
