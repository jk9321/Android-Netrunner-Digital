import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { nextInt } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findCardAnywhere, findInstalledCorpCard, removeCard, revealInHand } from '../../../engine/helpers';
import { accessOutsideRun } from '../../../engine/actions/run';
import { trashInstalledRunnerCard } from '../../../engine/damage';
import { derez, useOncePerTurn } from '../../../engine/cardEffects';
import { isIcebreaker } from '../../../engine/ice';
import { CardScript, EffectContext } from '../../types';
import { installRunnerHostChoice, installableRunnerCards } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts, RunnerHostData } from '../../steps';
import { isSelf, keywords, onceKey } from './helpers';

// Bling: +1 MU. Whenever you install a card without spending credits, you may host
// the top card of your stack faceup on this hardware. You can play or install hosted
// cards as if they were in your grip. When your discard phase ends, trash all hosted cards.
const blingFlow = prompts({
  host: choice(({ state, card }, a) => {
    if (a.optionId !== 'host' || state.runner.stack.length === 0) return;
    const top = state.runner.stack.shift()!;
    card.hostedCards = [...(card.hostedCards ?? []), top];
    addLog(state, 'runner', `Runner hosted ${cardDef(top).title} on Bling.`);
  }),
});

export const bling: CardScript = {
  modifiers: { memory: 1 },
  hostedPlayable: true,
  triggers: {
    installed: (ctx, e) => {
      if (cardDef(e.card).side_code !== 'runner' || e.paid !== 0 || ctx.state.runner.stack.length === 0) return;
      blingFlow.choice(ctx, 'host', choiceQuestion('runner', 'Bling: host the top card of your stack on Bling?', [
        { id: 'host', label: 'Host the top card' },
        { id: 'no', label: 'No' },
      ]));
    },
    discard_phase_ends: ({ state, card }, e) => {
      if (e.side !== 'runner' || !card.hostedCards?.length) return;
      state.runner.heap.push(...card.hostedCards);
      addLog(state, 'runner', `Bling's hosted cards were trashed (${card.hostedCards.map(c => cardDef(c).title).join(', ')}).`);
      card.hostedCards = [];
    },
  },
  ...blingFlow.script,
};

// Detente: +1 MU. The first time each turn you make a successful run on HQ, you may
// host 1 card from HQ at random faceup on this hardware. click, add 2 hosted cards
// to HQ: The Runner may access 1 card in HQ at random. Any player can use this ability.
const detenteReturn = (state: GameState, card: CardInstance, ids: string[]) => {
  for (const id of ids) {
    const hosted = card.hostedCards?.find(c => c.instanceId === id);
    if (!hosted) continue;
    card.hostedCards = card.hostedCards!.filter(c => c !== hosted);
    state.corp.hq.push(hosted);
    // Hosted faceup, so the Runner knows what went back
    revealInHand(state, 'corp', [hosted]);
  }
  addLog(state, 'runner', `${ids.length} card(s) hosted on Detente were added to HQ.`);
};

const detenteAccessQuestion = (ctx: EffectContext) =>
  ctx.state.corp.hq.length === 0 || ctx.state.activeRun
    ? null
    : choiceQuestion('runner', 'Detente: access 1 card in HQ at random?', [
        { id: 'access', label: 'Access 1 random card in HQ' },
        { id: 'no', label: 'No' },
      ]);

const detenteFlow = prompts({
  host: choice(({ state, card }, a) => {
    if (a.optionId !== 'host' || state.corp.hq.length === 0) return;
    const target = state.corp.hq[nextInt(state.rng, state.corp.hq.length)];
    removeCard(state.corp.hq, target);
    target.isRezzed = true;
    card.hostedCards = [...(card.hostedCards ?? []), target];
    addLog(state, 'runner', `Runner hosted ${cardDef(target).title} from HQ on Detente.`);
  }),
  return: cards((ctx, a) => {
    detenteReturn(ctx.state, ctx.card, a.ids);
    detenteFlow.askIf(ctx, 'access', detenteAccessQuestion(ctx));
  }),
  access: choice(({ state }, a) => {
    const hq = state.corp.hq;
    if (a.optionId === 'access' && hq.length > 0) accessOutsideRun(state, [hq[nextInt(state.rng, hq.length)].instanceId]);
  }),
});

export const detente: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    successful_run: (ctx, e) => {
      if (e.server !== 'hq' || ctx.state.corp.hq.length === 0 || !useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      detenteFlow.choice(ctx, 'host', choiceQuestion('runner', 'Detente: host 1 card from HQ at random?', [
        { id: 'host', label: 'Host a random card from HQ' },
        { id: 'no', label: 'No' },
      ]));
    },
  },
  abilities: [
    {
      label: 'Add 2 hosted cards to HQ: the Runner may access 1 card in HQ at random.',
      clicks: 1,
      anyPlayer: true,
      canUse: ({ card }) => ((card.hostedCards?.length ?? 0) >= 2 ? null : 'Needs 2 hosted cards'),
      resolve: ctx => {
        const hosted = ctx.card.hostedCards ?? [];
        if (hosted.length > 2) {
          detenteFlow.cards(ctx, 'return', cardsQuestion(ctx.side, 'Detente: choose 2 hosted cards to add to HQ.', hosted.map(c => c.instanceId), 2, 2));
          return;
        }
        detenteReturn(ctx.state, ctx.card, hosted.map(c => c.instanceId));
        detenteFlow.askIf(ctx, 'access', detenteAccessQuestion(ctx));
      },
    },
  ],
  ...detenteFlow.script,
};

// Maglectric Rapid (748 Mod): Whenever you make a successful run on HQ, you may
// trash this hardware to derez 1 installed Corp card.
const rezzedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]).filter(c => c.isRezzed);

const maglectricFlow = prompts({
  derez: cards(({ state, card }, a) => {
    if (a.ids.length === 0) return;
    const target = findInstalledCorpCard(state, a.ids[0])?.card;
    if (!target || !state.runner.rig.hardware.includes(card)) return;
    trashInstalledRunnerCard(state, card);
    addLog(state, 'runner', 'Runner trashed Maglectric Rapid (748 Mod) to derez a Corp card.');
    derez(state, target);
  }),
});

export const maglectric: CardScript = {
  triggers: {
    successful_run: (ctx, e) => {
      const targets = rezzedCorpCards(ctx.state);
      if (e.server !== 'hq' || targets.length === 0) return;
      maglectricFlow.cards(ctx, 'derez', cardsQuestion('runner', 'Maglectric Rapid: you may trash it to derez 1 installed Corp card.', targets.map(c => c.instanceId), 0, 1));
    },
  },
  ...maglectricFlow.script,
};

// GAMEDRAGON™ Pro: When you install this hardware and when your turn begins, you may
// host this hardware on an installed non-AI icebreaker. Host icebreaker gets +1
// strength. Abilities that increase its strength last for the remainder of the run.
const gamedragonHostQuestion = (ctx: EffectContext) => {
  const breakers = ctx.state.runner.rig.programs.filter(
    p => isIcebreaker(p) && !/\bAI\b/.test(keywords(p)) && p.instanceId !== ctx.card.hostedOnId
  );
  if (breakers.length === 0) return null;
  return choiceQuestion('runner', 'GAMEDRAGON™ Pro: host it on an icebreaker?', [
    ...breakers.map(b => ({ id: b.instanceId, label: `Host on ${cardDef(b).title}` })),
    { id: 'no', label: 'Leave it where it is' },
  ]);
};

const gamedragonFlow = prompts({
  host: choice(({ state, card }, a) => {
    if (a.optionId === 'no') return;
    const breaker = state.runner.rig.programs.find(p => p.instanceId === a.optionId);
    if (!breaker || !state.runner.rig.hardware.includes(card)) return;
    const old = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
    if (old) old.hostedCardIds = old.hostedCardIds.filter(id => id !== card.instanceId);
    card.hostedOnId = breaker.instanceId;
    breaker.hostedCardIds.push(card.instanceId);
    addLog(state, 'runner', `Runner hosted GAMEDRAGON™ Pro on ${cardDef(breaker).title}.`);
  }),
});
const askGamedragonHost = (ctx: EffectContext) => gamedragonFlow.askIf(ctx, 'host', gamedragonHostQuestion(ctx));

export const gamedragon: CardScript = {
  modifiers: { hostStrength: 1, boostsLastForRun: true },
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && askGamedragonHost(ctx),
    turn_begins: (ctx, e) => e.side === 'runner' && askGamedragonHost(ctx),
  },
  ...gamedragonFlow.script,
};

// Madani: click: Host any number of programs from your grip faceup on this hardware.
// Once per turn -> 0 credits: Install 1 hosted program (paying its install cost).
const madaniTargets = (state: GameState, card: CardInstance) => installableRunnerCards(state, card.hostedCards ?? []);

const madaniFlow = prompts({
  host_programs: cards(({ state, card }, a) => {
    for (const id of a.ids) {
      const program = state.runner.grip.find(c => c.instanceId === id);
      if (!program) continue;
      removeCard(state.runner.grip, program);
      card.hostedCards = [...(card.hostedCards ?? []), program];
    }
    addLog(state, 'runner', `Runner hosted ${a.ids.length} program(s) on Madani.`);
  }),
  install: cards((ctx, a) => void madaniFlow.installRunner(ctx, a.ids[0], 'host', 0, a.trashFirst)),
  host: choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export const madani: CardScript = {
  abilities: [
    {
      label: 'Host any number of programs from your grip on Madani.',
      clicks: 1,
      canUse: ({ state }) => (state.runner.grip.some(c => cardDef(c).type_code === 'program') ? null : 'No programs in your grip'),
      resolve: ctx => {
        const programs = ctx.state.runner.grip.filter(c => cardDef(c).type_code === 'program');
        madaniFlow.cards(ctx, 'host_programs', cardsQuestion('runner', 'Madani: host any number of programs from your grip.', programs.map(c => c.instanceId), 0, programs.length));
      },
    },
    {
      label: 'Install 1 hosted program.',
      oncePerTurn: true,
      canUse: ({ state, card }) => (madaniTargets(state, card).length > 0 ? null : 'No hosted program can be installed'),
      resolve: ctx =>
        madaniFlow.runnerInstall(ctx, 'install', { message: 'Madani: install 1 hosted program.', candidateIds: madaniTargets(ctx.state, ctx.card).map(c => c.instanceId), min: 1, max: 1 }),
    },
  ],
  ...madaniFlow.script,
};

// --- Programs ------------------------------------------------------------------------

export const elevationRunnerHardwareScripts: Record<string, CardScript> = {
  '35006': bling,
  '35018': detente,
  '35019': maglectric,
  '35027': gamedragon,
  '35028': madani,
};
