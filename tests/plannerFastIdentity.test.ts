import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardInstance, GameState, SideCode, actingSide, cardDef, createInitialGameState, createRng, executeAction, getCardScript, getLegalActions } from '../src/core';
import { breakerScript, breakerStrength, iceScript, iceStrength, iceSubroutines, iceSubtypes } from '../src/core/engine/ice';
import { activeCards } from '../src/core/engine/triggers';
import { BLOCK, creditCost, knownSubroutineCost, tagCost, trashedCardCost } from '../src/ai/runs';
import { coreDamageWorth, damageWorth } from '../src/ai/effectValues';
import { clickRate } from '../src/ai/valueModel';
import { deckGameSetup } from '../src/data/decks';
import { pairing, pickAction } from '../scripts/engine-fuzz-check';
import { fingerprint } from '../src/ai/valueModel';
import { breakerTypeWorth, deckIceShare, iceTypeOdds } from '../src/ai/iceValues';

// Planner speed 1+2 and 3+4 (ai-planner-fast, redesign/planner-fast-step1.md): pure rewrites that must give the same values
// bit for bit. Checked against the code they replaced, copied here, on every state of random legal games.

/** fingerprint as it was before the rewrite (array join). */
function oldFingerprint(state: GameState): string {
  const { corp, runner } = state;
  const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId + (c.isRezzed ? 'r' : '') + (c.hostedCards?.length ?? '')).join(',');
  const servers = Object.values(corp.servers).map(s => s.id + ':' + ids(s.ice) + '/' + ids(s.root)).join(';');
  return [
    state.turnNumber, state.activePlayer, corp.credits, corp.clicks, corp.score, corp.hq.length, corp.rd.length, corp.archives.faceUp.length, corp.archives.faceDown.length,
    runner.credits, runner.clicks, runner.score, runner.tags, runner.grip.length, runner.stack.length, ids(runner.rig.programs), ids(runner.rig.hardware), ids(runner.rig.resources), servers,
  ].join('|');
}

const ICE_TYPES = ['barrier', 'code gate', 'sentry'] as const;
/** iceTypeOdds as it was before the rewrite (keywords read on every call). */
function oldIceTypeOdds(state: GameState): Record<string, number> {
  const deck = deckIceShare(state);
  const shown = [
    ...Object.values(state.corp.servers).flatMap(s => s.ice).filter(c => c.isRezzed),
    ...state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'ice'),
  ];
  const count: Record<string, number> = Object.fromEntries(ICE_TYPES.map(t => [t, 3 * deck[t]]));
  for (const ice of shown) {
    const keywords = (cardDef(ice).keywords ?? '').toLowerCase();
    for (const t of ICE_TYPES) if (keywords.includes(t)) count[t]++;
  }
  const total = ICE_TYPES.reduce((n, t) => n + count[t], 0);
  return Object.fromEntries(ICE_TYPES.map(t => [t, count[t] / total]));
}

/** Every state of a few random legal games (seeded), with rezzed ice now and then so the odds move. */
function randomStates(games: number, steps: number): GameState[] {
  const out: GameState[] = [];
  for (let g = 0; g < games; g++) {
    const { corp, runner } = pairing(g);
    const rng = createRng(4242 + g);
    let state = createInitialGameState(deckGameSetup(900 + g, corp, runner));
    out.push(state);
    for (let i = 0; i < steps && !state.winner; i++) {
      const side = actingSide(state);
      if (!side) break;
      const action = pickAction(getLegalActions(state, side), rng);
      if (!action) break;
      state = executeAction(state, action);
      out.push(state);
    }
  }
  return out;
}

describe('planner speed 1+2: same values as the code replaced', () => {
  const states = randomStates(12, 220);

  it('fingerprint gives the same string as the array join', () => {
    let rezzed = 0;
    for (const s of states) {
      expect(fingerprint(s)).toBe(oldFingerprint(s));
      if (Object.values(s.corp.servers).some(v => v.ice.some(c => c.isRezzed))) rezzed++;
    }
    expect(states.length).toBeGreaterThan(1000);
    expect(rezzed).toBeGreaterThan(0);
  });

  it('iceTypeOdds and breakerTypeWorth (with the odds passed in or not) are unchanged, bit for bit', () => {
    for (const s of states) {
      const odds = iceTypeOdds(s);
      expect(odds).toEqual(oldIceTypeOdds(s));
      for (const t of ICE_TYPES) expect(breakerTypeWorth(s, t, odds)).toBe(breakerTypeWorth(s, t));
    }
  });
});

/** knownSubroutineCost as it was before the rule table (one regex after another on every call). */
function oldKnownSubroutineCost(state: GameState, label: string): number | undefined {
  const runner = state.runner;
  if (/cannot steal or trash/i.test(label)) return BLOCK;
  // Mycoweb: as bad as the worst subroutine on a rezzed ice of that type
  const borrowed = label.match(/resolve 1 subroutine on (?:a|another) rezzed (barrier|code gate|sentry)/i);
  if (borrowed) {
    const type = borrowed[1].toLowerCase();
    const costs = Object.values(state.corp.servers)
      .flatMap(server => server.ice)
      .filter(ice => ice.isRezzed && iceSubtypes(ice, state).some(t => t === type))
      .flatMap(ice => (iceSubroutines(state, ice)).filter(sub => !/resolve 1 subroutine on/i.test(sub.label)))
      .map(sub => oldKnownSubroutineCost(state, sub.label) ?? 2);
    return costs.length > 0 ? Math.max(...costs) : 0;
  }
  // Elevation conditions
  const unless = label.match(/end the run unless the runner suffers (\d+) net damage/i);
  if (unless) return Number(unless[1]) >= runner.grip.length ? BLOCK : 2 * Number(unless[1]);
  const threat = label.match(/threat level is (\d+) or greater, end the run/i);
  if (threat) return Math.max(state.corp.score, runner.score) >= Number(threat[1]) ? BLOCK : 0;
  if (/end the run if the runner is tagged/i.test(label)) return runner.tags > 0 ? BLOCK : 1;
  if (/if the runner has at least 2 tags/i.test(label)) return runner.tags >= 2 ? (2 >= runner.grip.length ? BLOCK : 4) : 0;
  // Vantage Point: "... unless the Runner pays N credits": the cheaper of paying and letting the rest resolve
  const pays = label.match(/^(.*?)\s*unless the runner pays (\d+) (?:\[credit\]|credits?)\.?$/i);
  if (pays) {
    const n = Number(pays[2]);
    const rest = /^end the run$/i.test(pays[1]) ? BLOCK : oldKnownSubroutineCost(state, pays[1]) ?? 2;
    return runner.credits >= n ? Math.min(creditCost(state, n), rest) : rest;
  }
  const jacks = label.match(/^(.*?)\s*unless the runner jacks out\.?$/i);
  if (jacks) return oldKnownSubroutineCost(state, jacks[1]);
  if (/do x net damage and give the runner x tags/i.test(label)) {
    // Vicsek: X is the Runner's tags
    const x = runner.tags;
    if (x === 0) return 0;
    return x >= runner.grip.length ? BLOCK : damageWorth(state, x) + tagCost(state) * x;
  }
  if (/loses? \[click\]/i.test(label)) return clickRate();
  if (/gets \+1 strength for the remainder of this run/i.test(label)) return 1.5; // ezaM: every ice after it costs more to break
  if (/each piece of ice gets \+2 strength for the remainder of this run/i.test(label)) return 2.5; // Tributary: every ice costs more to break
  if (/installed runner card to the grip/i.test(label)) return 0.5 * trashedCardCost(state) + 1; // Lethe: a reinstall, not a loss
  if (/remove 1 card in the heap from the game/i.test(label)) return 0.3;
  if (/place 1 virus counter on this ice/i.test(label)) return 0; // Knowledge Seeker: counts down to its own derez
  if (/look at the top \d+ cards? of r&d|arrange|to the (?:top or )?bottom of r&d|shuffle 1 card from hq or archives into r&d/i.test(label)) return 0.4; // Corp card selection
  if (/core damage/i.test(label)) return coreDamageWorth(state) + damageWorth(state, 1);
  if (/unless they pay 3 credits/i.test(label)) return creditCost(state, 3);
  const loses = label.match(/loses? (\d+) (?:\[credit\]|credits?)/i);
  if (loses) return creditCost(state, Math.min(Number(loses[1]), runner.credits));
  if (/or end the run/i.test(label)) return runner.rig.programs.length > 0 ? 5 : BLOCK;
  if (/odd cost/i.test(label)) return runner.grip.length <= 1 ? BLOCK : 4; // Diviner: half the time it ends the run
  if (/6 credits or less/i.test(label)) return runner.credits - 3 <= 6 ? BLOCK : 0;
  // Liberation conditions
  if (/end the run if you have more credits than the runner/i.test(label)) return state.corp.credits > runner.credits ? BLOCK : 1; // Valentão
  if (/end the run if there are more cards in hq than in the grip/i.test(label)) return state.corp.hq.length > runner.grip.length ? BLOCK : 0; // Piranhas
  if (/trash 1 card from hq to end the run/i.test(label)) return state.corp.hq.length > 0 ? BLOCK : 0; // Boto
  if (/end the run/i.test(label)) return BLOCK;
  const damage = label.match(/(\d+) (net|meat) damage/i);
  if (damage) {
    const n = Number(damage[1]);
    return n >= runner.grip.length ? BLOCK : damageWorth(state, n);
  }
  if (/gain 1 \[credit\] for each tag/i.test(label)) return 0.3 * runner.tags; // Capacitor: Corp credits
  if (/tag/i.test(label)) return tagCost(state);
  if (/trash 1 installed runner card/i.test(label)) return trashedCardCost(state);
  if (/gain 1 credit/i.test(label)) return 0.3;
  if (/gain 1 \[credit\]/i.test(label)) return 0.8; // Flywheel: a credit and maybe a card
  const gains = label.match(/^gain (\d+) \[credit\]/i);
  if (gains) return 0.4 * Number(gains[1]); // Valentão: Corp credits
  // Sorocaban Blade, Hammer, Lycian: a rig card lost, when there is one of that type (with none, the old flat 1.5 below)
  const trashType = label.match(/trash 1 installed (resource|piece of hardware|program)/i);
  if (trashType) {
    const zone = { resource: runner.rig.resources, 'piece of hardware': runner.rig.hardware, program: runner.rig.programs }[trashType[1].toLowerCase() as 'resource'];
    if (zone.length > 0) return trashedCardCost(state);
  }
  if (/^(?:you may )?draw 1 card/i.test(label)) return 0.5; // Empiricist: helps the Corp a little
  if (/install/i.test(label)) return 1.5;
  return undefined;
}

/** activeCards, iceStrength and breakerStrength as they were before eachActiveCard (lists built on every call). */
function oldActiveCards(state: GameState, side?: SideCode): CardInstance[] {
  const corp = (): CardInstance[] => [
    state.corp.identity,
    // Agendas whose printed text installs them faceup are active while installed (rules 3.2.3a)
    ...Object.values(state.corp.servers)
      .flatMap(s => [...s.ice, ...s.root])
      .filter(c => c.isRezzed || (c.faceUp && getCardScript(c.cardCode)?.installFaceUpOnly)),
    // Runner cards added to the Corp's score area as agendas (Word on the Street) are not the Corp's to use
    ...state.corp.scoreArea.filter(c => cardDef(c).side_code === 'corp'),
  ];
  const runner = (): CardInstance[] => {
    const { programs, hardware, resources } = state.runner.rig;
    return [state.runner.identity, ...programs, ...hardware, ...resources];
  };
  if (side === 'corp') return corp();
  if (side === 'runner') return runner();
  return [...corp(), ...runner()];
}

function oldIceStrength(state: GameState, ice: CardInstance): number {
  const run = state.activeRun;
  const encounterMod = run?.encounter?.iceId === ice.instanceId ? run.encounter.iceStrengthModifier : 0;
  const fromCards = oldActiveCards(state).reduce((n, c) => n + (getCardScript(c.cardCode)?.modifiers?.iceStrength?.(state, c, ice) ?? 0), 0);
  const forRun = run?.iceRunStrength?.[ice.instanceId] ?? 0;
  return (cardDef(ice).strength ?? 0) + (iceScript(ice)?.strengthModifier?.(state, ice) ?? 0) + encounterMod + fromCards + (run?.iceStrengthBonus ?? 0) + forRun;
}

function oldBreakerStrength(state: GameState, breaker: CardInstance): number {
  const fromCards = oldActiveCards(state).reduce((n, c) => n + (getCardScript(c.cardCode)?.modifiers?.breakerStrength?.(state, c, breaker) ?? 0), 0);
  const base = (cardDef(breaker).strength ?? 0) + (breakerScript(breaker)?.strengthModifier?.(state, breaker) ?? 0) + fromCards;
  // Hosted hardware (GAMEDRAGON™ Pro) can change strength too
  const hosted = state.runner.rig.hardware
    .filter(h => h.hostedOnId === breaker.instanceId)
    .reduce((n, h) => n + (getCardScript(h.cardCode)?.modifiers?.hostStrength ?? 0), 0);
  const run = state.activeRun;
  return base + hosted + (run?.encounter?.boosts[breaker.instanceId] ?? 0) + (run?.runBoosts?.[breaker.instanceId] ?? 0);
}

describe('planner speed 3+4: same values as the code replaced', () => {
  const states = randomStates(12, 220);
  const labels = [...new Set(ALL_CARDS.flatMap(card => {
    const script = getCardScript(card.code);
    return [...(script?.ice?.subroutines ?? []), ...(script?.grantedSubroutines ?? []).flat()].map(sub => sub.label);
  }))];
  // The board parts the prices read, varied: tags, grip size, credits, an empty rig
  const variants = (s: GameState): GameState[] => [
    s,
    { ...s, runner: { ...s.runner, tags: 2, credits: 0 } },
    { ...s, runner: { ...s.runner, tags: 0, grip: s.runner.grip.slice(0, 1), credits: 12 } },
    { ...s, runner: { ...s.runner, rig: { ...s.runner.rig, programs: [], hardware: [], resources: [] } } },
  ];

  it('knownSubroutineCost gives the same price for every subroutine in the card pool', () => {
    expect(labels.length).toBeGreaterThan(50);
    const same = (a: number | undefined, b: number | undefined) => (Number.isNaN(a) && Number.isNaN(b)) || a === b;
    let checked = 0;
    for (const s of states.filter((_, i) => i % 40 === 0).flatMap(variants)) {
      for (const label of labels) {
        const now = knownSubroutineCost(s, label);
        const before = oldKnownSubroutineCost(s, label);
        if (!same(now, before)) expect({ label, now }).toEqual({ label, now: before });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('activeCards keeps its order; iceStrength and breakerStrength give the same strengths', () => {
    let ice = 0;
    let breakers = 0;
    for (const s of states) {
      for (const side of [undefined, 'corp', 'runner'] as const) expect(activeCards(s, side)).toEqual(oldActiveCards(s, side));
      for (const c of Object.values(s.corp.servers).flatMap(v => v.ice)) {
        ice++;
        expect(iceStrength(s, c)).toBe(oldIceStrength(s, c));
      }
      for (const b of s.runner.rig.programs) {
        breakers++;
        expect(breakerStrength(s, b)).toBe(oldBreakerStrength(s, b));
      }
    }
    expect(ice).toBeGreaterThan(100);
    expect(breakers).toBeGreaterThan(10);
  });

  it('activeCards hands out a new list each call, sharing nothing with the state (engine shared path)', () => {
    const s = states[states.length - 1];
    const before = JSON.stringify(s);
    const a = activeCards(s);
    const b = activeCards(s);
    expect(a).not.toBe(b);
    a.length = 0;
    expect(activeCards(s)).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
  });
});
