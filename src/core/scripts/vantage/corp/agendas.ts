import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, revealInHand, turnKey } from '../../../engine/helpers';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { dealMeatDamage, giveTags } from '../../../engine/damage';
import { addCounters, gainFromCard, moveUpgrade, removeTags, takeBadPublicity, turnFlag, upgradeAllowedIn, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { askCards, askChoice } from '../../effects';
import { archivesCards, ids, isSelf, onceKey, serverOf, takeFromCorpZone, title, type } from './helpers';

const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

// Méliès City Luxury Line: As an additional cost to steal this agenda, the Runner must spend
// click. When you score this agenda, gain click.
export const meliesCity: CardScript = {
  stealCost: (_state, self, agenda) => (self.instanceId === agenda.instanceId ? { clicks: 1 } : null),
  triggers: {
    agenda_scored: onScore(({ state }) => {
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Méliès City Luxury Line).');
    }),
  },
};

// Lotus Haze: When you score this agenda, place 3 agenda counters on it. Hosted agenda
// counter: Move 1 rezzed upgrade to the root of another server.
const movableUpgrades = (state: GameState) =>
  installedCorpCards(state).filter(
    c => type(c) === 'upgrade' && c.isRezzed && Object.keys(state.corp.servers).some(id => id !== serverOf(state, c)?.id && upgradeAllowedIn(state, c, id))
  );

export const lotusHaze: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => addCounters(ctx.card, 'agenda', 3)),
  },
  abilities: [
    {
      label: 'Move 1 rezzed upgrade to the root of another server.',
      counters: { type: 'agenda', count: 1 },
      canUse: ({ state }) => (movableUpgrades(state).length > 0 ? null : 'No rezzed upgrade can move'),
      resolve: ctx => askCards(ctx, 'corp', 'Lotus Haze: move which rezzed upgrade?', ids(movableUpgrades(ctx.state)), 1, 1, 'upgrade'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'upgrade' && answer.kind === 'effect_cards') {
      const upgrade = movableUpgrades(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!upgrade) return;
      const from = serverOf(state, upgrade)?.id;
      const options = Object.values(state.corp.servers)
        .filter(s => s.id !== from && upgradeAllowedIn(state, upgrade, s.id))
        .map(s => ({ id: s.id, label: s.name }));
      askChoice(ctx, 'corp', `Lotus Haze: move ${title(upgrade)} to which server?`, options, 'server', { cardId: upgrade.instanceId });
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      const upgrade = findInstalledCorpCard(state, String(source.data?.cardId))?.card;
      if (upgrade) moveUpgrade(state, upgrade, answer.optionId);
    }
  },
};

// Witch Hunt (Initiative - Liability): When this agenda is scored or stolen, take 1 bad
// publicity. When your action phase ends, if you scored this agenda this turn, remove all
// tags, then give the Runner 3 tags.
export const witchHunt: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state }) => takeBadPublicity(state, 1)),
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && takeBadPublicity(ctx.state, 1),
    action_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'corp' || card.scoredTurn !== turnKey(state) || !state.corp.scoreArea.includes(card)) return;
      removeTags(state, state.runner.tags);
      giveTags(state, 3);
      addLog(state, 'corp', 'Witch Hunt: the Runner\'s tags were removed and they took 3 tags.');
    },
  },
};

// Sacrifice Zone Expansion (Public - Expansion): Install only faceup. The first time each turn
// you advance this agenda, gain 3 credits. Once per turn -> When the Runner makes a successful
// run on another server, you may remove 1 hosted advancement counter to do 1 meat damage.
export const sacrificeZone: CardScript = {
  installFaceUpOnly: true,
  triggers: {
    advanced: (ctx, e) => {
      if (!isSelf(ctx, e.card) || !useOncePerTurn(ctx.state, onceKey(ctx.card, 0))) return;
      gainFromCard(ctx.state, 'corp', 3, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 3 [credit] (Sacrifice Zone Expansion).');
    },
    successful_run: (ctx, e) => {
      const { state, card } = ctx;
      if (card.advancementCounters === 0 || serverOf(state, card)?.id === e.server || turnFlag(state, onceKey(card, 1)) > 0) return;
      askChoice(ctx, 'corp', 'Sacrifice Zone Expansion: remove 1 advancement counter to do 1 meat damage?', [
        { id: 'yes', label: 'Remove 1 counter: 1 meat damage' },
        { id: 'no', label: 'No' },
      ], 'meat');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'yes' || card.advancementCounters === 0) return;
    useOncePerTurn(state, onceKey(card, 1));
    card.advancementCounters -= 1;
    dealMeatDamage(state, 1);
  },
};

// Let Them Dream: When you score this agenda, you may search HQ, R&D, or Archives for 1 agenda
// and reveal it. Add that agenda to HQ or the bottom of R&D. While this agenda is in the
// Runner's score area, it is worth 1 less agenda point (see stealAgenda).
const LTD_ZONES = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;

const ltdZone = (state: GameState, zone: string) =>
  zone === 'hq' ? state.corp.hq : zone === 'rd' ? state.corp.rd : archivesCards(state);

export const letThemDream: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx =>
      askChoice(ctx, 'corp', 'Let Them Dream: you may search HQ, R&D or Archives for 1 agenda.', [
        ...Object.entries(LTD_ZONES).map(([id, label]) => ({ id, label: `Search ${label}` })),
        { id: 'no', label: 'No' },
      ], 'zone')
    ),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'zone' && answer.kind === 'effect_choice' && answer.optionId !== 'no') {
      const agendas = ltdZone(state, answer.optionId).filter(c => type(c) === 'agenda');
      if (agendas.length === 0) {
        if (answer.optionId === 'rd') shuffleRD(state);
        return;
      }
      askCards(ctx, 'corp', 'Let Them Dream: choose 1 agenda.', ids(agendas), 1, 1, 'agenda', { zone: answer.optionId });
    } else if (source.step === 'agenda' && answer.kind === 'effect_cards') {
      const card = ltdZone(state, String(source.data?.zone)).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      takeFromCorpZone(state, card);
      if (source.data?.zone === 'rd') shuffleRD(state);
      addLog(state, 'corp', `Corp revealed ${title(card)} (Let Them Dream).`);
      state.corp.hq.push(card);
      askChoice(ctx, 'corp', `Let Them Dream: add ${title(card)} to HQ or the bottom of R&D?`, [
        { id: 'hq', label: 'Add it to HQ' },
        { id: 'bottom', label: 'Bottom of R&D' },
      ], 'where', { cardId: card.instanceId });
    } else if (source.step === 'where' && answer.kind === 'effect_choice') {
      const card = state.corp.hq.find(c => c.instanceId === source.data?.cardId);
      if (!card) return;
      if (answer.optionId === 'bottom') {
        removeCard(state.corp.hq, card);
        state.corp.rd.push(card);
        runnerSeesRd(state, card); // revealed, then put on the bottom
      } else {
        revealInHand(state, 'corp', [card]);
      }
    }
  },
};

// --- Assets -----------------------------------------------------------------

export const vantageCorpAgendasScripts: Record<string, CardScript> = {
  '36026': meliesCity,
  '36037': lotusHaze,
  '36047': witchHunt,
  '36056': sacrificeZone,
  '36066': letThemDream,
};
