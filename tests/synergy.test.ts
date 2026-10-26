import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardInstance, GameAction, GameState, createCardInstance, createInitialGameState, executeAction, getCardDefinition } from '../src/core';
import { digValue, handValue, keepValue, tagThreat } from '../src/ai/evaluate';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, HeuristicRunnerAI, playAIGame } from '../src/ai';
import { MAX_NUDGE, deckProfile, nudge, opponentProfile, tuning } from '../src/ai/synergy';
import { CONDITIONS, CONDITION_PATTERNS, SYNERGY, THEMES, inferSynergy } from '../src/ai/synergyTags';
import { newGame } from './helpers';
import { RunnerMemory, isTrap, serverValue, trapOdds } from '../src/ai/runs';
import { answerPrompt, taoSwap, untaianPick } from '../src/ai/prompts';


describe('synergy tags', () => {
  it('cover every card (tag the cards of a new set in synergyTags.ts)', () => {
    const untagged = ALL_CARDS.filter(c => !(c.code in SYNERGY)).map(c => `${c.code} ${c.title}`);
    expect(untagged).toEqual([]);
  });

  it('tag every conditional effect (timing the AI should plan around)', () => {
    const missing: string[] = [];
    for (const card of ALL_CARDS) {
      for (const c of CONDITIONS) {
        const says = CONDITION_PATTERNS[c].test(card.stripped_text ?? '');
        const tagged = SYNERGY[card.code]?.when?.includes(c) ?? false;
        if (says && !tagged) missing.push(`${card.code} ${card.title}: ${c}`);
      }
    }
    expect(missing).toEqual([]);
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
    const finite = (r: typeof on) => r.filter(x => Number.isFinite(x.score)).length;
    expect(finite(on)).toBe(finite(off));
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

describe('trap caution', () => {
  // Every trap the Corp still has hidden (HQ, R&D, facedown in Archives, installed facedown)
  const hiddenTraps = (s: GameState) =>
    [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown].filter(c => isTrap(c.cardCode));

  it('counts the traps and agendas the Corp could still have from its decklist', () => {
    const s = structuredClone(newGame());
    s.corp.rd.push(createCardInstance(s, '30045'), createCardInstance(s, '35050')); // Urtica Cipher, Byte!
    const before = trapOdds(s, new Map());
    expect(before).toBeGreaterThan(0);
    // Traps the Runner has accessed are accounted for
    const seen: RunnerMemory = new Map(hiddenTraps(s).slice(0, 1).map(c => [c.instanceId, c.cardCode]));
    expect(trapOdds(s, seen)).toBeLessThan(before);
  });

  it('knows when every trap is accounted for, and counts one shuffled back in again', () => {
    const s = structuredClone(newGame());
    const traps = hiddenTraps(s);
    for (const t of traps) {
      for (const zone of [s.corp.hq, s.corp.rd, s.corp.archives.faceDown]) {
        const i = zone.indexOf(t);
        if (i >= 0) zone.splice(i, 1);
      }
    }
    s.corp.archives.faceUp.push(...traps);
    expect(trapOdds(s, new Map())).toBe(0);
    // Nothing to fear in an unknown remote: no trap penalty even with a small hand
    const card = createCardInstance(s, '30067');
    card.advancementCounters = 2;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [card] };
    s.runner.grip = s.runner.grip.slice(0, 2);
    expect(serverValue(s, 'remote-9', 0, new Map(), true)).toBeGreaterThan(0);
    // A trap shuffled back into R&D is live again
    s.corp.rd.push(createCardInstance(s, '30045'));
    expect(trapOdds(s, new Map())).toBeGreaterThan(0);
    expect(serverValue(s, 'remote-9', 0, new Map(), true)).toBe(0);
  });

  it('is warier of an undefended remote', () => {
    const s = structuredClone(newGame());
    s.corp.rd.push(createCardInstance(s, '30045'));
    const card = createCardInstance(s, '30067');
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [card] };
    s.runner.grip = s.runner.grip.slice(0, 3);
    expect(serverValue(s, 'remote-9', 0, new Map(), true)).toBeLessThan(serverValue(s, 'remote-9', 0, new Map(), false));
  });
});

describe('Corp bluffing', () => {
  it('advances an Urtica Cipher that would flatline the Runner', () => {
    const state = newGame();
    const s = structuredClone(state);
    const urtica = createCardInstance(s, '30045');
    urtica.advancementCounters = 1;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [urtica] };
    s.runner.grip = s.runner.grip.slice(0, 4); // 2 + 2 counters = 4 net damage after one more advance
    s.corp.credits = 8;
    const advance = (ai: HeuristicCorpAI) =>
      ai.rankMainActions(s).find(r => r.action.type === 'ADVANCE_CARD' && r.action.cardInstanceId === urtica.instanceId)!.score;
    expect(advance(new HeuristicCorpAI())).toBeGreaterThan(advance(new HeuristicCorpAI({ synergy: false })) + 1);
  });
});

describe('planning (setup scoring)', () => {
  const remote = (s: GameState, id: string, root: CardInstance[], ice: CardInstance[] = []) =>
    (s.corp.servers[id] = { id, name: id, isRemote: true, ice, root });

  it('values tags more while the Corp holds cards that punish them, seen only by the Corp', () => {
    const s = structuredClone(newGame());
    s.corp.hq.push(createCardInstance(s, '30065')); // Retribution
    expect(tagThreat(s, 'corp')).toBeGreaterThan(tagThreat(s, 'runner'));
  });

  it('wants the breaker for the ice the Corp has shown', () => {
    const s = structuredClone(newGame());
    for (let i = 0; i < 3; i++) {
      const sentry = createCardInstance(s, '30062'); // Ballista
      sentry.isRezzed = true;
      s.corp.servers.hq.ice.push(sentry);
    }
    s.runner.rig.programs = [];
    const killer = createCardInstance(s, '30015'); // Carmen
    const decoder = createCardInstance(s, '30005'); // Buzzsaw
    const shelved = tuning.plan.breakerFocus; // switched off for now; the logic is kept for re-testing
    tuning.plan.breakerFocus = true;
    try {
      expect(keepValue(s, killer, true)).toBeGreaterThan(keepValue(s, decoder, true));
      expect(keepValue(s, killer, false)).toBe(keepValue(s, decoder, false));
    } finally {
      tuning.plan.breakerFocus = shelved;
    }
  });

  it('runs an agenda the Corp could finish next turn with more urgency', () => {
    const s = structuredClone(newGame());
    const card = createCardInstance(s, '30067');
    card.advancementCounters = 2;
    remote(s, 'remote-9', [card]);
    s.runner.grip = s.runner.grip.slice(0, 5);
    expect(serverValue(s, 'remote-9', 0, new Map(), false, true)).toBeGreaterThan(serverValue(s, 'remote-9', 0, new Map(), false, false));
  });

  it('plays Seamless Launch when it lets an agenda score this turn', () => {
    const s = structuredClone(newGame());
    const agenda = createCardInstance(s, '30067'); // Offworld Office: 4 to score
    agenda.advancementCounters = 2;
    agenda.installedTurn = 'earlier';
    const ice = createCardInstance(s, '30072');
    ice.isRezzed = true;
    remote(s, 'remote-9', [agenda], [ice]);
    const launch = createCardInstance(s, '30040');
    s.corp.hq.push(launch);
    s.corp.clicks = 1;
    s.corp.credits = 5;
    const rank = (ai: HeuristicCorpAI) => ai.rankMainActions(s).find(r => 'cardInstanceId' in r.action && r.action.cardInstanceId === launch.instanceId)!.score;
    expect(rank(new HeuristicCorpAI())).toBeGreaterThanOrEqual(41);
  });

  it('ices against the Runner: a type they cannot break, on a server they attacked', () => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver: barriers only
    s.runnerLastTurnRuns = [{ server: 'rd', successful: true } as (typeof s.runnerLastTurnRuns)[number]];
    const sentry = createCardInstance(s, '30073'); // Tithe
    const barrier = createCardInstance(s, '30072'); // Palisade
    s.corp.hq = [sentry, barrier];
    const score = (card: CardInstance, server: string) =>
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === card.instanceId && r.action.targetServerId === server)!.score;
    expect(score(sentry, 'rd')).toBeGreaterThan(score(sentry, 'hq'));
    const plain = (card: CardInstance) =>
      new HeuristicCorpAI({ synergy: false }).rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === card.instanceId && r.action.targetServerId === 'hq')!.score;
    expect(score(sentry, 'hq') - plain(sentry)).toBeGreaterThan(score(barrier, 'hq') - plain(barrier));
  });

  it('tags the Runner before scoring Orbital Superiority', () => {
    const s = structuredClone(newGame());
    const orbital = createCardInstance(s, '30068');
    orbital.advancementCounters = 4; // ready to score
    const ice = createCardInstance(s, '30072');
    ice.isRezzed = true;
    remote(s, 'remote-9', [orbital], [ice]);
    s.corp.hq.push(createCardInstance(s, '30057')); // Public Trail
    s.runnerLastTurnRuns = [{ server: 'hq', successful: true } as (typeof s.runnerLastTurnRuns)[number]];
    s.runner.credits = 2; // can't pay 8 to dodge it
    const order = (ai: HeuristicCorpAI) => ai.rankMainActions(s).map(r => r.action.type);
    const aware = order(new HeuristicCorpAI());
    expect(aware.indexOf('PLAY_OPERATION_OR_EVENT')).toBeLessThan(aware.indexOf('SCORE_AGENDA'));
    expect(order(new HeuristicCorpAI({ synergy: false }))[0]).toBe('SCORE_AGENDA');
  });

  it('does not leave an agenda half-advanced over the Runner\'s turn', () => {
    const s = structuredClone(newGame());
    const agenda = createCardInstance(s, '30069'); // Send a Message: 5 to score
    agenda.installedTurn = 'earlier';
    const ice = createCardInstance(s, '30072'); // Palisade, unrezzed
    remote(s, 'remote-9', [agenda], [ice]);
    s.corp.clicks = 1;
    s.corp.credits = 6;
    const advance = (ai: HeuristicCorpAI) => ai.rankMainActions(s).find(r => r.action.type === 'ADVANCE_CARD')?.score ?? -Infinity;
    // One advance now still leaves 4 to go next turn: wait
    expect(advance(new HeuristicCorpAI())).toBe(-Infinity);
    expect(advance(new HeuristicCorpAI({ synergy: false }))).toBeGreaterThan(0);
    // With 3 clicks it can get to 2 counters and score next turn: then it commits
    s.corp.clicks = 3;
    expect(advance(new HeuristicCorpAI())).toBeGreaterThan(5);
  });

  it('ices R&D before an HQ with nothing worth stealing', () => {
    const s = structuredClone(newGame());
    const ice = createCardInstance(s, '30072');
    s.corp.hq = [ice, createCardInstance(s, '30075')];
    s.corp.credits = 8;
    const score = (server: string) =>
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === server)!.score;
    expect(score('rd')).toBeGreaterThan(score('hq') + 1);
  });

  it('keeps money to rez ice on R&D as well as an agenda remote', () => {
    const s = structuredClone(newGame());
    const rdIce = createCardInstance(s, '30072');
    s.corp.servers.rd.ice = [rdIce];
    const hedge = createCardInstance(s, '30075'); // Hedge Fund: 5 to play, +9
    const palisade = createCardInstance(s, '30072');
    s.corp.hq = [hedge, palisade];
    s.corp.credits = 2; // Palisade on R&D costs 3 to rez
    const ranked = (ai: HeuristicCorpAI) => ai.rankMainActions(s);
    const credit = (ai: HeuristicCorpAI) => ranked(ai).find(r => r.action.type === 'GAIN_CREDIT')!.score;
    // Short of the reserve, a credit is worth a little more to the round 3 Corp
    expect(credit(new HeuristicCorpAI())).toBeGreaterThan(credit(new HeuristicCorpAI({ synergy: false })));
  });

  it('adds a layer where the Runner already breaks the ice', () => {
    const s = structuredClone(newGame());
    const palisade = createCardInstance(s, '30072'); // a barrier
    palisade.isRezzed = true;
    s.corp.servers.rd.ice = [palisade];
    const ice = createCardInstance(s, '30073'); // Tithe
    s.corp.hq = [ice];
    s.corp.credits = 8;
    const score = () =>
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === 'rd')!.score;
    const unbroken = score();
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver breaks barriers
    const broken = score();
    tuning.plan.iceDepth = false;
    const plain = score();
    tuning.plan.iceDepth = true;
    expect(broken - unbroken).toBeGreaterThan(plain - unbroken + 0.5);
  });
});

describe('identity plans', () => {
  const remote = (s: GameState, id: string, root: CardInstance[], ice: CardInstance[] = []) =>
    (s.corp.servers[id] = { id, name: id, isRemote: true, ice, root });

  it('PT Untaian advances the agenda behind ice, and skips when nothing is worth a credit', () => {
    const s = structuredClone(newGame());
    const agenda = createCardInstance(s, '30069');
    const trap = createCardInstance(s, '30045'); // Urtica Cipher
    remote(s, 'remote-8', [agenda], [createCardInstance(s, '30072')]);
    remote(s, 'remote-9', [trap]);
    s.corp.credits = 5;
    expect(untaianPick(s, [agenda.instanceId, trap.instanceId])).toEqual([agenda.instanceId]);
    expect(untaianPick(s, [trap.instanceId])).toEqual([trap.instanceId]);
    s.corp.credits = 1;
    expect(untaianPick(s, [agenda.instanceId])).toEqual([]);
  });

  it('BANGUN installs an agenda faceup with tag punishers in hand; the Runner reads it', () => {
    const s = structuredClone(newGame());
    s.corp.identity = createCardInstance(s, '35068'); // BANGUN
    const agenda = createCardInstance(s, '30067');
    s.corp.hq = [agenda, createCardInstance(s, '30065')]; // Retribution
    remote(s, 'remote-8', [], [createCardInstance(s, '30072')]);
    s.corp.clicks = 1;
    s.corp.credits = 6;
    const install = (faceUp: boolean) =>
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === agenda.instanceId && r.action.targetServerId === 'remote-8' && !!r.action.faceUp === faceUp)?.score ?? -Infinity;
    expect(install(true)).toBeGreaterThan(install(false));
    // The Runner: a faceup agenda is a sure steal, but not with a hand that 2 meat damage would empty
    const t = structuredClone(s);
    agenda.faceUp = true;
    remote(t, 'remote-9', [{ ...agenda, faceUp: true }]);
    t.runner.grip = t.runner.grip.slice(0, 3);
    expect(serverValue(t, 'remote-9', 0, undefined, true)).toBeGreaterThan(2);
    t.runner.grip = t.runner.grip.slice(0, 1);
    expect(serverValue(t, 'remote-9', 0, undefined, true)).toBe(0);
  });

  it('Tāo Salonga swaps the ice it cannot break off the agenda remote', () => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver: barriers only
    const sentry = createCardInstance(s, '30073'); // Tithe
    sentry.isRezzed = true;
    const barrier = createCardInstance(s, '30072'); // Palisade
    barrier.isRezzed = true;
    const agenda = createCardInstance(s, '30069');
    agenda.advancementCounters = 2;
    remote(s, 'remote-8', [agenda], [sentry]);
    s.corp.servers.archives.ice = [barrier];
    expect(new Set(taoSwap(s))).toEqual(new Set([sentry.instanceId, barrier.instanceId]));
    // Nothing to gain: no swap
    s.corp.servers.archives.ice = [];
    expect(taoSwap(s)).toEqual([]);
  });
});

describe('draws and money', () => {
  it('a card in hand is worth about a credit up to the hand-size limit, nothing over it', () => {
    expect(handValue(4, 5, 'corp') - handValue(3, 5, 'corp')).toBeCloseTo(1.6);
    expect(handValue(6, 5, 'corp') - handValue(5, 5, 'corp')).toBe(0);
    tuning.plan.drawValue.corp = false;
    expect(handValue(4, 5, 'corp') - handValue(3, 5, 'corp')).toBeCloseTo(0.8);
    expect(handValue(4, 5, 'runner') - handValue(3, 5, 'runner')).toBeCloseTo(1.6);
    tuning.plan.drawValue.corp = true;
  });

  it('the Runner draws below the limit with money in the bank, and stops at the limit', () => {
    const s = structuredClone(newGame());
    s.activePlayer = 'runner';
    s.runner.clicks = 4;
    s.runner.credits = 8;
    s.runner.grip = s.runner.grip.slice(0, 3);
    const score = (type: string) => new HeuristicRunnerAI().rankMainActions(s).find(r => r.action.type === type)!.score;
    expect(score('DRAW_CARD')).toBeGreaterThan(score('GAIN_CREDIT'));
    while (s.runner.grip.length < s.runner.handSizeLimit) s.runner.grip.push(s.runner.stack.shift()!);
    expect(score('DRAW_CARD')).toBeLessThan(score('GAIN_CREDIT'));
  });

  it('Predictive Planogram takes the credits when broke and HQ is full, without peeking at the cards it would draw', () => {
    const s = structuredClone(newGame());
    const planogram = createCardInstance(s, '30056');
    s.corp.hq = [planogram, ...s.corp.hq.slice(0, 4)];
    s.corp.credits = 0;
    const played = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: planogram.instanceId });
    const answered = executeAction(played, answerPrompt(played, 'corp', undefined, true));
    expect(answered.corp.credits).toBe(3);
  });

  it('a Regolith Mining License click is worth its 3 credits, well over the basic click', () => {
    const s = structuredClone(newGame());
    const regolith = createCardInstance(s, '30071');
    regolith.isRezzed = true;
    regolith.tokens = { ...regolith.tokens, credit: 15 };
    s.corp.servers['remote-8'] = { id: 'remote-8', name: 'remote-8', isRemote: true, ice: [], root: [regolith] };
    s.corp.credits = 8;
    const ranked = new HeuristicCorpAI().rankMainActions(s);
    const take = ranked.find(r => r.action.type === 'USE_ABILITY' && r.action.cardInstanceId === regolith.instanceId)!.score;
    const click = ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
    expect(take).toBeGreaterThan(click + 1.5);
  });

  it('clicks for credits toward a Hedge Fund it can almost afford', () => {
    const s = structuredClone(newGame());
    s.corp.hq = [createCardInstance(s, '30075'), ...s.corp.hq.slice(0, 2)];
    s.corp.credits = 3;
    const credit = () => new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'GAIN_CREDIT')!.score;
    const on = credit();
    tuning.plan.saveForOps = false;
    const off = credit();
    tuning.plan.saveForOps = true;
    expect(on).toBeGreaterThan(off + 0.5);
  });
});

describe('digging for answers', () => {
  it('the Corp digs for ice it does not hold, harder once the Runner is close to winning', () => {
    const s = structuredClone(newGame());
    s.corp.hq = s.corp.hq.filter(c => getCardDefinition(c.cardCode).type_code !== 'ice').slice(0, 2);
    s.corp.credits = 8;
    const calm = digValue(s, 'corp');
    expect(calm).toBeGreaterThan(0);
    s.runner.score = 5;
    expect(digValue(s, 'corp')).toBeGreaterThan(calm);
    // Nothing left to find: no reason to dig
    s.corp.rd = s.corp.rd.filter(c => getCardDefinition(c.cardCode).type_code !== 'ice');
    expect(digValue(s, 'corp')).toBe(0);
  });

  it('the Runner digs for a breaker for the ice the Corp has shown', () => {
    const s = structuredClone(newGame());
    s.runner.credits = 8;
    s.runner.grip = [];
    s.runner.rig.programs = [];
    expect(digValue(s, 'runner')).toBe(0); // no ice shown yet
    const wall = createCardInstance(s, '30072'); // Palisade, a barrier
    wall.isRezzed = true;
    s.corp.servers.rd.ice = [wall];
    expect(digValue(s, 'runner')).toBeGreaterThan(0);
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver breaks barriers
    expect(digValue(s, 'runner')).toBe(0);
  });
});
