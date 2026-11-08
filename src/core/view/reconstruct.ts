/**
 * A GameState rebuilt from one player's view (multiplayer phase 1, chunk 2).
 *
 * The table's components and display helpers read GameState. Rather than
 * rewrite them all against the GameView types, the screen gets this
 * reconstruction: it is built only from the view, so it cannot hold anything
 * the view doesn't (the leak fuzzer checks views; scripts/leak-check.ts also
 * checks these). Own cards and public numbers are exact. Cards the viewer may
 * not see become placeholders (HIDDEN_CORP / HIDDEN_RUNNER in cards.ts):
 *
 * - the opponent's hand, both decks, and facedown Archives seen by the Runner
 *   are `count` placeholders with ids like `hidden-hq-0` (rules 4.2.2, 4.3.2, 4.4.6c);
 * - a facedown installed Corp card keeps its viewer id and gets HIDDEN_CORP (4.6.2);
 * - cards still to be accessed are placeholders (`accessQueueCount`).
 *
 * A card the viewer's own prompt shows from a hidden zone (the card being
 * accessed, the top of R&D) takes the place of a placeholder in the zone it is
 * most likely in, so the prompt's helpers can find it.
 *
 * Engine internals the view drops get dummy values (rng, counters). Legality
 * must never be worked out on a reconstruction except for the seat's own-side
 * probes (src/ui/table.ts): the opponent's hidden cards are not in it.
 */
import { HIDDEN_CORP, HIDDEN_RUNNER, getCardDefinition, isHiddenCode } from '../cards';
import type { CardInstance, SideCode } from '../types/card';
import type { CorpState, EncounterState, GameState, LogEntry, PriorityWindow, RunState, RunnerState, ServerState } from '../types/state';
import type { EffectSource, Prompt } from '../types/prompts';
import type { CardView, GameView, MyPromptView, RunView } from '../view';

const hiddenCode = (side: SideCode) => (side === 'corp' ? HIDDEN_CORP : HIDDEN_RUNNER);

/** A placeholder for a card nobody at this screen may see. */
function placeholder(id: string, side: SideCode): CardInstance {
  return { instanceId: id, cardCode: hiddenCode(side), isRezzed: false, advancementCounters: 0, tokens: {}, hostedCardIds: [] };
}

const placeholders = (prefix: string, count: number, side: SideCode): CardInstance[] =>
  Array.from({ length: count }, (_, i) => placeholder(`hidden-${prefix}-${i}`, side));

/** A card from the view; `side` names the placeholder used when its face is hidden. */
function fromCard(v: CardView, side: SideCode): CardInstance {
  return {
    instanceId: v.instanceId,
    cardCode: v.cardCode ?? hiddenCode(side),
    isRezzed: v.isRezzed,
    advancementCounters: v.advancementCounters,
    tokens: { ...v.tokens },
    hostedCardIds: [...v.hostedCardIds],
    ...(v.hostedOnId !== undefined && { hostedOnId: v.hostedOnId }),
    ...(v.installedTurn !== undefined && { installedTurn: v.installedTurn }),
    ...(v.flipped !== undefined && { flipped: v.flipped }),
    ...(v.faceUp && { faceUp: true }),
    ...(v.runnerKnows && { runnerKnows: true }),
    ...(v.hostedCards && { hostedCards: v.hostedCards.map(h => fromCard(h, side)) }),
    ...(v.asAgendaPoints !== undefined && { asAgendaPoints: v.asAgendaPoints }),
    ...(v.scoredTurn !== undefined && { scoredTurn: v.scoredTurn }),
    ...(v.chosenSubtypes && { chosenSubtypes: [...v.chosenSubtypes] }),
    ...(v.cannotScoreTurn !== undefined && { cannotScoreTurn: v.cannotScoreTurn }),
  };
}

const cardsOf = (list: CardView[], side: SideCode) => list.map(c => fromCard(c, side));

function prompt(p: MyPromptView): Prompt {
  const base = { id: p.id, side: p.side, message: p.message };
  const source = (): EffectSource => ({
    cardCode: p.source?.cardCode ?? '',
    instanceId: p.source?.instanceId ?? '',
    step: p.source?.step ?? '',
    // The view sends only what the table needs of the engine's data (view.ts MyPromptView)
    ...(p.installs && { data: { install: true, ...(p.installCardId !== undefined && { cardId: p.installCardId }) } }),
  });
  switch (p.kind) {
    case 'mulligan':
      return { ...base, kind: 'mulligan' };
    case 'discard':
      return { ...base, kind: 'discard', count: p.count ?? 0 };
    case 'access_trash':
      return {
        ...base,
        kind: 'access_trash',
        cardInstanceId: p.cardInstanceId ?? '',
        trashCost: p.trashCost ?? null,
        ...(p.alternatives && { alternatives: p.alternatives.map(a => ({ ...a })) }),
      };
    case 'access_order':
      return { ...base, kind: 'access_order', options: (p.options ?? []).map(o => ({ ...o })) };
    case 'effect_choice':
      return { ...base, kind: 'effect_choice', options: (p.options ?? []).map(o => ({ ...o })), source: source() };
    case 'effect_cards':
      return { ...base, kind: 'effect_cards', candidateIds: [...(p.candidateIds ?? [])], min: p.min ?? 0, max: p.max ?? 0, source: source() };
  }
}

function run(v: RunView): RunState {
  const e = v.encounter;
  const encounter: EncounterState | null = e && {
    iceId: e.iceId ?? '',
    broken: [...e.broken],
    boosts: { ...e.boosts },
    resolvingIndex: e.resolvingIndex,
    ...(e.onEncounterPending !== undefined && { onEncounterPending: e.onEncounterPending }),
    iceStrengthModifier: e.iceStrengthModifier,
    ...(e.grantedSubs && { grantedSubs: e.grantedSubs.map(g => ({ ...g })) }),
    ...(e.fullyBroken !== undefined && { fullyBroken: e.fullyBroken }),
    ...(e.brokenBy && { brokenBy: { ...e.brokenBy } }),
    ...(e.cannotEndRun !== undefined && { cannotEndRun: e.cannotEndRun }),
    ...(e.flags && { flags: { ...e.flags } }),
  };
  const { accessQueueCount, breach, encounter: _e, ...rest } = v;
  void _e;
  return {
    ...structuredClone(rest),
    accessQueue: Array.from({ length: accessQueueCount }, (_, i) => `hidden-access-${i}`),
    encounter,
    ...(breach && {
      breach: {
        root: [...breach.root],
        zone: breach.zone,
        zoneLeft: breach.zoneLeft,
        chosen: Array.from({ length: breach.chosenCount }, (_, i) => `hidden-chosen-${i}`),
      },
    }),
    runEffects: v.runEffects.map(x => ({ cardCode: x.cardCode, instanceId: x.instanceId ?? '' })),
  } as RunState;
}

/** Puts a card shown by a prompt in place of a placeholder in `zone` (from the top); false if there is none. */
function place(zone: CardInstance[], card: CardInstance): boolean {
  const i = zone.findIndex(c => c.instanceId.startsWith('hidden-'));
  if (i < 0) return false;
  zone[i] = card;
  return true;
}

/** Every card id in the rebuilt state, hosted cards included. */
function allIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  const add = (c: CardInstance) => {
    ids.add(c.instanceId);
    c.hostedCards?.forEach(add);
  };
  const { corp, runner } = state;
  [corp.identity, runner.identity].forEach(add);
  for (const s of Object.values(corp.servers)) [...s.ice, ...s.root].forEach(add);
  for (const list of [corp.hq, corp.rd, corp.archives.faceUp, corp.archives.faceDown, corp.scoreArea, runner.grip, runner.stack, runner.heap, runner.rig.programs, runner.rig.hardware, runner.rig.resources, runner.scoreArea, state.removedFromGame]) list.forEach(add);
  return ids;
}

/** The GameState the screen shows for `view`. Built from the view alone. */
export function stateFromView(view: GameView): GameState {
  const me = view.viewer;
  const vc = view.corp;
  const vr = view.runner;
  const servers: Record<string, ServerState> = {};
  for (const [key, s] of Object.entries(vc.servers)) {
    servers[key] = { id: s.id, name: s.name, isRemote: s.isRemote, ice: cardsOf(s.ice, 'corp'), root: cardsOf(s.root, 'corp') };
  }
  const corp: CorpState = {
    credits: vc.credits,
    clicks: vc.clicks,
    maxClicks: vc.maxClicks,
    badPublicity: vc.badPublicity,
    handSizeLimit: vc.handSizeLimit,
    scoreArea: cardsOf(vc.scoreArea, 'corp'),
    score: vc.score,
    identity: fromCard(vc.identity, 'corp'),
    hq: me === 'corp' ? cardsOf(vc.hq.cards, 'corp') : placeholders('hq', vc.hq.count, 'corp'),
    rd: placeholders('rd', vc.rd.count, 'corp'),
    archives: {
      faceUp: cardsOf(vc.archives.faceUp, 'corp'),
      faceDown: me === 'corp' ? cardsOf(vc.archives.faceDown.cards, 'corp') : placeholders('archives', vc.archives.faceDown.count, 'corp'),
    },
    servers,
    remoteCounter: vc.remoteCounter,
    ...(vc.bonusClicksNextTurn !== undefined && { bonusClicksNextTurn: vc.bonusClicksNextTurn }),
    ...(vc.meliesServer && { meliesServer: vc.meliesServer }),
    ...(vc.hq.known.length > 0 && { knownToRunner: vc.hq.known.map((code, i) => ({ id: `known-hq-${i}`, code })) }),
    ...(vc.rd.known?.length && {
      rdKnownToRunner: vc.rd.known.map((k, i) => ({ id: `known-rd-${i}`, code: k.code, lo: k.lo, hi: k.hi, ...(k.left && { left: k.left }) })),
    }),
  };
  const runner: RunnerState = {
    credits: vr.credits,
    clicks: vr.clicks,
    maxClicks: vr.maxClicks,
    tags: vr.tags,
    coreDamage: vr.coreDamage,
    memoryUnitsTotal: vr.memoryUnitsTotal,
    memoryUnitsUsed: vr.memoryUnitsUsed,
    handSizeLimit: vr.handSizeLimit,
    scoreArea: cardsOf(vr.scoreArea, 'corp'),
    score: vr.score,
    identity: fromCard(vr.identity, 'runner'),
    grip: me === 'runner' ? cardsOf(vr.grip.cards, 'runner') : placeholders('grip', vr.grip.count, 'runner'),
    stack: placeholders('stack', vr.stack.count, 'runner'),
    heap: cardsOf(vr.heap, 'runner'),
    rig: { programs: cardsOf(vr.rig.programs, 'runner'), hardware: cardsOf(vr.rig.hardware, 'runner'), resources: cardsOf(vr.rig.resources, 'runner') },
    ...(vr.grip.known.length > 0 && { knownToCorp: vr.grip.known.map((code, i) => ({ id: `known-grip-${i}`, code })) }),
    ...(vr.bonusClicksNextTurn !== undefined && { bonusClicksNextTurn: vr.bonusClicksNextTurn }),
  };

  let priority: PriorityWindow | null | undefined = view.priority as PriorityWindow | null | undefined;
  if (view.priority) priority = { ...view.priority, ...(view.priority.intent && { intent: structuredClone(view.priority.intent) }) };

  const log: LogEntry[] = view.log.map(e => ({
    id: e.id,
    turnNumber: e.turnNumber,
    player: e.player,
    message: e.message,
    ...(e.cardCode !== undefined && { cardCode: e.cardCode }),
    ...(e.event && { event: e.event }),
  }));

  const state: GameState = {
    id: view.id,
    rng: { seed: 0, state: 0 },
    nextInstanceId: 0,
    pendingPrompts: view.pendingPrompts.map(prompt),
    nextPromptId: 0,
    runsThisTurn: view.runsThisTurn.map(x => ({ ...x })),
    runnerLastTurnRuns: view.runnerLastTurnRuns.map(x => ({ ...x })),
    ...(view.runnerLastTurnStoleOrTrashed !== undefined && { runnerLastTurnStoleOrTrashed: view.runnerLastTurnStoleOrTrashed }),
    turnFlags: { ...view.turnFlags },
    removedFromGame: cardsOf(view.removedFromGame, 'corp'),
    ...(view.turnStep !== undefined && { turnStep: view.turnStep && { ...view.turnStep } }),
    ...(priority !== undefined && { priority }),
    ...(view.stops && { stops: { ...view.stops } }),
    turnNumber: view.turnNumber,
    activePlayer: view.activePlayer,
    phase: view.phase,
    corp,
    runner,
    activeRun: view.activeRun && run(view.activeRun),
    winner: view.winner,
    winReason: view.winReason,
    log,
  };

  // Cards the viewer's prompts show from hidden zones: in place of a placeholder where they most likely are.
  // A Corp card the Runner sees is being accessed from HQ or R&D (the breach says which); one the Corp sees is
  // in R&D (HQ and Archives are open to it). A Runner card the Corp sees is in the grip; one the Runner sees, in the stack.
  const present = allIds(state);
  for (const p of view.pendingPrompts) {
    for (const c of p.cards) {
      if (present.has(c.instanceId) || !c.cardCode) continue;
      const corpCard = !isHiddenCode(c.cardCode) && isCorpCode(c.cardCode);
      const zone = corpCard
        ? me === 'runner' && state.activeRun?.breach?.zone === 'hq'
          ? corp.hq
          : me === 'runner' && state.activeRun?.breach?.zone === 'archives'
            ? corp.archives.faceDown
            : corp.rd
        : me === 'corp'
          ? runner.grip
          : runner.stack;
      if (place(zone, fromCard(c, corpCard ? 'corp' : 'runner'))) present.add(c.instanceId);
    }
  }
  return state;
}

/** The side a prompt's card belongs to (viewer ids don't say). */
function isCorpCode(code: string): boolean {
  try {
    return getCardDefinition(code).side_code === 'corp';
  } catch {
    return false;
  }
}
