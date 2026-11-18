import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, noteTrashedFromHand } from '../../../engine/helpers';
import { runnerTrashInstalledCorpCard, startRun } from '../../../engine/actions/run';
import { giveTags, trashInstalledRunnerCard, uninstallRunnerCard } from '../../../engine/damage';
import { counters, drawForEffect, loseCredits, removeTags, threatLevel } from '../../../engine/cardEffects';
import { encounteredIce, enterMovement, iceStrength } from '../../../engine/ice';
import { CardScript } from '../../types';
import { gainCredits } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
import { allServers, hasKeyword, ids, isInstalled, isSelf, place, remoteServers, runQuestion, runSource, runnerTurn, spendLoad, title, type, yesNo } from './helpers';
import { firstThisTurn } from '../../../engine/triggers';

// Eru Ayase-Pessoa: Once per turn -> [click], take 1 tag: Run Archives. If successful, instead of
// breaching Archives, breach R&D. Threat 3 -> Whenever you breach R&D during a run on Archives,
// access 1 additional card.
export const eru: CardScript = {
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
const hannahFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx) })),
});

export const hannah: CardScript = {
  abilities: [
    {
      label: 'Gain [click]. Run a remote server (take 1 tag if unsuccessful).',
      clicks: 1,
      oncePerTurn: true,
      canUse: ({ state }) => (remoteServers(state).length > 0 ? null : 'There is no remote server to run'),
      resolve: ctx => {
        ctx.state.runner.clicks += 1;
        hannahFlow.askIf(ctx, 'run', runQuestion(ctx, 'Hannah "Wheels" Pilintra', remoteServers(ctx.state)));
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
  ...hannahFlow.script,
  onRunEnds: ({ state }, run) => {
    if (!run.isSuccessful) giveTags(state, 1);
  },
};

// Lago Paranoá Shelter: The first time each turn the Corp installs a card in the root of a server,
// you may trash the top card of your stack to draw 1 card.
const lagoFlow = prompts({
  use: choice(({ state }, a) => {
    if (a.optionId !== 'yes' || state.runner.stack.length === 0) return;
    const top = state.runner.stack.shift()!;
    state.runner.heap.push(top);
    addLog(state, 'runner', `Runner trashed ${title(top)} from the top of their stack (Lago Paranoá Shelter).`);
    noteTrashedFromHand(state, [top]);
    drawForEffect(state, 'runner', 1, 'Lago Paranoá Shelter');
  }),
});

const corpRootInstall = (state: GameState, e: { card: CardInstance }) =>
  cardDef(e.card).side_code === 'corp' && findInstalledCorpCard(state, e.card.instanceId)?.location === 'root';

export const lagoParanoa: CardScript = {
  firstEachTurn: { installed: corpRootInstall },
  triggers: {
    installed: (ctx, e) => {
      const { state } = ctx;
      if (!corpRootInstall(state, e) || !firstThisTurn(state, ctx.card) || state.runner.stack.length === 0) return;
      lagoFlow.ask(ctx, 'use', choiceQuestion('runner', 'Lago Paranoá Shelter: trash the top card of your stack to draw 1 card?', yesNo('Trash and draw')));
    },
  },
  ...lagoFlow.script,
};

// --- The Automata Initiative: Criminal -----------------------------------------------------

// Debbie "Downtown" Moreira: Threat 4 -> When you install this resource, place 2 credits on it.
// Whenever you play a run event, place 1 credit on this resource. [click]: Run any server. You can
// spend hosted credits during that run.
const debbieFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), creditHosts: [ctx.card.instanceId] })),
});

export const debbie: CardScript = {
  triggers: {
    installed: (ctx, e) => {
      if (isSelf(ctx, e.card) && threatLevel(ctx.state) >= 4) place(ctx.card, 'credit', 2);
    },
    event_played: (ctx, e) => {
      if (hasKeyword(e.card, 'run')) place(ctx.card, 'credit', 1);
    },
  },
  abilities: [{ label: 'Run any server (you can spend hosted credits during it).', clicks: 1, resolve: ctx => void debbieFlow.askIf(ctx, 'run', runQuestion(ctx, 'Debbie "Downtown" Moreira', allServers(ctx.state))) }],
  ...debbieFlow.script,
};

// --- The Automata Initiative: Shaper -------------------------------------------------------

// Beatriz Friere Gonzalez: [click][click]: Run HQ. If successful, instead of breaching HQ, breach
// R&D. When you do, access 1 additional card.
export const beatriz: CardScript = {
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

const urbanArtFlow = prompts({
  grip: cards(({ state, card }, a) => {
    const trojan = nonVirusTrojans(state).find(c => c.instanceId === a.ids[0]);
    if (!trojan) return;
    uninstallRunnerCard(state, trojan, 'grip');
    place(card, 'credit', 2);
    addLog(state, 'runner', `Runner added ${title(trojan)} to their grip and placed 2 [credit] on Urban Art Vernissage.`);
  }),
});

export const urbanArt: CardScript = {
  paysFor: (_state, _self, purpose) => purpose.kind === 'install',
  triggers: {
    turn_begins: (ctx, e) => {
      const trojans = nonVirusTrojans(ctx.state);
      if (e.side === 'runner' && trojans.length > 0) {
        urbanArtFlow.ask(ctx, 'grip', cardsQuestion('runner', 'Urban Art Vernissage: you may add 1 installed non-virus trojan to your grip to place 2 [credit] here.', ids(trojans), 0, 1));
      }
    },
  },
  ...urbanArtFlow.script,
};

// Arruaceiras Crew (Connection - Seedy): Once per turn -> Take 1 tag: The ice you are encountering
// gets -2 strength for the remainder of this encounter. [trash], 2 credits: Trash the ice you are
// encountering if its strength is 0 or less.
const ARRUACEIRAS = 'arruaceiras';

export const arruaceiras: CardScript = {
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
export const friendOfAFriend: CardScript = {
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
export const manuelLattes: CardScript = {
  modifiers: {
    breachAccesses: (state, _self, serverId) => ((serverId === 'hq' || serverId === 'rd') && state.runner.tags > 0 ? 1 : 0),
    resourceTrashHqCost: (state, self, resource) => (resource.instanceId === self.instanceId && threatLevel(state) >= 3 ? 1 : 0),
  },
};

// --- Rebellion Without Rehearsal: Criminal --------------------------------------------------

// Amelia Earhart (Virtual - Companion): Whenever a run on HQ or R&D ends, if you accessed 3 or more
// cards during that run, place 1 power counter on this resource. When your turn begins, you may
// remove 3 hosted power counters and trash this resource. If you do, the Corp loses 10 credits.
const ameliaFlow = prompts({
  use: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || counters(card, 'power') < 3 || !isInstalled(state, card)) return;
    trashInstalledRunnerCard(state, card);
    const lost = loseCredits(state, 'corp', 10);
    addLog(state, 'runner', `The Corp lost ${lost} [credit] (Amelia Earhart).`);
  }),
});

export const amelia: CardScript = {
  triggers: {
    run_ends: (ctx, e) => {
      if ((e.server === 'hq' || e.server === 'rd') && e.accessedCount >= 3) place(ctx.card, 'power', 1);
    },
    turn_begins: (ctx, e) => {
      if (e.side === 'runner' && counters(ctx.card, 'power') >= 3) {
        ameliaFlow.ask(ctx, 'use', choiceQuestion('runner', 'Amelia Earhart: remove 3 power counters and trash it to make the Corp lose 10 [credit]?', yesNo('Do it')));
      }
    },
  },
  ...ameliaFlow.script,
};

// Juli Moreira Lee: When you install this resource, load 4 power counters onto it. When it is empty,
// trash it. The first time each turn you take an action on an installed resource, remove 1 hosted
// power counter and gain [click].
const actionOnResource = (state: GameState, e: { card: CardInstance; clicks: number }) =>
  e.clicks > 0 && (state.runner.rig.resources.includes(e.card) || state.runner.heap.includes(e.card)) && type(e.card) === 'resource' && runnerTurn(state);

export const juli: CardScript = {
  firstEachTurn: { ability_used: actionOnResource },
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 4),
    ability_used: (ctx, e) => {
      const { state, card } = ctx;
      if (!actionOnResource(state, e) || !firstThisTurn(state, card) || counters(card, 'power') === 0) return;
      state.runner.clicks += 1;
      addLog(state, 'runner', 'Runner gained [click] (Juli Moreira Lee).');
      spendLoad(state, card);
    },
  },
};

// --- Rebellion Without Rehearsal: Shaper ----------------------------------------------------

// "Pretty" Mary da Silva (Connection - Seedy): Whenever you breach R&D, if you are allowed to access 2
// or more cards in R&D during this breach, you may access 1 additional card. Asked once the other
// access counts are known, as the breach begins.
const maryFlow = prompts({
  extra: choice(({ state }, a) => {
    const breach = state.activeRun?.breach;
    if (a.optionId !== 'yes' || !breach || breach.zone !== 'rd') return;
    breach.zoneLeft += 1;
    addLog(state, 'runner', 'Runner accesses 1 additional card in R&D ("Pretty" Mary da Silva).');
  }),
});

export const prettyMary: CardScript = {
  triggers: {
    breach_begins: (ctx, e) => {
      const breach = ctx.state.activeRun?.breach;
      if (e.server !== 'rd' || !breach || breach.zone !== 'rd' || breach.zoneLeft < 2) return;
      maryFlow.ask(ctx, 'extra', choiceQuestion('runner', '"Pretty" Mary da Silva: access 1 additional card in R&D?', yesNo('Access 1 more')));
    },
  },
  ...maryFlow.script,
};

// Valentina Ferreira Carvalho: Whenever you remove 1 or more tags, gain 1 credit. Threat 3 -> When
// you install this resource during your turn, you may remove 1 tag or gain 2 credits.
const valentinaFlow = prompts({
  install: choice(({ state }, a) => {
    if (a.optionId === 'tag') removeTags(state, 1);
    else if (a.optionId === 'credits') gainCredits(state, 'runner', 2);
  }),
});

export const valentina: CardScript = {
  triggers: {
    tags_removed: ({ state }) => {
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Valentina Ferreira Carvalho).');
    },
    installed: (ctx, e) => {
      if (!isSelf(ctx, e.card) || !runnerTurn(ctx.state) || threatLevel(ctx.state) < 3) return;
      valentinaFlow.ask(
        ctx,
        'install',
        choiceQuestion('runner', 'Valentina Ferreira Carvalho: remove 1 tag or gain 2 [credit]?', [
          ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : []),
          { id: 'credits', label: 'Gain 2 [credit]' },
          { id: 'no', label: 'Neither' },
        ]),
      );
    },
  },
  ...valentinaFlow.script,
};

export const liberationRunnerResourcesScripts: Record<string, CardScript> = {
  '34007': eru,
  '34008': hannah,
  '34009': lagoParanoa,
  '34019': debbie,
  '34028': beatriz,
  '34029': urbanArt,
  '34073': arruaceiras,
  '34074': friendOfAFriend,
  '34075': manuelLattes,
  '34083': amelia,
  '34084': juli,
  '34093': prettyMary,
  '34095': valentina,
};
