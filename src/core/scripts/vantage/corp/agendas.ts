import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, revealInHand, turnKey } from '../../../engine/helpers';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { dealMeatDamage, giveTags } from '../../../engine/damage';
import { addCounters, gainFromCard, moveUpgrade, removeTags, takeBadPublicity, turnFlag, upgradeAllowedIn, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
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

const lotusFlow = prompts({
  upgrade: cards((ctx, a) => {
    const { state } = ctx;
    const upgrade = movableUpgrades(state).find(c => c.instanceId === a.ids[0]);
    if (!upgrade) return;
    const from = serverOf(state, upgrade)?.id;
    const options = Object.values(state.corp.servers)
      .filter(s => s.id !== from && upgradeAllowedIn(state, upgrade, s.id))
      .map(s => ({ id: s.id, label: s.name }));
    lotusFlow.choice(ctx, 'server', choiceQuestion('corp', `Lotus Haze: move ${title(upgrade)} to which server?`, options), { cardId: upgrade.instanceId });
  }),
  server: choice<{ cardId: string }>(({ state }, a, data) => {
    const upgrade = findInstalledCorpCard(state, String(data.cardId))?.card;
    if (upgrade) moveUpgrade(state, upgrade, a.optionId);
  }),
});

export const lotusHaze: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => addCounters(ctx.card, 'agenda', 3)),
  },
  abilities: [
    {
      label: 'Move 1 rezzed upgrade to the root of another server.',
      counters: { type: 'agenda', count: 1 },
      canUse: ({ state }) => (movableUpgrades(state).length > 0 ? null : 'No rezzed upgrade can move'),
      resolve: ctx => lotusFlow.cards(ctx, 'upgrade', cardsQuestion('corp', 'Lotus Haze: move which rezzed upgrade?', ids(movableUpgrades(ctx.state)), 1, 1)),
    },
  ],
  ...lotusFlow.script,
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
const sacrificeFlow = prompts({
  meat: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || card.advancementCounters === 0) return;
    useOncePerTurn(state, onceKey(card, 1));
    card.advancementCounters -= 1;
    dealMeatDamage(state, 1);
  }),
});

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
      sacrificeFlow.choice(ctx, 'meat', choiceQuestion('corp', 'Sacrifice Zone Expansion: remove 1 advancement counter to do 1 meat damage?', [
        { id: 'yes', label: 'Remove 1 counter: 1 meat damage' },
        { id: 'no', label: 'No' },
      ]));
    },
  },
  ...sacrificeFlow.script,
};

// Let Them Dream: When you score this agenda, you may search HQ, R&D, or Archives for 1 agenda
// and reveal it. Add that agenda to HQ or the bottom of R&D. While this agenda is in the
// Runner's score area, it is worth 1 less agenda point (see stealAgenda).
const LTD_ZONES = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;

const ltdZone = (state: GameState, zone: string) =>
  zone === 'hq' ? state.corp.hq : zone === 'rd' ? state.corp.rd : archivesCards(state);

const ltdFlow = prompts({
  zone: choice((ctx, a) => {
    const { state } = ctx;
    if (a.optionId === 'no') return;
    const agendas = ltdZone(state, a.optionId).filter(c => type(c) === 'agenda');
    if (agendas.length === 0) {
      if (a.optionId === 'rd') shuffleRD(state);
      return;
    }
    ltdFlow.cards(ctx, 'agenda', cardsQuestion('corp', 'Let Them Dream: choose 1 agenda.', ids(agendas), 1, 1), { zone: a.optionId });
  }),
  agenda: cards<{ zone: string }>((ctx, a, data) => {
    const { state } = ctx;
    const card = ltdZone(state, String(data.zone)).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    takeFromCorpZone(state, card);
    if (data.zone === 'rd') shuffleRD(state);
    addLog(state, 'corp', `Corp revealed ${title(card)} (Let Them Dream).`);
    state.corp.hq.push(card);
    ltdFlow.choice(ctx, 'where', choiceQuestion('corp', `Let Them Dream: add ${title(card)} to HQ or the bottom of R&D?`, [
      { id: 'hq', label: 'Add it to HQ' },
      { id: 'bottom', label: 'Bottom of R&D' },
    ]), { cardId: card.instanceId });
  }),
  where: choice<{ cardId: string }>(({ state }, a, data) => {
    const card = state.corp.hq.find(c => c.instanceId === data.cardId);
    if (!card) return;
    if (a.optionId === 'bottom') {
      removeCard(state.corp.hq, card);
      state.corp.rd.push(card);
      runnerSeesRd(state, card); // revealed, then put on the bottom
    } else {
      revealInHand(state, 'corp', [card]);
    }
  }),
});

export const letThemDream: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx =>
      ltdFlow.choice(ctx, 'zone', choiceQuestion('corp', 'Let Them Dream: you may search HQ, R&D or Archives for 1 agenda.', [
        ...Object.entries(LTD_ZONES).map(([id, label]) => ({ id, label: `Search ${label}` })),
        { id: 'no', label: 'No' },
      ]))
    ),
  },
  ...ltdFlow.script,
};

// --- Assets -----------------------------------------------------------------

export const vantageCorpAgendasScripts: Record<string, CardScript> = {
  '36026': meliesCity,
  '36037': lotusHaze,
  '36047': witchHunt,
  '36056': sacrificeZone,
  '36066': letThemDream,
};
