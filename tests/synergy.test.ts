import { describe, expect, it } from 'vitest';
import { ALL_CARDS, GameAction, createCardInstance, createInitialGameState, getCardDefinition } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, playAIGame } from '../src/ai';
import { MAX_NUDGE, deckProfile, nudge, opponentProfile } from '../src/ai/synergy';
import { SYNERGY, THEMES, inferSynergy } from '../src/ai/synergyTags';
import { newGame } from './helpers';


describe('synergy tags', () => {
  it('cover every card (tag the cards of a new set in synergyTags.ts)', () => {
    const untagged = ALL_CARDS.filter(c => !(c.code in SYNERGY)).map(c => `${c.code} ${c.title}`);
    expect(untagged).toEqual([]);
  });

  it('only use known themes', () => {
    for (const [code, syn] of Object.entries(SYNERGY)) {
      for (const t of [...Object.keys(syn.gives ?? {}), ...Object.keys(syn.wants ?? {})]) {
        expect(THEMES, `${code}: ${t}`).toContain(t);
      }
    }
  });

  it('guess from the card text for cards not tagged yet', () => {
    expect(inferSynergy(getCardDefinition('30075')).gives?.econ).toBeGreaterThan(0); // Hedge Fund: gain 9
    expect(inferSynergy(getCardDefinition('30065')).wants?.tags).toBeGreaterThan(0); // Retribution: only if tagged
    expect(inferSynergy(getCardDefinition('35059')).wants?.advance).toBeGreaterThan(0); // Embedded Reporting: Dividends
    expect(inferSynergy(getCardDefinition('30005')).gives?.breakers).toBeGreaterThan(0); // Buzzsaw
  });
});

describe('deck profile', () => {
  it('counts the identity most', () => {
    const state = newGame();
    const before = deckProfile(state, 'corp').demand.tags;
    const s = structuredClone(state);
    s.corp.identity = createCardInstance(s, '30051'); // NBN: Reality Plus wants tags
    expect(deckProfile(s, 'corp').demand.tags - before).toBeCloseTo(2 * 3);
  });

  it('follows the game: trashed cards stop counting, drawn cards count more', () => {
    const state = newGame();
    const s = structuredClone(state);
    const card = s.runner.stack.find(c => (SYNERGY[c.cardCode].gives?.econ ?? 0) > 0)!;
    const econ = deckProfile(s, 'runner').supply.econ;
    s.runner.stack = s.runner.stack.filter(c => c !== card);
    s.runner.grip.push(card);
    // (profiles are cached per position, so each change is a new position)
    const drawn = deckProfile(structuredClone(s), 'runner').supply.econ;
    expect(drawn).toBeGreaterThan(econ);
    s.runner.grip = s.runner.grip.filter(c => c !== card);
    s.runner.heap.push(card);
    expect(deckProfile(structuredClone(s), 'runner').supply.econ).toBeLessThan(econ);
  });

  it("reads only the opponent's public cards", () => {
    const state = newGame();
    const s = structuredClone(state);
    const before = opponentProfile(s, 'runner').supply.econ;
    const nico = createCardInstance(s, '30037');
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [nico] };
    expect(opponentProfile(s, 'runner').supply.econ).toBe(before); // unrezzed: unknown
    nico.isRezzed = true;
    const s2 = structuredClone(s);
    expect(opponentProfile(s2, 'runner').supply.econ).toBeGreaterThan(before);
  });
});

describe('synergy nudges', () => {
  it('stay small next to the main scores', () => {
    const { state } = playAIGame(createInitialGameState(deckGameSetup(7, DECKS[0], DECKS[1])), 3000, 4);
    for (const side of ['corp', 'runner'] as const) {
      const s = structuredClone(state);
      s.activePlayer = side;
      const actions: GameAction[] = [
        { type: 'DRAW_CARD', player: side },
        { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' },
        ...(side === 'corp' ? s.corp.hq : s.runner.grip).map(c => ({ type: 'INSTALL_CARD', player: side, cardInstanceId: c.instanceId, asNewRemote: true }) as GameAction),
      ];
      for (const a of actions) {
        const { bonus } = nudge(s, side, a);
        expect(bonus).toBeGreaterThanOrEqual(0);
        expect(bonus).toBeLessThanOrEqual(MAX_NUDGE);
      }
    }
  });

  it('favour trashing money assets against an econ-reliant Corp', () => {
    const state = newGame();
    const s = structuredClone(state);
    s.activePlayer = 'runner';
    s.corp.identity = createCardInstance(s, '30059'); // keep identity neutral-ish
    for (let i = 0; i < 3; i++) {
      const asset = createCardInstance(s, '30071'); // Regolith Mining License
      asset.isRezzed = true;
      s.corp.servers[`remote-${i + 5}`] = { id: `remote-${i + 5}`, name: `Server ${i + 5}`, isRemote: true, ice: [], root: [asset] };
    }
    const run = (id: string) => nudge(s, 'runner', { type: 'INITIATE_RUN', player: 'runner', targetServerId: id }, true);
    const onAsset = run('remote-5');
    expect(onAsset.reasons.join(' ')).toMatch(/counters their econ/);
    expect(onAsset.bonus).toBeGreaterThan(run('archives').bonus);
  });

  it('can be turned off (the AI as it was)', () => {
    const state = newGame();
    const on = new HeuristicCorpAI().rankMainActions(state);
    const off = new HeuristicCorpAI({ synergy: false }).rankMainActions(state);
    expect(on.length).toBe(off.length);
    const total = (r: typeof on) => r.filter(x => Number.isFinite(x.score)).reduce((n, x) => n + x.score, 0);
    expect(total(on)).toBeGreaterThanOrEqual(total(off));
  });
});

describe('dividends', () => {
  it('the Corp advances a Dividends agenda past its cost before scoring it', () => {
    const state = newGame();
    const s = structuredClone(state);
    const agenda = createCardInstance(s, '35059'); // Embedded Reporting: 3 to score, Dividends 2
    agenda.advancementCounters = 3;
    const ice = createCardInstance(s, '30072');
    ice.isRezzed = true;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [ice], root: [agenda] };
    s.corp.credits = 10;
    s.corp.clicks = 2;
    const ai = new HeuristicCorpAI();
    const first = ai.chooseAction(s);
    expect(first).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda.instanceId });
    // Without the deck-aware AI it scores straight away
    expect(new HeuristicCorpAI({ synergy: false }).chooseAction(s)).toMatchObject({ type: 'SCORE_AGENDA' });
  });
});
