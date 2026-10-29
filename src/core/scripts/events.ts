import { cardDef } from '../cards';
import { addLog } from '../engine/log';
import { drawCards, madeSuccessfulRunThisTurn, revealInHand } from '../engine/helpers';
import { shuffleInPlace } from '../rng';
import { CardScript, EffectContext } from './types';
import { startRun } from '../engine/actions/run';
import { drawForEffect } from '../engine/cardEffects';
import { askCards, askChoice, gainCredits, installRunnerTrashing, installableRunnerCards, loseClickIfAny } from './effects';

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
const wildcatStrike: CardScript = {
  onPlay: ctx =>
    askChoice(
      ctx,
      'corp',
      'Wildcat Strike: choose what the Runner gets.',
      [
        { id: 'credits', label: 'Runner gains 6 credits' },
        { id: 'cards', label: 'Runner draws 4 cards' },
      ],
      'corp_choice'
    ),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'credits') {
      gainCredits(state, 'runner', 6);
      addLog(state, 'runner', 'Corp chose: Runner gains 6 [credit].');
    } else {
      const drawn = drawCards(state, 'runner', 4);
      addLog(state, 'runner', `Corp chose: Runner draws ${drawn} card(s).`);
    }
  },
};

// Mutual Favor: Search your stack for 1 icebreaker and reveal it. (Shuffle
// your stack after searching it.) If you made a successful run this turn, you
// may install that program. If you do not, add it to your grip.
const mutualFavor: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const breakers = state.runner.stack.filter(c => /icebreaker/i.test(cardDef(c).keywords ?? ''));
    if (breakers.length === 0) {
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'runner', 'Runner searched their Stack but found no icebreaker.');
      return;
    }
    askCards(ctx, 'runner', 'Mutual Favor: choose 1 icebreaker from your Stack.', breakers.map(c => c.instanceId), 1, 1, 'search');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'search' && answer.kind === 'effect_cards') {
      const id = answer.cardInstanceIds[0];
      const card = state.runner.stack.find(c => c.instanceId === id)!;
      // Pull the card aside, shuffle, and keep it at the top while deciding.
      state.runner.stack = state.runner.stack.filter(c => c.instanceId !== id);
      shuffleInPlace(state.rng, state.runner.stack);
      state.runner.stack.unshift(card);
      addLog(state, 'runner', `Runner revealed ${cardDef(card).title} and shuffled their Stack.`);

      if (madeSuccessfulRunThisTurn(state) && installableRunnerCards(state, [card]).length > 0) {
        askChoice(
          ctx,
          'runner',
          `Mutual Favor: install ${cardDef(card).title}?`,
          [
            { id: 'install', label: `Install (${cardDef(card).cost ?? 0} credits)` },
            { id: 'grip', label: 'Add to grip' },
          ],
          'install',
          { cardId: id, install: true }
        );
        return;
      }
      state.runner.grip.push(state.runner.stack.shift()!);
      revealInHand(state, 'runner', [card]);
      addLog(state, 'runner', `Runner added ${cardDef(card).title} to their grip.`);
      return;
    }

    if (source.step === 'install' && answer.kind === 'effect_choice') {
      const card = state.runner.stack.find(c => c.instanceId === source.data?.cardId)!;
      // Installing may first trash programs to make room (rules 8.5.6c); if it can't be installed, it goes to the grip
      if (answer.optionId !== 'install' || !installRunnerTrashing(state, card, state.runner.stack, undefined, 0, answer.trashFirst ?? [])) {
        state.runner.stack.shift();
        state.runner.grip.push(card);
        revealInHand(state, 'runner', [card]);
        addLog(state, 'runner', `Runner added ${cardDef(card).title} to their grip.`);
      }
    }
  },
};

/** Asks the Runner which server to run (for "Run any server" events). */
function askRunTarget(ctx: EffectContext, serverIds: string[], cardTitle: string): void {
  const options = serverIds.map(id => ({ id, label: ctx.state.corp.servers[id].name }));
  askChoice(ctx, 'runner', `${cardTitle}: run which server?`, options, 'run');
}

const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

// Tread Lightly: Run any server. During that run, the rez cost of each piece of
// ice is increased by 3 credits.
const treadLightly: CardScript = {
  onPlay: ctx => askRunTarget(ctx, Object.keys(ctx.state.corp.servers), 'Tread Lightly'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(state, answer.optionId, { iceRezCostIncrease: 3, eventCode: '30012' });
  },
};

// Jailbreak: Run HQ or R&D. If successful, draw 1 card and when you breach the
// attacked server, access 1 additional card.
const jailbreak: CardScript = {
  onPlay: ctx => askRunTarget(ctx, ['hq', 'rd'], 'Jailbreak'),
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(ctx.state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode });
  },
  onRunSuccessful: ({ state }) => {
    drawForEffect(state, 'runner', 1, 'Jailbreak');
    state.activeRun!.extraAccesses += 1;
  },
};

// Overclock: Place 5 credits on this event, then run any server. You can spend
// hosted credits during that run.
const overclock: CardScript = {
  onPlay: ctx => askRunTarget(ctx, Object.keys(ctx.state.corp.servers), 'Overclock'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(state, answer.optionId, { bonusCredits: 5, eventCode: '30029' });
  },
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
