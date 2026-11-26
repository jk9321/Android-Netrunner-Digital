import { RATES } from '../src/ai/valueModel';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardInstance, GameAction, GameState, createCardInstance, actingSide, createInitialGameState, executeAction, getCardDefinition } from '../src/core';
import { digValue, handValue, keepValue } from '../src/ai/evaluate';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from '../scripts/nsg-sample-decks';
import { HeuristicCorpAI, HeuristicRunnerAI, createAgent, playAIGame } from '../src/ai';
import { MAX_NUDGE, deckProfile, nudge, opponentProfile } from '../src/ai/synergy';
import { CONDITIONS, CONDITION_PATTERNS, SYNERGY, THEMES, inferSynergy } from '../src/ai/synergyTags';
import { newGame } from './helpers';
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
  }, 120_000);

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
    // R6 (step 3, corpAI installScore): with synergy on, ice is never installed on Archives without an agenda there or a
    // Runner Archives card, so those installs rank -Infinity only on that side
    const archivesIce = (x: (typeof on)[number]) => x.action.type === 'INSTALL_CARD' && (x.action as { targetServerId?: string }).targetServerId === 'archives';
    const finite = (r: typeof on) => r.filter(x => Number.isFinite(x.score) && !archivesIce(x)).length;
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
    const first = ai.chooseAction(s);
    expect(first).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda.instanceId });
    // The synergy: false half ("without the deck-aware AI it scores straight away") compared the ranking with its own
    // flag off; the order does not read the flag (Step 4 Stage C7)
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
    expect(serverValue(s, 'remote-9', 0, new Map(), true)).toBeLessThan(safe - trapOdds(s, new Map()) * 4 * RATES.point * 0.9 /* the old flat FLATLINE, deleted in V-B B6 */);
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
  // Rewritten in Step 4 Stage C7 against the decision (the ranking's synergy bonus on the advance is gone) and known-failing:
  // the order puts Pharos on R&D first (line 2) and the advance second, and the look-ahead plays Pharos too. The bluff
  // advance has no line of its own (the Stage D bluff-advance item)
  it.fails('advances an Urtica Cipher that would flatline the Runner', () => {
    const state = newGame();
    const s = structuredClone(state);
    const urtica = createCardInstance(s, '30045');
    urtica.advancementCounters = 1;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [urtica] };
    // 2 + 2 counters = 4 net damage after one more advance: more than a 3-card grip flatlines (rules 10.4.4)
    s.runner.grip = s.runner.grip.slice(0, 3);
    s.corp.credits = 8;
    expect(new HeuristicCorpAI().chooseAction(s)).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: urtica.instanceId });
  });
});

describe('planning (setup scoring)', () => {
  const remote = (s: GameState, id: string, root: CardInstance[], ice: CardInstance[] = []) =>
    (s.corp.servers[id] = { id, name: id, isRemote: true, ice, root });

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
    // The old score tier (plan.scoreSetup's 41) went in step 2 (+0.5 ± 0.5 at games=3): counted scoring (plan.scoreNow)
    // finds the line. 1 click: Seamless Launch places the 2 counters Offworld Office still needs (rule 1.17.3a)
    let t: GameState = s;
    const corp = createAgent('corp', 'normal', {});
    const runner = createAgent('runner', 'normal', {});
    for (let i = 0; i < 12 && t.activePlayer === 'corp' && !t.winner; i++) t = executeAction(t, (actingSide(t) === 'corp' ? corp : runner).chooseAction(t));
    expect(t.corp.scoreArea.map(c => c.instanceId)).toContain(agenda.instanceId);
  });

  // Rewritten in Step 4 Stage C7 against the decision (the ranking's iceFit score is gone): the Corp with its look-ahead
  // puts the sentry the Runner cannot break on the server it attacked. The order alone puts Palisade on R&D first
  it('ices against the Runner: a type they cannot break, on a server they attacked', () => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver: barriers only
    s.runner.credits = 10;
    s.runnerLastTurnRuns = [{ server: 'rd', successful: true } as (typeof s.runnerLastTurnRuns)[number]];
    const sentry = createCardInstance(s, '30073'); // Tithe
    s.corp.hq = [sentry, createCardInstance(s, '30072')]; // and Palisade
    expect(new HeuristicCorpAI().chooseAction(s)).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: sentry.instanceId, targetServerId: 'rd' });
  });

  // 'judges Scatter Field where it would go' compared the ranking's install scores with plan.icePosition on and off; the
  // switch's reader was the ranking (Step 4 Stage C7: deleted with it, the switch removed)

  // Rewritten in Step 4 Stage C7 against the decision, and known-failing: the order holds the score back (tagFirst) and
  // puts Public Trail on line 3 (tagsBeforeScore), but the over-advance of Orbital Superiority is line 3's first by its keys,
  // with or without the look-ahead. A carried rule whose own pin fails: reported with leave-one-out (c7-leave-one-out.md)
  it.fails('tags the Runner before scoring Orbital Superiority', () => {
    const s = structuredClone(newGame());
    const orbital = createCardInstance(s, '30068');
    orbital.advancementCounters = 4; // ready to score
    const ice = createCardInstance(s, '30072');
    ice.isRezzed = true;
    remote(s, 'remote-9', [orbital], [ice]);
    const trail = createCardInstance(s, '30057'); // Public Trail
    s.corp.hq.push(trail);
    s.runnerLastTurnRuns = [{ server: 'hq', successful: true } as (typeof s.runnerLastTurnRuns)[number]];
    s.runner.credits = 2; // can't pay 8 to dodge it
    expect(new HeuristicCorpAI().chooseAction(s)).toMatchObject({ type: 'PLAY_OPERATION_OR_EVENT', cardInstanceId: trail.instanceId });
  });

  // Rewritten in Step 4 Stage C7 against the decision (the ranking's -Infinity on the advance is gone): with one click the
  // Corp with its look-ahead does not advance (the order alone puts the advance first, line 3)
  it('does not leave an agenda half-advanced over the Runner\'s turn', () => {
    const s = structuredClone(newGame());
    const agenda = createCardInstance(s, '30069'); // Send a Message: 5 to score
    agenda.installedTurn = 'earlier';
    const ice = createCardInstance(s, '30072'); // Palisade, unrezzed
    remote(s, 'remote-9', [agenda], [ice]);
    s.corp.clicks = 1;
    s.corp.credits = 6;
    expect(new HeuristicCorpAI().chooseAction(s).type).not.toBe('ADVANCE_CARD');
  });

  // Rewritten in Step 4 Stage C7 against the order (the ranking's score gap is gone): the first ice install is on R&D
  it('ices R&D before an HQ with nothing worth stealing', () => {
    const s = structuredClone(newGame());
    s.corp.hq = [createCardInstance(s, '30072'), createCardInstance(s, '30075')];
    s.corp.credits = 8;
    const first = new HeuristicCorpAI({ planner: false }).rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD')!.action;
    expect(first).toMatchObject({ targetServerId: 'rd' });
  });

  // 'keeps money to rez ice on R&D as well as an agenda remote' compared the ranking's credit score with synergy on and off
  // (Step 4 Stage C7: deleted); the rez money owner keeps R&D staked (tests/corpOwners.test.ts, rezMoney)

  // 'adds a layer where the Runner already breaks the ice' read the ranking's iceDepth term (Step 4 Stage C7: deleted with
  // it); what the Runner breaks is the hold owner's (tests/exposure.test.ts)
});

describe('identity plans', () => {
  const remote = (s: GameState, id: string, root: CardInstance[], ice: CardInstance[] = []) =>
    (s.corp.servers[id] = { id, name: id, isRemote: true, ice, root });

  // V-B B6 item 17: an agenda's counter is the owner's step (agendaWorth on its server: here the click and credit it saves,
  // 3), no longer the iced share of its points (5); the bare Urtica's bluff and extra damage (4.3) now ranks first
  it('PT Untaian places on the card whose counter is worth most (the owner\'s step for an agenda), and skips when nothing is worth a credit', () => {
    let s = structuredClone(newGame());
    const agenda = createCardInstance(s, '30069');
    const trap = createCardInstance(s, '30045'); // Urtica Cipher
    remote(s, 'remote-8', [agenda], [createCardInstance(s, '30072')]);
    remote(s, 'remote-9', [trap]);
    s.corp.credits = 5;
    expect(untaianPick(s, [agenda.instanceId, trap.instanceId])).toEqual([trap.instanceId]);
    expect(untaianPick(s, [agenda.instanceId])).toEqual([agenda.instanceId]);
    s = structuredClone(s); // asked boards are frozen (F3 askedFreeze): edit a copy
    s.corp.credits = 1;
    expect(untaianPick(s, [agenda.instanceId])).toEqual([]);
  });

  it.fails('BANGUN installs an agenda faceup with tag punishers in hand (the order: the facedown install first)', () => {
    const s = structuredClone(newGame());
    s.corp.identity = createCardInstance(s, '35068'); // BANGUN
    const agenda = createCardInstance(s, '30067');
    s.corp.hq = [agenda, createCardInstance(s, '30065')]; // Retribution
    remote(s, 'remote-8', [], [createCardInstance(s, '30072')]);
    s.corp.clicks = 1;
    s.corp.credits = 6;
    expect(new HeuristicCorpAI().chooseAction(s)).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: agenda.instanceId, faceUp: true });
  });

  it('BANGUN: the Runner reads a faceup agenda', () => {
    const s = structuredClone(newGame());
    s.corp.identity = createCardInstance(s, '35068'); // BANGUN
    const agenda = createCardInstance(s, '30067');
    s.corp.hq = [agenda, createCardInstance(s, '30065')]; // Retribution
    remote(s, 'remote-8', [], [createCardInstance(s, '30072')]);
    s.corp.clicks = 1;
    s.corp.credits = 6;
    // The Corp half read the ranking's install scores (BANGUN's bait); under the order the facedown install comes first, so
    // that half is pinned known-failing above (Step 4 Stage C7)
    // The Runner: a faceup agenda is a sure steal, but not with a hand that 2 meat damage would empty
    let t = structuredClone(s);
    agenda.faceUp = true;
    remote(t, 'remote-9', [{ ...agenda, faceUp: true }]);
    t.runner.grip = t.runner.grip.slice(0, 3);
    expect(serverValue(t, 'remote-9', 0, undefined, true)).toBeGreaterThan(2);
    t = structuredClone(t); // asked boards are frozen (F3 askedFreeze): edit a copy
    t.runner.grip = t.runner.grip.slice(0, 1);
    expect(serverValue(t, 'remote-9', 0, undefined, true)).toBe(0);
  });

  it('Tāo Salonga swaps the ice it cannot break off the agenda remote', () => {
    let s = structuredClone(newGame());
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
    s = structuredClone(s); // asked boards are frozen (F3 askedFreeze): edit a copy
    s.corp.servers.archives.ice = [];
    expect(taoSwap(s)).toEqual([]);
  });
});

describe('draws and money', () => {
  it('a card in hand is worth about a credit up to the hand-size limit, little for one over, nothing beyond', () => {
    expect(handValue(4, 5, 'corp') - handValue(3, 5, 'corp')).toBeCloseTo(1.6);
    expect(handValue(6, 5, 'corp') - handValue(5, 5, 'corp')).toBeCloseTo(0.3);
    expect(handValue(7, 5, 'corp') - handValue(6, 5, 'corp')).toBe(0);
    expect(handValue(4, 5, 'runner') - handValue(3, 5, 'runner')).toBeCloseTo(1.6);
  });

  it('the Runner draws below the limit with money in the bank, and stops at the limit', () => {
    let s = structuredClone(newGame());
    s.activePlayer = 'runner';
    s.runner.clicks = 4;
    s.runner.credits = 8;
    s.runner.grip = s.runner.grip.slice(0, 3);
    const score = (type: string) => new HeuristicRunnerAI().rankMainActions(s).find(r => r.action.type === type)!.score;
    expect(score('DRAW_CARD')).toBeGreaterThan(score('GAIN_CREDIT'));
    s = structuredClone(s); // asked boards are frozen (F3 askedFreeze): edit a copy
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

  // RETIRED at the V-C checkpoint's pin pass (2026-11-20): the known-failing pin "clicks for credits toward a Hedge Fund
  // it can almost afford" (HQ = Hedge Fund and two cards, 3 credits: the Corp clicks for a credit, installs Anoetic Void
  // and clicks again; Hedge Fund is not reached). V-C item 3 counted the class (504 paired games, netrunner-ai/stage-vc/
  // item3-held-operation/ruling.md, found row 97): the save-up line banks 2.5 credits and loses points and wins
  // (win-adjusted -0.30 +/- 0.11), so beta's line is right on the record and the pin asserted the opposite. It is not a
  // known fault, so it leaves the known-failing list. Its board is rebuilt by scripts/stage-vc/held-op.ts (PART pin).
  // The behaviour for its own sake is the `saveUpMoney` arm of that count (not built; Jeff's call).
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
  // 'a full hand of duds still digs for ice, one card past the hand size' compared the ranking's draw scores (Step 4 Stage
  // C7: deleted). Line 7's condition decides a draw (the cards the Corp can use now against its clicks)
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
    // With money to spare beyond the reserve, it may
    s.corp.credits = 6;
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
