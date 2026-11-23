import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { hqStepAnswer } from '../src/ai/corp/hqSteps';
import { freeInstallOrder } from '../src/ai/corp/candidates';
import { HeldLine, scoreInTwo } from '../src/ai/corp/lines';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { answerPrompt, ownCorpReader } from '../src/ai/prompts';
import { answer, giveCard, installCorpForTest, installIceForTest, newGame, passTurn, play } from './helpers';

// Jeff 2026-11-22: "the Corp AI activates Humanoid Resources ... but never carries out the card's steps". Humanoid
// Resources: "[click][click][click], [trash]: Gain 4 credits and draw 3 cards. Install up to 2 cards from HQ (one at a
// time). You may play 1 operation from HQ." The installs and the play spend no click (rule 5.2.6: only a Corp action
// does) but pay their install and play costs (rules 1.16.6, 1.16.7). The engine offered each step; the Corp declined
// all three (an install pick ties with the decline one step ahead; the play paid the hand's half-keep). corp/hqSteps.ts.

const HUMANOID = '35039';
const PALISADE = '30072';
const NICO = '30037';
const HEDGE_FUND = '30075';
const ANSEL = '30038'; // ice, rez cost 6
const OFFWORLD = '30067'; // agenda
const KARUNA = '30047'; // ice, rez cost 4
const PING = '30055';
const TITHE = '30073'; // ice, rez cost 1
const RETRIBUTION = '30065';
const ABOVE_THE_LAW = '30060'; // agenda 3/2
const TOP_DOWN = '35044';
const MERCIA = '35045';

/** The Corp has just used Humanoid Resources: HQ holds Palisade, Nico Campaign and Hedge Fund, plus the 3 cards drawn. */
function afterUse(): GameState {
  let s = newGame(5);
  const hr = installCorpForTest(s, HUMANOID, 'remote-1', true);
  s.corp.hq = [createCardInstance(s, PALISADE), createCardInstance(s, NICO), createCardInstance(s, HEDGE_FUND)];
  s.corp.credits = 10;
  s = executeAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: hr, abilityIndex: 0 });
  return s;
}

/** Answers the Corp's prompts with `decide` until none is left. */
function answerAll(s: GameState, decide: (s: GameState) => GameAction): GameState {
  for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++) s = executeAction(s, decide(s));
  return s;
}

const installed = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root]).map(c => cardDef(c).title);

describe('Humanoid Resources: the Corp carries out its steps (corp/hqSteps.ts)', () => {
  it('the deciding Corp installs 2 cards from HQ and plays Hedge Fund', { timeout: 60_000 }, () => {
    const corp = createAgent('corp', 'normal');
    const s0 = afterUse();
    expect(s0.pendingPrompts[0]?.kind).toBe('effect_cards');
    const credits = s0.corp.credits;
    const s = answerAll(s0, x => corp.chooseAction(x));
    expect(installed(s)).toHaveLength(2);
    expect(s.corp.hq.some(c => c.cardCode === HEDGE_FUND)).toBe(false);
    expect(s.corp.archives.faceUp.some(c => c.cardCode === HEDGE_FUND)).toBe(true);
    // Hedge Fund: pay 5, gain 9; the ice's install cost is paid too (1.16.6)
    expect(s.corp.credits).toBeGreaterThan(credits);
  });

  it('the planner’s rollouts (no counted questions) keep the fallback’s answers', { timeout: 60_000 }, () => {
    const rollout = new HeuristicCorpAI({ planner: false });
    const s = answerAll(afterUse(), x => rollout.chooseAction(x));
    expect(installed(s)).toHaveLength(0);
  });

  // Condition C4 (spec-ruling.md): the install is paid in the board the order prices (freeAfter plays the real answer), so
  // ice the Corp cannot rez with the money it keeps is behind (candidates.ts iceMove, icePaid) and Q0a leaves the pick to
  // the fallback. Ansel 1.0 rezzes for 6; the Corp has 4 after Humanoid Resources' gain; the 3 cards drawn are agendas,
  // which freeInstallOrder leaves out (spec-ruling.md 3.2)
  it('ice the Corp could install but not rez is behind: the fallback answers', { timeout: 60_000 }, () => {
    let s = newGame(5);
    const hr = installCorpForTest(s, HUMANOID, 'remote-1', true);
    s.corp.hq = [createCardInstance(s, ANSEL)];
    s.corp.rd.unshift(createCardInstance(s, OFFWORLD), createCardInstance(s, OFFWORLD), createCardInstance(s, OFFWORLD));
    s.corp.credits = 0;
    s = executeAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: hr, abilityIndex: 0 });
    expect(s.corp.credits).toBe(4);
    expect(s.pendingPrompts[0]?.kind).toBe('effect_cards');
    expect(hqStepAnswer(s, null, null)).toBeNull();
    expect(createAgent('corp', 'normal').chooseAction(s)).toEqual(answerPrompt(s, 'corp', undefined, true));
  });

  // Spec-ruling.md 7 R1 (red team finding 1, probes/tax-keep.test.ts): a step that pays is priced at what the prompt
  // charges (rules 1.16.6, 8.5.11a: 1 credit per ice already protecting the server), read from the engine's board after
  // the answer, so ice whose install leaves the Corp unable to rez it, or under rez money's keep, is behind
  function taxBoard(o: { credits: number; hq: string[]; draws: string[]; central: number; agenda: boolean }): GameState {
    const s = newGame(5);
    const hr = installCorpForTest(s, HUMANOID, 'remote-1', true);
    for (const srv of ['hq', 'rd']) for (let i = 0; i < o.central; i++) installIceForTest(s, PING, srv, true);
    if (o.agenda) {
      installCorpForTest(s, OFFWORLD, 'remote-2', false);
      installIceForTest(s, PALISADE, 'remote-2', false);
    }
    s.corp.hq = o.hq.map(c => createCardInstance(s, c));
    s.corp.rd = [...o.draws.map(c => createCardInstance(s, c)), ...s.corp.rd];
    s.corp.credits = o.credits;
    return executeAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: hr, abilityIndex: 0 });
  }

  it('R1: no paid install that leaves the Corp under keep (red team pin, keepBroken)', { timeout: 60_000 }, () => {
    const s0 = taxBoard({ credits: 1, hq: [TITHE], draws: [TITHE, RETRIBUTION, RETRIBUTION], central: 3, agenda: true });
    const keep = rezMoney(s0).keep; // 3: Palisade in front of Offworld Office
    expect(keep).toBe(3);
    const s = answerAll(s0, x => createAgent('corp', 'normal').chooseAction(x));
    expect(s.corp.credits).toBeGreaterThanOrEqual(keep); // 00f8b972: 2 (Tithe outermost on R&D for 3)
  });

  it('R1: no ice installed behind two ice when its install leaves too little to rez it (taxOnly)', { timeout: 60_000 }, () => {
    const s0 = taxBoard({ credits: 0, hq: [KARUNA], draws: [RETRIBUTION, RETRIBUTION, RETRIBUTION], central: 2, agenda: false });
    expect(s0.corp.credits).toBe(4);
    const s = answerAll(s0, x => createAgent('corp', 'normal').chooseAction(x));
    expect(installed(s)).not.toContain('Karunā'); // 00f8b972: Karunā on R&D for 2, left on 2 with a rez cost of 4
    expect(s.corp.credits).toBe(4);
  });

  // R2 (red team finding 3): inside the main phase the held two-turn line is read as the main phase reads it. The Corp
  // holds Above the Law's line (install+ice: Palisade in a new remote in front of it) and plays Top-Down Solutions
  function heldLineBoard(): { s: GameState; held: HeldLine; palisade: string } {
    let s = newGame(5);
    s.corp.hq = [createCardInstance(s, ABOVE_THE_LAW), createCardInstance(s, PALISADE), createCardInstance(s, TOP_DOWN)];
    s.corp.rd = [createCardInstance(s, RETRIBUTION), createCardInstance(s, RETRIBUTION), ...s.corp.rd];
    s.corp.credits = 8;
    const line = scoreInTwo(s)!;
    expect(line).toMatchObject({ form: 'install+ice', server: 'new remote' });
    const held: HeldLine = { game: s.id, turn: s.turnNumber, line, server: null, counters: 0 };
    const palisade = s.corp.hq.find(c => c.cardCode === PALISADE)!.instanceId;
    s = play(s, 'corp', s.corp.hq.find(c => c.cardCode === TOP_DOWN)!.instanceId);
    expect(activePrompt(s)).toMatchObject({ kind: 'effect_cards', source: { step: 'install_pick' } });
    return { s, held, palisade };
  }

  it('R2: the held line\'s ice goes where the line puts it, not to a bare central', { timeout: 60_000 }, () => {
    const { s, held, palisade } = heldLineBoard();
    const p = hqStepAnswer(s, held, null);
    expect(p?.pick).toEqual({ source: (activePrompt(s) as { source: { instanceId: string } }).source.instanceId, card: palisade });
    const s2 = executeAction(s, p!.action);
    const options = (activePrompt(s2) as { options: { id: string }[] }).options.map(o => o.id);
    expect(hqStepAnswer(s2, held, p!.pick)?.action).toMatchObject({ choice: { optionId: 'new' } });
    // 00f8b972's order (held: null, step 1 skipped, as Synapse Global reads it) sent it to bare HQ
    expect(freeInstallOrder(s2, options).find(c => c.card === palisade)?.action).toMatchObject({ targetServerId: 'hq' });
  });

  it('R2: with no held line the order is the same with and without the main-phase view', { timeout: 60_000 }, () => {
    for (const s of [afterUse(), heldLineBoard().s]) {
      const options = ['new', ...Object.keys(s.corp.servers)];
      expect(freeInstallOrder(s, options, { held: null })).toEqual(freeInstallOrder(s, options));
    }
  });

  // R3 (red team finding 2): Mercia B4LL4RD moves with the ice it installs ("move this upgrade to the root of the server
  // that piece of ice is protecting"; a central's root cards are candidates when it is breached, rule 7.3.3). The order
  // does not price the root card that travels, so Q0a answers neither the pick nor the server (registry debt line)
  it('R3: a step whose install moves its source card is left to the fallback (Mercia)', { timeout: 60_000 }, () => {
    let s = newGame(5);
    installCorpForTest(s, MERCIA, 'remote-1', true);
    installCorpForTest(s, OFFWORLD, 'remote-2', false);
    s.corp.hq = [];
    const ice = giveCard(s, 'corp', PALISADE);
    s.corp.credits = 8;
    s = passTurn(s);
    expect(activePrompt(s)).toMatchObject({ kind: 'effect_cards', source: { cardCode: MERCIA } });
    expect(hqStepAnswer(s, null, null)).toBeNull();
    expect(createAgent('corp', 'normal').chooseAction(s)).toEqual(answerPrompt(s, 'corp', undefined, true));
    const s2 = answer(s, { kind: 'effect_cards', cardInstanceIds: [ice] });
    const source = (activePrompt(s2) as { source: { instanceId: string } }).source.instanceId;
    expect(hqStepAnswer(s2, null, { source, card: ice })).toBeNull();
  });

  // The red team's seed 1791 board (Agency vs Party Hard, Corp turn 2; fixture: scripts/hr-install-steps/mercia-1791-fixture.ts):
  // Send a Message alone in bare remote-4, Mercia's pick Brân 1.0. Known-failing: R3 leaves Mercia's steps to the
  // fallback, which answers remote-4 only by chance; the order does not price Mercia's move (registry debt, "Mercia")
  it.fails('Mercia: the ice goes in front of the bare agenda, not to bare R&D (seed 1791; known-failing, R3 debt)', { timeout: 60_000 }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/hq-steps/mercia-1791-t2.json', import.meta.url), 'utf8'));
    const p = activePrompt(s) as { source: { instanceId: string; data?: { cardId?: string } } };
    expect(hqStepAnswer(s, null, { source: p.source.instanceId, card: String(p.source.data?.cardId) })).toMatchObject({ action: { choice: { optionId: 'remote-4' } } });
  });

  // R4 (red team finding 6): a prompt with a reader of its own in prompts.ts keeps it (one reader per prompt)
  it('R4: Synapse Global, Warm Reception and Janaína reach their own readers', { timeout: 60_000 }, () => {
    const synapse: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-13-synapse.json', import.meta.url), 'utf8'));
    expect(ownCorpReader(activePrompt(synapse)!)).toBe('synapse');
    // on the Corp's own turn too (the report's prompt came on the Runner's): Q0a does not answer it
    const corpTurn = structuredClone(synapse);
    corpTurn.activePlayer = 'corp';
    expect(hqStepAnswer(corpTurn, null, null)).toBeNull();
    // Warm Reception's and Janaína's pick, the Humanoid Resources prompt relabelled (a prompt to read, never resolved):
    // Q0a leaves it, and prompts.ts answers it with its own reader (ice the Corp can afford first: Palisade)
    for (const code of ['34098', '34115']) {
      const s = structuredClone(afterUse());
      const p = s.pendingPrompts[0] as { source: { cardCode: string; step: string } };
      p.source.cardCode = code;
      p.source.step = 'pick';
      expect(ownCorpReader(activePrompt(s)!)).toBe('affordable');
      expect(hqStepAnswer(s, null, null)).toBeNull();
      const palisade = s.corp.hq.find(c => c.cardCode === PALISADE)!.instanceId;
      expect(answerPrompt(s, 'corp', undefined, true)).toMatchObject({ choice: { cardInstanceIds: [palisade] } });
    }
  });

  // R5: the server step is Q0a's only after its own pick of that card from the same source, at the decision before
  it('R5: a server step after another decision is the fallback\'s (the pick is valid for one decision)', { timeout: 60_000 }, () => {
    const corp = createAgent('corp', 'normal');
    let s = afterUse();
    s = executeAction(s, corp.chooseAction(s)); // Q0a's pick
    expect(activePrompt(s)?.kind).toBe('effect_choice');
    const stepState = s;
    // another decision in between (a prompt Q0a leaves alone: Mercia's) clears the pick
    let other = newGame(5);
    installCorpForTest(other, MERCIA, 'remote-1', true);
    other.corp.hq = [];
    giveCard(other, 'corp', PALISADE);
    other = passTurn(other);
    corp.chooseAction(other);
    expect(corp.chooseAction(stepState)).toEqual(answerPrompt(stepState, 'corp', undefined, true));
    // and a server step whose pick names another card or source is not answered
    const p = activePrompt(stepState) as { source: { instanceId: string; data?: { cardId?: string } } };
    expect(hqStepAnswer(stepState, null, { source: 'inst-0', card: String(p.source.data?.cardId) })).toBeNull();
    expect(hqStepAnswer(stepState, null, { source: p.source.instanceId, card: 'inst-0' })).toBeNull();
    expect(hqStepAnswer(stepState, null, { source: p.source.instanceId, card: String(p.source.data?.cardId) })).not.toBeNull();
  });
});

// R7 (red team H4): class prompts no batch Corp deck holds. Each is carried out, its cost paid, and the Corp keeps
// rez money's keep; these are not shown by the batch (the count's decks never reach them)
describe('Q0a on class prompts not shown by the batch (spec-ruling.md 7 R7)', () => {
  const GREASING = '34037';
  const ACTIVE_POLICING = '34102';
  const SUDDEN = '34119';
  /** The Corp's action phase with `op` played from HQ (the rest of HQ as given), R&D topped with `draws`. */
  function played(op: string, hq: string[], credits: number, draws: string[] = [], setup?: (s: GameState) => void): GameState {
    const s = newGame(5);
    s.corp.hq = [createCardInstance(s, op), ...hq.map(c => createCardInstance(s, c))];
    s.corp.rd = [...draws.map(c => createCardInstance(s, c)), ...s.corp.rd];
    s.corp.credits = credits;
    setup?.(s);
    return play(s, 'corp', s.corp.hq[0].instanceId);
  }
  const deciding = (s0: GameState) => answerAll(s0, x => createAgent('corp', 'normal').chooseAction(x));

  it('Greasing the Palm: the ice is installed, paid, and keep holds (not shown by the batch)', { timeout: 60_000 }, () => {
    const s0 = played(GREASING, [PALISADE], 6);
    expect(activePrompt(s0)).toMatchObject({ kind: 'effect_cards', source: { cardCode: GREASING } });
    expect(hqStepAnswer(s0, null, null)).not.toBeNull();
    const s = deciding(s0);
    expect(installed(s)).toContain('Palisade');
    expect(s.corp.credits).toBeGreaterThanOrEqual(rezMoney(s).keep);
  });

  it('Active Policing: the ice is installed, paid, and keep holds (not shown by the batch)', { timeout: 60_000 }, () => {
    const s0 = played(ACTIVE_POLICING, [PALISADE], 8, [], s => void (s.runnerLastTurnStoleOrTrashed = true));
    expect(activePrompt(s0)).toMatchObject({ kind: 'effect_cards', source: { cardCode: ACTIVE_POLICING } });
    expect(hqStepAnswer(s0, null, null)).not.toBeNull();
    const s = deciding(s0);
    expect(installed(s)).toContain('Palisade');
    expect(s.corp.credits).toBeGreaterThanOrEqual(rezMoney(s).keep);
  });

  it('Sudden Commandment: Hedge Fund is played from HQ, its cost paid (not shown by the batch)', { timeout: 60_000 }, () => {
    const s0 = played(SUDDEN, [HEDGE_FUND], 6, [RETRIBUTION, RETRIBUTION]);
    expect(activePrompt(s0)).toMatchObject({ kind: 'effect_cards', source: { cardCode: SUDDEN } });
    const credits = s0.corp.credits;
    const s = deciding(s0);
    expect(s.corp.archives.faceUp.some(c => c.cardCode === HEDGE_FUND)).toBe(true);
    expect(s.corp.credits).toBe(credits + 4); // pay 5, gain 9 (rule 1.16.7: the play cost is paid)
  });
});
