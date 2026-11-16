import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, activePrompt, executeAction, getLegalActions } from '../src/core';
import { revealInHand } from '../src/core/engine/helpers';
import { HeuristicCorpAI } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { asSide, plan, pricing, withPricing } from '../src/ai/pricing';
import { clearHandCaches } from '../src/ai/handValues';
import { corpSeenGrip } from '../src/ai/oracle';
import { knownRdSlots } from '../src/ai/runnerReply';
import { clearThreatCaches } from '../src/ai/threatModel';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { clearBuildTargets } from '../src/ai/valueModel';
// Namespace imports, so that on a tree without this branch (beta 8fbc771) only the tests that read the new exports fail
import * as planner from '../src/ai/turnPlanner';
import * as core from '../src/ai/corp/core';

/**
 * ai-honest-corp-decision (brief rev 2, "Pins"; red team 2026-11-16 rulings 1 to 9): the deciding Corp's whole decision
 * reads its own view (turnPlanner.ts corpDecisionView), not only its order. Rule 10.2.2a: the order of R&D and the cards
 * in the Runner's grip are hidden from the Corp (Jeff: the Normal AI never sees hidden cards or draw order; it may know
 * both decklists). So through the deciding agent (the planner on, plan.hiddenDraws and plan.plannerSeed on), a prompt
 * answer, a free install, a rez in a run and the money step are the same whatever R&D's order (outside the slots the
 * Corp knows) and whichever unseen Runner cards are in the grip. The caches are emptied before every variant.
 */
const read = (name: string): GameState => {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  return raw.state ?? raw; // a rez fixture keeps its state beside its cards
};
const honest = <T>(f: () => T): T => withPricing({ plan: { ...plan(), hiddenDraws: true, plannerSeed: true } }, () => asSide('corp', f));
const reset = () => {
  clearThreatCaches();
  clearHandCaches();
  clearDamageThreats();
  clearDeckShares();
  clearBuildTargets();
};
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
const card = (instanceId: string, cardCode: string) => ({ instanceId, cardCode, isRezzed: false, advancementCounters: 0, tokens: {}, hostedCardIds: [] }) as unknown as CardInstance;
const agent = () => new HeuristicCorpAI({ synergy: true, planner: true });

/** The ids the active prompt names (as turnPlanner.ts promptNamedIds; written out here so the test runs on beta too). */
function named(s: GameState): Set<string> {
  const p = activePrompt(s);
  const out = new Set<string>();
  if (!p) return out;
  if (p.kind === 'effect_cards') p.candidateIds.forEach(id => out.add(id));
  if (p.kind === 'effect_choice' || p.kind === 'access_order') p.options.forEach(o => out.add(o.id.replace(/^root:/, '')));
  if ('source' in p) {
    out.add(p.source.instanceId);
    for (const v of Object.values(p.source.data ?? {})) (Array.isArray(v) ? v : [v]).forEach(x => out.add(String(x)));
  }
  return out;
}

/**
 * Variants with the same Corp information: the top of R&D swapped for another unseen R&D card (not a known slot, not
 * a card the prompt names), and the Runner's unseen grip cards swapped with stack cards (one, then all).
 */
function variants(s: GameState): [string, GameState][] {
  const out: [string, GameState][] = [];
  const fixed = honest(() => knownRdSlots(s));
  const shown = named(s);
  const free = s.corp.rd.map((c, i) => (fixed.has(i) || shown.has(c.instanceId) ? -1 : i)).filter(i => i >= 0);
  if (free.length > 1) {
    for (const j of [free[1], free[Math.floor(free.length / 2)], free[free.length - 1]]) {
      const t = structuredClone(s);
      const top = free[0];
      [t.corp.rd[top], t.corp.rd[j]] = [t.corp.rd[j], t.corp.rd[top]];
      out.push([`R&D: top unseen card swapped with #${j}`, t]);
    }
  }
  const seen = honest(() => corpSeenGrip(s, 'reply'));
  const unseen = s.runner.grip.map((c, i) => (seen.has(c.instanceId) || shown.has(c.instanceId) ? -1 : i)).filter(i => i >= 0);
  const stack = s.runner.stack.map((c, i) => (shown.has(c.instanceId) ? -1 : i)).filter(i => i >= 0);
  if (unseen.length && stack.length) {
    const one = structuredClone(s);
    [one.runner.grip[unseen[0]], one.runner.stack[stack[0]]] = [one.runner.stack[stack[0]], one.runner.grip[unseen[0]]];
    out.push(['grip: one unseen card swapped with the stack', one]);
    const all = structuredClone(s);
    unseen.forEach((i, n) => {
      if (n < stack.length) [all.runner.grip[i], all.runner.stack[stack[n]]] = [all.runner.stack[stack[n]], all.runner.grip[i]];
    });
    out.push(['grip: every unseen card swapped with the stack', all]);
  }
  return out;
}

/** The deciding agent's answer at `s`: chooseRez at a run's rez window, chooseAction otherwise. */
function answer(s: GameState): string {
  reset();
  const copy = structuredClone(s);
  return honest(() => {
    const window = copy.priority;
    if (copy.activeRun && window?.holder === 'corp' && !copy.pendingPrompts.length && (window.step === 'approach_ice' || window.step === 'approach_server')) {
      return key(agent().chooseRez(copy, rezCandidates(copy, window.step)));
    }
    return key(agent().chooseAction(copy));
  });
}

/** Deal 1001 T10 at 6 credits with Mindscaping and Sprint in HQ (the honest-order probe): plays that draw. */
const drawPlays = (): GameState => {
  const s = read('hidden-draws-1001-t10.json');
  s.corp.credits = 6;
  s.corp.hq.push(card('inst-900', '34045'), card('inst-901', '30041'));
  return s;
};
/** The same board with Predictive Planogram (30056) played: its prompt's options gain credits or draw 3 (Q0 through evaluate). */
const planogram = (): GameState => {
  const s = drawPlays();
  s.corp.hq.push(card('inst-902', '30056'));
  const t = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: 'inst-902' });
  if (activePrompt(t)?.side !== 'corp') throw new Error('no Planogram prompt');
  return t;
};
/** Sprint (30041) played: draw 3, then the prompt to shuffle 2 HQ cards into R&D (Q0 priced through evaluate). */
const sprint = (): GameState => {
  const s = drawPlays();
  const t = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: 'inst-901' });
  if (activePrompt(t)?.side !== 'corp') throw new Error('no Sprint prompt');
  return t;
};
const PROMPTS: [string, () => GameState][] = [
  ['(a) Predictive Planogram: gain 3 or draw 3', planogram],
  // Found on beta 8fbc771 (a Planogram played at a recorded state of the local deals): its answer moved with R&D's order
  ['(a) Predictive Planogram, deal 1721 #15', () => read('honest-corp-planogram-1721.json')],
  ['(a) Predictive Planogram, deal 3001 #6', () => read('honest-corp-planogram-3001.json')],
  ['(b) Sprint: the two cards shuffled back', sprint],
  ['(b) Spin Doctor: the Archives cards shuffled in', () => read('spin-doctor-archives-2041.json')],
];
const FREE_INSTALL: [string, () => GameState][] = [['(c) Synapse Global: the free install (bug report 13)', () => read('bug-report-13-synapse.json')]];
const REZ: [string, () => GameState][] = [
  ['(d) rez toll', () => read('rez-toll.json')],
  ['(d) holes 48 #118', () => read('holes-48-118.json')],
  ['(d) Stage B Biawak r20', () => read('stage-b-rez-biawak-r20-42.json')],
  ['(d) Stage B Scatter r23', () => read('stage-b-rez-scatter-r23-31.json')],
];
const MONEY: [string, () => GameState][] = [['(e) the money step with plays that draw (deal 1001 T10)', drawPlays]];

describe("the deciding Corp's whole decision reads no hidden card (rule 10.2.2a)", () => {
  for (const [name, make] of [...PROMPTS, ...FREE_INSTALL, ...REZ, ...MONEY]) {
    for (const [variant] of variants(make())) {
      it(`gives the same answer: ${variant} (${name})`, () => {
        const s = make();
        const v = variants(s).find(([n]) => n === variant)![1];
        expect(answer(v)).toBe(answer(s));
      }, 600_000);
    }
  }

  it('the rez fixtures are at a rez window of a run with a card to rez', () => {
    for (const [name, make] of REZ) {
      const s = make();
      expect(s.activeRun, name).toBeTruthy();
      expect(rezCandidates(s, s.priority!.step as 'approach_ice').length, name).toBeGreaterThan(0);
    }
  });

  // Ruling 2: the cards the active prompt names stay where they really are, so a prompt that shows R&D cards is
  // answered on the view with those cards in place, the same answer as with the view off
  it('keeps the cards a prompt names in their real places, and answers a prompt that shows R&D cards as with the view off', () => {
    const s = structuredClone(planogram());
    const p = s.pendingPrompts[0] as Extract<GameState['pendingPrompts'][number], { kind: 'effect_choice' }>;
    // The prompt names three R&D cards (as an arrange or look-at-the-top prompt does) and one unseen grip card
    const ids = [s.corp.rd[0].instanceId, s.corp.rd[3].instanceId, s.corp.rd[7].instanceId];
    p.source.data = { ids, grip: s.runner.grip[0].instanceId };
    const view = honest(() => planner.corpDecisionView(s));
    for (const id of ids) expect(view.corp.rd.findIndex(c => c.instanceId === id)).toBe(s.corp.rd.findIndex(c => c.instanceId === id));
    expect(view.runner.grip.some(c => c.instanceId === s.runner.grip[0].instanceId)).toBe(true);
    expect(honest(() => planner.promptCardsInPlace(s, view))).toBe(true);
    const off = (() => {
      reset();
      return withPricing({ plan: { ...plan(), hiddenDraws: false } }, () => asSide('corp', () => key(agent().chooseAction(structuredClone(s)))));
    })();
    // With the view off the Corp reads every card; on, the cards it is shown are the same, the rest a guess: the
    // Planogram's answer (gain or draw) reads no unshown card
    expect(answer(s)).toBe(off);
  }, 600_000);

  it('keeps a grip card the Corp has seen, and an R&D card both sides know the place of, in their real places', () => {
    const s = drawPlays();
    s.corp.rdKnownToRunner = [{ id: s.corp.rd[2].instanceId, code: s.corp.rd[2].cardCode, lo: 2, hi: 2 }];
    revealInHand(s, 'runner', [s.runner.grip[0]]);
    const seen = honest(() => corpSeenGrip(s, 'reply'));
    expect(seen.has(s.runner.grip[0].instanceId)).toBe(true);
    const view = honest(() => planner.corpDecisionView(s));
    expect(view.corp.rd[2].instanceId).toBe(s.corp.rd[2].instanceId);
    for (const id of seen) expect(view.runner.grip.some(c => c.instanceId === id)).toBe(true);
  });

  // Red team finding 1, ruled known debt (a Corp-side R&D memory in src/core, its own brief): the view forgets the R&D
  // cards only the Corp has seen. Known-failing until that memory exists
  it.fails('keeps the top R&D cards the Corp arranged in secret where it put them (known debt: no Corp-side R&D memory)', () => {
    const s = drawPlays();
    s.corp.rdNotes = { privateTop: 4 };
    const view = honest(() => planner.corpDecisionView(s));
    expect(view.corp.rd.slice(0, 4).map(c => c.instanceId)).toEqual(s.corp.rd.slice(0, 4).map(c => c.instanceId));
  });

  // Ruling 4: a view is marked and is its own view, so a question handed the view does not deal again
  it('is one object for every question of a decision, and its own view', () => {
    for (const make of [drawPlays, planogram]) {
      const s = make();
      const view = honest(() => planner.corpDecisionView(s));
      expect(honest(() => planner.corpDecisionView(s))).toBe(view);
      expect(honest(() => planner.corpDecisionView(view))).toBe(view);
    }
  });

  // Ruling 6: the seed is the game, turn and clicks left, so it is the same within a click and reads nothing hidden;
  // the deal changes only when the cards it deals from change
  it('deals from the same seed within a click, and again when the cards it deals from change', () => {
    const s = planogram();
    // Answering the prompt spends no click: the same seed
    const answered = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: s.pendingPrompts[0].id, choice: { kind: 'effect_choice', optionId: 'credits' } });
    expect(honest(() => planner.decisionSeedFor(answered, 'corp'))).toBe(honest(() => planner.decisionSeedFor(s, 'corp')));
    const v1 = honest(() => planner.corpDecisionView(s));
    const t = structuredClone(s);
    t.runner.stack.push(t.runner.grip.pop()!);
    expect(honest(() => planner.corpDecisionView(t))).not.toBe(v1);
  });

  // Fix 4 (red team: decideRez never set its context): the deciding Corp's rez runs under its own decision's context
  it("decides a rez under the rez decision's own context, on its view", () => {
    const s = read('rez-toll.json');
    const view = honest(() => planner.corpDecisionView(s));
    let root: unknown;
    honest(() => {
      // An earlier decision's context: a different board
      const a = agent();
      const before = drawPlays();
      a.rankMainActions(before);
      const cards = rezCandidates(s, s.priority!.step as 'approach_ice');
      a.chooseRez(s, cards);
      root = pricing().anchor?.root;
    });
    expect(root).toBe(view);
  });

  // Fix 2 and red team finding 3: an answer not legal on the real state is taken again on the real state before
  // anything is committed, so the memories end as one decision on the real state leaves them
  it('takes a decision again on the real state when its answer is not legal there, leaving the memories as one real decision would', () => {
    const s = drawPlays();
    const run = (view?: GameState) => {
      reset();
      const a = agent() as unknown as { memory: { heldLine: unknown }; planMemory: { line: unknown[] }; freeActions: { count?: number } };
      const notes: GameAction[] = [];
      const pick = honest(() =>
        core.corpDecide(
          structuredClone(s),
          {
            synergy: true,
            counted: true,
            memory: a.memory as never,
            rank: (st, legal) => (a as unknown as HeuristicCorpAI).rankMainActions(st, legal),
            // The look-ahead's memory written as planTurn writes it; on the bad view its pick is the card only the view has
            lookahead: (st, ranked) => {
              const only = st.corp.hq.find(c => c.instanceId === 'inst-903');
              a.planMemory.line = [only ? 'from the bad view' : 'from the real state'];
              return only ? { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: only.instanceId } : ranked[0].action;
            },
            note: x => void notes.push(x),
            snapshot: () => {
              const line = [...a.planMemory.line];
              return () => void (a.planMemory.line = line);
            },
          },
          view,
        ),
      );
      return { pick: key(pick), held: JSON.stringify(a.memory.heldLine), line: JSON.stringify(a.planMemory.line), notes: notes.map(key) };
    };
    // "Views" that disagree with the real state about something public, so the answer is not legal on the real state:
    // a prompt the real state does not have (answered at Q0), and a Hedge Fund in HQ the real state does not have (the
    // look-ahead picks it and writes its memory, the held line is asked, and both are put back before the retry)
    const real = run();
    for (const bad of [planogram(), (() => {
      const t = structuredClone(s);
      t.corp.hq.push(card('inst-903', '30038'));
      return t;
    })()]) {
      const counts = { ...core.honestCorpCounts };
      const fell = run(bad);
      expect(fell).toEqual(real);
      expect((core.honestCorpCounts.illegalAction ?? 0) - (counts.illegalAction ?? 0)).toBe(1);
    }
    expect(getLegalActions(s, 'corp').some(x => key(x) === real.pick)).toBe(true);
  }, 600_000);
});
