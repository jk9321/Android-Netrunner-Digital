import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { nextInt, shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findCardAnywhere, noteTrashedFromHand, removeCard, revealInHand } from '../../../engine/helpers';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { startRun, trashAccessedCard } from '../../../engine/actions/run';
import { giveTags } from '../../../engine/damage';
import { counters, derez, drawForEffect, installedIce, removeTags, runFlag, RunFlag, threatLevel, turnFlag } from '../../../engine/cardEffects';
import { bypassIce } from '../../../engine/ice';
import { rezForFree } from '../../../engine/actions/corp';
import { CardScript, EffectContext } from '../../types';
import { gainCredits, iceLabel, installableRunnerCards, installRunnerHostChoice } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts, RunnerHostData } from '../../steps';
import {
  allServers,
  bypassIfStill,
  centralServers,
  hasKeyword,
  ids,
  place,
  remoteServers,
  runQuestion,
  runSource,
  runnerTurn,
  title,
  type,
  yesNo,
} from './helpers';

// Strike Fund: Gain 4 credits. When this event is trashed from your grip or stack, you may gain 2
// credits.
const strikeFundFlow = prompts({
  trashed: choice(({ state }, a) => {
    if (a.optionId !== 'yes') return;
    gainCredits(state, 'runner', 2);
    addLog(state, 'runner', 'Runner gained 2 [credit] (Strike Fund was trashed).');
  }),
});

export const strikeFund: CardScript = {
  onPlay: ({ state }) => {
    gainCredits(state, 'runner', 4);
    addLog(state, 'runner', 'Runner gained 4 [credit] (Strike Fund).');
  },
  onTrashedFromHand: ctx => strikeFundFlow.ask(ctx, 'trashed', choiceQuestion('runner', 'Strike Fund was trashed: gain 2 [credit]?', yesNo('Gain 2 [credit]'))),
  ...strikeFundFlow.script,
};

// The Price: Trash the top 4 cards of your stack. You may install 1 of those cards, paying 3 credits less.
const priceFlow = prompts({
  install: cards((ctx, a) => {
    if (a.ids.length > 0) priceFlow.installRunner(ctx, a.ids[0], 'host', 3, a.trashFirst);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export const thePrice: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const top = state.runner.stack.splice(0, 4);
    state.runner.heap.push(...top);
    addLog(state, 'runner', `Runner trashed ${top.map(title).join(', ') || 'nothing'} from the top of their stack (The Price).`);
    noteTrashedFromHand(state, top);
    const options = installableRunnerCards(state, top.filter(c => state.runner.heap.includes(c)), 3);
    if (options.length > 0) priceFlow.runnerInstall(ctx, 'install', { message: 'The Price: you may install 1 of those cards, paying 3 [credit] less.', candidateIds: ids(options), min: 0, max: 1 });
  },
  ...priceFlow.script,
};

// Chrysopoeian Skimming: The Corp may reveal an agenda from HQ. If they do, gain [click] and draw
// 1 card. Otherwise, look at the top 3 cards of R&D.
const skimFlow = prompts({
  reveal: cards(({ state }, a) => {
    const agenda = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (!agenda) return skimLook(state);
    revealInHand(state, 'corp', [agenda]);
    addLog(state, 'corp', `Corp revealed ${title(agenda)} from HQ (Chrysopoeian Skimming).`, agenda.cardCode);
    state.runner.clicks += 1;
    drawForEffect(state, 'runner', 1, 'Chrysopoeian Skimming');
  }),
});

export const chrysopoeian: CardScript = {
  onPlay: ctx => {
    const agendas = ctx.state.corp.hq.filter(c => type(c) === 'agenda');
    // The Corp is asked even with no agenda in HQ when its stops are on ALL (4.3.2, see askEvenIfNone); the one answer
    // goes on to the look like a decline
    const asked = skimFlow.evenIfNone(
      ctx,
      'corp',
      agendas.length > 0,
      () => skimFlow.ask(ctx, 'reveal', cardsQuestion('corp', 'Chrysopoeian Skimming: you may reveal an agenda from HQ (the Runner gains [click] and draws 1).', ids(agendas), 0, 1)),
      'Chrysopoeian Skimming: no agenda in HQ to reveal.',
      'OK',
      { step: 'reveal' },
    );
    if (!asked) skimLook(ctx.state);
  },
  ...skimFlow.script,
};

function skimLook(state: GameState): void {
  const top = state.corp.rd.slice(0, 3);
  for (const card of top) runnerSeesRd(state, card);
  addLog(state, 'runner', `Runner looked at the top ${top.length} cards of R&D (Chrysopoeian Skimming).`);
}

// S-Dobrado (Run): Run a central server. The first time you encounter a piece of ice during that
// run, bypass it. Threat 4 -> The second time you encounter a piece of ice during that run, you may
// spend [click] to bypass it.
/** Starts the run an event asked for with runQuestion. */
const runStep = () => choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode }));

const sDobradoFlow = prompts({
  run: runStep(),
  bypass: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId !== 'yes' || state.runner.clicks === 0) return;
    state.runner.clicks -= 1;
    bypassIfStill(state, data.iceId);
  }),
});

export const sDobrado: CardScript = {
  onPlay: ctx => void sDobradoFlow.askIf(ctx, 'run', runQuestion(ctx, 'S-Dobrado', centralServers)),
  triggers: {
    encounter_ice: (ctx, e) => {
      const { state } = ctx;
      const n = runFlag(state, RunFlag.encounters);
      if (n === 1) bypassIce(state);
      else if (n === 2 && threatLevel(state) >= 4 && state.runner.clicks > 0) {
        sDobradoFlow.ask(ctx, 'bypass', choiceQuestion('runner', `S-Dobrado: spend [click] to bypass ${title(e.ice)}?`, yesNo('Spend [click] and bypass')), { iceId: e.ice.instanceId });
      }
    },
  },
  ...sDobradoFlow.script,
};

// Joy Ride (Run): Run R&D. If successful, draw 5 cards.
export const joyRide: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'rd', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ({ state }) => drawForEffect(state, 'runner', 5, 'Joy Ride'),
};

// Bahia Bands (Run): Run any server. If successful, resolve 2 of the following in any order: Draw 2
// cards. / Install 1 card from your grip, paying 1 credit less. / Remove 1 tag. / Place 4 credits on
// this event. You can spend hosted credits to pay trash costs for the remainder of this run.
const BAHIA_MODES = [
  { id: 'draw', label: 'Draw 2 cards' },
  { id: 'install', label: 'Install 1 card from your grip, paying 1 [credit] less' },
  { id: 'tag', label: 'Remove 1 tag' },
  { id: 'credits', label: 'Place 4 [credit] here to pay trash costs this run' },
];

type BahiaData = { done: string };

const bahiaFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
  mode: choice<BahiaData>((ctx, a, d) => {
    const { state, card } = ctx;
    const next = [...bahiaDone(d), a.optionId];
    if (a.optionId === 'draw') drawForEffect(state, 'runner', 2, 'Bahia Bands');
    else if (a.optionId === 'tag') removeTags(state, 1);
    else if (a.optionId === 'credits') {
      place(card, 'credit', 4);
      if (state.activeRun) state.activeRun.trashCreditHosts = [...(state.activeRun.trashCreditHosts ?? []), card.instanceId];
    } else if (a.optionId === 'install') {
      const options = installableRunnerCards(state, state.runner.grip, 1);
      if (options.length > 0) {
        bahiaFlow.runnerInstall(ctx, 'install', { message: 'Bahia Bands: install 1 card from your grip, paying 1 [credit] less.', candidateIds: ids(options), min: 0, max: 1 }, { done: next.join(',') });
        return;
      }
    }
    bahiaAsk(ctx, next);
  }),
  install: cards<BahiaData>((ctx, a, d) => {
    if (a.ids.length > 0 && !bahiaFlow.installRunner(ctx, a.ids[0], 'host', 1, a.trashFirst, { done: bahiaDone(d).join(',') })) return;
    bahiaAsk(ctx, bahiaDone(d));
  }),
  host: choice<BahiaData & RunnerHostData>((ctx, a, d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    bahiaAsk(ctx, bahiaDone(d));
  }),
});

const bahiaDone = (d: Partial<BahiaData>) => String(d.done ?? '').split(',').filter(Boolean);

const bahiaAsk = (ctx: EffectContext, done: string[]) => {
  if (done.length >= 2) return;
  const options = BAHIA_MODES.filter(m => !done.includes(m.id));
  bahiaFlow.choice(ctx, 'mode', { side: 'runner', message: `Bahia Bands: choose ${done.length === 0 ? 'the first' : 'the second'} effect.`, options }, { done: done.join(',') });
};

export const bahiaBands: CardScript = {
  onPlay: ctx => {
    const q = runQuestion(ctx, 'Bahia Bands', allServers(ctx.state));
    bahiaFlow.askIf(ctx, 'run', q);
  },
  onRunSuccessful: ctx => bahiaAsk(ctx, []),
  ...bahiaFlow.script,
};

// --- Rebellion Without Rehearsal: Anarch ---------------------------------------------------

// Eye for an Eye (Run): Play only if you are not tagged. Run HQ. If successful, take 1 tag and
// access 1 additional card when you breach HQ. Access -> Trash 1 card from your grip: Trash the card
// you are accessing.
const eyeFlow = prompts({
  grip: cards<{ accessedId: string }>(({ state }, a, data) => {
    const card = state.runner.grip.find(c => c.instanceId === a.ids[0]);
    const accessed = findCardAnywhere(state, data.accessedId);
    if (!card || !accessed) return;
    removeCard(state.runner.grip, card);
    state.runner.heap.push(card);
    noteTrashedFromHand(state, [card]);
    addLog(state, 'runner', `Runner trashed ${title(card)} from their grip (Eye for an Eye).`);
    trashAccessedCard(state, accessed);
  }),
});

export const eyeForAnEye: CardScript = {
  canPlay: ({ state }) => (state.runner.tags > 0 ? 'You are tagged' : null),
  onPlay: ctx => startRun(ctx.state, 'hq', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ({ state }) => {
    giveTags(state, 1);
    if (state.activeRun) state.activeRun.extraAccesses += 1;
  },
  accessAbility: {
    label: 'trash 1 card from your grip to trash this card',
    canUse: ({ state }) => state.runner.grip.length > 0,
    use: (ctx, accessed) => {
      eyeFlow.ask(ctx, 'grip', cardsQuestion('runner', `Eye for an Eye: trash 1 card from your grip to trash ${title(accessed)}.`, ids(ctx.state.runner.grip), 1, 1), {
        accessedId: accessed.instanceId,
      });
    },
  },
  ...eyeFlow.script,
};

// Privileged Access (Run): Play only if you are not tagged. Run Archives. If successful, instead of
// breaching Archives, take 1 tag. When you take a tag with this event, you may install 1 resource
// from your heap, paying 2 credits less. Threat 3 -> When you take a tag with this event, you may
// install 1 program from your heap.
const heapOf = (state: GameState, kind: string, discount: number) => installableRunnerCards(state, state.runner.heap.filter(c => type(c) === kind), discount);

const privilegedFlow = prompts({
  resource: cards((ctx, a) => {
    if (a.ids[0] && !privilegedFlow.installRunner(ctx, a.ids[0], 'host-resource', 2, a.trashFirst)) return;
    privilegedProgram(ctx);
  }),
  program: cards((ctx, a) => {
    if (a.ids[0]) privilegedFlow.installRunner(ctx, a.ids[0], 'host-program', 0, a.trashFirst);
  }),
  'host-resource': choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    privilegedProgram(ctx);
  }),
  'host-program': choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

function privilegedProgram(ctx: EffectContext): void {
  if (threatLevel(ctx.state) < 3) return;
  const options = heapOf(ctx.state, 'program', 0);
  if (options.length > 0) privilegedFlow.runnerInstall(ctx, 'program', { message: 'Privileged Access: you may install 1 program from your heap.', candidateIds: ids(options), min: 0, max: 1 });
}

export const privilegedAccess: CardScript = {
  canPlay: ({ state }) => (state.runner.tags > 0 ? 'You are tagged' : null),
  onPlay: ctx => {
    startRun(ctx.state, 'archives', { source: runSource(ctx), eventCode: ctx.card.cardCode });
    if (ctx.state.activeRun) ctx.state.activeRun.breachInstead = 'none';
  },
  onRunSuccessful: ctx => {
    giveTags(ctx.state, 1);
    privilegedResource(ctx);
  },
  ...privilegedFlow.script,
};

function privilegedResource(ctx: EffectContext): void {
  const options = heapOf(ctx.state, 'resource', 2);
  if (options.length > 0) privilegedFlow.runnerInstall(ctx, 'resource', { message: 'Privileged Access: you may install 1 resource from your heap, paying 2 [credit] less.', candidateIds: ids(options), min: 0, max: 1 });
  else privilegedProgram(ctx);
}

// Meeting of Minds: Choose connection or virtual. You may search your stack for 1 resource with the
// chosen subtype and reveal it. Add that card to your grip. Reveal any number of cards with the
// chosen subtype in your grip. Gain 1 credit for each card revealed this way.
const meetingFlow = prompts({
  subtype: choice((ctx, a) => {
    const kind = a.optionId;
    const options = ctx.state.runner.stack.filter(c => type(c) === 'resource' && hasKeyword(c, kind));
    // Asked even with no such resource in the stack when the Runner's stops are on ALL (4.2.2, see askEvenIfNone);
    // the one answer goes on like a decline
    const asked = meetingFlow.evenIfNone(
      ctx,
      'runner',
      options.length > 0,
      () => meetingFlow.ask(ctx, 'search', cardsQuestion('runner', `Meeting of Minds: you may search your stack for 1 ${kind} resource.`, ids(options), 0, 1), { kind }),
      `Meeting of Minds: no ${kind} resource in your stack.`,
      'OK',
      { step: 'search', data: { kind } },
    );
    if (!asked) meetingReveal(ctx, kind);
  }),
  search: cards<{ kind: string }>((ctx, a, data) => {
    const { state } = ctx;
    const card = state.runner.stack.find(c => c.instanceId === a.ids[0]);
    if (card) {
      removeCard(state.runner.stack, card);
      state.runner.grip.push(card);
      addLog(state, 'runner', `Runner revealed ${title(card)} and added it to their grip (Meeting of Minds).`, card.cardCode);
    }
    shuffleInPlace(state.rng, state.runner.stack);
    meetingReveal(ctx, String(data.kind));
  }),
  reveal: cards(({ state }, a) => {
    const cards = state.runner.grip.filter(c => a.ids.includes(c.instanceId));
    if (cards.length === 0) return;
    revealInHand(state, 'runner', cards);
    gainCredits(state, 'runner', cards.length);
    addLog(state, 'runner', `Runner revealed ${cards.map(title).join(', ')} and gained ${cards.length} [credit] (Meeting of Minds).`);
  }),
});

export const meetingOfMinds: CardScript = {
  onPlay: ctx =>
    meetingFlow.ask(
      ctx,
      'subtype',
      choiceQuestion('runner', 'Meeting of Minds: choose a subtype.', [
        { id: 'connection', label: 'Connection' },
        { id: 'virtual', label: 'Virtual' },
      ]),
    ),
  ...meetingFlow.script,
};

/** Meeting of Minds: reveal any number of grip cards of the chosen subtype, a credit each. */
function meetingReveal(ctx: EffectContext, kind: string): void {
  const cards = ctx.state.runner.grip.filter(c => hasKeyword(c, kind));
  // Asked even with no such card in the grip when the Runner's stops are on ALL (4.3.2, see askEvenIfNone)
  meetingFlow.evenIfNone(
    ctx,
    'runner',
    cards.length > 0,
    () => meetingFlow.ask(ctx, 'reveal', cardsQuestion('runner', `Meeting of Minds: reveal any number of ${kind} cards in your grip, gaining 1 [credit] each.`, ids(cards), 0, cards.length)),
    `Meeting of Minds: no ${kind} card in your grip.`,
  );
}

// Window of Opportunity (Run): You may install 1 program or piece of hardware from your grip. Run any
// server. When that run begins, derez 1 piece of ice protecting that server. When that run ends, the
// Corp may rez the ice derezzed this way, ignoring all costs.
const windowRun = (ctx: EffectContext) => windowFlow.askIf(ctx, 'run', runQuestion(ctx, 'Window of Opportunity', allServers(ctx.state)));

const windowFlow = prompts({
  install: cards((ctx, a) => {
    if (a.ids.length > 0 && !windowFlow.installRunner(ctx, a.ids[0], 'host', 0, a.trashFirst)) return;
    windowRun(ctx);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    windowRun(ctx);
  }),
  run: runStep(),
  derez: cards(({ state, card }, a) => {
    const ice = installedIce(state).find(c => c.instanceId === a.ids[0]);
    if (!ice) return;
    derez(state, ice);
    state.turnFlags[windowKey(card, ice)] = 1;
    addLog(state, 'runner', `Runner derezzed ${title(ice)} (Window of Opportunity).`);
  }),
  rez: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId !== 'yes') return;
    const ice = installedIce(state).find(c => c.instanceId === data.iceId);
    if (ice && !ice.isRezzed) rezForFree(state, ice);
  }),
});

export const windowOfOpportunity: CardScript = {
  onPlay: ctx => {
    const options = installableRunnerCards(ctx.state, ctx.state.runner.grip.filter(c => type(c) === 'program' || type(c) === 'hardware'));
    // Asked even with nothing to install when the Runner's stops are on ALL (4.3.2, see askEvenIfNone): the one answer
    // goes on to the server choice like a decline
    const asked = windowFlow.evenIfNone(
      ctx,
      'runner',
      options.length > 0,
      () =>
        windowFlow.runnerInstall(ctx, 'install', {
          message: 'Window of Opportunity: you may install 1 program or piece of hardware from your grip.',
          candidateIds: ids(options),
          min: 0,
          max: 1,
        }),
      'Window of Opportunity: no program or hardware in your grip you can install.',
      'OK',
      { step: 'install' },
    );
    if (!asked) windowRun(ctx);
  },
  triggers: {
    run_begins: (ctx, e) => {
      const ice = ctx.state.corp.servers[e.server]?.ice.filter(c => c.isRezzed) ?? [];
      if (ice.length > 0) windowFlow.ask(ctx, 'derez', cardsQuestion('runner', 'Window of Opportunity: derez 1 piece of ice protecting the attacked server.', ids(ice), 1, 1));
    },
  },
  onRunEnds: ctx => {
    const derezzed = installedIce(ctx.state).find(c => !c.isRezzed && turnFlag(ctx.state, windowKey(ctx.card, c)) > 0);
    if (derezzed) windowFlow.ask(ctx, 'rez', choiceQuestion('corp', `Window of Opportunity: rez ${title(derezzed)} ignoring all costs?`, yesNo('Rez it')), { iceId: derezzed.instanceId });
  },
  ...windowFlow.script,
};

const windowKey = (event: CardInstance, ice: CardInstance) => `window:${event.instanceId}:${ice.instanceId}`;

// Burner (Run): Run HQ. If successful, instead of breaching HQ, reveal 3 cards in HQ at random. Add 2
// of the revealed cards to the top and/or bottom of R&D.
const burnerFlow = prompts({
  pick: cards((ctx, a) => {
    const [first, ...rest] = a.ids;
    if (first) burnerWhere(ctx, first, rest);
  }),
  where: choice<{ cardId: string; rest: string }>((ctx, a, data) => {
    const { state } = ctx;
    const card = state.corp.hq.find(c => c.instanceId === data.cardId);
    if (card) {
      removeCard(state.corp.hq, card);
      if (a.optionId === 'top') state.corp.rd.unshift(card);
      else state.corp.rd.push(card);
      runnerSeesRd(state, card);
      addLog(state, 'runner', `Runner added ${title(card)} to the ${a.optionId} of R&D (Burner).`);
    }
    const rest = String(data.rest ?? '').split(',').filter(Boolean);
    if (rest.length > 0) burnerWhere(ctx, rest[0], rest.slice(1));
  }),
});

export const burner: CardScript = {
  onPlay: ctx => {
    startRun(ctx.state, 'hq', { source: runSource(ctx), eventCode: ctx.card.cardCode });
    if (ctx.state.activeRun) ctx.state.activeRun.breachInstead = 'none';
  },
  onRunSuccessful: ctx => {
    const { state } = ctx;
    const pool = [...state.corp.hq];
    const revealed: CardInstance[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) revealed.push(pool.splice(nextInt(state.rng, pool.length), 1)[0]);
    if (revealed.length === 0) return;
    revealInHand(state, 'corp', revealed);
    addLog(state, 'runner', `Runner revealed ${revealed.map(title).join(', ')} from HQ (Burner).`);
    burnerFlow.ask(ctx, 'pick', cardsQuestion('runner', 'Burner: choose 2 of the revealed cards to add to R&D.', ids(revealed), Math.min(2, revealed.length), 2));
  },
  ...burnerFlow.script,
};

function burnerWhere(ctx: EffectContext, cardId: string, rest: string[]): void {
  const card = ctx.state.corp.hq.find(c => c.instanceId === cardId);
  if (!card) return;
  burnerFlow.ask(
    ctx,
    'where',
    choiceQuestion('runner', `Burner: add ${title(card)} to the top or bottom of R&D?`, [
      { id: 'top', label: 'Top of R&D' },
      { id: 'bottom', label: 'Bottom of R&D' },
    ]),
    { cardId, rest: rest.join(',') },
  );
}

// Spree (Run): Place 3 power counters on this event, then run any server. Hosted power counter: Host
// 1 installed trojan program on a piece of ice protecting the attacked server.
const installedTrojans = (state: GameState) => state.runner.rig.programs.filter(c => hasKeyword(c, 'trojan') && c.hostedOnId);

const spreeFlow = prompts({
  run: runStep(),
  trojan: cards((ctx, a) => {
    const { state } = ctx;
    const run = state.activeRun;
    const ice = run ? (state.corp.servers[run.server]?.ice ?? []) : [];
    const trojan = a.ids[0];
    if (trojan && ice.length > 0) {
      spreeFlow.ask(ctx, 'ice', choiceQuestion('runner', 'Spree: host it on which ice?', ice.map(i => ({ id: i.instanceId, label: iceLabel(state, i) }))), { trojan });
    }
  }),
  ice: choice<{ trojan: string }>(({ state }, a, data) => {
    const trojan = state.runner.rig.programs.find(c => c.instanceId === data.trojan);
    const ice = installedIce(state).find(c => c.instanceId === a.optionId);
    if (!trojan || !ice) return;
    const old = trojan.hostedOnId ? findCardAnywhere(state, trojan.hostedOnId) : undefined;
    if (old) old.hostedCardIds = old.hostedCardIds.filter(id => id !== trojan.instanceId);
    trojan.hostedOnId = ice.instanceId;
    ice.hostedCardIds.push(trojan.instanceId);
    addLog(state, 'runner', `Runner moved ${title(trojan)} onto ${iceLabel(state, ice)} (Spree).`);
  }),
});

export const spree: CardScript = {
  onPlay: ctx => {
    place(ctx.card, 'power', 3);
    spreeFlow.askIf(ctx, 'run', runQuestion(ctx, 'Spree', allServers(ctx.state)));
  },
  abilities: [
    {
      label: 'Hosted power counter: host 1 installed trojan on a piece of ice protecting the attacked server.',
      fromRun: true,
      counters: { type: 'power', count: 1 },
      canUse: ({ state }) => {
        const run = state.activeRun;
        if (!run || run.accessOnly) return 'Only during the run';
        if ((state.corp.servers[run.server]?.ice.length ?? 0) === 0) return 'No ice protects the attacked server';
        return installedTrojans(state).length > 0 ? null : 'No installed trojan';
      },
      resolve: ctx => spreeFlow.ask(ctx, 'trojan', cardsQuestion('runner', 'Spree: choose 1 installed trojan to move.', ids(installedTrojans(ctx.state)), 1, 1)),
    },
  ],
  ...spreeFlow.script,
};

// Trick Shot (Run): Place 4 credits on this event. You can spend hosted credits during runs. Run R&D.
// If successful, place 2 credits on this event and access 1 additional card when you breach R&D.
// When that run ends, you may run a remote server.
const trickShotFlow = prompts({
  remote: choice((ctx, a) => {
    // "You may run a remote server" is optional (rules 9.6.9): 'no' declines it
    if (a.optionId === 'no' || ctx.state.activeRun) return;
    // The second run is not "that run" (no source: its end offers no other run); the hosted credits still pay
    startRun(ctx.state, a.optionId, { creditHosts: counters(ctx.card, 'credit') > 0 ? [ctx.card.instanceId] : [] });
  }),
});

export const trickShot: CardScript = {
  paysDuringRuns: true,
  onPlay: ctx => {
    place(ctx.card, 'credit', 4);
    startRun(ctx.state, 'rd', { source: runSource(ctx), eventCode: ctx.card.cardCode, creditHosts: [ctx.card.instanceId] });
  },
  onRunSuccessful: ({ state, card }) => {
    place(card, 'credit', 2);
    if (state.activeRun) state.activeRun.extraAccesses += 1;
  },
  onRunEnds: ctx => {
    if (!ctx.state.winner && runnerTurn(ctx.state)) trickShotFlow.askIf(ctx, 'remote', runQuestion(ctx, 'Trick Shot (you may run a remote server)', remoteServers(ctx.state), true));
  },
  ...trickShotFlow.script,
};

// Ashen Epilogue: Shuffle your grip and heap into your stack, then remove the top 5 cards of your
// stack from the game. Draw 5 cards. Remove this event from the game.
export const ashenEpilogue: CardScript = {
  onPlay: ({ state, card }) => {
    const { runner } = state;
    runner.stack.push(...runner.grip.splice(0), ...runner.heap.splice(0).filter(c => c.instanceId !== card.instanceId));
    shuffleInPlace(state.rng, runner.stack);
    const removed = runner.stack.splice(0, 5);
    state.removedFromGame.push(...removed);
    addLog(state, 'runner', `Runner shuffled their grip and heap into their stack and removed ${removed.map(title).join(', ')} from the game (Ashen Epilogue).`);
    drawForEffect(state, 'runner', 5, 'Ashen Epilogue');
    // It was in the heap, so the shuffle took it out: it goes straight to the removed-from-game zone
    state.removedFromGame.push(card);
  },
};

export const liberationRunnerEventsScripts: Record<string, CardScript> = {
  '34001': strikeFund,
  '34002': thePrice,
  '34011': chrysopoeian,
  '34012': sDobrado,
  '34021': joyRide,
  '34030': bahiaBands,
  '34067': eyeForAnEye,
  '34068': privilegedAccess,
  '34076': meetingOfMinds,
  '34077': windowOfOpportunity,
  '34085': burner,
  '34086': spree,
  '34087': trickShot,
  '34094': ashenEpilogue,
};
