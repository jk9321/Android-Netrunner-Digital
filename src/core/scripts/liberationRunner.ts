import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { nextInt, shuffleInPlace } from '../rng';
import { addLog } from '../engine/log';
import { findCardAnywhere, findInstalledCorpCard, noteTrashedFromHand, removeCard, revealInHand } from '../engine/helpers';
import { runnerSeesRd } from '../engine/rdKnowledge';
import { breachOutsideRun, runBlocked, runnerTrashInstalledCorpCard, startRun, trashAccessedCard } from '../engine/actions/run';
import { answerBoostDiscard, BOOST_DISCARD_STEP } from '../engine/actions/breaking';
import { giveTags, installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../engine/damage';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  derez,
  drawForEffect,
  installedIce,
  loseCredits,
  removeCounters,
  removeFromGame,
  removeTags,
  runFlag,
  RunFlag,
  spendCredits,
  threatLevel,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../engine/cardEffects';
import { addBreakerStrength, breakerStrength, bypassIce, encounteredIce, enterMovement, iceScript, iceStrength, iceSubroutines, iceSubtypes, markSubroutinesBroken } from '../engine/ice';
import { rezForFree } from '../engine/actions/corp';
import { CardScript, EffectAnswer, EffectContext } from './types';
import { arrangeNext, arrangeTop, askCards, askChoice, askRunnerInstall, gainCredits, iceLabel, installableRunnerCards, installRunnerChoice, installRunnerHostChoice } from './effects';
import { returnInstalledToHQ } from './liberationCorp';

/** Runner cards from Liberation: The Automata Initiative (34001-34030) and Rebellion Without Rehearsal (34066-34095). */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const type = (card: CardInstance) => cardDef(card).type_code;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const hasKeyword = (card: CardInstance, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(keywords(card));
const title = (card: CardInstance) => cardDef(card).title;
const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);
const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;
const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });
const yesNo = (yes: string, no = 'No') => [
  { id: 'yes', label: yes },
  { id: 'no', label: no },
];
const said = (answer: EffectAnswer, id = 'yes') => answer.kind === 'effect_choice' && answer.optionId === id;
const picked = (answer: EffectAnswer) => (answer.kind === 'effect_cards' ? answer.cardInstanceIds : []);
const isInstalled = (state: GameState, card: CardInstance) => installedRunnerCards(state).some(c => c.instanceId === card.instanceId);
const runnerTurn = (state: GameState) => state.activePlayer === 'runner';
const centralServers = ['hq', 'rd', 'archives'];
const remoteServers = (state: GameState) => Object.values(state.corp.servers).filter(s => s.isRemote && !runBlocked(state, s.id)).map(s => s.id);
const allServers = (state: GameState) => Object.keys(state.corp.servers);

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

/** Asks which of these servers a run event or ability runs. */
function askServer(ctx: EffectContext, label: string, ids: string[], step = 'run'): boolean {
  const serverIds = ids.filter(id => !runBlocked(ctx.state, id)); // Front Company
  if (serverIds.length === 0) return false;
  askChoice(ctx, 'runner', `${label}: run which server?`, serverIds.map(id => ({ id, label: ctx.state.corp.servers[id].name })), step);
  return true;
}

/** Puts `n` power counters on a card ("load" cards are trashed when empty by their own scripts). */
const place = (card: CardInstance, kind: 'power' | 'credit' | 'virus', n: number) => addCounters(card, kind, n);

/** Removes 1 power counter from a "load" card; trashes it (or removes it from the game) once empty. */
function spendLoad(state: GameState, card: CardInstance, n = 1, whenEmpty: 'trash' | 'remove' = 'trash'): void {
  removeCounters(card, 'power', n);
  if (counters(card, 'power') > 0 || !isInstalled(state, card)) return;
  if (whenEmpty === 'trash') trashInstalledRunnerCard(state, card);
  else removeFromGame(state, card);
  addLog(state, 'runner', `${title(card)} is empty and was ${whenEmpty === 'trash' ? 'trashed' : 'removed from the game'}.`);
}

/** The ice a trojan program is hosted on. */
const hostIce = (state: GameState, program: CardInstance) => (program.hostedOnId ? installedIce(state).find(i => i.instanceId === program.hostedOnId) : undefined);
/** Is this ice hosting an installed trojan program? */
const hostsTrojan = (state: GameState, ice: CardInstance) => state.runner.rig.programs.some(p => p.hostedOnId === ice.instanceId && hasKeyword(p, 'trojan'));
/** Bypass the encountered ice if it is still the one this ability was about. */
function bypassIfStill(state: GameState, iceId: unknown): void {
  if (encounteredIce(state)?.instanceId === iceId) bypassIce(state);
}

/** Successful runs on HQ, R&D and Archives this turn (The Wizard's Chest, Jeitinho). */
const ranAllCentrals = (state: GameState) => centralServers.every(id => state.runsThisTurn.some(r => r.server === id && r.successful));

/** Installs a card from the heap (or elsewhere) for an effect, asking for a host if it's a trojan. */
function installFrom(ctx: EffectContext, cardId: string, discount: number, step = 'host'): boolean {
  return installRunnerChoice(ctx, cardId, step, discount);
}

// --- The Automata Initiative: Anarch -------------------------------------------------------

// Strike Fund: Gain 4 credits. When this event is trashed from your grip or stack, you may gain 2
// credits.
const strikeFund: CardScript = {
  onPlay: ({ state }) => {
    gainCredits(state, 'runner', 4);
    addLog(state, 'runner', 'Runner gained 4 [credit] (Strike Fund).');
  },
  onTrashedFromHand: ctx => askChoice(ctx, 'runner', 'Strike Fund was trashed: gain 2 [credit]?', yesNo('Gain 2 [credit]'), 'trashed'),
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step !== 'trashed' || !said(answer)) return;
    gainCredits(state, 'runner', 2);
    addLog(state, 'runner', 'Runner gained 2 [credit] (Strike Fund was trashed).');
  },
};

// The Price: Trash the top 4 cards of your stack. You may install 1 of those cards, paying 3 credits less.
const thePrice: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const top = state.runner.stack.splice(0, 4);
    state.runner.heap.push(...top);
    addLog(state, 'runner', `Runner trashed ${top.map(title).join(', ') || 'nothing'} from the top of their stack (The Price).`);
    noteTrashedFromHand(state, top);
    const options = installableRunnerCards(state, top.filter(c => state.runner.heap.includes(c)), 3);
    if (options.length > 0) askRunnerInstall(ctx, 'The Price: you may install 1 of those cards, paying 3 [credit] less.', ids(options), 0, 1, 'install');
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'install' && picked(answer).length > 0) installRunnerChoice(ctx, picked(answer)[0], 'host', 3, {}, answer.kind === 'effect_cards' ? answer.trashFirst : []);
    else if (source.step === 'host') installRunnerHostChoice(ctx.state, source, answer);
  },
};

// Solidarity Badge: The first time each turn you trash a Corp card, place 1 power counter on this
// hardware. When your turn begins, you may remove 1 hosted power counter to draw 1 card or remove 1 tag.
const solidarityBadge: CardScript = {
  triggers: {
    runner_trashed_corp_card: ctx => {
      if (useOncePerTurn(ctx.state, onceKey(ctx.card))) place(ctx.card, 'power', 1);
    },
    turn_begins: (ctx, e) => {
      if (e.side !== 'runner' || counters(ctx.card, 'power') === 0) return;
      askChoice(ctx, 'runner', 'Solidarity Badge: remove 1 power counter to draw 1 card or remove 1 tag?', [
        { id: 'draw', label: 'Draw 1 card' },
        ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : []),
        { id: 'no', label: 'No' },
      ], 'use');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no' || counters(card, 'power') === 0) return;
    removeCounters(card, 'power', 1);
    if (answer.optionId === 'draw') drawForEffect(state, 'runner', 1, 'Solidarity Badge');
    else removeTags(state, 1);
  },
};

// Audrey v2 (AI - Virus): Whenever you trash a card you are accessing, place 1 virus counter on
// this program. Interface -> Hosted virus counter: Break up to 2 subroutines. Trash 1 card from
// your grip: +3 strength.
const audrey: CardScript = {
  breaker: { breaks: 'any', breakMax: 2, breakCost: () => 0, breakCounter: 'virus', boostCost: 0, boostAmount: () => 3, boostDiscard: true },
  triggers: { trashed_on_access: ctx => place(ctx.card, 'virus', 1) },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === BOOST_DISCARD_STEP && picked(answer).length > 0) answerBoostDiscard(state, card, picked(answer)[0]);
  },
};

// Banner (Fracter - Weapon): Interface -> 2 credits: Subroutines on the barrier you are
// encountering cannot end the run for the remainder of this encounter.
const banner: CardScript = {
  abilities: [
    {
      label: 'Subroutines on this barrier cannot end the run this encounter.',
      credits: 2,
      canUse: ({ state, card }) => {
        const ice = encounteredIce(state);
        if (!ice || !inBreakWindow(state)) return 'Only while encountering ice, before subroutines fire';
        if (!iceSubtypes(ice, state).includes('barrier')) return 'Banner can only interface with barriers';
        if (state.activeRun?.encounter?.cannotEndRun) return 'Already used this encounter';
        return breakerStrength(state, card) >= iceStrength(state, ice) ? null : `Banner needs strength ${iceStrength(state, ice)}`;
      },
      resolve: ({ state }) => {
        const encounter = state.activeRun?.encounter;
        if (!encounter) return;
        encounter.cannotEndRun = true;
        addLog(state, 'runner', 'Subroutines on this barrier cannot end the run this encounter (Banner).');
      },
    },
  ],
};

// Monkeywrench (Trojan): Install only on a piece of ice. Host ice gets -2 strength. Each other
// piece of ice protecting this server gets -1 strength.
const monkeywrench: CardScript = {
  installsOnIce: true,
  modifiers: {
    iceStrength: (state, self, ice) => {
      const host = hostIce(state, self);
      if (!host) return 0;
      if (host.instanceId === ice.instanceId) return -2;
      const server = Object.values(state.corp.servers).find(s => s.ice.includes(host));
      return server?.ice.includes(ice) ? -1 : 0;
    },
  },
};

// Eru Ayase-Pessoa: Once per turn -> [click], take 1 tag: Run Archives. If successful, instead of
// breaching Archives, breach R&D. Threat 3 -> Whenever you breach R&D during a run on Archives,
// access 1 additional card.
const eru: CardScript = {
  abilities: [
    {
      label: 'Take 1 tag: run Archives; if successful, breach R&D instead.',
      clicks: 1,
      oncePerTurn: true,
      resolve: ({ state, card }) => {
        giveTags(state, 1);
        startRun(state, 'archives', { source: { cardCode: card.cardCode, instanceId: card.instanceId } });
        if (state.activeRun) state.activeRun.breachInstead = 'rd';
      },
    },
  ],
  modifiers: {
    breachAccesses: (state, _self, serverId) => (serverId === 'rd' && state.activeRun?.server === 'archives' && threatLevel(state) >= 3 ? 1 : 0),
  },
};

// Hannah "Wheels" Pilintra: Once per turn -> [click]: Gain [click]. Run a remote server. When that
// run ends, if it was unsuccessful, take 1 tag. [click], [trash]: Gain [click][click]. Remove 1 tag.
const hannah: CardScript = {
  abilities: [
    {
      label: 'Gain [click]. Run a remote server (take 1 tag if unsuccessful).',
      clicks: 1,
      oncePerTurn: true,
      canUse: ({ state }) => (remoteServers(state).length > 0 ? null : 'There is no remote server to run'),
      resolve: ctx => {
        ctx.state.runner.clicks += 1;
        askServer(ctx, 'Hannah "Wheels" Pilintra', remoteServers(ctx.state));
      },
    },
    {
      label: 'Gain [click][click]. Remove 1 tag.',
      clicks: 1,
      trashSelf: true,
      resolve: ({ state }) => {
        state.runner.clicks += 2;
        removeTags(state, 1);
        addLog(state, 'runner', 'Runner gained [click][click] (Hannah "Wheels" Pilintra).');
      },
    },
  ],
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(ctx.state, answer.optionId, { source: runSource(ctx) });
  },
  onRunEnds: ({ state }, run) => {
    if (!run.isSuccessful) giveTags(state, 1);
  },
};

// Lago Paranoá Shelter: The first time each turn the Corp installs a card in the root of a server,
// you may trash the top card of your stack to draw 1 card.
const lagoParanoa: CardScript = {
  triggers: {
    installed: (ctx, e) => {
      const { state } = ctx;
      if (cardDef(e.card).side_code !== 'corp' || findInstalledCorpCard(state, e.card.instanceId)?.location !== 'root') return;
      if (!useOncePerTurn(state, onceKey(ctx.card)) || state.runner.stack.length === 0) return;
      askChoice(ctx, 'runner', 'Lago Paranoá Shelter: trash the top card of your stack to draw 1 card?', yesNo('Trash and draw'), 'use');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || state.runner.stack.length === 0) return;
    const top = state.runner.stack.shift()!;
    state.runner.heap.push(top);
    addLog(state, 'runner', `Runner trashed ${title(top)} from the top of their stack (Lago Paranoá Shelter).`);
    noteTrashedFromHand(state, [top]);
    drawForEffect(state, 'runner', 1, 'Lago Paranoá Shelter');
  },
};

// --- The Automata Initiative: Criminal -----------------------------------------------------

// Mercury: Chrome Libertador: Once per turn -> When you breach HQ or R&D during a run, if you did
// not break any subroutines during that run, you may access 1 additional card.
const mercury: CardScript = {
  triggers: {
    breach_server: (ctx, e) => {
      const { state } = ctx;
      if ((e.server !== 'hq' && e.server !== 'rd') || state.activeRun?.accessOnly) return;
      if (runFlag(state, RunFlag.subsBroken) > 0 || turnFlag(state, onceKey(ctx.card)) > 0) return;
      askChoice(ctx, 'runner', 'Mercury: access 1 additional card?', yesNo('Access 1 more'), 'access');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || !state.activeRun || !useOncePerTurn(state, onceKey(card))) return;
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner will access 1 additional card (Mercury).');
  },
};

// Chrysopoeian Skimming: The Corp may reveal an agenda from HQ. If they do, gain [click] and draw
// 1 card. Otherwise, look at the top 3 cards of R&D.
const chrysopoeian: CardScript = {
  onPlay: ctx => {
    const agendas = ctx.state.corp.hq.filter(c => type(c) === 'agenda');
    if (agendas.length > 0) askCards(ctx, 'corp', 'Chrysopoeian Skimming: you may reveal an agenda from HQ (the Runner gains [click] and draws 1).', ids(agendas), 0, 1, 'reveal');
    else skimLook(ctx.state);
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    const agenda = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
    if (!agenda) return skimLook(state);
    revealInHand(state, 'corp', [agenda]);
    addLog(state, 'corp', `Corp revealed ${title(agenda)} from HQ (Chrysopoeian Skimming).`, agenda.cardCode);
    state.runner.clicks += 1;
    drawForEffect(state, 'runner', 1, 'Chrysopoeian Skimming');
  },
};
function skimLook(state: GameState): void {
  const top = state.corp.rd.slice(0, 3);
  for (const card of top) runnerSeesRd(state, card);
  addLog(state, 'runner', `Runner looked at the top ${top.length} cards of R&D (Chrysopoeian Skimming).`);
}

// S-Dobrado (Run): Run a central server. The first time you encounter a piece of ice during that
// run, bypass it. Threat 4 -> The second time you encounter a piece of ice during that run, you may
// spend [click] to bypass it.
const sDobrado: CardScript = {
  onPlay: ctx => askServer(ctx, 'S-Dobrado', centralServers),
  triggers: {
    encounter_ice: (ctx, e) => {
      const { state } = ctx;
      const n = runFlag(state, RunFlag.encounters);
      if (n === 1) bypassIce(state);
      else if (n === 2 && threatLevel(state) >= 4 && state.runner.clicks > 0) {
        askChoice(ctx, 'runner', `S-Dobrado: spend [click] to bypass ${title(e.ice)}?`, yesNo('Spend [click] and bypass'), 'bypass', { iceId: e.ice.instanceId });
      }
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'run' && answer.kind === 'effect_choice') startRun(state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode });
    else if (source.step === 'bypass' && said(answer) && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      bypassIfStill(state, source.data?.iceId);
    }
  },
};

// Capybara: Whenever you bypass a piece of ice, you may remove this hardware from the game to derez that ice.
const capybara: CardScript = {
  triggers: {
    ice_bypassed: (ctx, e) => askChoice(ctx, 'runner', `Capybara: remove it from the game to derez ${title(e.ice)}?`, yesNo('Remove Capybara and derez'), 'derez', { iceId: e.ice.instanceId }),
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    const ice = installedIce(state).find(c => c.instanceId === source.data?.iceId);
    if (!said(answer) || !ice || !isInstalled(state, card)) return;
    removeFromGame(state, card);
    derez(state, ice);
    addLog(state, 'runner', `Runner removed Capybara from the game to derez ${title(ice)}.`);
  },
};

// Hermes (Console): +1 MU. Whenever an agenda is scored or stolen, add 1 unrezzed card to HQ.
const hermesTargets = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]).filter(c => !c.isRezzed);
const hermesAsk = (ctx: EffectContext) => {
  const targets = hermesTargets(ctx.state);
  if (targets.length > 0) askCards(ctx, 'runner', 'Hermes: add 1 unrezzed installed card to HQ.', ids(targets), 1, 1, 'bounce');
};
const hermes: CardScript = {
  modifiers: { memory: 1 },
  triggers: { agenda_scored: hermesAsk, agenda_stolen: hermesAsk },
  onPromptAnswer: ({ state }, _source, answer) => {
    const target = hermesTargets(state).find(c => c.instanceId === picked(answer)[0]);
    if (target && returnInstalledToHQ(state, target)) addLog(state, 'runner', 'Runner added an unrezzed card to HQ (Hermes).');
  },
};

// Curupira (Fracter): Whenever you encounter a barrier, you may spend 3 hosted power counters to
// bypass it. Whenever this program fully breaks a piece of ice, place 1 power counter on it.
// Interface -> 1 credit: Break 1 barrier subroutine. 1 credit: +1 strength.
const brokeAllWith = (state: GameState, breaker: CardInstance) => {
  const encounter = state.activeRun?.encounter;
  return !!encounter && Object.values(encounter.brokenBy ?? {}).every(id => id === breaker.instanceId) && encounter.broken.every(Boolean);
};
const curupira: CardScript = {
  breaker: { breaks: 'barrier', breakMax: 1, breakCost: () => 1, boostCost: 1, boostAmount: () => 1 },
  triggers: {
    encounter_ice: (ctx, e) => {
      if (!iceSubtypes(e.ice, ctx.state).includes('barrier') || counters(ctx.card, 'power') < 3) return;
      askChoice(ctx, 'runner', `Curupira: spend 3 power counters to bypass ${title(e.ice)}?`, yesNo('Bypass'), 'bypass', { iceId: e.ice.instanceId });
    },
    ice_fully_broken: ctx => {
      if (brokeAllWith(ctx.state, ctx.card)) place(ctx.card, 'power', 1);
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (!said(answer) || counters(card, 'power') < 3) return;
    removeCounters(card, 'power', 3);
    bypassIfStill(state, source.data?.iceId);
  },
};

// Laser Pointer (Weapon): Whenever you encounter a piece of AP, destroyer, or observer ice, you may
// trash this program to bypass that ice.
const laserPointer: CardScript = {
  triggers: {
    encounter_ice: (ctx, e) => {
      if (!['ap', 'destroyer', 'observer'].some(k => hasKeyword(e.ice, k))) return;
      askChoice(ctx, 'runner', `Laser Pointer: trash it to bypass ${title(e.ice)}?`, yesNo('Trash and bypass'), 'bypass', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (!said(answer) || !isInstalled(state, card)) return;
    trashInstalledRunnerCard(state, card);
    bypassIfStill(state, source.data?.iceId);
  },
};

// Saci (Trojan): Install only on a piece of ice. Whenever host ice is rezzed or derezzed, gain 3 credits.
const saciGain = (ctx: EffectContext, ice: CardInstance) => {
  if (ctx.card.hostedOnId !== ice.instanceId) return;
  gainCredits(ctx.state, 'runner', 3);
  addLog(ctx.state, 'runner', 'Runner gained 3 [credit] (Saci).');
};
const saci: CardScript = {
  installsOnIce: true,
  triggers: { rezzed: (ctx, e) => saciGain(ctx, e.card), derezzed: (ctx, e) => saciGain(ctx, e.card) },
};

// Shibboleth (Decoder): Threat 4 -> This program gets -2 strength. Interface -> 1 credit: Break 1
// code gate subroutine. 2 credits: +2 strength.
const shibboleth: CardScript = {
  breaker: {
    breaks: 'code gate',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 2,
    boostAmount: () => 2,
    strengthModifier: state => (threatLevel(state) >= 4 ? -2 : 0),
  },
};

// Debbie "Downtown" Moreira: Threat 4 -> When you install this resource, place 2 credits on it.
// Whenever you play a run event, place 1 credit on this resource. [click]: Run any server. You can
// spend hosted credits during that run.
const debbie: CardScript = {
  triggers: {
    installed: (ctx, e) => {
      if (isSelf(ctx, e.card) && threatLevel(ctx.state) >= 4) place(ctx.card, 'credit', 2);
    },
    event_played: (ctx, e) => {
      if (hasKeyword(e.card, 'run')) place(ctx.card, 'credit', 1);
    },
  },
  abilities: [{ label: 'Run any server (you can spend hosted credits during it).', clicks: 1, resolve: ctx => void askServer(ctx, 'Debbie "Downtown" Moreira', allServers(ctx.state)) }],
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(ctx.state, answer.optionId, { source: runSource(ctx), creditHosts: [ctx.card.instanceId] });
  },
};

// --- The Automata Initiative: Shaper -------------------------------------------------------

// Arissana Rocha Nahu: Street Artist: Once per turn -> 0 credits: Install 1 program from your grip
// (paying its install cost). Use this ability only during a run. When that run ends, trash that
// program if it is not a trojan.
const arissana: CardScript = {
  abilities: [
    {
      label: 'Install 1 program from your grip (only during a run; trashed when the run ends unless a trojan).',
      oncePerTurn: true,
      canUse: ({ state }) => {
        if (!state.activeRun || state.activeRun.accessOnly) return 'Use this only during a run';
        return installableRunnerCards(state, state.runner.grip.filter(c => type(c) === 'program')).length > 0 ? null : 'No program in the grip can be installed';
      },
      resolve: ctx => {
        const programs = installableRunnerCards(ctx.state, ctx.state.runner.grip.filter(c => type(c) === 'program'));
        askRunnerInstall(ctx, 'Arissana Rocha Nahu: install 1 program from your grip.', ids(programs), 1, 1, 'install');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    let id: string | undefined;
    if (source.step === 'install' && picked(answer).length > 0) {
      id = picked(answer)[0];
      if (!installRunnerChoice(ctx, id, 'host', 0, {}, answer.kind === 'effect_cards' ? answer.trashFirst : [])) return;
    } else if (source.step === 'host') {
      id = source.data?.cardId as string;
      if (!installRunnerHostChoice(state, source, answer)) return;
    }
    const program = id && state.runner.rig.programs.find(c => c.instanceId === id);
    if (program && !hasKeyword(program, 'trojan') && state.activeRun) state.activeRun.trashAtRunEnd.push(program.instanceId);
  },
};

// Joy Ride (Run): Run R&D. If successful, draw 5 cards.
const joyRide: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'rd', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ({ state }) => drawForEffect(state, 'runner', 5, 'Joy Ride'),
};

// AirbladeX (JSRF Ed.) (Vehicle): When you install this hardware, load 3 power counters onto it.
// When it is empty, trash it. [interrupt] -> Hosted power counter: Prevent 1 net damage. Use this
// ability only during a run. [interrupt] -> Hosted power counter: Prevent a "when encountered"
// ability on a piece of ice. (Damage is prevented without asking: the Runner always wants it.)
const airblade: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 3),
    encounter_ice: (ctx, e) => {
      if (!iceScript(e.ice)?.onEncounter || counters(ctx.card, 'power') === 0) return;
      askChoice(ctx, 'runner', `AirbladeX: spend 1 power counter to prevent ${title(e.ice)}'s "when encountered" ability?`, yesNo('Prevent it'), 'prevent', { iceId: e.ice.instanceId });
    },
  },
  preventDamage: (state, self, kind, amount) => {
    if (kind !== 'net' || !state.activeRun || state.activeRun.accessOnly) return 0;
    const n = Math.min(amount, counters(self, 'power'));
    if (n === 0) return 0;
    addLog(state, 'runner', `Runner prevented ${n} net damage (AirbladeX).`);
    spendLoad(state, self, n);
    return n;
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    const encounter = state.activeRun?.encounter;
    if (!said(answer) || !encounter || encounter.iceId !== source.data?.iceId || counters(card, 'power') === 0) return;
    encounter.onEncounterPending = false;
    addLog(state, 'runner', 'Runner prevented the "when encountered" ability (AirbladeX).');
    spendLoad(state, card);
  },
};

// LilyPAD (Console): +2 MU. The first time each turn you install a program, you may draw 1 card.
const lilypad: CardScript = {
  modifiers: { memory: 2 },
  triggers: {
    installed: (ctx, e) => {
      if (type(e.card) !== 'program' || cardDef(e.card).side_code !== 'runner') return;
      if (useOncePerTurn(ctx.state, onceKey(ctx.card))) askChoice(ctx, 'runner', 'LilyPAD: draw 1 card?', yesNo('Draw 1 card'), 'draw');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer)) drawForEffect(state, 'runner', 1, 'LilyPAD');
  },
};

// Living Mural (Killer - Trojan): Install only on a piece of ice. Threat 4 -> When you install this
// program, it gets +3 strength for the remainder of the turn. Interface -> 1 credit: Break 1
// subroutine on a sentry protecting this server. 1 credit: +2 strength.
const muralKey = (card: CardInstance) => `mural:${card.instanceId}`;
const livingMural: CardScript = {
  installsOnIce: true,
  breaker: {
    breaks: 'sentry',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 1,
    boostAmount: () => 2,
    strengthModifier: (state, card) => (turnFlag(state, muralKey(card)) > 0 ? 3 : 0),
    canInterface: (state, breaker, ice) => {
      const host = hostIce(state, breaker);
      const server = host && Object.values(state.corp.servers).find(s => s.ice.includes(host));
      return server?.ice.includes(ice) ? null : 'Living Mural only breaks sentries protecting its host\'s server';
    },
  },
  triggers: {
    installed: (ctx, e) => {
      if (isSelf(ctx, e.card) && threatLevel(ctx.state) >= 4) ctx.state.turnFlags[muralKey(ctx.card)] = 1;
    },
  },
};

// Pichação (Trojan): Install only on a piece of ice. Whenever you pass host ice, you may gain
// [click]. If this is not the first time you gained [click] during a run this turn, add this program to your grip.
const PICHACAO_CLICKS = 'pichacao:clicks-in-runs';
const pichacao: CardScript = {
  installsOnIce: true,
  triggers: {
    ice_passed: (ctx, e) => {
      if (ctx.card.hostedOnId === e.ice.instanceId) askChoice(ctx, 'runner', 'Pichação: gain [click]?', yesNo('Gain [click]'), 'click');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer)) return;
    state.runner.clicks += 1;
    const times = (state.turnFlags[PICHACAO_CLICKS] = (state.turnFlags[PICHACAO_CLICKS] ?? 0) + 1);
    addLog(state, 'runner', 'Runner gained [click] (Pichação).');
    if (times > 1 && isInstalled(state, card)) {
      uninstallRunnerCard(state, card, 'grip');
      addLog(state, 'runner', 'Pichação was added to the grip.');
    }
  },
};

// Slap Vandal (AI - Trojan): Install only on a piece of ice. Interface -> 1 credit: Break 1
// subroutine on host ice. Use this ability only once per encounter.
const SLAP_KEY = 'slap-vandal';
const slapVandal: CardScript = {
  installsOnIce: true,
  breaker: {
    breaks: 'any',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: Infinity,
    boostAmount: () => 0,
    canInterface: (state, breaker, ice) => {
      if (breaker.hostedOnId !== ice.instanceId) return 'Slap Vandal only breaks subroutines on its host ice';
      return (state.activeRun?.encounter?.flags?.[`${SLAP_KEY}:${breaker.instanceId}`] ?? 0) > 0 ? 'Use Slap Vandal only once per encounter' : null;
    },
    onBreakUsed: (state, breaker) => {
      const encounter = state.activeRun?.encounter;
      if (encounter) encounter.flags = { ...(encounter.flags ?? {}), [`${SLAP_KEY}:${breaker.instanceId}`]: 1 };
    },
  },
};

// Umbrella (Decoder - Weapon): This program can only interface with ice hosting a trojan program.
// Interface -> 2 credits: Break up to 3 code gate subroutines. If at least 1 subroutine was broken
// this way, each player may draw 1 card.
const umbrella: CardScript = {
  breaker: {
    breaks: 'code gate',
    breakMax: 3,
    breakCost: () => 2,
    boostCost: Infinity,
    boostAmount: () => 0,
    canInterface: (state, _breaker, ice) => (hostsTrojan(state, ice) ? null : 'Umbrella can only interface with ice hosting a trojan'),
    onBreakUsed: (state, breaker) => {
      // Each player may draw: the Runner is asked, then the Corp (not offered with R&D empty, where drawing would lose the game)
      const ctx = { state, card: breaker, side: 'runner' as const };
      askChoice(ctx, 'runner', 'Umbrella: draw 1 card?', yesNo('Draw 1 card'), 'draw-runner');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'draw-runner') {
      if (said(answer)) drawForEffect(state, 'runner', 1, 'Umbrella');
      if (state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Umbrella: draw 1 card?', yesNo('Draw 1 card'), 'draw-corp');
    } else if (source.step === 'draw-corp' && said(answer)) drawForEffect(state, 'corp', 1, 'Umbrella');
  },
};

// Beatriz Friere Gonzalez: [click][click]: Run HQ. If successful, instead of breaching HQ, breach
// R&D. When you do, access 1 additional card.
const beatriz: CardScript = {
  abilities: [
    {
      label: 'Run HQ; if successful, breach R&D instead and access 1 additional card.',
      clicks: 2,
      resolve: ({ state, card }) => {
        startRun(state, 'hq', { source: { cardCode: card.cardCode, instanceId: card.instanceId } });
        if (state.activeRun) {
          state.activeRun.breachInstead = 'rd';
          state.activeRun.extraAccesses += 1;
        }
      },
    },
  ],
};

// Urban Art Vernissage (Job - Ritzy): When your turn begins, you may add 1 installed non-virus
// trojan program to your grip. If you do, place 2 credits on this resource. You can spend hosted
// credits to install cards.
const nonVirusTrojans = (state: GameState) => state.runner.rig.programs.filter(c => hasKeyword(c, 'trojan') && !hasKeyword(c, 'virus'));
const urbanArt: CardScript = {
  paysFor: (_state, _self, purpose) => purpose.kind === 'install',
  triggers: {
    turn_begins: (ctx, e) => {
      const trojans = nonVirusTrojans(ctx.state);
      if (e.side === 'runner' && trojans.length > 0) askCards(ctx, 'runner', 'Urban Art Vernissage: you may add 1 installed non-virus trojan to your grip to place 2 [credit] here.', ids(trojans), 0, 1, 'grip');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    const trojan = nonVirusTrojans(state).find(c => c.instanceId === picked(answer)[0]);
    if (!trojan) return;
    uninstallRunnerCard(state, trojan, 'grip');
    place(card, 'credit', 2);
    addLog(state, 'runner', `Runner added ${title(trojan)} to their grip and placed 2 [credit] on Urban Art Vernissage.`);
  },
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
const bahiaAsk = (ctx: EffectContext, done: string[]) => {
  if (done.length >= 2) return;
  const options = BAHIA_MODES.filter(m => !done.includes(m.id));
  askChoice(ctx, 'runner', `Bahia Bands: choose ${done.length === 0 ? 'the first' : 'the second'} effect.`, options, 'mode', { done: done.join(',') });
};
const bahiaBands: CardScript = {
  onPlay: ctx => askServer(ctx, 'Bahia Bands', allServers(ctx.state)),
  onRunSuccessful: ctx => bahiaAsk(ctx, []),
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'run' && answer.kind === 'effect_choice') {
      startRun(state, answer.optionId, { source: runSource(ctx), eventCode: card.cardCode });
      return;
    }
    const done = String(source.data?.done ?? '').split(',').filter(Boolean);
    if (source.step === 'mode' && answer.kind === 'effect_choice') {
      const next = [...done, answer.optionId];
      if (answer.optionId === 'draw') drawForEffect(state, 'runner', 2, 'Bahia Bands');
      else if (answer.optionId === 'tag') removeTags(state, 1);
      else if (answer.optionId === 'credits') {
        place(card, 'credit', 4);
        if (state.activeRun) state.activeRun.trashCreditHosts = [...(state.activeRun.trashCreditHosts ?? []), card.instanceId];
      } else if (answer.optionId === 'install') {
        const options = installableRunnerCards(state, state.runner.grip, 1);
        if (options.length > 0) {
          askRunnerInstall(ctx, 'Bahia Bands: install 1 card from your grip, paying 1 [credit] less.', ids(options), 0, 1, 'install', { done: next.join(',') });
          return;
        }
      }
      bahiaAsk(ctx, next);
    } else if (source.step === 'install') {
      if (picked(answer).length > 0 && !installRunnerChoice(ctx, picked(answer)[0], 'host', 1, { done: done.join(',') }, answer.kind === 'effect_cards' ? answer.trashFirst : [])) return;
      bahiaAsk(ctx, done);
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
      bahiaAsk(ctx, done);
    }
  },
};

// --- Rebellion Without Rehearsal: Anarch ---------------------------------------------------

// Sebastião Souza Pessoa: Activist Organizer: Whenever you take 1 or more tags, if you had no tags,
// you may install 1 connection resource from your grip, paying 2 credits less. As an additional
// cost to trash a connection resource with the basic action, the Corp must trash 1 card from HQ.
const connectionsInGrip = (state: GameState) => installableRunnerCards(state, state.runner.grip.filter(c => type(c) === 'resource' && hasKeyword(c, 'connection')), 2);
const sebastiao: CardScript = {
  triggers: {
    tags_taken: (ctx, e) => {
      if (ctx.state.runner.tags !== e.count) return; // had tags before
      const options = connectionsInGrip(ctx.state);
      if (options.length > 0) askRunnerInstall(ctx, 'Sebastião Souza Pessoa: you may install 1 connection resource from your grip, paying 2 [credit] less.', ids(options), 0, 1, 'install');
    },
  },
  modifiers: { resourceTrashHqCost: (_state, _self, resource) => (hasKeyword(resource, 'connection') ? 1 : 0) },
  onPromptAnswer: (ctx, _source, answer) => {
    if (picked(answer).length > 0) installRunnerChoice(ctx, picked(answer)[0], 'host', 2);
  },
};

// Eye for an Eye (Run): Play only if you are not tagged. Run HQ. If successful, take 1 tag and
// access 1 additional card when you breach HQ. Access -> Trash 1 card from your grip: Trash the card
// you are accessing.
const eyeForAnEye: CardScript = {
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
      askCards(ctx, 'runner', `Eye for an Eye: trash 1 card from your grip to trash ${title(accessed)}.`, ids(ctx.state.runner.grip), 1, 1, 'grip', { accessedId: accessed.instanceId });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step !== 'grip') return;
    const card = state.runner.grip.find(c => c.instanceId === picked(answer)[0]);
    const accessed = findCardAnywhere(state, source.data?.accessedId as string);
    if (!card || !accessed) return;
    removeCard(state.runner.grip, card);
    state.runner.heap.push(card);
    noteTrashedFromHand(state, [card]);
    addLog(state, 'runner', `Runner trashed ${title(card)} from their grip (Eye for an Eye).`);
    trashAccessedCard(state, accessed);
  },
};

// Privileged Access (Run): Play only if you are not tagged. Run Archives. If successful, instead of
// breaching Archives, take 1 tag. When you take a tag with this event, you may install 1 resource
// from your heap, paying 2 credits less. Threat 3 -> When you take a tag with this event, you may
// install 1 program from your heap.
const heapOf = (state: GameState, kind: string, discount: number) => installableRunnerCards(state, state.runner.heap.filter(c => type(c) === kind), discount);
const privilegedAccess: CardScript = {
  canPlay: ({ state }) => (state.runner.tags > 0 ? 'You are tagged' : null),
  onPlay: ctx => {
    startRun(ctx.state, 'archives', { source: runSource(ctx), eventCode: ctx.card.cardCode });
    if (ctx.state.activeRun) ctx.state.activeRun.breachInstead = 'none';
  },
  onRunSuccessful: ctx => {
    giveTags(ctx.state, 1);
    privilegedResource(ctx);
  },
  onPromptAnswer: (ctx, source, answer) => {
    const id = picked(answer)[0];
    if (source.step === 'resource') {
      if (id && !installFrom(ctx, id, 2, 'host-resource')) return;
      privilegedProgram(ctx);
    } else if (source.step === 'program') {
      if (id) installFrom(ctx, id, 0, 'host-program');
    } else if (source.step === 'host-resource') {
      installRunnerHostChoice(ctx.state, source, answer);
      privilegedProgram(ctx);
    } else if (source.step === 'host-program') installRunnerHostChoice(ctx.state, source, answer);
  },
};
function privilegedResource(ctx: EffectContext): void {
  const options = heapOf(ctx.state, 'resource', 2);
  if (options.length > 0) askRunnerInstall(ctx, 'Privileged Access: you may install 1 resource from your heap, paying 2 [credit] less.', ids(options), 0, 1, 'resource');
  else privilegedProgram(ctx);
}
function privilegedProgram(ctx: EffectContext): void {
  if (threatLevel(ctx.state) < 3) return;
  const options = heapOf(ctx.state, 'program', 0);
  if (options.length > 0) askRunnerInstall(ctx, 'Privileged Access: you may install 1 program from your heap.', ids(options), 0, 1, 'program');
}

// Amanuensis (Console): +1 MU. When your turn ends, place 1 power counter on this hardware if you
// are tagged. Whenever you remove 1 or more tags, you may remove 1 hosted power counter to draw 2 cards.
const amanuensis: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    discard_phase_ends: (ctx, e) => {
      if (e.side === 'runner' && ctx.state.runner.tags > 0) place(ctx.card, 'power', 1);
    },
    tags_removed: ctx => {
      if (counters(ctx.card, 'power') > 0) askChoice(ctx, 'runner', 'Amanuensis: remove 1 power counter to draw 2 cards?', yesNo('Draw 2 cards'), 'draw');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || counters(card, 'power') === 0) return;
    removeCounters(card, 'power', 1);
    drawForEffect(state, 'runner', 2, 'Amanuensis');
  },
};

// The Wizard's Chest: Use this hardware only if you made a successful run on HQ, R&D, and Archives
// this turn. [trash]: Choose hardware, program, or resource. Set aside cards from the top of your
// stack faceup until you set aside 2 cards of the chosen type. You may install 1 of those 2 cards,
// ignoring all costs. Shuffle the rest of the set-aside cards into your stack.
const wizardsChest: CardScript = {
  abilities: [
    {
      label: 'Set aside cards from the top of your stack until 2 of a chosen type; install 1 free.',
      trashSelf: true,
      canUse: ({ state }) => (ranAllCentrals(state) ? null : 'You need successful runs on HQ, R&D and Archives this turn'),
      resolve: ctx =>
        askChoice(ctx, 'runner', "The Wizard's Chest: choose a card type.", [
          { id: 'hardware', label: 'Hardware' },
          { id: 'program', label: 'Program' },
          { id: 'resource', label: 'Resource' },
        ], 'type'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'type' && answer.kind === 'effect_choice') {
      const setAside: CardInstance[] = [];
      let found = 0;
      while (found < 2 && state.runner.stack.length > 0) {
        const card = state.runner.stack.shift()!;
        setAside.push(card);
        if (type(card) === answer.optionId) found++;
      }
      addLog(state, 'runner', `Runner set aside ${setAside.map(title).join(', ') || 'nothing'} (The Wizard's Chest).`);
      // Set-aside cards wait in the grip-free "removed" limbo: kept on the stack's bottom until the choice is made
      const chosen = setAside.filter(c => type(c) === answer.optionId);
      const rest = setAside.filter(c => !chosen.includes(c));
      state.runner.stack.push(...rest);
      shuffleInPlace(state.rng, state.runner.stack);
      state.runner.stack.push(...chosen);
      const options = installableRunnerCards(state, chosen, 99);
      if (options.length > 0) askRunnerInstall(ctx, "The Wizard's Chest: you may install 1 of them, ignoring all costs.", ids(options), 0, 1, 'install', { chosen: ids(chosen).join(',') });
      else shuffleInPlace(state.rng, state.runner.stack);
    } else if (source.step === 'install') {
      const id = picked(answer)[0];
      if (id) installFrom(ctx, id, 99, 'host');
      shuffleInPlace(state.rng, state.runner.stack);
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
      shuffleInPlace(state.rng, state.runner.stack);
    }
  },
};

// Boi-tatá (Killer): If you trashed any of your installed cards this turn, paid abilities on this
// program cost 1 credit less to use. Interface -> 2 credits: Break up to 2 sentry subroutines.
// 3 credits: +3 strength.
const boiDiscount = (state: GameState) => (turnFlag(state, TurnFlag.runnerTrashedOwnInstalled) > 0 ? 1 : 0);
const boiTata: CardScript = {
  breaker: { breaks: 'sentry', breakMax: 2, breakCost: state => 2 - boiDiscount(state), boostCost: state => 3 - boiDiscount(state), boostAmount: () => 3 },
};

// Heliamphora (Virus): [interrupt] -> Whenever you would access a card in Archives, you may host it
// faceup on this program instead. Use this ability only once each time you breach Archives. When the
// Corp purges virus counters, they trash 2 cards from HQ at random. Trash this program.
const heliamphora: CardScript = {
  triggers: {
    breach_begins: (ctx, e) => {
      const { state } = ctx;
      if (e.server !== 'archives' || state.activeRun?.accessOnly) return;
      const cards = state.corp.archives.faceUp;
      if (cards.length > 0) askCards(ctx, 'runner', 'Heliamphora: you may host 1 card from Archives on it instead of accessing it.', ids(cards), 0, 1, 'host');
    },
    virus_purged: ({ state, card }) => {
      const ids: string[] = [];
      const pool = [...state.corp.hq];
      for (let i = 0; i < 2 && pool.length > 0; i++) ids.push(pool.splice(nextInt(state.rng, pool.length), 1)[0].instanceId);
      const trashed = corpTrashFromHQ(state, ids, true);
      addLog(state, 'corp', `Corp trashed ${trashed.map(title).join(', ') || 'no cards'} from HQ at random (Heliamphora).`);
      if (isInstalled(state, card)) trashInstalledRunnerCard(state, card);
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    const target = state.corp.archives.faceUp.find(c => c.instanceId === picked(answer)[0]);
    if (!target) return;
    removeCard(state.corp.archives.faceUp, target);
    card.hostedCards = [...(card.hostedCards ?? []), target];
    const breach = state.activeRun?.breach;
    if (breach) breach.chosen.push(target.instanceId);
    addLog(state, 'runner', `Runner hosted ${title(target)} on Heliamphora instead of accessing it.`);
  },
};

// Arruaceiras Crew (Connection - Seedy): Once per turn -> Take 1 tag: The ice you are encountering
// gets -2 strength for the remainder of this encounter. [trash], 2 credits: Trash the ice you are
// encountering if its strength is 0 or less.
const ARRUACEIRAS = 'arruaceiras';
const arruaceiras: CardScript = {
  modifiers: {
    iceStrength: (state, self, ice) => {
      const encounter = state.activeRun?.encounter;
      if (encounter?.iceId !== ice.instanceId) return 0;
      return -2 * (encounter.flags?.[`${ARRUACEIRAS}:${self.instanceId}`] ?? 0);
    },
  },
  abilities: [
    {
      label: 'Take 1 tag: the encountered ice gets -2 strength this encounter.',
      oncePerTurn: true,
      canUse: ({ state }) => (state.activeRun?.encounter && state.activeRun.phase === 'encounter_ice' ? null : 'Only while encountering ice'),
      resolve: ({ state, card }) => {
        giveTags(state, 1);
        const encounter = state.activeRun?.encounter;
        if (!encounter) return;
        const key = `${ARRUACEIRAS}:${card.instanceId}`;
        encounter.flags = { ...(encounter.flags ?? {}), [key]: (encounter.flags?.[key] ?? 0) + 1 };
        addLog(state, 'runner', 'The encountered ice gets -2 strength this encounter (Arruaceiras Crew).');
      },
    },
    {
      label: 'Trash the encountered ice if its strength is 0 or less.',
      credits: 2,
      trashSelf: true,
      canUse: ({ state }) => {
        const ice = encounteredIce(state);
        if (!ice || state.activeRun?.phase !== 'encounter_ice') return 'Only while encountering ice';
        return iceStrength(state, ice) <= 0 ? null : 'The ice\'s strength is above 0';
      },
      resolve: ({ state }) => {
        const ice = encounteredIce(state);
        if (!ice || iceStrength(state, ice) > 0) return;
        runnerTrashInstalledCorpCard(state, ice);
        // The encounter ends with the ice gone; the run goes on from the Movement Phase
        if (state.activeRun) {
          state.activeRun.icePassed += 1;
          enterMovement(state);
        }
      },
    },
  ],
};

// Friend of a Friend: [click], [trash]: Gain 5 credits and remove 1 tag. / [click], [trash]: Gain 9
// credits and take 1 tag. Use this ability only if you are not tagged.
const friendOfAFriend: CardScript = {
  abilities: [
    {
      label: 'Gain 5 [credit] and remove 1 tag.',
      clicks: 1,
      trashSelf: true,
      resolve: ({ state }) => {
        gainCredits(state, 'runner', 5);
        removeTags(state, 1);
        addLog(state, 'runner', 'Runner gained 5 [credit] (Friend of a Friend).');
      },
    },
    {
      label: 'Gain 9 [credit] and take 1 tag.',
      clicks: 1,
      trashSelf: true,
      canUse: ({ state }) => (state.runner.tags > 0 ? 'Use this only if you are not tagged' : null),
      resolve: ({ state }) => {
        gainCredits(state, 'runner', 9);
        giveTags(state, 1);
        addLog(state, 'runner', 'Runner gained 9 [credit] (Friend of a Friend).');
      },
    },
  ],
};

// Manuel Lattes de Moura: Whenever you breach HQ or R&D while you are tagged, access 1 additional
// card. Threat 3 -> As an additional cost to trash this resource with the basic action, the Corp must
// trash 1 card from HQ.
const manuelLattes: CardScript = {
  modifiers: {
    breachAccesses: (state, _self, serverId) => ((serverId === 'hq' || serverId === 'rd') && state.runner.tags > 0 ? 1 : 0),
    resourceTrashHqCost: (state, self, resource) => (resource.instanceId === self.instanceId && threatLevel(state) >= 3 ? 1 : 0),
  },
};

// --- Rebellion Without Rehearsal: Criminal --------------------------------------------------

// Meeting of Minds: Choose connection or virtual. You may search your stack for 1 resource with the
// chosen subtype and reveal it. Add that card to your grip. Reveal any number of cards with the
// chosen subtype in your grip. Gain 1 credit for each card revealed this way.
const meetingOfMinds: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'runner', 'Meeting of Minds: choose a subtype.', [
      { id: 'connection', label: 'Connection' },
      { id: 'virtual', label: 'Virtual' },
    ], 'subtype'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'subtype' && answer.kind === 'effect_choice') {
      const kind = answer.optionId;
      const options = state.runner.stack.filter(c => type(c) === 'resource' && hasKeyword(c, kind));
      if (options.length > 0) askCards(ctx, 'runner', `Meeting of Minds: you may search your stack for 1 ${kind} resource.`, ids(options), 0, 1, 'search', { kind });
      else meetingReveal(ctx, kind);
    } else if (source.step === 'search') {
      const card = state.runner.stack.find(c => c.instanceId === picked(answer)[0]);
      if (card) {
        removeCard(state.runner.stack, card);
        state.runner.grip.push(card);
        addLog(state, 'runner', `Runner revealed ${title(card)} and added it to their grip (Meeting of Minds).`, card.cardCode);
      }
      shuffleInPlace(state.rng, state.runner.stack);
      meetingReveal(ctx, String(source.data?.kind));
    } else if (source.step === 'reveal') {
      const cards = state.runner.grip.filter(c => picked(answer).includes(c.instanceId));
      if (cards.length === 0) return;
      revealInHand(state, 'runner', cards);
      gainCredits(state, 'runner', cards.length);
      addLog(state, 'runner', `Runner revealed ${cards.map(title).join(', ')} and gained ${cards.length} [credit] (Meeting of Minds).`);
    }
  },
};
/** Meeting of Minds: reveal any number of grip cards of the chosen subtype, a credit each. */
function meetingReveal(ctx: EffectContext, kind: string): void {
  const cards = ctx.state.runner.grip.filter(c => hasKeyword(c, kind));
  if (cards.length > 0) askCards(ctx, 'runner', `Meeting of Minds: reveal any number of ${kind} cards in your grip, gaining 1 [credit] each.`, ids(cards), 0, cards.length, 'reveal');
}

// Window of Opportunity (Run): You may install 1 program or piece of hardware from your grip. Run any
// server. When that run begins, derez 1 piece of ice protecting that server. When that run ends, the
// Corp may rez the ice derezzed this way, ignoring all costs.
const windowOfOpportunity: CardScript = {
  onPlay: ctx => {
    const options = installableRunnerCards(ctx.state, ctx.state.runner.grip.filter(c => type(c) === 'program' || type(c) === 'hardware'));
    if (options.length > 0) askRunnerInstall(ctx, 'Window of Opportunity: you may install 1 program or piece of hardware from your grip.', ids(options), 0, 1, 'install');
    else askServer(ctx, 'Window of Opportunity', allServers(ctx.state));
  },
  triggers: {
    run_begins: (ctx, e) => {
      const ice = ctx.state.corp.servers[e.server]?.ice.filter(c => c.isRezzed) ?? [];
      if (ice.length > 0) askCards(ctx, 'runner', 'Window of Opportunity: derez 1 piece of ice protecting the attacked server.', ids(ice), 1, 1, 'derez');
    },
  },
  onRunEnds: ctx => {
    const derezzed = installedIce(ctx.state).find(c => !c.isRezzed && turnFlag(ctx.state, windowKey(ctx.card, c)) > 0);
    if (derezzed) askChoice(ctx, 'corp', `Window of Opportunity: rez ${title(derezzed)} ignoring all costs?`, yesNo('Rez it'), 'rez', { iceId: derezzed.instanceId });
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'install') {
      if (picked(answer).length > 0 && !installRunnerChoice(ctx, picked(answer)[0], 'host', 0, {}, answer.kind === 'effect_cards' ? answer.trashFirst : [])) return;
      askServer(ctx, 'Window of Opportunity', allServers(state));
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
      askServer(ctx, 'Window of Opportunity', allServers(state));
    } else if (source.step === 'run' && answer.kind === 'effect_choice') {
      startRun(state, answer.optionId, { source: runSource(ctx), eventCode: card.cardCode });
    } else if (source.step === 'derez') {
      const ice = installedIce(state).find(c => c.instanceId === picked(answer)[0]);
      if (!ice) return;
      derez(state, ice);
      state.turnFlags[windowKey(card, ice)] = 1;
      addLog(state, 'runner', `Runner derezzed ${title(ice)} (Window of Opportunity).`);
    } else if (source.step === 'rez' && said(answer)) {
      const ice = installedIce(state).find(c => c.instanceId === source.data?.iceId);
      if (ice && !ice.isRezzed) rezForFree(state, ice);
    }
  },
};
const windowKey = (event: CardInstance, ice: CardInstance) => `window:${event.instanceId}:${ice.instanceId}`;

// Alarm Clock: When your turn begins, you may run HQ. The first time you encounter a piece of ice
// during that run, you may spend [click][click] to bypass it.
const alarmClock: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side === 'runner') askChoice(ctx, 'runner', 'Alarm Clock: run HQ?', yesNo('Run HQ'), 'run');
    },
    encounter_ice: (ctx, e) => {
      const run = ctx.state.activeRun;
      if (!run?.runEffects.some(r => r.instanceId === ctx.card.instanceId) || runFlag(ctx.state, RunFlag.encounters) !== 1 || ctx.state.runner.clicks < 2) return;
      askChoice(ctx, 'runner', `Alarm Clock: spend [click][click] to bypass ${title(e.ice)}?`, yesNo('Spend [click][click] and bypass'), 'bypass', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'run' && said(answer)) startRun(state, 'hq', { source: runSource(ctx) });
    else if (source.step === 'bypass' && said(answer) && state.runner.clicks >= 2) {
      state.runner.clicks -= 2;
      bypassIfStill(state, source.data?.iceId);
    }
  },
};

// Jeitinho (Weapon): When your turn ends, if you made a successful run on HQ, R&D, and Archives this
// turn, you may add this hardware to your score area as an assassination agenda worth 0 agenda
// points. Then, if you have 3 assassination agendas in your score area, you win the game. Threat 3 ->
// Whenever you bypass a piece of ice, you may spend [click] to install this hardware from your heap.
const JEITINHO = '34079';
const jeitinho: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      if (e.side === 'runner' && ranAllCentrals(ctx.state)) askChoice(ctx, 'runner', 'Jeitinho: add it to your score area as an assassination agenda?', yesNo('Add to score area'), 'score');
    },
  },
  heapTriggers: {
    ice_bypassed: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 3 || state.runner.clicks === 0 || installableRunnerCards(state, [ctx.card]).length === 0) return;
      askChoice(ctx, 'runner', 'Jeitinho: spend [click] to install it from your heap?', yesNo('Spend [click] and install'), 'install');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'score' && said(answer) && isInstalled(state, card)) {
      removeCard(state.runner.rig.hardware, card);
      card.tokens = {};
      card.asAgendaPoints = 0;
      state.runner.scoreArea.push(card);
      addLog(state, 'runner', 'Runner added Jeitinho to their score area as an assassination agenda.');
      if (state.runner.scoreArea.filter(c => c.cardCode === JEITINHO).length >= 3) {
        state.winner = 'runner';
        state.winReason = 'Jeitinho: 3 assassination agendas';
        addLog(state, 'runner', 'The Runner has 3 assassination agendas and wins the game (Jeitinho).');
      }
    } else if (source.step === 'install' && said(answer) && state.runner.clicks > 0 && state.runner.heap.includes(card)) {
      state.runner.clicks -= 1;
      installFrom(ctx, card.instanceId, 0);
    }
  },
};

// Cupellation: Limit 1 hosted card. Access -> 1 credit: Host the non-agenda card you are accessing
// faceup on this program. Whenever you breach HQ, if this program has a hosted Corp card, you may pay
// 1 credit and trash this program to access 2 additional cards.
const cupellation: CardScript = {
  accessAbility: {
    label: 'pay 1 [credit] to host this card on Cupellation',
    canUse: ({ state, card }, accessed) => type(accessed) !== 'agenda' && (card.hostedCards ?? []).length === 0 && availableCredits(state, 'runner') >= 1,
    use: ({ state, card }, accessed) => {
      spendCredits(state, 'runner', 1);
      const found = findInstalledCorpCard(state, accessed.instanceId);
      if (found) {
        returnInstalledToHQ(state, accessed);
        removeCard(state.corp.hq, accessed);
      } else {
        removeCard(state.corp.hq, accessed) || removeCard(state.corp.rd, accessed) || removeCard(state.corp.archives.faceUp, accessed) || removeCard(state.corp.archives.faceDown, accessed);
      }
      card.hostedCards = [...(card.hostedCards ?? []), accessed];
      addLog(state, 'runner', `Runner paid 1 [credit] to host ${title(accessed)} on Cupellation.`);
      const run = state.activeRun;
      if (run) run.accessQueue = run.accessQueue.filter(id => id !== accessed.instanceId);
    },
  },
  triggers: {
    breach_server: (ctx, e) => {
      const { state, card } = ctx;
      if (e.server !== 'hq' || !(card.hostedCards ?? []).some(c => cardDef(c).side_code === 'corp') || availableCredits(state, 'runner') < 1) return;
      askChoice(ctx, 'runner', 'Cupellation: pay 1 [credit] and trash it to access 2 additional cards?', yesNo('Pay and trash'), 'breach');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || !state.activeRun || !isInstalled(state, card)) return;
    spendCredits(state, 'runner', 1);
    trashInstalledRunnerCard(state, card);
    state.activeRun.extraAccesses += 2;
    addLog(state, 'runner', 'Runner trashed Cupellation to access 2 additional cards.');
  },
};

// Malandragem: When you install this program, load 2 power counters onto it. When it is empty,
// remove it from the game. Once per turn -> When you encounter a piece of ice, if its strength is 3
// or less, you may remove 1 hosted power counter to bypass it. Threat 4 -> Whenever you encounter a
// piece of ice, you may remove this program from the game to bypass it.
const malandragem: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 2),
    encounter_ice: (ctx, e) => {
      const { state } = ctx;
      const options = [
        ...(turnFlag(state, onceKey(ctx.card)) === 0 && iceStrength(state, e.ice) <= 3 && counters(ctx.card, 'power') > 0 ? [{ id: 'counter', label: 'Remove 1 power counter and bypass' }] : []),
        ...(threatLevel(state) >= 4 ? [{ id: 'remove', label: 'Remove Malandragem from the game and bypass' }] : []),
      ];
      if (options.length > 0) askChoice(ctx, 'runner', `Malandragem: bypass ${title(e.ice)}?`, [...options, { id: 'no', label: 'No' }], 'bypass', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no' || !isInstalled(state, card)) return;
    if (answer.optionId === 'counter') {
      if (!useOncePerTurn(state, onceKey(card))) return;
      spendLoad(state, card, 1, 'remove');
    } else removeFromGame(state, card);
    bypassIfStill(state, source.data?.iceId);
  },
};

// Physarum Entangler (Virus - Trojan): Install only on a piece of ice. Whenever you encounter host
// ice, if it is not a barrier, you may pay 1 credit for each subroutine it has. If you do, bypass
// that ice. When the Corp purges virus counters, trash this program.
const physarum: CardScript = {
  installsOnIce: true,
  triggers: {
    encounter_ice: (ctx, e) => {
      const { state, card } = ctx;
      if (card.hostedOnId !== e.ice.instanceId || iceSubtypes(e.ice, state).includes('barrier')) return;
      const cost = iceSubroutines(state, e.ice).length;
      if (availableCredits(state, 'runner') < cost) return;
      askChoice(ctx, 'runner', `Physarum Entangler: pay ${cost} [credit] to bypass ${title(e.ice)}?`, yesNo(`Pay ${cost} [credit] and bypass`), 'bypass', { iceId: e.ice.instanceId, cost });
    },
    virus_purged: ({ state, card }) => {
      if (isInstalled(state, card)) trashInstalledRunnerCard(state, card);
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    const cost = Number(source.data?.cost ?? 0);
    if (!said(answer) || availableCredits(state, 'runner') < cost) return;
    spendCredits(state, 'runner', cost);
    bypassIfStill(state, source.data?.iceId);
  },
};

// Amelia Earhart (Virtual - Companion): Whenever a run on HQ or R&D ends, if you accessed 3 or more
// cards during that run, place 1 power counter on this resource. When your turn begins, you may
// remove 3 hosted power counters and trash this resource. If you do, the Corp loses 10 credits.
const amelia: CardScript = {
  triggers: {
    run_ends: (ctx, e) => {
      if ((e.server === 'hq' || e.server === 'rd') && e.accessedCount >= 3) place(ctx.card, 'power', 1);
    },
    turn_begins: (ctx, e) => {
      if (e.side === 'runner' && counters(ctx.card, 'power') >= 3) askChoice(ctx, 'runner', 'Amelia Earhart: remove 3 power counters and trash it to make the Corp lose 10 [credit]?', yesNo('Do it'), 'use');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || counters(card, 'power') < 3 || !isInstalled(state, card)) return;
    trashInstalledRunnerCard(state, card);
    const lost = loseCredits(state, 'corp', 10);
    addLog(state, 'runner', `The Corp lost ${lost} [credit] (Amelia Earhart).`);
  },
};

// Juli Moreira Lee: When you install this resource, load 4 power counters onto it. When it is empty,
// trash it. The first time each turn you take an action on an installed resource, remove 1 hosted
// power counter and gain [click].
const juli: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 4),
    ability_used: (ctx, e) => {
      const { state, card } = ctx;
      if (e.clicks === 0 || !state.runner.rig.resources.includes(e.card) && !state.runner.heap.includes(e.card)) return;
      if (type(e.card) !== 'resource' || !runnerTurn(state) || counters(card, 'power') === 0 || !useOncePerTurn(state, onceKey(card))) return;
      state.runner.clicks += 1;
      addLog(state, 'runner', 'Runner gained [click] (Juli Moreira Lee).');
      spendLoad(state, card);
    },
  },
};

// --- Rebellion Without Rehearsal: Shaper ----------------------------------------------------

// Burner (Run): Run HQ. If successful, instead of breaching HQ, reveal 3 cards in HQ at random. Add 2
// of the revealed cards to the top and/or bottom of R&D.
const burner: CardScript = {
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
    askCards(ctx, 'runner', 'Burner: choose 2 of the revealed cards to add to R&D.', ids(revealed), Math.min(2, revealed.length), 2, 'pick');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const [first, ...rest] = picked(answer);
      if (first) burnerWhere(ctx, first, rest);
    } else if (source.step === 'where' && answer.kind === 'effect_choice') {
      const card = state.corp.hq.find(c => c.instanceId === source.data?.cardId);
      if (card) {
        removeCard(state.corp.hq, card);
        if (answer.optionId === 'top') state.corp.rd.unshift(card);
        else state.corp.rd.push(card);
        runnerSeesRd(state, card);
        addLog(state, 'runner', `Runner added ${title(card)} to the ${answer.optionId} of R&D (Burner).`);
      }
      const rest = String(source.data?.rest ?? '').split(',').filter(Boolean);
      if (rest.length > 0) burnerWhere(ctx, rest[0], rest.slice(1));
    }
  },
};
function burnerWhere(ctx: EffectContext, cardId: string, rest: string[]): void {
  const card = ctx.state.corp.hq.find(c => c.instanceId === cardId);
  if (!card) return;
  askChoice(ctx, 'runner', `Burner: add ${title(card)} to the top or bottom of R&D?`, [
    { id: 'top', label: 'Top of R&D' },
    { id: 'bottom', label: 'Bottom of R&D' },
  ], 'where', { cardId, rest: rest.join(',') });
}

// Spree (Run): Place 3 power counters on this event, then run any server. Hosted power counter: Host
// 1 installed trojan program on a piece of ice protecting the attacked server.
const installedTrojans = (state: GameState) => state.runner.rig.programs.filter(c => hasKeyword(c, 'trojan') && c.hostedOnId);
const spree: CardScript = {
  onPlay: ctx => {
    place(ctx.card, 'power', 3);
    askServer(ctx, 'Spree', allServers(ctx.state));
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
      resolve: ctx => askCards(ctx, 'runner', 'Spree: choose 1 installed trojan to move.', ids(installedTrojans(ctx.state)), 1, 1, 'trojan'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'run' && answer.kind === 'effect_choice') startRun(state, answer.optionId, { source: runSource(ctx), eventCode: card.cardCode });
    else if (source.step === 'trojan') {
      const run = state.activeRun;
      const ice = run ? state.corp.servers[run.server]?.ice ?? [] : [];
      const trojan = picked(answer)[0];
      if (trojan && ice.length > 0) askChoice(ctx, 'runner', 'Spree: host it on which ice?', ice.map(i => ({ id: i.instanceId, label: iceLabel(state, i) })), 'ice', { trojan });
    } else if (source.step === 'ice' && answer.kind === 'effect_choice') {
      const trojan = state.runner.rig.programs.find(c => c.instanceId === source.data?.trojan);
      const ice = installedIce(state).find(c => c.instanceId === answer.optionId);
      if (!trojan || !ice) return;
      const old = trojan.hostedOnId ? findCardAnywhere(state, trojan.hostedOnId) : undefined;
      if (old) old.hostedCardIds = old.hostedCardIds.filter(id => id !== trojan.instanceId);
      trojan.hostedOnId = ice.instanceId;
      ice.hostedCardIds.push(trojan.instanceId);
      addLog(state, 'runner', `Runner moved ${title(trojan)} onto ${iceLabel(state, ice)} (Spree).`);
    }
  },
};

// Trick Shot (Run): Place 4 credits on this event. You can spend hosted credits during runs. Run R&D.
// If successful, place 2 credits on this event and access 1 additional card when you breach R&D.
// When that run ends, you may run a remote server.
const trickShot: CardScript = {
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
    if (!ctx.state.winner && runnerTurn(ctx.state)) askServer(ctx, 'Trick Shot (you may run a remote server)', remoteServers(ctx.state), 'remote');
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'remote' && answer.kind === 'effect_choice' && !ctx.state.activeRun) {
      // The second run is not "that run" (no source: its end offers no other run); the hosted credits still pay
      startRun(ctx.state, answer.optionId, { creditHosts: counters(ctx.card, 'credit') > 0 ? [ctx.card.instanceId] : [] });
    }
  },
};

// Cataloguer: When you install this hardware, load 2 power counters onto it. When it is empty, trash
// it. Whenever you make a successful run on R&D, instead of breaching R&D, you may remove 1 hosted
// power counter to look at the top 4 cards of R&D and arrange them in any order. [click], hosted
// power counter: Breach R&D. Use this ability only if you made a successful run on R&D this turn.
const cataloguer: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 2),
    successful_run: (ctx, e) => {
      if (e.server !== 'rd' || counters(ctx.card, 'power') === 0 || ctx.state.activeRun?.breachInstead) return;
      askChoice(ctx, 'runner', 'Cataloguer: remove 1 power counter to arrange the top 4 cards of R&D instead of breaching it?', yesNo('Arrange instead'), 'instead');
    },
  },
  abilities: [
    {
      label: 'Hosted power counter: breach R&D.',
      clicks: 1,
      canUse: ({ state, card }) => {
        if (counters(card, 'power') === 0) return 'No power counters';
        return state.runsThisTurn.some(r => r.server === 'rd' && r.successful) ? null : 'You need a successful run on R&D this turn';
      },
      resolve: ({ state, card }) => {
        spendLoad(state, card);
        breachOutsideRun(state, 'rd');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'instead' && said(answer) && state.activeRun) {
      state.activeRun.breachInstead = 'none';
      const top = ids(state.corp.rd.slice(0, 4));
      spendLoad(state, card);
      addLog(state, 'runner', 'Runner looked at the top 4 cards of R&D (Cataloguer).');
      arrangeTop({ ...ctx, card }, top, 'arrange', [], 'runner');
    } else if (source.step === 'arrange' && answer.kind === 'effect_cards') {
      arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
    }
  },
};

// Coalescence: When you install this program, place 2 power counters on it. Hosted power counter:
// Gain 2 credits. Use this ability only during your turn.
const coalescence: CardScript = {
  triggers: { installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 2) },
  abilities: [
    {
      label: 'Gain 2 [credit].',
      counters: { type: 'power', count: 1 },
      canUse: ({ state }) => (runnerTurn(state) ? null : 'Only during your turn'),
      resolve: ({ state }) => {
        gainCredits(state, 'runner', 2);
        addLog(state, 'runner', 'Runner gained 2 [credit] (Coalescence).');
      },
    },
  ],
};

// Lobisomem (Decoder - Fracter): When you install this program and whenever it fully breaks a code
// gate, place 1 power counter on it. Interface -> 1 credit: Break 1 code gate subroutine. Interface ->
// X credits, hosted power counter: Break X barrier subroutines. 1 credit: +2 strength.
const unbrokenIndices = (state: GameState) => (state.activeRun?.encounter?.broken ?? []).flatMap((b, i) => (b ? [] : [i]));
const lobisomem: CardScript = {
  breaker: { breaks: 'code gate', breakMax: 1, breakCost: () => 1, boostCost: 1, boostAmount: () => 2 },
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 1),
    ice_fully_broken: (ctx, e) => {
      if (iceSubtypes(e.ice, ctx.state).includes('code gate') && brokeAllWith(ctx.state, ctx.card)) place(ctx.card, 'power', 1);
    },
  },
  abilities: [
    {
      label: 'X [credit], hosted power counter: break X barrier subroutines.',
      counters: { type: 'power', count: 1 },
      canUse: ({ state, card }) => {
        const ice = encounteredIce(state);
        if (!ice || !inBreakWindow(state)) return 'Only while encountering ice, before subroutines fire';
        if (!iceSubtypes(ice, state).includes('barrier')) return 'Only on barriers';
        if (breakerStrength(state, card) < iceStrength(state, ice)) return `Lobisomem needs strength ${iceStrength(state, ice)}`;
        if (unbrokenIndices(state).length === 0) return 'No subroutine left to break';
        return availableCredits(state, 'runner') >= 1 ? null : 'Not enough credits';
      },
      resolve: ctx => {
        const { state } = ctx;
        const max = Math.min(unbrokenIndices(state).length, availableCredits(state, 'runner'));
        const options = Array.from({ length: max }, (_, i) => ({ id: String(max - i), label: `Pay ${max - i} [credit]: break ${max - i}` }));
        askChoice(ctx, 'runner', 'Lobisomem: break how many barrier subroutines?', options, 'x');
      },
    },
  ],
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step !== 'x' || answer.kind !== 'effect_choice') return;
    const indices = unbrokenIndices(state).slice(0, Number(answer.optionId));
    if (indices.length === 0 || availableCredits(state, 'runner') < indices.length) return;
    spendCredits(state, 'runner', indices.length);
    addLog(state, 'runner', `Runner paid ${indices.length} [credit] to break ${indices.length} subroutine(s) with Lobisomem.`);
    markSubroutinesBroken(state, indices, card);
  },
};

// Muse (Daemon): When you install this program, search your stack, heap, or grip for 1 non-daemon
// program. If that program is a trojan, install it on a piece of ice. Otherwise, install it on this
// program. (A program "on Muse" is installed normally here: hosting changes nothing else for it.)
const museTargets = (state: GameState) =>
  [...state.runner.stack, ...state.runner.heap, ...state.runner.grip].filter(c => type(c) === 'program' && !hasKeyword(c, 'daemon'));
const muse: CardScript = {
  triggers: {
    installed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const options = installableRunnerCards(ctx.state, museTargets(ctx.state));
      if (options.length > 0) askRunnerInstall(ctx, 'Muse: search your stack, heap or grip for 1 non-daemon program to install.', ids(options), 0, 1, 'install');
      else shuffleInPlace(ctx.state.rng, ctx.state.runner.stack);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'install') {
      const id = picked(answer)[0];
      if (id) {
        const card = findCardAnywhere(state, id);
        if (card) addLog(state, 'runner', `Runner found ${title(card)} (Muse).`, card.cardCode);
        installRunnerChoice(ctx, id, 'host', 0, {}, answer.kind === 'effect_cards' ? answer.trashFirst : []);
      }
      shuffleInPlace(state.rng, state.runner.stack);
    } else if (source.step === 'host') installRunnerHostChoice(state, source, answer);
  },
};

// Pressure Spike (Fracter): Interface -> 1 credit: Break 1 barrier subroutine. 2 credits: +3
// strength. Threat 4 -> 2 credits: +9 strength. Use this ability only once per run.
/** Pressure Spike's once-per-run +9 (a run flag), read by the AI's break plans too. */
export const spikeKey = (card: CardInstance) => `pressure-spike:${card.instanceId}`;
const pressureSpike: CardScript = {
  breaker: { breaks: 'barrier', breakMax: 1, breakCost: () => 1, boostCost: 2, boostAmount: () => 3 },
  abilities: [
    {
      label: '+9 strength (threat 4, once per run).',
      credits: 2,
      canUse: ({ state, card }) => {
        if (threatLevel(state) < 4) return 'The threat level must be 4 or greater';
        if (!inBreakWindow(state)) return 'Only while encountering ice, before subroutines fire';
        return runFlag(state, spikeKey(card)) > 0 ? 'Once per run' : null;
      },
      resolve: ({ state, card }) => {
        const run = state.activeRun;
        if (!run) return;
        run.runFlags = { ...(run.runFlags ?? {}), [spikeKey(card)]: 1 };
        addBreakerStrength(state, card, 9);
      },
    },
  ],
};

// "Pretty" Mary da Silva (Connection - Seedy): Whenever you breach R&D, if you are allowed to access 2
// or more cards in R&D during this breach, you may access 1 additional card. Asked once the other
// access counts are known, as the breach begins.
const prettyMary: CardScript = {
  triggers: {
    breach_begins: (ctx, e) => {
      const breach = ctx.state.activeRun?.breach;
      if (e.server !== 'rd' || !breach || breach.zone !== 'rd' || breach.zoneLeft < 2) return;
      askChoice(ctx, 'runner', '"Pretty" Mary da Silva: access 1 additional card in R&D?', yesNo('Access 1 more'), 'extra');
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    const breach = state.activeRun?.breach;
    if (source.step !== 'extra' || !said(answer) || !breach || breach.zone !== 'rd') return;
    breach.zoneLeft += 1;
    addLog(state, 'runner', 'Runner accesses 1 additional card in R&D ("Pretty" Mary da Silva).');
  },
};

// Ashen Epilogue: Shuffle your grip and heap into your stack, then remove the top 5 cards of your
// stack from the game. Draw 5 cards. Remove this event from the game.
const ashenEpilogue: CardScript = {
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

// Valentina Ferreira Carvalho: Whenever you remove 1 or more tags, gain 1 credit. Threat 3 -> When
// you install this resource during your turn, you may remove 1 tag or gain 2 credits.
const valentina: CardScript = {
  triggers: {
    tags_removed: ({ state }) => {
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Valentina Ferreira Carvalho).');
    },
    installed: (ctx, e) => {
      if (!isSelf(ctx, e.card) || !runnerTurn(ctx.state) || threatLevel(ctx.state) < 3) return;
      askChoice(ctx, 'runner', 'Valentina Ferreira Carvalho: remove 1 tag or gain 2 [credit]?', [
        ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : []),
        { id: 'credits', label: 'Gain 2 [credit]' },
        { id: 'no', label: 'Neither' },
      ], 'install');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'tag')) removeTags(state, 1);
    else if (said(answer, 'credits')) gainCredits(state, 'runner', 2);
  },
};

export const liberationRunnerScripts: Record<string, CardScript> = {
  '34001': strikeFund,
  '34002': thePrice,
  '34003': solidarityBadge,
  '34004': audrey,
  '34005': banner,
  '34006': monkeywrench,
  '34007': eru,
  '34008': hannah,
  '34009': lagoParanoa,
  '34010': mercury,
  '34011': chrysopoeian,
  '34012': sDobrado,
  '34013': capybara,
  '34014': hermes,
  '34015': curupira,
  '34016': laserPointer,
  '34017': saci,
  '34018': shibboleth,
  '34019': debbie,
  '34020': arissana,
  '34021': joyRide,
  '34022': airblade,
  '34023': lilypad,
  '34024': livingMural,
  '34025': pichacao,
  '34026': slapVandal,
  '34027': umbrella,
  '34028': beatriz,
  '34029': urbanArt,
  '34030': bahiaBands,
  '34066': sebastiao,
  '34067': eyeForAnEye,
  '34068': privilegedAccess,
  '34069': amanuensis,
  '34070': wizardsChest,
  '34071': boiTata,
  '34072': heliamphora,
  '34073': arruaceiras,
  '34074': friendOfAFriend,
  '34075': manuelLattes,
  '34076': meetingOfMinds,
  '34077': windowOfOpportunity,
  '34078': alarmClock,
  '34079': jeitinho,
  '34080': cupellation,
  '34081': malandragem,
  '34082': physarum,
  '34083': amelia,
  '34084': juli,
  '34085': burner,
  '34086': spree,
  '34087': trickShot,
  '34088': cataloguer,
  '34089': coalescence,
  '34090': lobisomem,
  '34091': muse,
  '34092': pressureSpike,
  '34093': prettyMary,
  '34094': ashenEpilogue,
  '34095': valentina,
};
