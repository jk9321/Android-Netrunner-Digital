import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { serverHold } from '../src/ai/corp/hold';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { corpDecisionView } from '../src/ai/turnPlanner';
import { oracleGetsIn, oracleStart } from '../scripts/stage-d/hold-oracle';

/**
 * Step 4 Stage D pins (spec-step4-corp-core.md section 5; AI Coordinator 2026-11-14 17:56Z), committed in Stage B as
 * known-failing so the holes stay visible through Stages B and C. Each one asserts the Corp's DECISION at Jeff's
 * recorded state (the Normal Corp, planner on), as "it does not play the recorded mistake"; the D branch that fixes it
 * turns the pin over and tightens the assertion. States: the report's moves replayed to move N (as centralIce.test.ts).
 *
 * Not pinned here:
 *  - #53 #62 (Jaguarundi discarded at the end of turn 4): the decision was earlier in the turn, when the clicks went to the
 *    score-now line; covered by #53 #76 and #191 and by D6.
 *  - D1 bioroid clicks, D2 encounter tolls, D5 the 7-point steal: no recorded state; the D1, D2 and D5 branches owe them.
 */
const report = (n: number) => JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
const at = (n: number, move: number): { s: GameState; recorded: GameAction } => {
  const r = report(n);
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return { s, recorded: r.moves[move] };
};
const decide = (s: GameState): GameAction => createAgent('corp', 'normal').chooseAction(s);
type Install = GameAction & { cardInstanceId?: string; targetServerId?: string };
const T = 120_000;

describe('Stage D pins (known-failing until their fix lands)', () => {
  // D4, the open case: HQ behind one ice the rig beats; the ice went to a remote. Expected: on HQ
  // #49 #82 is a guard since beta 545f146 (the Runner AI plays from a guessed stack; clickWorth's key holds the board): the
  // Corp now advances Send a Message in remote-6 instead. D4 still owes the HQ ice and turns this into the HQ assertion
  // #49 #111 was a guard from ai-runner-unknowns to ai-rez-stops: the Corp installed Send a Message in remote-6 instead.
  // It held only by the rez budget's per-decision stop note (anchor.stops), which served a look-ahead board's stop to the
  // decision's own board (Tithe on remote-2: 3.91 noted, 3.72 on the root). With the note deleted (ai-rez-stops) the
  // Corp installs Ansel on remote-6 again, the original D4 mistake: known-failing until D4 owes the HQ ice
  // Stage D item 5 (2026-11-18, counted, not built; netrunner-ai/stage-d/item5-placement/design-answer.md, found-list
  // rows 50 to 52): spec 1.8 ice rule 2 and HQ-first do not fix this board with the look-ahead on (the planner then plays
  // another card), and played out they cost the Corp games: the destination alone is not where the Corp loses. The cause
  // is a lead for tuning (row 50: each ice is offered at one destination, so the planner cannot weigh HQ against the
  // remote). Known-failing
  // Since ai-runner-money (Stage D item 1 follow-up 4, part 1) the Corp's first action here is a draw: "Knickknack"
  // O'Brian is in the Runner's rig, and with its first-run money counted HQ's run count goes 2 to 3 (the oracle's own
  // +1: 3 without Knickknack, 4 with). The install follows on the next click (the override check,
  // followup4-runner-money/override-check.md), so the pin asserts over the Corp's whole turn (below). D4 still owes the
  // HQ ice
  for (const [n, m, title, remote, since, fails] of [
    [49, 82, 'Lycian Multi-Munition', 'remote-4', 'guard since beta 545f146', false],
  ] as const) {
    (fails ? it.fails : it)(`D4 #${n} #${m}: ${title} is not installed on ${remote} (expected: HQ) (${since})`, { timeout: T }, () => {
      const { s, recorded } = at(n, m);
      const id = (recorded as Install).cardInstanceId!;
      expect(cardDef(findCardAnywhere(s, id)!).title).toBe(title);
      const a = decide(s) as Install;
      expect(a.type === 'INSTALL_CARD' && a.cardInstanceId === id && a.targetServerId === remote).toBe(false);
    });
  }
  it.fails('D4 #49 #111: Ansel 1.0 is not installed on remote-6 in the rest of the Corp\'s turn (expected: HQ) (known-failing: since ai-runner-money a draw first, the install on the next click)', { timeout: T }, () => {
    const { s: s0, recorded } = at(49, 111);
    const id = (recorded as Install).cardInstanceId!;
    expect(cardDef(findCardAnywhere(s0, id)!).title).toBe('Ansel 1.0');
    // The Corp's clicks from move 111 to the end of its turn, by its own Normal agent (a Normal Runner answers any prompt)
    const corp = createAgent('corp', 'normal');
    const runner = createAgent('runner', 'normal');
    const played: Install[] = [];
    let s = s0;
    for (let k = 0; k < 40 && !s.winner && s.turnNumber === s0.turnNumber && s.activePlayer === 'corp'; k++) {
      const side = actingSide(s);
      const a = (side === 'corp' ? corp : runner).chooseAction(s) as Install;
      if (side === 'corp') played.push(a);
      s = executeAction(s, a);
    }
    expect(played.length).toBeGreaterThan(0);
    expect(played.some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === id && a.targetServerId === 'remote-6')).toBe(false);
  });

  // A guard, not a pin: since centralIce the Corp puts Descent on bare R&D, not remote-1. D4 decides whether R&D or HQ
  // (4 agendas behind one ice) is right here; Jeff expected HQ
  // Item 5 (2026-11-18, counted, not built): rule 2 and HQ-first put Descent on HQ only with the look-ahead off (HQ is
  // still open then, need 3 of 10); with the look-ahead on the Corp draws. item5-placement/design-note.md section 8
  it('#53 #191 guard: Descent is not installed on remote-1 (R&D since centralIce; D4 decides R&D or HQ)', { timeout: T }, () => {
    const { s, recorded } = at(53, 191);
    const id = (recorded as Install).cardInstanceId!;
    expect(cardDef(findCardAnywhere(s, id)!).title).toBe('Descent');
    const a = decide(s) as Install;
    expect(a.type === 'INSTALL_CARD' && a.cardInstanceId === id && a.targetServerId === 'remote-1').toBe(false);
  });

  // D4, the reservation: the only iced remote (Piranhas) is kept for an agenda while two wait in HQ. Recorded card
  // Balanced Coverage; today the Corp makes the same mistake with Federal Fundraising
  // A guard since ai-runner-unknowns: the Corp now clicks for a credit here (not a D4 fix; D4 still owes the reservation)
  // D4 #53 #76 (no asset into remote-5, the only iced remote): a guard since ai-runner-unknowns under the ranking; under the
  // order it fails again (the original D4 mistake), pinned known-failing below ('Stage C, D4 #53 #76')

  // D6: Jaguarundi and Oracle Thinktank discarded while Public Access Plaza was in HQ
  // Passes since V-B B3 (the asset formulas at the measured risk, ruling 5, which named this pin as one that may turn over)
  it('D6 #53 #112: no agenda is discarded while a non-agenda is in HQ', { timeout: T }, () => {
    const { s } = at(53, 112);
    const a = decide(s) as GameAction & { choice?: { kind: string; cardInstanceIds?: string[] } };
    expect(a.choice?.kind).toBe('discard');
    const thrown = (a.choice?.cardInstanceIds ?? []).map(id => s.corp.hq.find(c => c.instanceId === id)!);
    const kept = s.corp.hq.filter(c => !thrown.includes(c));
    const agendaThrown = thrown.some(c => cardDef(c).type_code === 'agenda');
    expect(agendaThrown && kept.some(c => cardDef(c).type_code !== 'agenda')).toBe(false);
  });

  // D3, install prompts (Part B): the prompt was declined though a legal install existed. Expected (D3): it installs a
  // card, and its target is place(card, ...)[0]
  // #49 #219 passes since ai-hr-install-steps (corp/hqSteps.ts: the deciding Corp answers an HQ install pick with the
  // order's first install it does not put behind). #50 #252 stays known-failing: with 1 credit the order puts both ice
  // behind (not paid for) and leaves Project Ingatan out (freeInstallOrder takes no agenda), so the fallback declines
  for (const [n, m, source, pinned] of [
    [49, 219, 'Humanoid Resources', false],
    [50, 252, 'Top-Down Solutions', true],
  ] as const) {
    (pinned ? it.fails : it)(`D3 #${n} #${m}: the ${source} install prompt is not declined`, { timeout: T }, () => {
      const { s } = at(n, m);
      const p = s.pendingPrompts[0] as unknown as { kind: string; candidateIds: string[]; message: string };
      expect(p.kind).toBe('effect_cards');
      expect(p.message.startsWith(source)).toBe(true);
      expect(p.candidateIds.length).toBeGreaterThan(0);
      const a = decide(s) as GameAction & { choice?: { cardInstanceIds?: string[] } };
      expect(a.choice?.cardInstanceIds?.length ?? 0).toBeGreaterThan(0);
    });
  }

  // Stage C (AI Coordinator 2026-11-15 12:50Z): deal 1001 T10 (tests/iceRedirect.test.ts). Expected: ice on remote-1, the
  // scoring remote that does not hold. Today, under the new order with the look-ahead, the Regolith Mining License click:
  // no counted question takes the click; line 2 offers both Palisades on remote-1 (each improves its entries), the planner's
  // K is Palisade, Palisade, Regolith, Whitespace, and the playouts value the Regolith click -13.65 against -18.83 for the
  // ice (scripts/stage-c/fixture-candidates.ts). Cause: the leaf gives no worth to an empty scoring remote that now holds
  // (valuation, not the order; line 2 is not exempted from the look-ahead to cover it). The no-look-ahead Corp plays the
  // line-2 ice (tests/corpCandidates.test.ts)
  // Passed from V-B B6 item 33 (a rezzed profiled card's hosted credits read the owner, countersWorth) only by keeping
  // the Regolith click out of K. Known-failing again with the hold walk (Stage D item 1, AI Coordinator's ruling,
  // walk-rulings.md): no counted question takes the click; line 2 now offers all four ice, Whitespace first (the walk
  // prices its credit loss and its "6 or less"), and R&D's count is need 5 and 1 entry, holds false against the
  // Runner's 14 (beta: need 1, 4 entries; the oracle: one run gets in under every rez set). K becomes Whitespace,
  // Palisade, a credit, a draw, and the Regolith click is valued beside them: -6.19 against -12.20 for the ice. The
  // cause is the one above, the leaf's worth (valuation), not the count (walk-measurements.md section 3)
  it.fails('Stage C, deal 1001 T10: the Corp with the look-ahead installs ice on remote-1 (was: the Regolith click)', { timeout: 480_000 }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/ice-redirect-1001-t10.json', import.meta.url), 'utf8'));
    const a = new HeuristicCorpAI({ synergy: true }).chooseAction(s) as Install;
    expect(a.type).toBe('INSTALL_CARD');
    expect(cardDef(findCardAnywhere(s, a.cardInstanceId ?? '')!).type_code).toBe('ice');
    expect(a.targetServerId).toBe('remote-1');
  });

  // Bug report #4 under the new core (c0-rulings 16:00Z (1)): the order's first move is ice on HQ (corpCandidates.test.ts),
  // but the look-ahead plays Palisade into a new remote (the build slot) and then two Clearinghouse advances; HQ ends at
  // two ice (scripts/stage-c/turn-trace.ts STATE=tests/fixtures/bug-report-4-turn13.json). Stage C thought the cause was
  // the playouts' leaf pricing the game-ending steal as ordinary points (valuation, Stage D5), not the order; Stage D item 4
  // found otherwise (below)
  // Stage D item 4 (2026-11-17, counted, not built; netrunner-ai/stage-d/item4-game-end/design-answer.md sections 7 and 8):
  // neither ordering a game-ending access first nor pricing a near loss moves this board. The reply's Runner never runs HQ
  // here (found-list row 44) and plays with its planner off (row 36), and the count says the third ice does not hold HQ
  // (need 2, budget 9), so this pin asks for a toll, not a hold. Known-failing until the Runner rework
  it.fails('Stage C, bug report #4: with the look-ahead HQ gets its third ice', { timeout: 240_000 }, () => {
    let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-4-turn13.json', import.meta.url), 'utf8'));
    {
      const corp = createAgent('corp', 'normal');
      for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
        const a = corp.chooseAction(s);
        s = executeAction(s, a);
        if (a.type === 'END_TURN') break;
      }
    }
    expect(s.corp.servers.hq.ice.length).toBeGreaterThanOrEqual(3);
  });

  // Humanoid Resources under the new core (brokeCorp.test.ts; c0-rulings 15:50Z (5)): rezToUse asks for its ability to be
  // the order's first candidate after the rez; there it is behind, the model's play value of the ability (-2.06) below
  // the three credits its clicks would take. Valuation, not fixed in Stage C. Board: brokeCorp.test.ts idle()
  const hrBoard = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/humanoid-resources-idle.json', import.meta.url), 'utf8'));
  const hr = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root).find(c => c.cardCode === '35039')!;
  it.fails('Stage C, Humanoid Resources: rezzed in the action phase with the 3 clicks to use it', { timeout: T }, () => {
    const s = hrBoard();
    const a = new HeuristicCorpAI({ planner: false }).chooseAction(s);
    expect(a).toMatchObject({ type: 'REZ_CARD', cardInstanceId: hr(s).instanceId });
  });
  it.fails('Stage C, Humanoid Resources: a rez in the action phase is followed by using it', { timeout: T }, () => {
    let s = hrBoard();
    const id = hr(s).instanceId;
    let rezzed = false;
    let used = false;
    {
      const corp = new HeuristicCorpAI({ planner: false });
      for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
        const a = corp.chooseAction(s);
        if (rezzed && a.type === 'USE_ABILITY' && a.cardInstanceId === id) used = true;
        if (a.type === 'REZ_CARD' && a.cardInstanceId === id) rezzed = true;
        s = executeAction(s, a);
        if (a.type === 'END_TURN') break;
      }
    }
    expect(rezzed && used).toBe(true);
  });

  // D4 #53 #76 under the order (c0-rulings 15:50Z (6)): the guard held for the ranking; the order installs the asset in
  // remote-5 again, the original D4 mistake (the reservation, owed by Stage D)
  // Passes since V-B B3 (the asset formulas at the measured risk, ruling 5, which named this pin as one that may turn over)
  it('Stage C, D4 #53 #76: no asset is installed in remote-5 under the new core', { timeout: T }, () => {
    const { s } = at(53, 76);
    const a = decide(s) as Install;
    const card = a.cardInstanceId ? s.corp.hq.find(c => c.instanceId === a.cardInstanceId) : undefined;
    expect(a.type === 'INSTALL_CARD' && a.targetServerId === 'remote-5' && !!card && cardDef(card).type_code === 'asset').toBe(false);
  });

  // Bug report #15 under the new core (c0-rulings 16:10Z (2)): the hqNoSafer clause is gone from line 3. On the turn-10
  // position the Runner gets into every server for 0 credits (the hold owner's need is 0 on HQ, both remotes and a new
  // remote: scripts/stage-c/hold-probe.ts STATE=tests/fixtures/bug-report-15-turn10.json), so the hold owner cannot say
  // that HQ is no safer than Jaguarundi's remote; the old rule told them apart only through entryCost, which the hold
  // owner replaced. Offworld Office stays a line-9 candidate. The Stage D hold-owner item
  it.fails('Stage C, bug report #15: Offworld Office leaves HQ for an iced remote', { timeout: T }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-15-turn10.json', import.meta.url), 'utf8'));
    const a = decide(s) as Install;
    expect(a.type).toBe('INSTALL_CARD');
    expect(cardDef(findCardAnywhere(s, a.cardInstanceId ?? '')!).title).toBe('Offworld Office');
    expect((s.corp.servers[a.targetServerId ?? '']?.ice.length ?? 0) > 0).toBe(true);
  });

  // freeRez.test.ts 'installs Pharos first and rezzes it for free' under the new core (c0-rulings 16:10Z (8)): with the
  // paid test reading the free rez to come (placement icePaidAt, freeRezTargets) Pharos is paid, but place puts it in a
  // new remote with nothing behind it and the free rez goes to Palisade on the scoring remote. Owed: the trace of which
  // rule of place does it (c3-tests-both.md)
  it.fails('Stage C, Send a Message one advance out: Pharos is installed first and rezzed for free', { timeout: T }, () => {
    const s = newGame(3);
    s.corp.hq = [];
    installIceForTest(s, '30072', 'rd', true);
    installIceForTest(s, '30072', 'hq', true);
    installProgramForTest(s, '30026');
    s.runner.credits = 6;
    s.turnNumber = 7;
    s.corp.credits = 4;
    installIceForTest(s, '30074', 'remote1', true);
    installCorpForTest(s, '30069', 'remote1');
    s.corp.servers.remote1.root[0].advancementCounters = 4;
    giveCard(s, 'corp', '30063');
    giveCard(s, 'corp', '30072');
    let t = s;
    {
      const corp = new HeuristicCorpAI();
      for (let i = 0; i < 20 && t.activePlayer === 'corp'; i++) {
        const a = corp.chooseAction(t);
        if (a.type === 'END_TURN') break;
        t = executeAction(t, a);
      }
    }
    expect(t.corp.score).toBe(3);
    expect(Object.values(t.corp.servers).flatMap(v => v.ice).some(c => c.cardCode === '30063' && c.isRezzed)).toBe(true);
  });
  // Red team F8 (adversarial/2026-11-17-hold-walk, ruled 02:50Z): the hold walk counts installed cards only (10.2.2a; the
  // grip is not read), so a remote behind two rezzed Brân 1.0 holds against an empty rig: 4 clicks to break, 1 to run
  // (1.16.1). A Runner with Mayfly in the grip and $9 installs it (a click, $1), breaks one Brân with it (+5 strength
  // $5, both subroutines $2) and the other with 2 clicks: 4 clicks, $8. The Corp installs Longevity Serum there. Owned by
  // the deck-list capability item (exploit pin F2's family); the bar reports steals from bioroid remotes on their own line
  it.fails('F8: an agenda is not installed behind a lone bioroid wall the grip can beat (deck-list capability)', { timeout: T }, () => {
    const s = newGame(5);
    s.turnNumber = 7;
    s.corp.hq = [];
    giveCard(s, 'corp', '30044');
    giveCard(s, 'corp', '30072');
    s.corp.credits = 8;
    installIceForTest(s, '30039', 'remote1', true);
    installIceForTest(s, '30039', 'remote1', true);
    installIceForTest(s, '30072', 'hq', true);
    installIceForTest(s, '30072', 'rd', true);
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.runner.credits = 9;
    giveCard(s, 'runner', '30032');
    const a = decide(s) as Install;
    expect(a.type === 'INSTALL_CARD' && cardDef(s.corp.hq.find(c => c.instanceId === a.cardInstanceId)!).type_code === 'agenda' && a.targetServerId === 'remote1').toBe(false);
  });

  // The failed first run (Stage D item 1's first follow-up, branch ai-hold-retry; pinned by the 13:05Z ruling in
  // walk-rulings.md, fixed by the brief rev 2): the truth of `holds` is the whole turn: after a run ends (6.1.4) the
  // Runner may clear a tag (5.2.7g) or meet a rezzed ice without what its rez gave for that run only (Thunderbolt
  // Armaments; 6.8.5, 6.9.6d) and run again. Each board's truth is checked by the engine oracle, which plays the Runner's
  // whole turn with failed runs allowed.
  describe('the failed first run (item 1 follow-up)', () => {
    const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
    const holds = (s: GameState, server: string, corp = s.corp.credits) => inCorp(s, () => serverHold(s, server, { when: 'runnerTurn', corpCredits: corp }).holds);
    // Ping's board: Lamplighter rezzed, Ping unrezzed outside it, Cleaver, $10 and 4 clicks. Ping's rez tags the Runner and
    // Lamplighter ends the run; the Runner clears the tag and runs again past Ping already rezzed (no new tag)
    const ping = () => {
      const s = newGame(3);
      s.corp.hq = [];
      s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
      s.corp.credits = 20;
      s.turnNumber = 7;
      installIceForTest(s, '35080', 'remote1', true);
      installIceForTest(s, '30055', 'remote1', false);
      installProgramForTest(s, '30006');
      s.runner.credits = 10;
      return s;
    };
    // Human game 49 turn 1: Thunderbolt Armaments, Diviner unrezzed on R&D, nothing installed. Diviner's gained
    // subroutine ends the first run; the second meets Diviner rezzed without it. The line the oracle finds (red team 11):
    // with 2 clicks it holds (the second run's net damage, from the game's seed, trashes an odd-cost card and Diviner
    // ends the run), with 3 a third run gets in. The walk leaves Diviner's odd-cost end out (a fact of the grip it does
    // not read), so it gets in on the second run: the pin agrees with the walk's convention (the safe side, "does not
    // hold"), not with a hidden-card truth (2 of the grip's 5 cards have an even cost).
    const thunderbolt = () => JSON.parse(readFileSync(new URL('./fixtures/hold-walk/thunderbolt-49-t1-rd.json', import.meta.url), 'utf8')) as { server: string; state: GameState };

    it("the boards' truth: one run is kept out, the whole turn gets in", { timeout: T }, () => {
      const s = ping();
      const pingId = [s.corp.servers.remote1.ice[1].instanceId];
      expect(oracleGetsIn(s, 'remote1', 'runnerTurn', pingId).answer).toBe('holds');
      expect(oracleGetsIn(s, 'remote1', 'runnerTurn', pingId, undefined, undefined, true).answer).toBe('getsIn');
      const f = thunderbolt();
      const all = f.state.corp.servers[f.server].ice.map(c => c.instanceId);
      expect(oracleGetsIn(f.state, f.server, 'runnerTurn', all, Infinity).answer).toBe('holds');
      expect(oracleGetsIn(f.state, f.server, 'runnerTurn', all, Infinity, undefined, true).answer).toBe('getsIn');
    });
    it("Ping's board: the hold walk does not count the server as holding (the tag is cleared, a second run gets in)", { timeout: T }, () => {
      expect(holds(ping(), 'remote1')).toBe(false);
    });
    it('game 49 turn 1, Thunderbolt Armaments: the hold walk does not count R&D as holding (a second run gets in)', { timeout: T }, () => {
      const f = thunderbolt();
      expect(holds(f.state, f.server, Infinity)).toBe(false);
    });
  });

  // ai-runner-money part 1 (Stage D item 1 follow-up 4, design answer 7): "Knickknack" O'Brian is counted as a bound, the
  // largest printed install cost among the Runner's other installed cards, gained with the card kept. Its true-answer
  // board: human game 54, Runner turn 7, remote-2 (Pharos rezzed, N-Pot unrezzed; Principia, GAMEDRAGON Pro and
  // Knickknack installed; the Runner on $0, the Corp on 3). The oracle, which plays the engine's Runner turn, finds no way
  // in: the only gain that pays is Principia's 4, and Principia trashed cannot break Pharos. The bound gains the 4 and
  // keeps Principia, so the count says "does not hold" (one of the bound's 417 false "does not hold" on the step 1
  // questions, the hold row's debt line in docs/ai-priced-quantities.md): known-failing until Knickknack is counted
  // exactly.
  describe('"Knickknack" O\'Brian counted as a bound (ai-runner-money part 1)', () => {
    const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
    const knickknack = () => JSON.parse(readFileSync(new URL('./fixtures/hold-walk/knickknack-54-t7-remote2.json', import.meta.url), 'utf8')) as { server: string; opts: { corpCredits: number }; state: GameState };

    it("the board's truth: the oracle finds no way in over the Runner's whole turn", { timeout: T }, () => {
      const f = knickknack();
      expect(f.state.runner.rig.resources.some(c => c.cardCode === '35033')).toBe(true);
      expect(oracleGetsIn(f.state, f.server, 'runnerTurn', [], f.opts.corpCredits, undefined, true).answer).toBe('holds');
    });
    it.fails('game 54 turn 7: the hold count says remote-2 holds (known-failing: the bound keeps Principia and gains its 4)', { timeout: T }, () => {
      const f = knickknack();
      expect(inCorp(f.state, () => serverHold(f.state, f.server, { when: 'runnerTurn', corpCredits: f.opts.corpCredits }).holds)).toBe(true);
    });
  });

  // Madani's hosted programs (Stage D, Madani counts 1 and 2: netrunner-ai/stage-d/madani-hosted/, rulings ruling.md and
  // ruling-count2.md; found rows 61, 70a, 77). Madani: "click: Host any number of programs from your grip faceup on this
  // hardware. (They are not installed.) Once per turn -> 0 credits: Install 1 hosted program (paying its install cost)."
  // Chromatophores: "Install only on a piece of ice. Host ice gains barrier, code gate, and sentry." Human game report-40,
  // move 67 (turn 5, the Corp on $4 and 3 clicks about to install Luminal Transubstantiation in remote-2; the Runner on $5;
  // Madani hosts two Chromatophores; remote-2 has Flyswatter unrezzed). In the game the Runner installed a hosted
  // Chromatophores on Flyswatter during the run, broke it with Principia and got in (trace count2-trace-report40-T5.txt).
  // Hosted cards are faceup and public (Madani's text; rule 8.5.2's hidden information does not apply), so the Corp may
  // read them, but the hold count reads only the installed rig: it says remote-2 holds (rez Flyswatter, need Infinity,
  // budget 10). The oracle (engine, the Runner's whole turn, retries on) gets in with and without Flyswatter rezzed. The
  // count is asked on the Corp's own view (corpDecisionView), so it reads no hidden card; the oracle reads the real board,
  // by design ("measuring only"). Both readers counted failed their marks, so Madani is parked until the Runner rework:
  // known-failing until then.
  describe("Madani's hosted programs (parked until the Runner rework, found row 70a)", () => {
    const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
    const board = () => {
      const { s, recorded } = at(40, 67);
      expect(recorded).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'remote-2' });
      expect(cardDef(findCardAnywhere(s, (recorded as Install).cardInstanceId!)!).title).toBe('Luminal Transubstantiation');
      expect([s.turnNumber, s.activePlayer, s.corp.credits, s.corp.clicks, s.runner.credits]).toEqual([5, 'corp', 4, 3, 5]);
      const madani = s.runner.rig.hardware.find(c => c.cardCode === '35028')!;
      expect((madani.hostedCards ?? []).map(c => cardDef(c).title)).toEqual(['Chromatophores', 'Chromatophores']);
      const ice = s.corp.servers['remote-2'].ice;
      expect(ice.map(c => [cardDef(c).title, c.isRezzed])).toEqual([['Flyswatter', false]]);
      return { s, flyswatter: ice[0].instanceId };
    };

    it("report-40 turn 5, the board's truth: the oracle gets in on remote-2 over the Runner's whole turn, Flyswatter rezzed or not", { timeout: T }, () => {
      const { s, flyswatter } = board();
      expect(oracleGetsIn(s, 'remote-2', 'runnerTurn', [], undefined, 200_000, true).answer).toBe('getsIn');
      expect(oracleGetsIn(s, 'remote-2', 'runnerTurn', [flyswatter], undefined, 200_000, true).answer).toBe('getsIn');
    });
    it.fails("report-40 turn 5: the hold count does not say remote-2 holds (known-failing: Madani's hosted Chromatophores are not read; parked until the Runner rework, found row 70a)", { timeout: T }, () => {
      const { s } = board();
      expect(inCorp(s, () => {
        const v = corpDecisionView(s);
        decisionContext(v, 'corp');
        return serverHold(v, 'remote-2', { when: 'runnerTurn', corpCredits: s.corp.credits }).holds;
      })).toBe(false);
    });
  });

  // Side Hustle, Alarm Clock and Hannah "Wheels" Pilintra (Stage D count bound item, count 2 Part F: netrunner-ai/stage-d/
  // count-bound/count2-note.md, ruling-2.md; found row 80a). Card text (src/data):
  //  - Side Hustle: "When you install this resource and whenever a run begins, place 1[credit] on this resource. When there
  //    are 6 or more hosted credits, take all credits from this resource, trash it, and draw 1 card."
  //  - Alarm Clock: "When your turn begins, you may run HQ. The first time you encounter a piece of ice during that run,
  //    you may spend [click][click] to bypass it."
  //  - Hannah "Wheels" Pilintra: "Once per turn -> [click]: Gain [click]. Run a remote server. When that run ends, if it
  //    was unsuccessful, take 1 tag. [click], [trash]: Gain [click][click]. Remove 1 tag."
  // Human game report-33, move 308 (Corp decision #119 of the count's numbering: turn 17, the Corp on $16 and 2 clicks
  // about to draw; the Runner on $0; R&D has Logjam rezzed and Syailendra unrezzed). The hold count, asked on the Corp's
  // own view, says R&D holds with Syailendra rezzed (need 8, budget 4): its earnings for the Runner's turn do not see the
  // runs Alarm Clock and Hannah start on other servers, each of which puts a credit on Side Hustle. The oracle
  // (hold-oracle.ts: the engine, the Runner's whole turn, retries on) gets in, but only after 924k actions (5.5 minutes),
  // too slow for a test, so the truth half replays the line the oracle found (count-bound-oracle-line.ts) through the
  // engine from the oracle's own start board: Alarm Clock's run on HQ, three clicks for credits, Hannah's run on a remote,
  // the click Hannah gives for a credit, then the run on R&D. Side Hustle's sixth credit lands as that run begins ($4 to $10),
  // the Corp rezzes Syailendra, and Unity boosts and breaks. Known-failing until the count's earnings read the runs a
  // turn's cards start.
  describe('Side Hustle fed by runs other cards start (found row 80a)', () => {
    const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
    const board = () => {
      const { s, recorded } = at(33, 308);
      expect(recorded).toMatchObject({ type: 'DRAW_CARD', player: 'corp' });
      expect([s.turnNumber, s.activePlayer, s.corp.credits, s.corp.clicks, s.runner.credits]).toEqual([17, 'corp', 16, 2, 0]);
      const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title);
      expect(rig).toEqual(['Unity', 'Carmen', 'Curupira', 'Hermes', 'Alarm Clock', 'Docklands Pass', 'Verbal Plasticity', 'Hannah "Wheels" Pilintra', 'Side Hustle']);
      const ice = s.corp.servers.rd.ice;
      expect(ice.map(c => [cardDef(c).title, c.isRezzed])).toEqual([['Logjam', true], ['Syailendra', false]]);
      return { s, syailendra: ice[1].instanceId };
    };
    // The oracle's line from its start board (the Corp's turn ended with its clicks unused; then the Runner's turn)
    const LINE: GameAction[] = [
        {type: 'RESOLVE_PROMPT', player: 'runner', promptId: 'prompt-59', choice: {kind: 'effect_choice', optionId: 'yes'}},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'RESOLVE_PROMPT', player: 'runner', promptId: 'prompt-60', choice: {kind: 'effect_choice', optionId: 'no'}},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'GAIN_CREDIT', player: 'runner'},
        {type: 'GAIN_CREDIT', player: 'runner'},
        {type: 'GAIN_CREDIT', player: 'runner'},
        {type: 'USE_ABILITY', player: 'runner', cardInstanceId: 'inst-71', abilityIndex: 0},
        {type: 'RESOLVE_PROMPT', player: 'runner', promptId: 'prompt-61', choice: {kind: 'effect_choice', optionId: 'remote-3'}},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'PASS', player: 'corp'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'PASS', player: 'corp'},
        {type: 'USE_ABILITY', player: 'runner', cardInstanceId: 'inst-71', abilityIndex: 1},
        {type: 'GAIN_CREDIT', player: 'runner'},
        {type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'REZ_CARD', player: 'corp', cardInstanceId: 'inst-44'},
        {type: 'PASS', player: 'corp'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'RESOLVE_PROMPT', player: 'corp', promptId: 'prompt-62', choice: {kind: 'effect_cards', cardInstanceIds: []}},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-63'},
        {type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-63'},
        {type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-74'},
        {type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-74'},
        {type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-74'},
        {type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: 'inst-74', subroutineIndices: [0]},
        {type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: 'inst-74', subroutineIndices: [1]},
        {type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: 'inst-74', subroutineIndices: [2]},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'CONTINUE_RUN', player: 'runner'},
        {type: 'PASS', player: 'corp'},
    ] as GameAction[];

    it("report-33 turn 17, the board's truth: the oracle's line gets in on R&D with Syailendra rezzed", { timeout: T }, () => {
      const { s, syailendra } = board();
      const start = oracleStart(s, { when: 'runnerTurn', targets: ['rd'], rez: new Set([syailendra]), retries: true });
      if ('skipped' in start) throw new Error(start.skipped);
      let x = start.state;
      let rezzed = false;
      for (const a of LINE) {
        x = executeAction(x, a);
        if (findCardAnywhere(x, syailendra)?.isRezzed) rezzed = true;
      }
      expect(rezzed).toBe(true);
      const breached = (!!x.activeRun && x.activeRun.server === 'rd' && (x.activeRun.phase === 'access' || !!x.activeRun.breached)) || x.runsThisTurn.some(r => r.server === 'rd' && r.successful);
      expect(breached).toBe(true);
    });
    it.fails('report-33 turn 17: the hold count does not say R&D holds (known-failing: runs started by Alarm Clock and Hannah feed Side Hustle; the count\'s earnings do not see them; found row 80a)', { timeout: T }, () => {
      const { s } = board();
      expect(inCorp(s, () => {
        const v = corpDecisionView(s);
        decisionContext(v, 'corp');
        return serverHold(v, 'rd', { when: 'runnerTurn', corpCredits: s.corp.credits }).holds;
      })).toBe(false);
    });
  });
});

// Found row 59 (Stage D, count run 44530910615; count-note.md and ruling.md in netrunner-ai/stage-d/prompt-chain/): parked
// as known debt. Anoetic Void (30050): "Whenever the Runner approaches this server, you may pay 2[credit] and trash 2
// cards from HQ. If you do, end the run." The prompt fallback scores each answer on the board one step later, before the
// cost paid in the card's follow-up prompt (followChain follows identities only), so "yes" ties "no" and the first option
// wins: the Corp pays on remotes that hold no agenda. In the count, beta's "yes" sent an agenda from HQ to Archives on 25
// of 62 such boards; none of the 25 held two non-agenda cards in HQ (beta's trash step took the non-agenda card first on
// every board that had one), and on 5 of them a trashed agenda was later stolen from Archives.
// The board: deal 2141 (g1 base 44381468776, Normal v Normal), the source game's decision 250, turn 15: the Runner
// approaches remote-3 (root Regolith Mining License and Anoetic Void, no agenda); HQ holds Send a Message and a Regolith
// Mining License; the Corp has 11 credits. Saved by scripts/stage-d/prompt-chain-pin-boards.ts (BOARDS=2141:250 DUMP=...)
// with beta's two answers and the 11 recorded moves from the board to the steal (turn 16). The replayed line names prompt
// ids, so an engine change in how prompts are numbered breaks the passing half, not the AI (as the report-33 pin).
describe('Anoetic Void paid with an agenda (found row 59)', () => {
  const pin = () =>
    JSON.parse(readFileSync(new URL('./fixtures/anoetic-void-2141-t15.json', import.meta.url), 'utf8')) as { state: GameState; answers: GameAction[]; line: GameAction[] };
  const AGENDA = 'inst-7';
  const inArchives = (s: GameState, id: string) => [...s.corp.archives.faceUp, ...s.corp.archives.faceDown].some(c => c.instanceId === id);

  it("the board: beta's answers send Send a Message to Archives from a run that steals nothing, and the Runner steals it there next turn", () => {
    const { state: s0, answers, line } = pin();
    expect(s0.turnNumber).toBe(15);
    expect(s0.corp.credits).toBe(11);
    expect(s0.corp.hq.map(c => `${cardDef(c).type_code}:${cardDef(c).title}`)).toEqual(['agenda:Send a Message', 'asset:Regolith Mining License']);
    expect(s0.activeRun?.server).toBe('remote-3');
    const root = s0.corp.servers['remote-3'].root.map(c => cardDef(c));
    expect(root.map(d => d.title).sort()).toEqual(['Anoetic Void', 'Regolith Mining License']);
    expect(root.some(d => d.type_code === 'agenda')).toBe(false);
    const p = s0.pendingPrompts[0] as unknown as { side: string; source: { cardCode: string; step: string } };
    expect([p.side, p.source.cardCode, p.source.step]).toEqual(['corp', '30050', 'approach']);
    let s = s0;
    for (const a of answers) s = executeAction(s, a);
    expect(s.corp.credits).toBe(9);
    expect(inArchives(s, AGENDA)).toBe(true);
    expect(s.activeRun).toBeNull();
    for (const a of line) s = executeAction(s, a);
    expect(s.runner.scoreArea.some(c => c.instanceId === AGENDA)).toBe(true);
  });

  it.fails('the Corp sends no agenda from HQ to Archives here (known-failing: the answer is scored before its cost, rows 59 and 81a)', { timeout: T }, () => {
    let s = pin().state;
    for (let k = 0; k < 4; k++) {
      const p = s.pendingPrompts[0] as unknown as { side: string; source?: { cardCode: string } } | undefined;
      if (!p || p.side !== 'corp' || p.source?.cardCode !== '30050' || actingSide(s) !== 'corp') break;
      s = executeAction(s, decide(s));
    }
    expect(inArchives(s, AGENDA)).toBe(false);
  });
});
