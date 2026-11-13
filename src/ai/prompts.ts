import { CardInstance, GameAction, GameState, Prompt, SideCode, activePrompt, cardDef, executeAction, findCardAnywhere, getCardDefinition, getLegalActions, isLegalAction, knownInHand } from '../core';
import { runnerInstallBlocker, runnerInstallCost } from '../core/engine/actions/install';
import { evaluate, keepValue, rigCoverage, runnerRigValue } from './evaluate';
import { bakerWantsFuel, principiaFuel } from './cardPlans';
import { CARDS } from './cards';
import { CLICK, cardRate } from './valueModel';
import { PACE, accessWorth, placedCounterWorth } from './effectValues';
import { turnsLeft } from './cardProfiles';
import { BLOCK, BOTULUS, MANEGARM, RunOptions, RunnerMemory, iceCost, runClick, runRestWorth, runScore, serverValue, spendCost, subroutineCost, tagCost, weakestIce, windowDerez } from './runs';
import { breakerScript, encounteredIce, iceSubroutines, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { keepBonus, tuning } from './synergy';
import { freeInstallTarget, perfectRecallTarget } from './corpAI';
import { iceStop, iceWorth } from './iceValues';
import { rezCost } from '../core/engine/cardEffects';
import { isPsiStep } from '../core/scripts/effects';
import { plan } from './pricing';

/** Applies an action, or returns null if the engine rejects it. */
export function simulate(state: GameState, action: GameAction): GameState | null {
  try {
    return executeAction(state, action);
  } catch {
    return null;
  }
}

const hand = (state: GameState, side: SideCode) => (side === 'corp' ? state.corp.hq : state.runner.grip);
/** How much a side wants to keep a card, plus (deck-aware AI) how well it fits the deck's plan. */
const keep = (state: GameState, card: CardInstance, synergy: boolean) => keepValue(state, card) + (synergy ? keepBonus(state, card) : 0);
/** The card was on top of R&D or the stack before (so it was drawn, not fetched by name). */
const fromDeck = (state: GameState, side: SideCode, card: CardInstance) =>
  (side === 'corp' ? state.corp.rd : state.runner.stack).some(c => c.instanceId === card.instanceId);
const sumKeep = (state: GameState, cards: CardInstance[], synergy: boolean) => cards.reduce((n, c) => n + keep(state, c, synergy), 0);

/**
 * Position value after an answer, from `side`'s point of view. Beyond the
 * board evaluation it counts which cards are in hand (so the AI discards
 * its least useful cards) and, for the Runner, the run still in progress.
 */
export function scoreOutcome(before: GameState, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): number {
  let score = evaluate(after, side);
  // Cards that came from the deck are unknown until drawn: only the cards that left the hand count (plan.blindDraws)
  const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);
  score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));
  if (side === 'runner' && before.activeRun) {
    score += 0.8 * runRestWorth(after, memory, synergy && tuning.wary);
  }
  return score;
}

function answers(state: GameState, side: SideCode, synergy = false): GameAction[] {
  const legal = getLegalActions(state, side).filter(a => a.type === 'RESOLVE_PROMPT').slice(0, 200);
  const iceTrash = synergy;
  return [...legal, ...legal.flatMap(a => makeRoomAnswers(state, a)), ...(iceTrash ? iceTrashAnswers(state) : [])];
}

/**
 * A Corp effect installing ice (Mercia B4LL4RD, Ansel 1.0): also answer
 * each server by trashing its weakest rezzed ice first (rules 8.5.6b),
 * which can make a server affordable. The outcome decides.
 */
export function iceTrashAnswers(state: GameState): GameAction[] {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'corp' || prompt.kind !== 'effect_choice' || !prompt.source.data?.install) return [];
  const card = findCardAnywhere(state, String(prompt.source.data.cardId));
  if (!card || cardDef(card).type_code !== 'ice') return [];
  return prompt.options.flatMap(o => {
    const weak = o.id === 'new' ? undefined : weakestIce(state, o.id);
    if (!weak) return [];
    const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: o.id, trashFirst: [weak.instanceId] } };
    return isLegalAction(state, action) ? [action] : [];
  });
}

/**
 * A Runner effect installing a program that only fits once installed
 * programs are trashed (rules 8.5.6c): the same answer, trashing one
 * program (or two, if one isn't enough) first.
 */
export function makeRoomAnswers(state: GameState, action: GameAction): GameAction[] {
  if (action.type !== 'RESOLVE_PROMPT' || action.player !== 'runner') return [];
  const prompt = activePrompt(state);
  if (!prompt || (prompt.kind !== 'effect_cards' && prompt.kind !== 'effect_choice') || !prompt.source.data?.install) return [];
  const choice = action.choice;
  const cardId = choice.kind === 'effect_cards' ? choice.cardInstanceIds[0] : choice.kind === 'effect_choice' && choice.optionId === 'install' ? String(prompt.source.data.cardId) : undefined;
  const card = cardId ? findCardAnywhere(state, cardId) : undefined;
  if (!card || cardDef(card).type_code !== 'program' || !runnerInstallBlocker(state, card)) return [];
  const programs = state.runner.rig.programs.map(c => c.instanceId);
  const singles = programs.map(id => [id]);
  const pairs = programs.flatMap((a, i) => programs.slice(i + 1).map(b => [a, b]));
  for (const options of [singles, pairs]) {
    // Each answer that installs the program
    const installs = options
      .map(trashFirst => ({ ...action, choice: { ...choice, trashFirst } }) as GameAction)
      .filter(a => {
        const after = simulate(state, a);
        return !!after && after.runner.rig.programs.some(c => c.instanceId === card.instanceId);
      });
    if (installs.length > 0) return installs;
  }
  return [];
}

function mulligan(state: GameState, prompt: Prompt, synergy: boolean): boolean {
  const cards = hand(state, prompt.side);
  // (Jeff) a Corp hand needs ice it can rez early (on 5 credits, with a credit to spare), not just any ice
  if (prompt.side === 'corp') return !cards.some(c => cardDef(c).type_code === 'ice' && (!synergy || (cardDef(c).cost ?? 0) <= 4));
  const useful = cards.some(c => /icebreaker/i.test(cardDef(c).keywords ?? '') || /gain \d+|load \d+/i.test(cardDef(c).stripped_text ?? ''));
  return !useful;
}

/** The server option ids of a "run any server" choice, if this prompt is one. */
function serverOptions(state: GameState, prompt: Prompt): string[] | null {
  if (prompt.kind !== 'effect_choice') return null;
  const ids = prompt.options.map(o => o.id);
  return ids.length > 0 && ids.every(id => state.corp.servers[id]) ? ids : null;
}

/**
 * A bad publicity the Runner gives the Corp: a credit on each run for the rest of the game
 * (rules 10.6), or the Corp derezzing ice instead (Kompromat), whichever is cheaper for it.
 */
export function badPublicityWorth(state: GameState): number {
  return Math.min(3, 0.8 * PACE.runs * turnsLeft(state));
}

/**
 * A run card's riders, by the code of the card that starts the run (run events, Red Team, Conduit,
 * Baker, Eru...): each card's `run` entry in src/ai/cards/ (2026-11-05, moved from a switch here so a
 * card's worth and its run live in one place; tests/useAudit.test.ts checks every run card has one).
 */
export function runEventOptions(cardCode: string, state?: GameState): RunOptions {
  return CARDS[cardCode]?.run?.(state) ?? {};
}

/** Picks an answer to the active prompt, which belongs to `side`. */
export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const prompt = activePrompt(state)!;
  const base = { type: 'RESOLVE_PROMPT' as const, player: side, promptId: prompt.id };

  if (prompt.kind === 'mulligan') {
    return { ...base, choice: { kind: 'mulligan', mulligan: mulligan(state, prompt, synergy) } };
  }
  // Psi Game (Liberation): a secret bid from a mixed strategy, never from the other side's bid
  if (prompt.kind === 'effect_choice' && isPsiStep(prompt.source.step)) {
    return { ...base, choice: { kind: 'effect_choice', optionId: psiBid(state, side, prompt.options.map(o => o.id)) } };
  }
  // Liberation "may" effects the AI always takes: Salvo Testing's core damage, Strike Fund's 2 credits,
  // "Pretty" Mary's extra R&D card, and every Meeting of Minds card revealed for a credit
  if (prompt.kind === 'effect_choice' && ((prompt.source.cardCode === '34031' && prompt.source.step === 'damage') || (prompt.source.cardCode === '34001' && prompt.source.step === 'trashed') || (prompt.source.cardCode === '34093' && prompt.source.step === 'extra'))) {
    return { ...base, choice: { kind: 'effect_choice', optionId: 'yes' } };
  }
  // AirbladeX: prevent all the net damage it can, but keep the last counter (and the card) when 1 damage would only cost a card from a full grip.
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.step === 'prevent_damage') {
    const most = Math.max(...prompt.options.map(o => Number(o.id)));
    const counters = findCardAnywhere(state, prompt.source.instanceId)?.tokens.power ?? 0;
    const save = Number(prompt.source.data?.amount) === 1 && counters === 1 && state.runner.grip.length >= 5;
    return { ...base, choice: { kind: 'effect_choice', optionId: String(save ? 0 : most) } };
  }
  if (prompt.kind === 'effect_cards' && prompt.source.cardCode === '34076' && prompt.source.step === 'reveal') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: prompt.candidateIds } };
  }
  // Lycian Multi-Munition: the subtypes the Runner has no breaker for; all three when it covers them all
  // (more subroutines), or when an AI breaker breaks anything anyway
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34100' && prompt.source.step === 'subtypes') {
    const { covered, anyBreakers } = rigCoverage(state.runner.rig.programs);
    const open = anyBreakers > 0 ? [] : ['barrier', 'code gate', 'sentry'].filter(t => !covered.has(t));
    const id = open.length === 0 ? 'all' : open.join('+');
    return { ...base, choice: { kind: 'effect_choice', optionId: prompt.options.some(o => o.id === id) ? id : 'all' } };
  }
  // Balanced Coverage: name the commonest non-agenda type left in R&D (the Corp knows its deck, not the order);
  // reveal it for the 2 credits (an agenda would never be named, so revealing tells the Runner little)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34050') {
    if (prompt.source.step === 'reveal') return { ...base, choice: { kind: 'effect_choice', optionId: 'yes' } };
    if (prompt.source.step === 'type') {
      const counts = new Map<string, number>();
      for (const c of state.corp.rd) {
        const t = cardDef(c).type_code;
        if (t !== 'agenda') counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { ...base, choice: { kind: 'effect_choice', optionId: best && prompt.options.some(o => o.id === best) ? best : 'no' } };
    }
  }
  // Cohort Guidance Program: with 2 or more cards in HQ, swap the least useful for 2 credits and a draw
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34108' && prompt.source.step === 'mode') {
    const trash = state.corp.hq.length >= 2 && prompt.options.some(o => o.id === 'trash');
    return { ...base, choice: { kind: 'effect_choice', optionId: trash ? 'trash' : 'no' } };
  }
  // Synapse Global: a free install from HQ, judged like the Corp's own install choice; never an agenda,
  // which it would reveal (plan.freeInstallPick, bug report #13)
  if (side === 'corp' && (prompt.kind === 'effect_cards' || prompt.kind === 'effect_choice') && prompt.source.cardCode === SYNAPSE) {
    const servers = [...Object.keys(state.corp.servers), 'new'];
    if (prompt.kind === 'effect_cards' && prompt.source.step === 'pick') {
      const picks = prompt.candidateIds
        .map(id => findCardAnywhere(state, id))
        .filter((c): c is CardInstance => !!c && cardDef(c).type_code !== 'agenda')
        .map(c => ({ c, score: freeInstallTarget(state, c, servers)?.score ?? -Infinity }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score);
      return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: picks.length > 0 ? [picks[0].c.instanceId] : [] } };
    }
    const card = prompt.kind === 'effect_choice' && prompt.source.data?.install ? findCardAnywhere(state, String(prompt.source.data.cardId)) : undefined;
    const target = card && prompt.kind === 'effect_choice' ? freeInstallTarget(state, card, prompt.options.map(o => o.id)) : undefined;
    if (target) return { ...base, choice: { kind: 'effect_choice', optionId: target.server } };
  }
  // Warm Reception, Janaína, Humanoid Resources (its two installs, 35039): a free install from HQ; ice the Corp can
  // afford first, then an asset or upgrade, never an agenda
  if (side === 'corp' && prompt.kind === 'effect_cards' && ((['34098', '34115'].includes(prompt.source.cardCode) && prompt.source.step === 'pick') || (prompt.source.cardCode === '35039' && prompt.source.step === 'install_pick'))) {
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);
    const ice = cards.filter(c => cardDef(c).type_code === 'ice' && (cardDef(c).cost ?? 0) <= state.corp.credits).sort((a, b) => (cardDef(b).cost ?? 0) - (cardDef(a).cost ?? 0));
    const root = cards.filter(c => ['asset', 'upgrade'].includes(cardDef(c).type_code) && (cardDef(c).cost ?? 0) <= state.corp.credits);
    const pick = ice[0] ?? root[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: pick ? [pick.instanceId] : [] } };
  }
  // Liberation install effects placing an agenda: into the best-iced empty remote, not a bare new one
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.data?.install && LIB_INSTALLERS.includes(prompt.source.cardCode)) {
    const card = findCardAnywhere(state, String(prompt.source.data.cardId));
    if (card && cardDef(card).type_code === 'agenda') {
      const remote = safeAgendaRemote(state, prompt.options.map(o => o.id));
      if (remote) return { ...base, choice: { kind: 'effect_choice', optionId: remote } };
    }
  }
  // Epiphany Analytica: of the top 3 of R&D, ice or an asset or upgrade; an agenda only with an iced empty remote to put it in
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '34048' && prompt.source.step === 'pick') {
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);
    const agenda = safeAgendaRemote(state, Object.keys(state.corp.servers)) ? cards.find(c => cardDef(c).type_code === 'agenda') : undefined;
    const ice = cards.find(c => cardDef(c).type_code === 'ice' && (cardDef(c).cost ?? 0) <= state.corp.credits);
    const root = cards.find(c => ['asset', 'upgrade'].includes(cardDef(c).type_code));
    const pick = agenda ?? ice ?? root;
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: pick ? [pick.instanceId] : [] } };
  }
  // Lightning Laboratory: its one counter rezzes ice free for a turn; spend it on a run that threatens
  // something (HQ, R&D, a remote with cards in it) and on ice that costs at least 3 to rez
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '34097' && prompt.source.step === 'rez') {
    const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
    const threatened = !!server && (server.id === 'hq' || server.id === 'rd' || (server.isRemote && server.root.length > 0));
    const ice = prompt.candidateIds
      .map(id => findCardAnywhere(state, id))
      .filter((c): c is CardInstance => !!c)
      .sort((a, b) => rezCost(state, b) - rezCost(state, a))
      .slice(0, 2);
    const worth = ice.reduce((n, c) => n + rezCost(state, c), 0);
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: threatened && worth >= 3 ? ice.map(c => c.instanceId) : [] } };
  }
  // Lobisomem: break every barrier subroutine the plan chose it for (the largest X offered)
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34090' && prompt.source.step === 'x') {
    return { ...base, choice: { kind: 'effect_choice', optionId: prompt.options[0].id } };
  }
  // Breach order: the cards in the root first, then the central zone, without peeking at what comes up
  if (prompt.kind === 'access_order') {
    return { ...base, choice: { kind: 'access_order', optionId: prompt.options[0].id } };
  }
  if (prompt.kind === 'discard') {
    const cards = [...hand(state, side)].sort((a, b) => keep(state, a, synergy) - keep(state, b, synergy));
    return { ...base, choice: { kind: 'discard', cardInstanceIds: cards.slice(0, prompt.count).map(c => c.instanceId) } };
  }

  const servers = side === 'runner' ? serverOptions(state, prompt) : null;
  if (servers && prompt.kind === 'effect_choice') {
    const scored = servers.map(id => ({ id, score: runScore(state, id, { ...runEventOptions(prompt.source.cardCode, state), memory, wary: synergy && tuning.wary }) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...base, choice: { kind: 'effect_choice', optionId: scored[0].id } };
  }

  // Alarm Clock (plan.bypass): its HQ run when the turn begins, priced with the 2-click bypass of the first ice
  if (side === 'runner' && plan().bypass && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34078' && prompt.source.step === 'run') {
    // The run itself costs no click: runScore charges one, so it comes back
    const go = runScore(state, 'hq', { alarmClock: true, memory, wary: synergy && tuning.wary }) + runClick(state) > 0;
    return { ...base, choice: { kind: 'effect_choice', optionId: go ? 'yes' : 'no' } };
  }

  // Window of Opportunity (plan.bypass): derez the ice that costs the Runner most to get past (runs windowDerez)
  if (side === 'runner' && plan().bypass && prompt.kind === 'effect_cards' && prompt.source.cardCode === '34077' && prompt.source.step === 'derez' && state.activeRun) {
    const pick = windowDerez(state, state.activeRun.server)?.ice.instanceId;
    if (pick && prompt.candidateIds.includes(pick)) return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // Manegarm Skunkworks: pay the cheaper way in if the access is worth it, on the scale runScore planned the run with
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === MANEGARM && state.activeRun) {
    const value = serverValue(state, state.activeRun.server, 0, memory, synergy && tuning.wary);
    const cost: Record<string, number> = { clicks: 2 * runClick(state), pay: spendCost(state, 5) };
    const ways = prompt.options.filter(o => o.id in cost && cost[o.id] < value).sort((a, b) => cost[a.id] - cost[b.id]);
    return { ...base, choice: { kind: 'effect_choice', optionId: ways[0]?.id ?? 'end' } };
  }

  // Baker: turn the run on Archives to whichever of HQ and R&D is worth more, if either beats Archives by the credit
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36015' && prompt.source.step === 'redirect') {
    const value = (id: string) => serverValue(state, id, 0, memory, synergy && tuning.wary) - (id === 'archives' ? 0 : spendCost(state, 1));
    const best = ['hq', 'rd'].sort((a, b) => value(b) - value(a))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: value(best) > value('archives') ? best : 'no' } };
  }

  // The Holo Man (Jeff's Corp game 1, bug report #17: the AI moved it off the remote holding Offworld Office, so it
  // never advanced it): it goes where its 3 counters do most, the server with the agenda they bring closest to scored
  // (one they finish counts its points), and stays put when no server has one (the board score had no sense of it)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34120' && prompt.source.step === 'move') {
    const holo = findCardAnywhere(state, prompt.source.instanceId);
    const here = holo ? Object.values(state.corp.servers).find(v => v.root.some(c => c.instanceId === holo.instanceId))?.id : undefined;
    const pull = (serverId: string) =>
      Math.max(
        0,
        ...(state.corp.servers[serverId]?.root ?? [])
          .filter(c => cardDef(c).type_code === 'agenda')
          .map(c => {
            const cost = cardDef(c).advancement_cost ?? 3;
            const points = cardDef(c).agenda_points ?? 1;
            return c.advancementCounters + 3 >= cost ? points : (0.5 * points * (c.advancementCounters + 3)) / cost;
          })
      );
    let best = { id: 'no', pull: here ? pull(here) : 0 };
    for (const o of prompt.options) if (o.id !== 'no' && pull(o.id) > best.pull) best = { id: o.id, pull: pull(o.id) };
    return { ...base, choice: { kind: 'effect_choice', optionId: best.id } };
  }

  // Méliès U: the secret side is the central the Runner is likeliest to run first (its share of runs), varied by turn so it can't be read
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36036' && prompt.source.step === 'set') {
    return { ...base, choice: { kind: 'effect_choice', optionId: meliesSide(state) } };
  }

  // Caveat Emptor: the board score doesn't see next turn's clicks, so weigh them here: the 4 extra
  // credits are worth a 2-click swing to the Runner only when the Corp is nearly broke
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36032' && prompt.source.step === 'mode') {
    return { ...base, choice: { kind: 'effect_choice', optionId: state.corp.credits < 4 ? 'ten' : 'six' } };
  }

  // Rotary: the board score doesn't see the extra access the tag buys, so weigh it here: take the
  // tag when one more random access is worth more than what the tag costs (cheap for Vic)
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36014' && prompt.source.step === 'breach') {
    return { ...base, choice: { kind: 'effect_choice', optionId: accessWorth(state) > tagCost(state) ? 'tag' : 'no' } };
  }

  // Sourdough Starter (Jeff, 2026-10-30, plan.sourdough)
  if (side === 'runner' && prompt.kind === 'effect_cards') {
    const code = prompt.source.cardCode;
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);
    const weakest = (list: CardInstance[]) => [...list].sort((a, b) => keepValue(state, a) - keepValue(state, b))[0];
    const pick = (card?: CardInstance) => ({ ...base, choice: { kind: 'effect_cards' as const, cardInstanceIds: card ? [card.instanceId] : [] } });
    // Read-Write Share (Jeff): park the weakest card in the grip, or one it can't afford soon (more than
    // about two turns of credit clicks away), for a fresh draw
    if (code === '36022' && prompt.source.step === 'host') {
      const farOff = (c: CardInstance) => (cardDef(c).cost ?? 0) > state.runner.credits + 4;
      return pick([...cards].sort((a, b) => keepValue(state, a) * (farOff(a) ? 0.5 : 1) - keepValue(state, b) * (farOff(b) ? 0.5 : 1))[0]);
    }
    // Methuselah: feed it only dead hardware: a copy of one installed (or a second console), or one it can't afford
    if (code === '36020' && prompt.source.step === 'trash') {
      const rig = state.runner.rig.hardware;
      const dead = cards.filter(c => {
        const def = cardDef(c);
        const console = /console/i.test(def.keywords ?? '');
        return rig.some(h => cardDef(h).title === def.title || (console && /console/i.test(cardDef(h).keywords ?? ''))) || (def.cost ?? 0) > state.runner.credits;
      });
      if (dead.length) return pick(weakest(dead));
      // With Baker out and no stealth credit for it, the weakest hardware is worth turning into its fuel
      // (2 stealth credits, the first a Baker run worth about 2.5: cardPlans.ts)
      const spare = weakest(cards);
      return pick(bakerWantsFuel(state) && spare && keepValue(state, spare) < 2 * 0.9 + 1.6 ? spare : undefined);
    }
    // Knickknack O'Brian: trash only a card that has stopped giving value (its loss to the rig well under the credits and card it pays)
    if (code === '35033' && prompt.source.step === 'trash') {
      const rig = runnerRigValue(state);
      const loss = (c: CardInstance) => {
        const { programs, hardware, resources } = state.runner.rig;
        const without = { programs: programs.filter(x => x !== c), hardware: hardware.filter(x => x !== c), resources: resources.filter(x => x !== c) };
        // Fuel is there to be burnt: its loss is only the coverage it gives
        const lost = rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: without } }) - principiaFuel(state, c);
        if (!isIcebreaker(c)) return lost;
        // A breaker is cheap to lose when it comes back for its install (a copy in the grip, or this one from the
        // heap with Scrounge), and while no rezzed ice it breaks is out (Jeff, 2026-10-30: the Sourdough loop)
        const back = state.runner.grip.some(g => g.cardCode === c.cardCode || g.cardCode === SCROUNGE);
        const reinstall = runnerInstallCost(state, c) + CLICK;
        const needed = breaksRezzedIce(state, c);
        return Math.min(lost, back ? reinstall : Infinity) * (needed ? 1 : 0.5);
      };
      const spent = cards.map(c => ({ c, net: loss(c) - 0.5 * ((cardDef(c).cost ?? 0) + cardRate(state, 'runner')) })).filter(x => x.net < 0).sort((a, b) => a.net - b.net);
      return pick(spent[0]?.c);
    }
  }

  // Perfect Recall: reveal the agenda the Runner is after
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '36035' && prompt.source.step === 'reveal') {
    const pick = perfectRecallTarget(state) ?? prompt.candidateIds[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // Peer Review: keep the best agenda hidden (the Runner already knows the other cards it might
  // hide); with no unknown agenda, the card the Corp most wants to keep. The board score can't
  // see hidden information, so trying each answer would not tell them apart.
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === PEER_REVIEW && prompt.source.step === 'hide') {
    const known = new Set(knownInHand(state, 'corp').map(e => e.id));
    const cards = prompt.candidateIds.map(id => state.corp.hq.find(c => c.instanceId === id)!).filter(Boolean);
    const unknown = cards.filter(c => !known.has(c.instanceId));
    const pool = unknown.length > 0 ? unknown : cards;
    const worth = (c: CardInstance) => (cardDef(c).type_code === 'agenda' ? 100 + (cardDef(c).agenda_points ?? 0) : keep(state, c, synergy));
    const pick = [...pool].sort((a, b) => worth(b) - worth(a))[0]?.instanceId ?? prompt.candidateIds[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // Botulus: break the worst subroutine
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === BOTULUS) {
    const ice = encounteredIce(state);
    const subs = ice ? (iceSubroutines(state, ice)) : [];
    const worst = [...prompt.options].sort((a, b) => subroutineCost(state, subs[Number(b.id)]?.label ?? '') - subroutineCost(state, subs[Number(a.id)]?.label ?? ''))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: worst.id } };
  }

  // IP Enforcement: simulating stops before the agenda leaves the score area, so the try-each
  // search only sees the tags it costs. Take back the most points, then the quickest to re-score.
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35066' && prompt.source.step === 'agenda') {
    const worth = (id: string) => {
      const def = cardDef(state.runner.scoreArea.find(a => a.instanceId === id)!);
      return (def.agenda_points ?? 0) * 10 - (def.advancement_cost ?? 0);
    };
    const best = [...prompt.options].sort((a, b) => worth(b.id) - worth(a.id))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: best.id } };
  }

  // AU Co.: the power counters do nothing else, so 2 cards now beat 2 cards later. (Scored as an outcome
  // the cards drawn count for nothing: plan.blindDraws hides cards from R&D.)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35046' && prompt.source.step === 'use') {
    return { ...base, choice: { kind: 'effect_choice', optionId: 'use' } };
  }

  // Zahya Sadeghi (Jeff): a 1-credit gain waits while 2 clicks are left for another HQ or R&D run
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '30010' && prompt.source.step === 'gain') {
    const wait = Number(prompt.source.data?.credits ?? 0) < 2 && state.runner.clicks >= 2;
    return { ...base, choice: { kind: 'effect_choice', optionId: wait ? 'no' : 'gain' } };
  }

  // Deck-aware AI: PT Untaian's paid advancement goes where it does the most
  if (synergy && side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '35047') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: untaianPick(state, prompt.candidateIds) } };
  }

  // Deck-aware AI: Tāo Salonga moves the hardest ice off the servers worth attacking
  if (synergy && side === 'runner' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '30019') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: taoSwap(state, memory) } };
  }

  // "Any number of cards": build the answer one card at a time
  if (prompt.kind === 'effect_cards' && prompt.max - prompt.min > 2 && prompt.candidateIds.length > 4) {
    return greedyCards(state, side, prompt, base, memory, synergy);
  }

  // Everything else: try each answer and keep the best outcome.
  const options = answers(state, side, synergy);
  let best: GameAction = options[0];
  let bestScore = -Infinity;
  const skip = bypassSkips(state, side, prompt, memory, synergy);
  for (const action of options) {
    const after = simulate(state, action);
    if (!after) continue;
    let score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * A "bypass this ice?" prompt (S-Dobrado, Alarm Clock, Malandragem, Curupira, Laser Pointer,
 * Physarum Entangler, Fransofia Ward; plan.bypass). The board score only sees what the bypass
 * costs (a click, a counter, the card trashed), so an answer that leaves the ice encountered
 * also pays what the encounter costs: its subroutines broken or resolved (rules 6.5.8b), or,
 * when it can't be got past, the run itself (scoreOutcome counts a run still going).
 */
function bypassSkips(state: GameState, side: SideCode, prompt: Prompt, memory?: RunnerMemory, synergy = false): { iceId: string; cost: number } | undefined {
  if (side !== 'runner' || !plan().bypass || prompt.kind !== 'effect_choice' || prompt.source.step !== 'bypass' || !state.activeRun) return undefined;
  const ice = encounteredIce(state);
  if (!ice) return undefined;
  const cost = iceCost(state, ice);
  const run = serverValue(state, state.activeRun.server, 0, memory, synergy && tuning.wary) * 0.8;
  return { iceId: ice.instanceId, cost: cost === BLOCK ? run : spendCost(state, cost) };
}

/**
 * Méliès U's secret side, picked in proportion to the share of runs each
 * central gets in self-play (PACE), from a hash of the game and turn: a
 * fixed pick would let a human read it.
 */
/**
 * Psi Game bid (rules 10.14): neither side may see the
 * other's bid, so the AI mixes. The Corp wants the bids to differ and the
 * Runner wants them to match; with both paying their bid, cheap bids come up
 * more often (0: 45%, 1: 35%, 2: 20%), spread by the game, turn and side so
 * a human can't read it, and never more than the side can pay.
 */
/** Liberation cards whose effects install a card from HQ or R&D (their install-where prompts). */
const LIB_INSTALLERS = ['34037', '34039', '34048', '34062', '34098', '34102', '34115', '34122', '34130'];

/** The remote among these options with the most ice and nothing in its root, for an agenda (undefined: none has ice). */
function safeAgendaRemote(state: GameState, options: string[]): string | undefined {
  return options
    .map(id => state.corp.servers[id])
    .filter(s => !!s && s.isRemote && s.root.length === 0 && s.ice.length > 0)
    .sort((a, b) => b.ice.length - a.ice.length)[0]?.id;
}

export function psiBid(state: GameState, side: SideCode, options: string[]): string {
  const weights: [string, number][] = (
    [['0', 0.45], ['1', 0.35], ['2', 0.2]] as [string, number][]
  ).filter(([id]) => options.includes(id));
  if (weights.length === 0) return options[0];
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let h = 2166136261;
  for (const ch of `${state.id}:${state.turnNumber}:${side}:${state.log.length}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let roll = (((h >>> 0) % 10000) / 10000) * total;
  for (const [id, w] of weights) {
    if (roll < w) return id;
    roll -= w;
  }
  return weights[0][0];
}

export function meliesSide(state: GameState): 'hq' | 'rd' | 'archives' {
  const shares: ['hq' | 'rd' | 'archives', number][] = [['hq', PACE.hqShare], ['rd', PACE.rdShare], ['archives', PACE.archivesShare]];
  const total = shares.reduce((n, [, w]) => n + w, 0);
  let h = 2166136261;
  for (const ch of `${state.id}:${state.turnNumber}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let roll = ((h >>> 0) % 10000) / 10000 * total;
  for (const [id, w] of shares) {
    if (roll < w) return id;
    roll -= w;
  }
  return 'hq';
}

/**
 * PT Untaian: 1 credit for an advancement counter on an unrezzed card. An
 * agenda behind ice gets closer to scoring, a trap hits harder (Urtica
 * Cipher) or reads as an agenda; nothing worth it, or no spare credit: skip.
 */
export function untaianPick(state: GameState, candidateIds: string[]): string[] {
  if (state.corp.credits < 2) return [];
  let best: { id: string; value: number } | null = null;
  for (const server of Object.values(state.corp.servers)) {
    for (const card of [...server.root, ...server.ice]) {
      if (!candidateIds.includes(card.instanceId)) continue;
      const def = cardDef(card);
      // Model: what the counter adds on this card (Pharos and Syailendra use theirs; other ice, little)
      const value =
        def.type_code !== 'ice' ? placedCounterWorth(state, card, server.ice.length > 0) : card.cardCode === '30063' || card.cardCode === '35076' ? 0.5 : 0.3;
      if (!best || value > best.value) best = { id: card.instanceId, value };
    }
  }
  return best && best.value >= 1 ? [best.id] : [];
}

/**
 * Tāo Salonga: the swap of 2 installed ice that most lowers what the
 * Runner pays to get into servers, weighted by what each server is worth
 * running (the same values its run choices use: an agenda remote, then HQ
 * and R&D). None if no swap saves at least about a credit on a key server.
 */
export function taoSwap(state: GameState, memory?: RunnerMemory): string[] {
  const servers = Object.values(state.corp.servers).filter(s => s.ice.length > 0);
  const weight = new Map(servers.map(s => [s.id, Math.max(0.3, serverValue(state, s.id, 0, memory, tuning.wary))]));
  const cost = (ice: CardInstance) => Math.min(iceStop(state), iceCost(state, ice));
  const placed = servers.flatMap(s => s.ice.map(ice => ({ ice, server: s.id })));
  let best: { ids: string[]; gain: number } | null = null;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.server === b.server) continue; // reordering one server rarely matters
      const delta = cost(a.ice) - cost(b.ice); // a moves to b's server and back
      const gain = delta * (weight.get(a.server)! - weight.get(b.server)!);
      if (!best || gain > best.gain) best = { ids: [a.ice.instanceId, b.ice.instanceId], gain };
    }
  }
  return best && best.gain >= 2 ? best.ids : [];
}

/**
 * An answer that opens the same card's next choice (AU Co.: which card to trash; Poétrï and
 * Synapse Global: which server) is judged after the AI answers that too, so the first step of a
 * good ability doesn't look like a loss on its own (plan.promptChains).
 */
function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameState {
  // Identities only: following every card's chain made AI games about 4x slower
  if (!('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') return after;
  let state = after;
  for (let depth = 0; depth < 3; depth++) {
    const next = activePrompt(state);
    if (!next || next.side !== side || !('source' in next) || next.source.instanceId !== prompt.source.instanceId) break;
    const resolved = simulate(state, answerPrompt(state, side, memory, synergy));
    if (!resolved) break;
    state = resolved;
  }
  return state;
}

/** Adds the card that helps most until no card helps (and at least `min` are chosen). */
function greedyCards(
  state: GameState,
  side: SideCode,
  prompt: Extract<Prompt, { kind: 'effect_cards' }>,
  base: { type: 'RESOLVE_PROMPT'; player: SideCode; promptId: string },
  memory?: RunnerMemory,
  synergy = false
): GameAction {
  const answer = (ids: string[]): GameAction => ({ ...base, choice: { kind: 'effect_cards', cardInstanceIds: ids } });
  const value = (ids: string[]) => {
    const after = simulate(state, answer(ids));
    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy) : -Infinity;
  };
  let chosen: string[] = [];
  let current = prompt.min === 0 ? value([]) : -Infinity;
  while (chosen.length < prompt.max) {
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const id of prompt.candidateIds) {
      if (chosen.includes(id)) continue;
      const score = value([...chosen, id]);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (!bestId || (chosen.length >= prompt.min && bestScore <= current)) break;
    chosen = [...chosen, bestId];
    current = bestScore;
  }
  return answer(chosen);
}

const SCROUNGE = '35004';
const PEER_REVIEW = '35055';
const SYNAPSE = '35058';

/** Rezzed ice on the board that `breaker` breaks (all ice for an AI breaker). */
function breaksRezzedIce(state: GameState, breaker: CardInstance): boolean {
  const breaks = breakerScript(breaker)?.breaks;
  if (!breaks) return false;
  return Object.values(state.corp.servers).some(server => server.ice.some(ice => ice.isRezzed && (breaks === 'any' || iceSubtypes(ice, state).includes(breaks))));
}

/**
 * plan.freeRez: an answer that rezzes ice ignoring all costs (Send a Message,
 * Unleash; rules 1.16.5c). Ice the Corp could pay for anyway would have cost
 * its rez: the free rez saves that much, where the board score only sees the
 * ice's worth go from "still to pay for" to rezzed. Ice it couldn't pay for
 * gains its whole worth on the board already. So the free rez goes to the ice
 * that saves the most.
 */
export function freeRezSaving(before: GameState, after: GameState): number {
  if (after.corp.credits < before.corp.credits) return 0;
  let saving = 0;
  for (const server of Object.values(before.corp.servers)) {
    for (const ice of server.ice) {
      if (ice.isRezzed) continue;
      const now = after.corp.servers[server.id]?.ice.find(c => c.instanceId === ice.instanceId);
      if (!now?.isRezzed) continue;
      const cost = rezCost(before, ice);
      if (before.corp.credits < cost) continue;
      saving += Math.max(0, cost - (iceWorth(after, now, 'corp') - iceWorth(before, ice, 'corp')));
    }
  }
  return saving;
}
