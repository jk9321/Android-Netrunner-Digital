import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { plan, withPricing } from '../src/ai/pricing';

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
  // #49 #111 is a guard since ai-runner-unknowns (the Runner's prices that the Corp's model reads): the Corp now installs
  // Send a Message in remote-6 instead. Not a D4 fix: D4 still owes the HQ ice
  for (const [n, m, title, remote, since] of [
    [49, 82, 'Lycian Multi-Munition', 'remote-4', 'beta 545f146'],
    [49, 111, 'Ansel 1.0', 'remote-6', 'ai-runner-unknowns'],
  ] as const) {
    it(`D4 #${n} #${m}: ${title} is not installed on ${remote} (expected: HQ) (guard since ${since})`, { timeout: T }, () => {
      const { s, recorded } = at(n, m);
      const id = (recorded as Install).cardInstanceId!;
      expect(cardDef(findCardAnywhere(s, id)!).title).toBe(title);
      const a = decide(s) as Install;
      expect(a.type === 'INSTALL_CARD' && a.cardInstanceId === id && a.targetServerId === remote).toBe(false);
    });
  }

  // A guard, not a pin: since centralIce the Corp puts Descent on bare R&D, not remote-1. D4 decides whether R&D or HQ
  // (4 agendas behind one ice) is right here; Jeff expected HQ
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
  it('D4 #53 #76: no asset is installed in remote-5, the only iced remote (recorded Balanced Coverage; guard since ai-runner-unknowns)', { timeout: T }, () => {
    const { s } = at(53, 76);
    const a = decide(s) as Install;
    const card = a.cardInstanceId ? s.corp.hq.find(c => c.instanceId === a.cardInstanceId) : undefined;
    expect(a.type === 'INSTALL_CARD' && a.targetServerId === 'remote-5' && !!card && cardDef(card).type_code === 'asset').toBe(false);
  });

  // D6: Jaguarundi and Oracle Thinktank discarded while Public Access Plaza was in HQ
  it.fails('D6 #53 #112: no agenda is discarded while a non-agenda is in HQ', { timeout: T }, () => {
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
  for (const [n, m, source] of [
    [49, 219, 'Humanoid Resources'],
    [50, 252, 'Top-Down Solutions'],
  ] as const) {
    it.fails(`D3 #${n} #${m}: the ${source} install prompt is not declined`, { timeout: T }, () => {
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
  it.fails('Stage C, deal 1001 T10: the Corp with the look-ahead installs ice on remote-1 (today: the Regolith click)', { timeout: 480_000 }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/ice-redirect-1001-t10.json', import.meta.url), 'utf8'));
    const a = withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () => new HeuristicCorpAI({ synergy: true }).chooseAction(s)) as Install;
    expect(a.type).toBe('INSTALL_CARD');
    expect(cardDef(findCardAnywhere(s, a.cardInstanceId ?? '')!).type_code).toBe('ice');
    expect(a.targetServerId).toBe('remote-1');
  });
});
