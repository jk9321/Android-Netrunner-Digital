import { cardDef } from '../cards';
import { addLog } from '../engine/log';
import { drawCards, fromSetAside, madeSuccessfulRunThisTurn, revealInHand, setAside, setAsideZone } from '../engine/helpers';
import { shuffleInPlace } from '../rng';
import { CardScript, EffectContext } from './types';
import { runBlocked, startRun } from '../engine/actions/run';
import { runnerInstallCost } from '../engine/actions/install';
import { drawForEffect } from '../engine/cardEffects';
import { gainCredits, installRunnerTrashing, installableRunnerCards, loseClickIfAny } from './effects';
import { cards, cardsQuestion, choice, choiceQuestion, ChoiceQuestion, InstallData, prompts } from './steps';

/** Runner events from System Gateway. */

// Sure Gamble: Gain 9 credits.
const sureGamble: CardScript = {
  onPlay: ({ state }) => {
    gainCredits(state, 'runner', 9);
    addLog(state, 'runner', 'Runner gained 9 [credit].');
  },
};

// Creative Commission: Gain 5 credits. If you have any click remaining, lose click.
const creativeCommission: CardScript = {
  onPlay: ({ state }) => {
    gainCredits(state, 'runner', 5);
    loseClickIfAny(state, 'runner');
    addLog(state, 'runner', 'Runner gained 5 [credit].');
  },
};

// VRcation: Draw 4 cards. If you have any click remaining, lose click.
const vrcation: CardScript = {
  onPlay: ({ state }) => {
    const drawn = drawCards(state, 'runner', 4);
    loseClickIfAny(state, 'runner');
    addLog(state, 'runner', `Runner drew ${drawn} card(s).`);
  },
};

// Wildcat Strike: Resolve 1 of the following of the Corp's choice:
// * Gain 6 credits. * Draw 4 cards.
const wildcatFlow = prompts({
  corp_choice: choice(({ state }, a) => {
    if (a.optionId === 'credits') {
      gainCredits(state, 'runner', 6);
      addLog(state, 'runner', 'Corp chose: Runner gains 6 [credit].');
    } else {
      const drawn = drawCards(state, 'runner', 4);
      addLog(state, 'runner', `Corp chose: Runner draws ${drawn} card(s).`);
    }
  }),
});

const wildcatStrike: CardScript = {
  onPlay: ctx =>
    wildcatFlow.choice(
      ctx,
      'corp_choice',
      choiceQuestion('corp', 'Wildcat Strike: choose what the Runner gets.', [
        { id: 'credits', label: 'Runner gains 6 credits' },
        { id: 'cards', label: 'Runner draws 4 cards' },
      ])
    ),
  ...wildcatFlow.script,
};

// Mutual Favor: Search your stack for 1 icebreaker and reveal it. (Shuffle
// your stack after searching it.) If you made a successful run this turn, you
// may install that program. If you do not, add it to your grip.
/** Mutual Favor finding nothing, whether or not the Stack had an icebreaker (rules 8.7.2e); the Stack is still shuffled (8.7.3). */
function foundNone({ state }: EffectContext): void {
  shuffleInPlace(state.rng, state.runner.stack);
  addLog(state, 'runner', 'Runner searched their Stack and found no icebreaker.');
}

const mutualFavorFlow = prompts({
  // Also the step of the decline asked when nothing qualifies (its 'no' arrives as no cards)
  search: cards((ctx, a) => {
    const { state } = ctx;
    const id = a.ids[0];
    if (!id) {
      foundNone(ctx);
      return;
    }
    const card = state.runner.stack.find(c => c.instanceId === id)!;
    // The found card is set aside while the stack is shuffled and the install is decided (rules 8.7.2, 4.8.4, 8.7.3)
    state.runner.stack = state.runner.stack.filter(c => c.instanceId !== id);
    shuffleInPlace(state.rng, state.runner.stack);
    setAside(state, card);
    addLog(state, 'runner', `Runner revealed ${cardDef(card).title} and shuffled their Stack.`);

    if (madeSuccessfulRunThisTurn(state) && installableRunnerCards(state, [card]).length > 0) {
      mutualFavorFlow.choice(
        ctx,
        'install',
        choiceQuestion('runner', `Mutual Favor: install ${cardDef(card).title}?`, [
          // The cost after modifiers such as Carmen's (rules 1.16.4a: the install cost applies to effect installs)
          { id: 'install', label: `Install (${runnerInstallCost(state, card)} credits)` },
          { id: 'grip', label: 'Add to grip' },
        ]),
        { cardId: id, install: true }
      );
      return;
    }
    fromSetAside(state, card);
    state.runner.grip.push(card);
    revealInHand(state, 'runner', [card]);
    addLog(state, 'runner', `Runner added ${cardDef(card).title} to their grip.`);
  }),
  install: choice<InstallData>(({ state }, a, data) => {
    const card = state.setAside?.find(c => c.instanceId === data.cardId);
    if (!card) return;
    // Installing may first trash programs to make room (rules 8.5.6c); if it can't be installed, it goes to the grip.
    // Installed from the set-aside zone, it counts as installed from the stack (4.8.3)
    if (a.optionId !== 'install' || !installRunnerTrashing(state, card, setAsideZone(state), undefined, 0, a.trashFirst)) {
      fromSetAside(state, card);
      state.runner.grip.push(card);
      revealInHand(state, 'runner', [card]);
      addLog(state, 'runner', `Runner added ${cardDef(card).title} to their grip.`);
    }
  }),
});

const mutualFavor: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const breakers = state.runner.stack.filter(c => /icebreaker/i.test(cardDef(c).keywords ?? ''));
    if (breakers.length === 0) {
      // Whether the Stack holds an icebreaker is hidden from the Corp (4.2.2): with the Runner's stops on ALL they are
      // still asked (askEvenIfNone), on the search step so the answer logs the same line as failing to find
      if (!mutualFavorFlow.evenIfNone(ctx, 'runner', false, () => undefined, 'Mutual Favor: no icebreaker in your Stack.', 'OK', { step: 'search' })) foundNone(ctx);
      return;
    }
    // A search with criteria may fail to find even when a match exists (rules 8.7.2e)
    mutualFavorFlow.cards(ctx, 'search', cardsQuestion('runner', 'Mutual Favor: you may choose 1 icebreaker from your Stack.', breakers.map(c => c.instanceId), 0, 1));
  },
  ...mutualFavorFlow.script,
};

/** Which server the Runner runs (for "Run any server" events), asked under the event's 'run' step. */
function runTargetQuestion(ctx: EffectContext, serverIds: string[], cardTitle: string): ChoiceQuestion {
  const options = serverIds.filter(id => !runBlocked(ctx.state, id)).map(id => ({ id, label: ctx.state.corp.servers[id].name }));
  return choiceQuestion('runner', `${cardTitle}: run which server?`, options);
}

const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

// Tread Lightly: Run any server. During that run, the rez cost of each piece of
// ice is increased by 3 credits.
const treadFlow = prompts({
  run: choice(({ state }, a) => void startRun(state, a.optionId, { iceRezCostIncrease: 3, eventCode: '30012' })),
});

const treadLightly: CardScript = {
  onPlay: ctx => treadFlow.choice(ctx, 'run', runTargetQuestion(ctx, Object.keys(ctx.state.corp.servers), 'Tread Lightly')),
  ...treadFlow.script,
};

// Jailbreak: Run HQ or R&D. If successful, draw 1 card and when you breach the
// attacked server, access 1 additional card.
const jailbreakFlow = prompts({
  run: choice((ctx, a) => void startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
});
const jailbreak: CardScript = {
  onPlay: ctx => jailbreakFlow.choice(ctx, 'run', runTargetQuestion(ctx, ['hq', 'rd'], 'Jailbreak')),
  ...jailbreakFlow.script,
  onRunSuccessful: ({ state }) => {
    drawForEffect(state, 'runner', 1, 'Jailbreak');
    state.activeRun!.extraAccesses += 1;
  },
};

// Overclock: Place 5 credits on this event, then run any server. You can spend
// hosted credits during that run.
const overclockFlow = prompts({
  run: choice(({ state }, a) => void startRun(state, a.optionId, { bonusCredits: 5, eventCode: '30029' })),
});

const overclock: CardScript = {
  onPlay: ctx => overclockFlow.choice(ctx, 'run', runTargetQuestion(ctx, Object.keys(ctx.state.corp.servers), 'Overclock')),
  ...overclockFlow.script,
};

export const eventScripts: Record<string, CardScript> = {
  '30002': wildcatStrike,
  '30011': mutualFavor,
  '30012': treadLightly,
  '30028': jailbreak,
  '30029': overclock,
  '30020': creativeCommission,
  '30021': vrcation,
  '30030': sureGamble,
};
