import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { nextInt, shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findCardAnywhere, findInstalledCorpCard, illegal, removeCard } from '../../../engine/helpers';
import { answerBoostDiscard, BOOST_DISCARD_STEP } from '../../../engine/actions/breaking';
import { trashInstalledRunnerCard, uninstallRunnerCard } from '../../../engine/damage';
import {
  availableCredits,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  installedIce,
  removeCounters,
  removeFromGame,
  runFlag,
  spendCredits,
  threatLevel,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import {
  addBreakerStrength,
  breakerStrength,
  encounteredIce,
  iceStrength,
  iceSubroutines,
  iceSubtypes,
  markSubroutinesBroken,
} from '../../../engine/ice';
import { CardScript, EffectContext } from '../../types';
import {
  askCards,
  askChoice,
  askRunnerInstall,
  effectTrashableFirst,
  gainCredits,
  installableRunnerCards,
  installRunnerChoice,
  installRunnerHostChoice,
} from '../../effects';
import { returnInstalledToHQ } from '../corp/helpers';
import { bypassIfStill, hasKeyword, ids, isInstalled, isSelf, onceKey, picked, place, runnerTurn, said, spendLoad, spikeKey, title, type, yesNo } from './helpers';

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

/** The ice a trojan program is hosted on. */
const hostIce = (state: GameState, program: CardInstance) => (program.hostedOnId ? installedIce(state).find(i => i.instanceId === program.hostedOnId) : undefined);

/** Is this ice hosting an installed trojan program? */
const hostsTrojan = (state: GameState, ice: CardInstance) => state.runner.rig.programs.some(p => p.hostedOnId === ice.instanceId && hasKeyword(p, 'trojan'));

// Audrey v2 (AI - Virus): Whenever you trash a card you are accessing, place 1 virus counter on
// this program. Interface -> Hosted virus counter: Break up to 2 subroutines. Trash 1 card from
// your grip: +3 strength.
export const audrey: CardScript = {
  breaker: { breaks: 'any', breakMax: 2, breakCost: () => 0, breakCounter: 'virus', boostCost: 0, boostAmount: () => 3, boostDiscard: true },
  triggers: { trashed_on_access: ctx => place(ctx.card, 'virus', 1) },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === BOOST_DISCARD_STEP && picked(answer).length > 0) answerBoostDiscard(state, card, picked(answer)[0]);
  },
};

// Banner (Fracter - Weapon): Interface -> 2 credits: Subroutines on the barrier you are
// encountering cannot end the run for the remainder of this encounter.
export const banner: CardScript = {
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
export const monkeywrench: CardScript = {
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

// Curupira (Fracter): Whenever you encounter a barrier, you may spend 3 hosted power counters to
// bypass it. Whenever this program fully breaks a piece of ice, place 1 power counter on it.
// Interface -> 1 credit: Break 1 barrier subroutine. 1 credit: +1 strength.
const brokeAllWith = (state: GameState, breaker: CardInstance) => {
  const encounter = state.activeRun?.encounter;
  return !!encounter && Object.values(encounter.brokenBy ?? {}).every(id => id === breaker.instanceId) && encounter.broken.every(Boolean);
};

export const curupira: CardScript = {
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
export const laserPointer: CardScript = {
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

export const saci: CardScript = {
  installsOnIce: true,
  triggers: { rezzed: (ctx, e) => saciGain(ctx, e.card), derezzed: (ctx, e) => saciGain(ctx, e.card) },
};

// Shibboleth (Decoder): Threat 4 -> This program gets -2 strength. Interface -> 1 credit: Break 1
// code gate subroutine. 2 credits: +2 strength.
export const shibboleth: CardScript = {
  breaker: {
    breaks: 'code gate',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 2,
    boostAmount: () => 2,
    strengthModifier: state => (threatLevel(state) >= 4 ? -2 : 0),
  },
};

// Living Mural (Killer - Trojan): Install only on a piece of ice. Threat 4 -> When you install this
// program, it gets +3 strength for the remainder of the turn. Interface -> 1 credit: Break 1
// subroutine on a sentry protecting this server. 1 credit: +2 strength.
const muralKey = (card: CardInstance) => `mural:${card.instanceId}`;

export const livingMural: CardScript = {
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

export const pichacao: CardScript = {
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

export const slapVandal: CardScript = {
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
export const umbrella: CardScript = {
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

// Boi-tatá (Killer): If you trashed any of your installed cards this turn, paid abilities on this
// program cost 1 credit less to use. Interface -> 2 credits: Break up to 2 sentry subroutines.
// 3 credits: +3 strength.
const boiDiscount = (state: GameState) => (turnFlag(state, TurnFlag.runnerTrashedOwnInstalled) > 0 ? 1 : 0);

export const boiTata: CardScript = {
  breaker: { breaks: 'sentry', breakMax: 2, breakCost: state => 2 - boiDiscount(state), boostCost: state => 3 - boiDiscount(state), boostAmount: () => 3 },
};

// Heliamphora (Virus): [interrupt] -> Whenever you would access a card in Archives, you may host it
// faceup on this program instead. Use this ability only once each time you breach Archives. When the
// Corp purges virus counters, they trash 2 cards from HQ at random. Trash this program.
export const heliamphora: CardScript = {
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

// Cupellation: Limit 1 hosted card. Access -> 1 credit: Host the non-agenda card you are accessing
// faceup on this program. Whenever you breach HQ, if this program has a hosted Corp card, you may pay
// 1 credit and trash this program to access 2 additional cards.
export const cupellation: CardScript = {
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
    // Two copies both ask on the same breach; the second may no longer be affordable: no cost paid, no effect (rules 1.16.1)
    if (availableCredits(state, 'runner') < 1) {
      addLog(state, 'runner', 'Cupellation: the Runner cannot pay 1 [credit] now.');
      return;
    }
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
export const malandragem: CardScript = {
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
export const physarum: CardScript = {
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

// Coalescence: When you install this program, place 2 power counters on it. Hosted power counter:
// Gain 2 credits. Use this ability only during your turn.
export const coalescence: CardScript = {
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

export const lobisomem: CardScript = {
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
// program. (A program on Muse is trashed with it, rules 1.13.) The hosted program still uses its own
// memory (NSG ruling: its memory cost isn't ignored; rules 3.9.3), and Muse can't be trashed to make
// room for it unless it is a trojan going on ice (NSG ruling).
const museTargets = (state: GameState) =>
  [...state.runner.stack, ...state.runner.heap, ...state.runner.grip].filter(c => type(c) === 'program' && !hasKeyword(c, 'daemon'));

export const muse: CardScript = {
  triggers: {
    installed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const hostId = ctx.card.instanceId;
      const options = installableRunnerCards(ctx.state, museTargets(ctx.state), 0, hostId);
      if (options.length > 0) askRunnerInstall(ctx, 'Muse: search your stack, heap or grip for 1 non-daemon program to install.', ids(options), 0, 1, 'install', { hostId });
      else shuffleInPlace(ctx.state.rng, ctx.state.runner.stack);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'install') {
      const id = picked(answer)[0];
      if (id) {
        const card = findCardAnywhere(state, id);
        const trashIds = answer.kind === 'effect_cards' ? (answer.trashFirst ?? []) : [];
        if (card && trashIds.some(t => !effectTrashableFirst(state, card, source.data).some(c => c.instanceId === t))) {
          illegal(`Can't trash those programs to install ${title(card)} on Muse`);
        }
        // Searched for without a reveal: the Corp learns the card only once it is installed (rules 4.2.2, 4.3.2)
        if (card) addLog(state, 'runner', `Runner found ${title(card)} (Muse).`, card.cardCode, undefined, { from: 'corp', publicMessage: 'Runner searched for a program (Muse).' });
        const installed = installRunnerChoice(ctx, id, 'host', 0, {}, trashIds);
        const muse = ctx.card;
        if (installed && card && state.runner.rig.programs.includes(muse) && state.runner.rig.programs.includes(card)) {
          card.hostedOnId = muse.instanceId;
          muse.hostedCardIds.push(card.instanceId);
        }
      }
      shuffleInPlace(state.rng, state.runner.stack);
    } else if (source.step === 'host') installRunnerHostChoice(state, source, answer);
  },
};

export const pressureSpike: CardScript = {
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

export const liberationRunnerProgramsScripts: Record<string, CardScript> = {
  '34004': audrey,
  '34005': banner,
  '34006': monkeywrench,
  '34015': curupira,
  '34016': laserPointer,
  '34017': saci,
  '34018': shibboleth,
  '34024': livingMural,
  '34025': pichacao,
  '34026': slapVandal,
  '34027': umbrella,
  '34071': boiTata,
  '34072': heliamphora,
  '34080': cupellation,
  '34081': malandragem,
  '34082': physarum,
  '34089': coalescence,
  '34090': lobisomem,
  '34091': muse,
  '34092': pressureSpike,
};
