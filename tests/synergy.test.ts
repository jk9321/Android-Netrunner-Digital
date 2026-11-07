import { FLATLINE } from '../src/ai/effectValues';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardInstance, GameAction, GameState, createCardInstance, createInitialGameState, executeAction, findCardAnywhere, getCardDefinition } from '../src/core';
import { digValue, handValue, keepValue, tagThreat } from '../src/ai/evaluate';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from '../scripts/nsg-sample-decks';
import { HeuristicCorpAI, HeuristicRunnerAI, playAIGame } from '../src/ai';
import { MAX_NUDGE, deckProfile, nudge, opponentProfile, tuning } from '../src/ai/synergy';
import { CONDITIONS, CONDITION_PATTERNS, SYNERGY, THEMES, inferSynergy } from '../src/ai/synergyTags';
import { installProgramForTest, newGame } from './helpers';
import { RunnerMemory, isTrap, serverValue, trapOdds } from '../src/ai/runs';
import { answerPrompt, taoSwap, untaianPick } from '../src/ai/prompts';

describe('synergy tags', () => {
  it("cover every card (a `synergy` on each card in its set's file in src/ai/cards/)", () => {
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
    // Centrals already iced, so their first ice doesn't come first (centralsFirst)
    for (const id of ['rd', 'hq']) s.corp.servers[id].ice.push(createCardInstance(s, '30072'));
    // The one-step rule (the turn planner instead weighs the counters by what they do: Embedded Reporting's by the operations in R&D)
    const ai = new HeuristicCorpAI({ planner: false });
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: the order of a turn's clicks is the delta's to choose (an install may come first); what counts
      // is that the agenda is advanced past its cost before it is scored (SCORE_AGENDA ranks the extra counter's worth).
      // With ice in HQ, two ice installs (about 6 each) beat the extra counter (2 agenda counters, about 2.8 net), which
      // the old rule never weighed; with nothing else for the click, the counter beats a credit and goes on first
      let t = structuredClone(s);
      t.corp.hq = [];
      let scoredAt = -1;
      for (let i = 0; i < 10 && t.activePlayer === 'corp'; i++) {
        const action = ai.chooseAction(t);
        if (action.type === 'SCORE_AGENDA' && action.cardInstanceId === agenda.instanceId) scoredAt = findCardAnywhere(t, agenda.instanceId)!.advancementCounters;
        t = executeAction(t, action);
        if (action.type === 'END_TURN' || scoredAt >= 0) break;
      }
      expect(scoredAt).toBeGreaterThan(3);
    } else {
      const first = ai.chooseAction(s);
      expect(first).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda.instanceId });
    }
    // Without the deck-aware AI it scores straight away
    expect(new HeuristicCorpAI({ synergy: false, planner: false }).chooseAction(s)).toMatchObject({ type: 'SCORE_AGENDA' });
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
    // A trap shuffled back into R&D is live again: the run is worth less by the chance of a flatline (plan.runModel)
    const safe = serverValue(s, 'remote-9', 0, new Map(), true);
    s.corp.rd.push(createCardInstance(s, '30045'));
    expect(trapOdds(s, new Map())).toBeGreaterThan(0);
    expect(serverValue(s, 'remote-9', 0, new Map(), true)).toBeLessThan(safe - trapOdds(s, new Map()) * FLATLINE * 0.9);
  });

  it('is warier of an undefended remote (Jeff: agenda odds rise with what the Corp has put into the server)', () => {
    const s = structuredClone(newGame());
    s.corp.rd.push(createCardInstance(s, '30045'));
    const card = createCardInstance(s, '30067');
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [card] };
    s.runner.grip = s.runner.grip.slice(0, 3);
    const bare = serverValue(s, 'remote-9', 0, new Map(), true);
    const guarded = structuredClone(s);
    guarded.corp.servers['remote-9'].ice = [createCardInstance(guarded, '30072')];
    expect(bare).toBeLessThan(serverValue(guarded, 'remote-9', 0, new Map(), true));
  });
});

describe('Corp bluffing', () => {
  it('advances an Urtica Cipher that would flatline the Runner', () => {
    const state = newGame();
    const s = structuredClone(state);
    const urtica = createCardInstance(s, '30045');
    urtica.advancementCounters = 1;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [urtica] };
    // 2 + 2 counters = 4 net damage after one more advance: more than a 3-card grip flatlines (rules 10.4.4)
    s.runner.grip = s.runner.grip.slice(0, 3);
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
    // Value model step 5b: the odds of meeting each type (shown ice, then the decklist)
    expect(keepValue(s, killer)).toBeGreaterThan(keepValue(s, decoder));
  });

  it('runs an agenda the Corp could finish next turn with more urgency', () => {
    const s = structuredClone(newGame());
    const card = createCardInstance(s, '30067');
    card.advancementCounters = 2;
    remote(s, 'remote-9', [card]);
    s.runner.grip = s.runner.grip.slice(0, 5);
    // plan.runModel: an advanced card is likelier an agenda the Corp is about to score, and denying it matters more as the Corp nears 7
    const fresh = structuredClone(s);
    fresh.corp.servers['remote-9'].root[0].advancementCounters = 0;
    expect(serverValue(s, 'remote-9', 0, new Map(), false)).toBeGreaterThan(serverValue(fresh, 'remote-9', 0, new Map(), false));
    const late = structuredClone(s);
    late.corp.score = 5;
    expect(serverValue(late, 'remote-9', 0, new Map(), false)).toBeGreaterThan(serverValue(s, 'remote-9', 0, new Map(), false));
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
    // plan.oneCurrency: no score tier (41 = the old finishing tier); the delta of the agenda it finishes puts it first
    // once waiting is a risk (rewritten 2026-11-06): with the Runner unable to break the rezzed Palisade (steal odds 5%)
    // the finish a turn later is worth nearly as much, Offworld's 7 credits included, and ice on a bare R&D outranks it;
    // with Cleaver and the money to use it, the finish now comes first
    if (tuning.plan.oneCurrency) {
      installProgramForTest(s, '30006'); // Cleaver
      s.runner.credits = 8;
    }
    if (tuning.plan.oneCurrency) expect(new HeuristicCorpAI({ planner: false }).rankMainActions(s)[0].action).toMatchObject({ cardInstanceId: launch.instanceId });
    else expect(rank(new HeuristicCorpAI())).toBeGreaterThanOrEqual(41);
  });

  it('ices against the Runner: a type they cannot break, on a server they attacked', () => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver: barriers only
    s.runner.credits = 10; // rich enough that neither is a full stop (stopperPlacement): only the type fit differs
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

  it('judges Scatter Field where it would go: strong alone, weak behind or in front of other ice', () => {
    const board = () => {
      const s = structuredClone(newGame());
      s.runner.rig.programs = [createCardInstance(s, '30026')]; // Unity: boosting through 4 strength costs more
      s.runner.credits = 10; // never a full stop: only the strength differs
      s.corp.credits = 10;
      return s;
    };
    const score = (s: GameState, card: CardInstance, server: string, on: boolean) => {
      const was = tuning.plan.icePosition;
      tuning.plan.icePosition = on;
      try {
        return new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === card.instanceId && r.action.targetServerId === server)!.score;
      } finally {
        tuning.plan.icePosition = was;
      }
    };
    // Alone on R&D it counts its +4 strength; as HQ's second layer it doesn't get it
    const s = board();
    const palisade = createCardInstance(s, '30072');
    palisade.isRezzed = true;
    s.corp.servers.hq.ice = [palisade];
    const scatter = createCardInstance(s, '35042');
    s.corp.hq = [scatter];
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: evaluate prices ice at the strength the engine gives it where it sits, so plan.icePosition (an
      // installScore term) has nothing to add: alone on R&D beats a second layer on HQ, and a layer outside a lone Scatter
      // Field (which takes its +4 away) is worth less than the same layer outside a Palisade
      expect(score(s, scatter, 'rd', true)).toBeGreaterThan(score(s, scatter, 'hq', true) + 2);
      const u = board();
      const plain = createCardInstance(u, '30072');
      plain.isRezzed = true;
      u.corp.servers.rd.ice = [plain];
      const other = createCardInstance(u, '30072');
      u.corp.hq = [other];
      const t = board();
      const lone = createCardInstance(t, '35042');
      lone.isRezzed = true;
      t.corp.servers.rd.ice = [lone];
      const layer = createCardInstance(t, '30072');
      t.corp.hq = [layer];
      expect(score(t, layer, 'rd', true)).toBeLessThan(score(u, other, 'rd', true));
      return;
    }
    expect(score(s, scatter, 'rd', true) - score(s, scatter, 'rd', false)).toBeGreaterThan(0);
    expect(score(s, scatter, 'hq', true)).toBeCloseTo(score(s, scatter, 'hq', false));
    // A new layer outside a lone Scatter Field takes its +4 away, and that counts against it
    const t = board();
    const lone = createCardInstance(t, '35042');
    lone.isRezzed = true;
    t.corp.servers.rd.ice = [lone];
    const layer = createCardInstance(t, '30072');
    t.corp.hq = [layer];
    expect(score(t, layer, 'rd', true)).toBeLessThan(score(t, layer, 'rd', false));
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
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: not a -Infinity gate but a delta: with 1 click the advance is not the move (ice on the remote is)
      const top = (ai: HeuristicCorpAI) => ai.rankMainActions(s)[0].action.type;
      expect(top(new HeuristicCorpAI({ planner: false }))).not.toBe('ADVANCE_CARD');
      // With 3 clicks the turn may commit (2 counters or more: scoreable next turn) or build (ice on the remote and R&D, as
      // the delta prices it with the Runner on 2 credits), but never stops in between
      s.corp.clicks = 3;
      s.runner.credits = 2;
      let t = s;
      const ai = new HeuristicCorpAI();
      for (let i = 0; i < 8 && t.activePlayer === 'corp'; i++) {
        const action = ai.chooseAction(t);
        t = executeAction(t, action);
        if (action.type === 'END_TURN') break;
      }
      const counters = findCardAnywhere(t, agenda.instanceId)!.advancementCounters;
      expect(counters === 0 || counters >= 2).toBe(true);
      return;
    }
    // One advance now still leaves 4 to go next turn: wait
    expect(advance(new HeuristicCorpAI())).toBe(-Infinity);
    expect(advance(new HeuristicCorpAI({ synergy: false }))).toBeGreaterThan(0);
    // With 3 clicks it can get to 2 counters and score next turn: then it commits
    s.corp.clicks = 3;
    // plan.breakerReach (2026-11-06): with Marjanah in the grip the Runner gets past Palisade for about 6 credits, not a
    // flat 8, so on 5 credits the agenda would be exposed; on 2 it isn't
    s.runner.credits = 2;
    expect(advance(new HeuristicCorpAI())).toBeGreaterThan(5);
  });

  it('ices R&D before an HQ with nothing worth stealing', () => {
    const s = structuredClone(newGame());
    const ice = createCardInstance(s, '30072');
    s.corp.hq = [ice, createCardInstance(s, '30075')];
    s.corp.credits = 8;
    const score = (server: string) =>
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === server)!.score;
    // plan.oneCurrency: centralExposure prices it (R&D's agendas against HQ's Hedge Fund) without the old 1-point tier margin
    expect(score('rd')).toBeGreaterThan(score('hq') + (tuning.plan.oneCurrency ? 0.3 : 1));
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
    // Short of the reserve, a credit is worth a little more to the round 3 Corp (plan.oneCurrency: than the same credit
    // once the Palisade's rez is covered, the rez pool's step; the rule-based Corp has another currency to compare with)
    if (tuning.plan.oneCurrency) {
      const short = credit(new HeuristicCorpAI({ planner: false }));
      s.corp.credits = 4;
      expect(short).toBeGreaterThan(credit(new HeuristicCorpAI({ planner: false })) + 0.5);
      return;
    }
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
      new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === 'rd' && !r.action.trashFirst)!.score;
    const unbroken = score();
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver breaks barriers
    const broken = score();
    // plan.oneCurrency: runSuccess prices the layer the rig breaks through; otherwise iceDepth (an installScore term,
    // folded in item 6) does
    expect(broken - unbroken).toBeGreaterThan(tuning.plan.oneCurrency ? 1 : 0.5);
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
  it('a card in hand is worth about a credit up to the hand-size limit, little for one over, nothing beyond', () => {
    expect(handValue(4, 5, 'corp') - handValue(3, 5, 'corp')).toBeCloseTo(1.6);
    expect(handValue(6, 5, 'corp') - handValue(5, 5, 'corp')).toBeCloseTo(0.3);
    expect(handValue(7, 5, 'corp') - handValue(6, 5, 'corp')).toBe(0);
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
    expect(take).toBeGreaterThan(click + 1);
  });

  it('clicks for credits toward a Hedge Fund it can almost afford', () => {
    const s = structuredClone(newGame());
    s.corp.hq = [createCardInstance(s, '30075'), ...s.corp.hq.slice(0, 2)];
    s.corp.credits = 3;
    const credit = () => new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'GAIN_CREDIT')!.score;
    if (tuning.plan.oneCurrency) {
      // plan.oneCurrency: no saveForOps bonus (the old test compared it on and off). The planned turn clicks for the two
      // credits and plays Hedge Fund (5 to play, +9) with its last click, ahead of a draw for ice (digValue)
      let t = s;
      const ai = new HeuristicCorpAI();
      for (let i = 0; i < 8 && t.activePlayer === 'corp'; i++) {
        const action = ai.chooseAction(t);
        t = executeAction(t, action);
        if (action.type === 'END_TURN') break;
      }
      expect(t.corp.archives.faceUp.map(c => c.cardCode)).toContain('30075');
      return;
    }
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

  // Jeff 2026-10-31 (dud draws): a full hand with no ice digs one past the limit and discards the worst (rules 4.3.6, 5.5.3)
  it('a full hand of duds still digs for ice, one card past the hand size (plan.digPastLimit)', () => {
    const s = structuredClone(newGame());
    const duds = s.corp.rd.filter(c => getCardDefinition(c.cardCode).type_code !== 'ice' && getCardDefinition(c.cardCode).type_code !== 'agenda');
    s.corp.hq = duds.slice(0, 5);
    s.corp.rd = s.corp.rd.filter(c => !s.corp.hq.includes(c));
    s.corp.credits = 8;
    const draw = () => new HeuristicCorpAI({ synergy: true }).rankMainActions(s).find(r => r.action.type === 'DRAW_CARD')?.score ?? -Infinity;
    const on = draw();
    tuning.plan.digPastLimit = false;
    const off = draw();
    tuning.plan.digPastLimit = true;
    expect(on).toBeGreaterThan(off + 0.5);
    // Six cards: no more digging (a second discard)
    s.corp.hq.push(duds[5]);
    expect(draw()).toBeLessThanOrEqual(off);
  });

  it('ice the Corp cannot afford to rez soon is no answer: it still digs', () => {
    const s = structuredClone(newGame());
    s.corp.hq = s.corp.hq.filter(c => getCardDefinition(c.cardCode).type_code !== 'ice').slice(0, 2);
    const dear = s.corp.rd.find(c => (getCardDefinition(c.cardCode).type_code === 'ice') && (getCardDefinition(c.cardCode).cost ?? 0) >= 4)!;
    s.corp.hq.push(dear);
    s.corp.credits = 0;
    expect(digValue(s, 'corp')).toBeGreaterThan(0);
    s.corp.credits = 10;
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

describe('rez money (Jeff, from play)', () => {
  // Unrezzed ice out, an upgrade in a remote with no agenda: the money should wait for the ice
  const position = () => {
    const s = structuredClone(newGame());
    const ice = (code: string) => createCardInstance(s, code);
    s.corp.servers.rd.ice = [ice('30072'), ice('30073')]; // Palisade (ends the run, 3 to rez), Tithe
    s.corp.servers.hq.ice = [ice('30072')];
    const grid = createCardInstance(s, '35082'); // Mahkota Langit Grid, 2 to rez
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: [ice('30073')], root: [grid] };
    s.corp.hq = [createCardInstance(s, '30042'), ...s.corp.hq.filter(c => getCardDefinition(c.cardCode).type_code !== 'agenda').slice(0, 3)];
    s.corp.credits = 4;
    return { s, grid };
  };

  it('sets up upgrades in an empty remote, but does not rez them out of that money', () => {
    const { s, grid } = position();
    const ranked = new HeuristicCorpAI().rankMainActions(s);
    const rez = ranked.find(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === grid.instanceId)?.score ?? -Infinity;
    const credit = ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
    expect(rez).toBeLessThan(credit);
    // With money to spare beyond the reserve, it may (plan.oneCurrency: the reserve is the rez pool of every unrezzed
    // ice out, 8 here, plan.rezBudget, not the old reserve rule's 2 to 3, so spare means the grid's 2 on top: 10 or more.
    // The grid's own 2 hosted credits, which can pay for the ice on its server, are not in the pool yet)
    s.corp.credits = tuning.plan.oneCurrency ? 12 : 6;
    expect(new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === grid.instanceId)!.score).toBeGreaterThan(0);
  });
});

describe('a trap the Runner has already seen (Gemini audit, 2026-11-01)', () => {
  const seen = (code: string) => {
    const s = structuredClone(newGame());
    const card = createCardInstance(s, code);
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [card] };
    s.runner.credits = 10;
    return serverValue(s, 'remote-9', 0, new Map([[card.instanceId, code]]), true);
  };
  it('is not run again to trash it when it springs on access (Esca, Byte!)', () => {
    expect(seen('36038')).toBe(0);
    expect(seen('35050')).toBe(0);
  });
  it('is still worth trashing when it fires on the Corp\'s turn instead (Clearinghouse)', () => {
    expect(seen('30061')).toBeGreaterThan(0);
  });
});
