import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { removeCard, revealInHand } from '../../../engine/helpers';
import { getCardScript } from '../../index';
import { installedIce } from '../../../engine/cardEffects';
import { runnerInstallBlocker } from '../../../engine/actions/install';
import { dealDamage } from '../../../engine/damage';
import { corpTrashFromHQ, drawForEffect, flipIdentity, memoryLimit, useOncePerTurn } from '../../../engine/cardEffects';
import { isIcebreaker } from '../../../engine/ice';
import { CardScript } from '../../types';
import { gainCredits, installRunnerHostChoice, installableRunnerCards } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts, RunnerHostData } from '../../steps';
import { keywords, onceKey } from './helpers';

const isRunEvent = (card: CardInstance) => cardDef(card).type_code === 'event' && /\brun\b/i.test(keywords(card));

// Ryō "Phoenix" Ōno: The first time each turn a run becomes successful after a
// subroutine resolved during that run, gain 1 credit and the Corp trashes 1 card from HQ.
const ryoFlow = prompts({
  trash: cards(({ state }, a) => {
    corpTrashFromHQ(state, a.ids);
    addLog(state, 'corp', 'Corp trashed 1 card from HQ (Ryō "Phoenix" Ōno).');
  }),
});

export const ryo: CardScript = {
  triggers: {
    successful_run: ctx => {
      const { state, card } = ctx;
      if (!state.activeRun?.subroutineResolved || !useOncePerTurn(state, onceKey(card))) return;
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Ryō "Phoenix" Ōno).');
      const hq = state.corp.hq;
      if (hq.length > 0) ryoFlow.cards(ctx, 'trash', cardsQuestion('corp', 'Ryō "Phoenix" Ōno: trash 1 card from HQ.', hq.map(c => c.instanceId), 1, 1));
    },
  },
  ...ryoFlow.script,
};

// Topan: Once per turn -> click: Install 1 card from your grip, paying 2 credits
// less. When you install that card, suffer 1 meat damage.
const topanTargets = (state: GameState) => installableRunnerCards(state, state.runner.grip, 2);

const topanDamage = (state: GameState) => dealDamage(state, 'meat', 1, false);

const topanFlow = prompts({
  install: cards((ctx, a) => {
    if (topanFlow.installRunner(ctx, a.ids[0], 'host', 2, a.trashFirst)) topanDamage(ctx.state);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => {
    if (installRunnerHostChoice(ctx.state, source, a.raw)) topanDamage(ctx.state);
  }),
});

export const topan: CardScript = {
  abilities: [
    {
      label: 'Install 1 card from your grip, paying 2 credits less, then suffer 1 meat damage.',
      clicks: 1,
      oncePerTurn: true,
      canUse: ({ state }) => (topanTargets(state).length > 0 ? null : 'Nothing in your grip can be installed'),
      resolve: ctx =>
        topanFlow.runnerInstall(ctx, 'install', { message: 'Topan: install 1 card from your grip, paying 2 credits less.', candidateIds: topanTargets(ctx.state).map(c => c.instanceId), min: 1, max: 1 }),
    },
  ],
  ...topanFlow.script,
};

// Barry "Baz" Wong: Whenever the Corp rezzes a piece of ice, you may install 1
// resource or piece of hardware from your grip.
const bazTargets = (state: GameState) =>
  installableRunnerCards(state, state.runner.grip.filter(c => ['resource', 'hardware'].includes(cardDef(c).type_code)));

const bazFlow = prompts({
  install: cards((ctx, a) => {
    if (a.ids.length > 0) bazFlow.installRunner(ctx, a.ids[0], 'host', 0, []);
  }),
  // Never asked: resources and hardware don't install on ice
  host: choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export const baz: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (cardDef(e.card).type_code !== 'ice') return;
      const targets = bazTargets(ctx.state);
      // Asked even with nothing to install when the Runner's stops are on ALL (4.3.2, see askEvenIfNone)
      bazFlow.evenIfNone(
        ctx,
        'runner',
        targets.length > 0,
        () => bazFlow.cards(ctx, 'install', cardsQuestion('runner', 'Barry "Baz" Wong: you may install 1 resource or piece of hardware from your grip.', targets.map(c => c.instanceId), 0, 1)),
        'Barry "Baz" Wong: no resource or hardware in your grip you can install.',
      );
    },
  },
  ...bazFlow.script,
};

// MuslihaT: When your turn begins, look at the top card of your stack. If that
// card is an icebreaker or a run event, you may reveal it and add it to your grip.
const muslihatFlow = prompts({
  top: choice<{ cardId: string }>(({ state }, a, data) => {
    if (a.optionId !== 'take') return;
    const card = state.runner.stack.find(c => c.instanceId === data.cardId);
    if (!card) return;
    removeCard(state.runner.stack, card);
    state.runner.grip.push(card);
    revealInHand(state, 'runner', [card]);
    addLog(state, 'runner', `Runner revealed ${cardDef(card).title} and added it to their grip (MuslihaT).`);
  }),
});

export const muslihat: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      const top = ctx.state.runner.stack[0];
      if (e.side !== 'runner' || !top || !(isIcebreaker(top) || isRunEvent(top))) return;
      muslihatFlow.choice(ctx, 'top', choiceQuestion('runner', `MuslihaT: the top card of your stack is ${cardDef(top).title}. Reveal it and add it to your grip?`, [
        { id: 'take', label: `Add ${cardDef(top).title} to your grip` },
        { id: 'leave', label: 'Leave it' },
      ]), { cardId: top.instanceId });
    },
  },
  ...muslihatFlow.script,
};

// Dewi Subrotoputri: Whenever you make a successful run, if your MU is full, you
// may flip this identity and gain 1 credit. Flip side: Whenever you make a
// successful run, if you have at least 1 unused MU, you may flip this identity and draw 1 card.
const dewiFlow = prompts({
  flip: choice(({ state, card }, a) => {
    if (a.optionId !== 'flip') return;
    const wasFlipped = !!card.flipped;
    flipIdentity(state, 'runner');
    if (!wasFlipped) {
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Dewi Subrotoputri).');
    } else {
      drawForEffect(state, 'runner', 1, 'Dewi Subrotoputri');
    }
  }),
});

export const dewi: CardScript = {
  triggers: {
    successful_run: ctx => {
      const { state, card } = ctx;
      const free = memoryLimit(state) - state.runner.memoryUnitsUsed;
      if (!card.flipped && free <= 0) {
        dewiFlow.choice(ctx, 'flip', choiceQuestion('runner', 'Dewi Subrotoputri: flip and gain 1 credit?', [
          { id: 'flip', label: 'Flip and gain 1 credit' },
          { id: 'no', label: 'Do not flip' },
        ]));
      } else if (card.flipped && free >= 1) {
        dewiFlow.choice(ctx, 'flip', choiceQuestion('runner', 'Dewi Subrotoputri: flip and draw 1 card?', [
          { id: 'flip', label: 'Flip and draw 1 card' },
          { id: 'no', label: 'Do not flip' },
        ]));
      }
    },
  },
  ...dewiFlow.script,
};

/** Why a discarded program or piece of hardware can't be installed right now. */
function magdaleneBlocker(state: GameState, card: CardInstance): string {
  const ice = installedIce(state);
  if (getCardScript(card.cardCode)?.installsOnIce && ice.length === 0) return 'no installed ice to host it';
  return runnerInstallBlocker(state, card, getCardScript(card.cardCode)?.installsOnIce ? ice[0].instanceId : undefined) ?? 'not allowed';
}

// Magdalene Keino-Chemutai: Whenever you discard cards to reach your maximum hand
// size, you may install 1 program or piece of hardware from among those cards.
const magdaleneFlow = prompts({
  install: cards((ctx, a) => {
    if (a.ids.length > 0) magdaleneFlow.installRunner(ctx, a.ids[0], 'host', 0, a.trashFirst);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export const magdalene: CardScript = {
  triggers: {
    discarded_to_hand_size: (ctx, e) => {
      if (e.side !== 'runner') return;
      const inHeap = e.cards.filter(c => ctx.state.runner.heap.includes(c) && ['program', 'hardware'].includes(cardDef(c).type_code));
      const targets = installableRunnerCards(ctx.state, inHeap);
      if (targets.length === 0) {
        // Installing still means paying the install cost (rules 1.16.6), so say why nothing could be installed
        for (const c of inHeap) addLog(ctx.state, 'runner', `Magdalene Keino-Chemutai: ${cardDef(c).title} cannot be installed (${magdaleneBlocker(ctx.state, c)}).`);
        return;
      }
      magdaleneFlow.runnerInstall(ctx, 'install', { message: 'Magdalene Keino-Chemutai: you may install 1 program or piece of hardware you discarded.', candidateIds: targets.map(c => c.instanceId), min: 0, max: 1 });
    },
  },
  ...magdaleneFlow.script,
};

// --- Events -------------------------------------------------------------------

export const elevationRunnerIdentitiesScripts: Record<string, CardScript> = {
  '35001': ryo,
  '35002': topan,
  '35012': baz,
  '35013': muslihat,
  '35023': dewi,
  '35024': magdalene,
};
