import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, revealInHand } from '../../../engine/helpers';
import { playBlocker, playCardFrom } from '../../../engine/actions/play';
import { gainFromCard } from '../../../engine/cardEffects';
import { EffectContext } from '../../types';
import { cards, choice, prompts } from '../../steps';
import { corpInstallOptions, installCorpChoice } from '../../effects';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const type = (card: CardInstance) => cardDef(card).type_code;

export const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const onceKey = (card: CardInstance) => `once:${card.instanceId}`;

export const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

export const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;

export const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

/** Cards in a list that the Corp could install somewhere (not operations). */
export const installable = (state: GameState, cards: CardInstance[], opts: Parameters<typeof corpInstallOptions>[2] = {}) =>
  cards.filter(c => type(c) !== 'operation' && corpInstallOptions(state, c, opts).length > 0);

// Humanoid Resources: click click click, trash: Gain 4 credits and draw 3 cards. Install
// up to 2 cards from HQ (one at a time). You may play 1 operation from HQ.
/** Install up to `left` cards from HQ, one at a time; `then` 'operation': afterwards, you may play 1 operation from HQ. */
type InstallFromHQ = { left: number; then: string };

export const installFromHQ = prompts({
  install_pick: cards<InstallFromHQ>((ctx, a, { left, then }) => {
    // No card: declined, or the one answer of a question asked though nothing qualified (askEvenIfNone)
    if (a.ids.length === 0) {
      if (then === 'operation') askPlayOperation(ctx);
      return;
    }
    if (!installFromHQ.corpInstall(ctx, a.ids[0], 'install_server', {}, { left, then })) askInstallFromHQ(ctx, left - 1, then);
  }),
  install_server: choice<InstallFromHQ & { cardId: string; install: true }>((ctx, a, { left, then }, source) => {
    installCorpChoice(ctx.state, source, a.raw);
    askInstallFromHQ(ctx, left - 1, then);
  }),
  operation: cards((ctx, a) => {
    const card = ctx.state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (card) playCardFrom(ctx.state, 'corp', card, ctx.state.corp.hq, { fromHand: true });
  }),
});

export function askInstallFromHQ(ctx: EffectContext, left: number, then: string): void {
  const cards = installable(ctx.state, ctx.state.corp.hq);
  // Asked even when nothing in HQ can be installed when the Corp's stops are on ALL (4.3.2, see askEvenIfNone); the
  // one answer takes the decline's path
  const title = cardDef(ctx.card).title;
  if (
    left > 0 &&
    installFromHQ.evenIfNone(
      ctx,
      'corp',
      cards.length > 0,
      () => installFromHQ.cards(ctx, 'install_pick', { side: 'corp', message: `${title}: you may install a card from HQ (${left} left).`, candidateIds: ids(cards), min: 0, max: 1 }, { left, then }),
      `${title}: no card in HQ you can install.`,
      'OK',
      { step: 'install_pick', data: { left, then } },
    )
  )
    return;
  if (then === 'operation') askPlayOperation(ctx);
}

function askPlayOperation(ctx: EffectContext): void {
  const ops = ctx.state.corp.hq.filter(c => type(c) === 'operation' && !safePlayBlocker(ctx.state, c));
  const title = cardDef(ctx.card).title;
  installFromHQ.evenIfNone(
    ctx,
    'corp',
    ops.length > 0,
    () => installFromHQ.cards(ctx, 'operation', { side: 'corp', message: `${title}: you may play 1 operation from HQ.`, candidateIds: ids(ops), min: 0, max: 1 }),
    `${title}: no operation in HQ you can play.`,
  );
}

const safePlayBlocker = (state: GameState, card: CardInstance) => {
  try {
    return playBlocker(state, 'corp', card, true);
  } catch {
    return 'Not playable';
  }
};

export const safePlayBlockerFrom = (state: GameState, card: CardInstance) => {
  try {
    return playBlocker(state, 'corp', card, false);
  } catch {
    return 'Not playable';
  }
};

// Peer Review (Transaction): Reveal all but 1 card in HQ. Gain 7 credits. You may install
// 1 card from HQ in the root of a remote server.
const peerReviewTargets = (state: GameState) =>
  installable(state, state.corp.hq.filter(c => type(c) !== 'ice'), { remoteRootOnly: true });

export const peerReviewFlow = prompts({
  hide: cards((ctx, a) => peerReviewResolve(ctx, a.ids[0])),
  pick: cards((ctx, a) => {
    if (a.ids.length > 0) peerReviewFlow.corpInstall(ctx, a.ids[0], 'server', { remoteRootOnly: true });
  }),
  server: choice<{ cardId: string; install: true }>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export function peerReviewResolve(ctx: EffectContext, hiddenId: string | undefined): void {
  const { state, card } = ctx;
  const shown = state.corp.hq.filter(c => c.instanceId !== hiddenId);
  if (shown.length > 0) addLog(state, 'corp', `Corp revealed ${shown.map(c => cardDef(c).title).join(', ')} (Peer Review).`);
  revealInHand(state, 'corp', shown);
  gainFromCard(state, 'corp', 7, card);
  const targets = peerReviewTargets(state);
  if (targets.length > 0) peerReviewFlow.cards(ctx, 'pick', { side: 'corp', message: 'Peer Review: you may install 1 card from HQ in the root of a remote server.', candidateIds: ids(targets), min: 0, max: 1 });
}
