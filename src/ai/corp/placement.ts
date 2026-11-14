import { CardInstance, GameAction, GameState, cardDef } from '../../core';
import { assetPartner, centralIce, iceRedirect, scoreInTwoPick } from '../countedScore';
import { HeldLine } from './lines';
import { ScoreLine, keepsScore } from '../winNow';
import { econValue } from '../cardValues';
import { isTrap } from '../runs';
import { mainRemote } from '../corpAI';

/**
 * Owner: where a card goes (Step 4 Stage A, spec-step4-corp-core.md 1.8; registry row "placement").
 *
 * Stage A writes the function and does not wire it in: no decision calls `place` yet (Stage B4 hands its destination to
 * the ranking's install actions and deletes the rewriters; Stage D3 routes the install prompts to it). It applies
 * TODAY's rules in TODAY's order, so that `place(state, card, ctx)[0]` is where the Corp's install of `card` ends up
 * once the ranking (or the planner) has proposed `ctx.from`:
 *   0. a counted score this turn (scoreNowPlan): the pick stands while it keeps the score (keepsScore), else the score's
 *      line takes the click;
 *   1. a counted line (corpAI.ts decide, scoreInTwoPick): an asset line (assetCover: the cheapest ice from HQ in front
 *      of the asset, or the asset into an iced remote that waits) places the asset; a held agenda line, or a line step
 *      that takes the click, leaves the pick to the line (no rewrite: today's rewriters are skipped while a line holds);
 *   2. central ice (centralIce): ice for a remote goes to a central with no ice first;
 *   3. ice redirect (iceRedirect): remote ice goes to the scoring remote while it does not hold;
 *   4. asset partner (assetPartner): an asset or upgrade for a new remote goes to an iced remote with an open root,
 *      never the scoring remote reserved for an agenda (reservedForAgenda, inside assetCover and assetPartner);
 *   5. otherwise the pick stands, labelled by the installScore asset line that chose it where one did (an econ asset
 *      in an empty iced remote that is not the scoring remote; a trap kept off the scoring remote), else 'pick'.
 * Rules: one agenda or asset in a remote's root (3.3.1), any number of upgrades (3.6.2); a root card may replace one
 * already there by trashing it (8.5.6a); ice costs 1 credit per ice already protecting the server (8.5.11a). The
 * rewriters it reads see the Corp's own HQ and the public board only (10.2.2a).
 */

export type PlacementReason = 'pick' | 'assetCover' | 'centralIce' | 'iceRedirect' | 'assetPartner' | 'assetLine:econIced' | 'assetLine:trapOffScoring';

export interface Placement {
  /** A server id, or 'new' for a new remote. */
  server: string;
  /** Ice: its position counted from the server outward (today always outermost: the install puts it there). */
  position?: number;
  /** Cards trashed first from the server (rule 8.5.6a; the ranking's withDeadIceTrashed). */
  trash?: string[];
  /** A card installed first, in front of this one (assetCover: the ice from HQ). */
  pairWith?: string;
  reason: PlacementReason;
}

export interface PlaceContext {
  /** The install of `card` the ranking or the planner proposed (today's pick before the rewriters). */
  from: GameAction;
  /** The two-turn line the Corp holds as the decision begins (corpAI heldLine). */
  held: HeldLine | null;
  /** A counted score this turn (scoreNowPlan): no line and no rewriter runs; the pick stands only while it keeps the score. */
  scoreNow?: ScoreLine | null;
}

type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean; trashFirst?: string[] };
const isInstall = (a: GameAction): a is Install => a.type === 'INSTALL_CARD';
const typeOf = (c: CardInstance) => cardDef(c).type_code;

const at = (a: Install, reason: PlacementReason): Placement => {
  const server = a.asNewRemote ? 'new' : a.targetServerId ?? 'new';
  return { server, ...(a.trashFirst?.length ? { trash: [...a.trashFirst] } : {}), reason };
};

/**
 * Where `card` goes, best first (see the file comment). Empty when `ctx.from` is not an install of `card` from HQ, or
 * when a counted agenda line takes this click instead (its step is not a placement of this card).
 */
export function place(state: GameState, card: CardInstance, ctx: PlaceContext): Placement[] {
  const from = ctx.from;
  if (!isInstall(from) || from.cardInstanceId !== card.instanceId || !state.corp.hq.some(c => c.instanceId === card.instanceId)) return [];
  if (ctx.scoreNow) return keepsScore(state, from, ctx.scoreNow) ? [at(from, 'pick')] : [];
  // 1. The counted line (scoreInTwoPick changes the held line it is given: a copy)
  const held = ctx.held ? structuredClone(ctx.held) : null;
  const two = scoreInTwoPick(state, from, held);
  const line = two.held && two.held.game === state.id ? two.held : null;
  if (two.action !== from) {
    // An asset line begun on this pick: its first step installs the ice in front, or the asset where an iced remote waits
    if (line?.line.kind === 'asset' && line.line.agendaId === card.instanceId && !held) {
      const server = line.line.server === 'new remote' ? 'new' : line.line.server;
      return [{ server, ...(line.line.iceId ? { pairWith: line.line.iceId } : {}), reason: 'assetCover' }];
    }
    return [];
  }
  if (line) return [at(from, 'pick')];
  // 2-4. The rewriters, in decide's order
  const central = centralIce(state, from);
  if (central && isInstall(central)) return [at(central, 'centralIce')];
  const redirect = iceRedirect(state, from);
  if (redirect && isInstall(redirect)) return [at(redirect, 'iceRedirect')];
  const partner = assetPartner(state, from);
  if (partner && isInstall(partner)) return [at(partner, 'assetPartner')];
  // 5. The pick, with the installScore asset line that put it there
  return [at(from, assetLine(state, card, from))];
}

/** Which of installScore's two asset lines chose this destination (corpAI.ts installScore, 'asset' case), else 'pick'. */
function assetLine(state: GameState, card: CardInstance, from: Install): PlacementReason {
  if (typeOf(card) !== 'asset' || from.asNewRemote || !from.targetServerId) return 'pick';
  const server = state.corp.servers[from.targetServerId];
  if (!server?.isRemote) return 'pick';
  const econ = econValue(card.cardCode, state) !== undefined;
  const main = mainRemote(state);
  if (econ && server.ice.length > 0 && server.root.length === 0 && server.id !== main?.id) return 'assetLine:econIced';
  if (!econ && isTrap(card.cardCode) && server.id !== main?.id) return 'assetLine:trapOffScoring';
  return 'pick';
}

/** The install action a placement stands for (its first step when it pairs an ice in front), for comparing with a played move. */
export function placementAction(card: CardInstance, p: Placement): { cardInstanceId: string; server: string } {
  return p.pairWith ? { cardInstanceId: p.pairWith, server: p.server } : { cardInstanceId: card.instanceId, server: p.server };
}
