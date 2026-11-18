/**
 * Stage D item 1 follow-up 3 (found-list row 13; followup3-run-answers/design-answer.md sections 3, 7.6 and 8.6): the
 * Corp's answers to its own prompts during a run, priced with the run under way (prompts.ts runAnswer: the hold owner's
 * run stand, runStands in corp/hold.ts, says whether the Runner gets in after each answer; runLoss prices the access).
 * Rules: 1.14.5 (the Corp, the ice's controller, makes the choices of its subroutines), 6.9.3c and 9.8.7b-c (subroutines
 * resolve in order; the end of the encounter stops the rest), 6.9.4 (Movement Phase), 6.9.2b (rez on approach), 1.7.2a
 * (7 points wins). Card texts (src/data): Ballista 30062 "Trash 1 installed program or end the run."; Shred 35005 "The
 * first time the Corp would end that run, prevent the run from ending unless the Corp reveals and trashes X cards from
 * HQ at random."; Boto 34109 "You may trash 1 card from HQ to end the run."; Anoetic Void 30050 "Whenever the Runner
 * approaches this server, you may pay 2 credits and trash 2 cards from HQ. If you do, end the run."; Lycian
 * Multi-Munition 34100 (choose subtypes on rez); Lightning Laboratory 34097 ("rez up to 2 pieces of ice protecting the
 * attacked server, ignoring all costs"); Cloud Eater 34110 "Trash 1 installed Runner card."
 * Each pin says whether it fails on beta 333c16e (the fix) or is a mirror that passes on both.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, executeAction, getLegalActions } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { createAgent } from '../src/ai';
import { answerPrompt, runTermStats, settledStand } from '../src/ai/prompts';
import { runStands } from '../src/ai/corp/hold';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { clearCaches } from '../scripts/stage-a/harness';
import { installIceForTest, installProgramForTest, newGame, scoreForTest, startRunnerTurn } from './helpers';

const fixture = (name: string): GameState => JSON.parse(readFileSync(`tests/fixtures/run-answers/${name}.json`, 'utf8'));
/** The Normal Corp's move on a copy of the board. */
const corpMove = (s: GameState): GameAction => {
  clearCaches();
  return createAgent('corp', 'normal').chooseAction(structuredClone(s));
};
const pick = (a: GameAction): string | string[] => (a.type !== 'RESOLVE_PROMPT' ? a.type : a.choice.kind === 'effect_choice' ? a.choice.optionId : a.choice.kind === 'effect_cards' ? a.choice.cardInstanceIds : '?');
const title = (s: GameState, id: string) => [...s.runner.rig.programs, ...s.corp.hq].find(c => c.instanceId === id)?.cardCode;

describe('the run term: Ballista, Boto, Shred, Anoetic Void (recorded boards)', () => {
  it('deal 1601 T12, Ballista under Shred on a remote with an agenda: ends the run (fails on beta: trashes Marjanah)', () => {
    expect(pick(corpMove(fixture('deal-1601-t12-30062')))).toBe('end');
  });

  it('mirror: the same board with the agenda moved out of the root (nothing staked) keeps the program trash (both)', () => {
    const s = fixture('deal-1601-t12-30062');
    const sv = s.corp.servers[s.activeRun!.server];
    s.corp.hq.push(...sv.root.splice(0, sv.root.length));
    expect(pick(corpMove(s))).not.toBe('end');
  });

  it('deal 1601 T7, Ballista: ends the run (fails on beta)', () => {
    expect(pick(corpMove(fixture('deal-1601-t7-30062')))).toBe('end');
  });

  // Known-failing (ruling 5, found-list row 48, valuation): the Corp's board prices a lone barrier breaker at 20.8
  // against a 16 steal, so it trades the steal for the breaker. Tuning, not this branch.
  it.fails('deal 2873 T8, Ballista with Bumi behind: ends the run (known-failing: row 48)', () => {
    expect(pick(corpMove(fixture('deal-2873-t8-30062')))).toBe('end');
  });

  it('mirror: deal 1641 T21, every answer keeps the Runner out by the walk: the program trash stands (both)', () => {
    const s = fixture('deal-1641-t21-30062');
    const p = pick(corpMove(s));
    expect(p).not.toBe('end');
  });

  it("human report-39 T7, Boto's last subroutine on remote-1 with an agenda: trashes an HQ card to end the run (fails on beta: no trash)", () => {
    const p = pick(corpMove(fixture('report-39-t7-34109-108')));
    expect(Array.isArray(p) && p.length).toBe(1);
  });

  it("mirror: the same encounter's first Boto subroutine, with the second to come (the settle follows it): no trash yet (both)", () => {
    expect(pick(corpMove(fixture('report-39-t7-34109-107')))).toEqual([]);
  });

  it('mirror: human report-39 T1, Boto on R&D (little staked): no HQ trash (both)', () => {
    expect(pick(corpMove(fixture('report-39-t1-34109-16')))).toEqual([]);
  });

  it('mirror: deal 1841 T9, Shred on a remote with no agenda (runLoss 0): the Corp does not pay (both)', () => {
    expect(pick(corpMove(fixture('deal-1841-t9-35005')))).toBe('no');
  });

  it("mirror: deal 2241 T13, Anoetic Void at runLoss 0 keeps today's answer (both; found row 59 is its own item)", () => {
    const s = fixture('deal-2241-t13-30050');
    expect(pick(corpMove(s))).toBe(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
    expect(pick(corpMove(s))).toBe('no');
  });

  it("Shred's reveal is chance: the same board under two RNG states gives the same answer (ruling 3)", () => {
    // Deal 1601 T12: Ballista's "end" opens Shred's question
    const s = fixture('deal-1601-t12-30062');
    const p = activePrompt(s)!;
    const ended = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'end' } });
    const q = activePrompt(ended)!;
    expect('source' in q && q.source.cardCode).toBe('35005');
    const boards = [1, 2, 3, 4, 5, 6].map(k => {
      const t = structuredClone(ended);
      t.rng = { ...t.rng, state: (k * 2654435761) >>> 0 };
      return t;
    });
    // The RNG states do pick different cards (the pin would say nothing otherwise)
    const trashed = boards.map(t => {
      const a = executeAction(t, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: q.id, choice: { kind: 'effect_choice', optionId: 'trash' } });
      return t.corp.hq.filter(c => !a.corp.hq.some(h => h.instanceId === c.instanceId)).map(c => c.instanceId).sort().join();
    });
    expect(new Set(trashed).size).toBeGreaterThan(1);
    const answers = boards.map(t => {
      clearCaches();
      return pick(answerPrompt(t, 'corp', undefined, true));
    });
    expect(new Set(answers).size).toBe(1);
    // Fails on beta on the answer ('no' on every RNG state): the run term ends the run
    expect(answers[0]).toBe('trash');
  });
});

/** A remote with an agenda in the root, the Runner's turn, no Corp hand (test boards). */
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.corp.credits = 12;
  s.turnNumber = 7;
  setup(s);
  s.corp.servers.remote1?.root.push(createCardInstance(s, '30036'));
  return s;
}
/** Steps the run (the Runner continues, breaks nothing; the Corp passes) until `until` holds. */
function runTo(s: GameState, until: (s: GameState) => boolean): GameState {
  for (let k = 0; k < 30 && !until(s); k++) {
    const p = activePrompt(s);
    const side = p ? p.side : s.priority?.holder ?? s.activePlayer;
    const legal = getLegalActions(s, side) as GameAction[];
    const a = p ? (legal.find(x => x.type === 'RESOLVE_PROMPT') as GameAction) : (legal.find(x => x.type === 'CONTINUE_RUN') ?? legal.find(x => x.type === 'PASS'))!;
    s = executeAction(s, a);
  }
  return s;
}

describe('the run term ahead of the per-card blocks (ruling 8.1)', () => {
  it('row 58: Carmen + Marjanah at $3 with 1 click, Tatu-Bola inside Lycian: barrier or barrier + code gate (fails on beta: code gate)', () => {
    let s = board(st => {
      installIceForTest(st, '34044', 'remote1', false);
      installIceForTest(st, '34100', 'remote1', false);
      installProgramForTest(st, '30015');
      installProgramForTest(st, '30016');
    });
    const lycian = s.corp.servers.remote1.ice[1].instanceId;
    startRunnerTurn(s);
    s.runner.credits = 3;
    s.runner.clicks = 1;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => x.priority?.holder === 'corp' && x.activeRun?.phase === 'approach_ice');
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.step).toBe('subtypes');
    expect(['barrier', 'barrier+code gate']).toContain(pick(corpMove(s)));
  });

  it("Lightning Laboratory: one unrezzed Kessleroid on HQ, the Corp at $0, a Runner without breakers: rezzes it (fails on beta: the block's 3-credit floor)", () => {
    let s = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30036')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', 'hq', false);
    startRunnerTurn(s);
    s.corp.credits = 0;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.cardCode).toBe('34097');
    expect(pick(corpMove(s))).toHaveLength(1);
  });

  it('mirror: the same board with the Corp at $5 (it can rez Kessleroid itself): the block answers as today (both)', () => {
    let s = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30036')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', 'hq', false);
    startRunnerTurn(s);
    s.corp.credits = 5;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(pick(corpMove(s))).toEqual([]);
  });
});

describe('the trash target (ruling 7.5, red team rt-sweep)', () => {
  /** Cloud Eater rezzed outside an unrezzed Tatu-Bola, Carmen (killer) and Marjanah (fracter), the Runner at `credits`. */
  function cloudEater(credits: number): GameState {
    let s = board(st => {
      installIceForTest(st, '34044', 'remote1', false);
      installIceForTest(st, '34110', 'remote1', true);
      installProgramForTest(st, '30015');
      installProgramForTest(st, '30016');
    });
    startRunnerTurn(s);
    s.runner.credits = credits;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    return runTo(s, x => {
      const p = activePrompt(x);
      return !!p && p.side === 'corp' && 'source' in p && p.source.cardCode === '34110';
    });
  }

  it('a poor Runner: the Corp trashes the card whose loss keeps it out (Marjanah, the fracter for Tatu-Bola) (fails on beta)', () => {
    const s = cloudEater(2);
    expect(activePrompt(s)?.side).toBe('corp');
    const p = pick(corpMove(s));
    expect([p].flat().map(id => title(s, id))).toEqual(['30016']);
  });

  it("mirror: a Runner too poor for Tatu-Bola either way: every trash leaves the same verdict and today's answer stands (both)", () => {
    const s = cloudEater(0);
    clearCaches();
    expect(pick(corpMove(s))).toEqual(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
  });
});

describe("the hold owner's run stand (ruling 4: the 'thisRun' walk from where the run stands)", () => {
  it('a run over: in when it was successful on the server, out otherwise; a game over by its winner', () => {
    const s = newGame(3);
    s.runsThisTurn = [{ server: 'hq', successful: true } as GameState['runsThisTurn'][number]];
    expect(runStands(s, 'hq')?.verdict()).toBe('in');
    expect(runStands(s, 'rd')?.verdict()).toBe('out');
    expect(runStands({ ...s, winner: 'corp' }, 'hq')?.verdict()).toBe('out');
  });

  it('nothing holds (no keep-out answer): a Boto encounter with HQ empty offers no end, and the answer is today\'s', () => {
    let s = board(st => {
      installIceForTest(st, '34109', 'remote1', true);
    });
    startRunnerTurn(s);
    s.runner.credits = 0;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => {
      const p = activePrompt(x);
      return !x.activeRun || (!!p && p.side === 'corp');
    });
    const p = activePrompt(s);
    if (p && p.side === 'corp') expect(pick(corpMove(s))).toEqual(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
    else expect(s.activeRun).toBeFalsy();
  });
});

describe('the run stand against the engine oracle (ruling 4: scenario boards from where a run stands)', () => {
  /** The oracle's truth: some set of the server's unrezzed ice, rezzed as approached, keeps the Runner out (scripts/stage-d/hold-oracle.ts, 'thisRun'). */
  function oracleOut(s: GameState, server: string): boolean {
    const open = s.corp.servers[server].ice.filter(c => !c.isRezzed).map(c => c.instanceId);
    for (let mask = 0; mask < 1 << open.length; mask++) {
      const rez = open.filter((_, i) => mask & (1 << i));
      if (oracleGetsIn(s, server, 'thisRun', rez, undefined, 200_000).answer === 'holds') return true;
    }
    return false;
  }
  /** Each answer of the Corp's prompt: the walk's verdict on the settled board and the oracle's, on the same board. */
  function both(s: GameState, server: string) {
    const p = activePrompt(s)!;
    return (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .map(a => {
        const after = executeAction(s, a);
        const stand = runStands(after, server);
        return { answer: pick(a), walk: stand?.verdict() ?? null, oracle: after.activeRun ? (oracleOut(after, server) ? 'out' : 'in') : stand?.verdict() };
      });
  }

  it('Cloud Eater: after each trash, in the Movement Phase before an unrezzed Tatu-Bola (6.9.4d, 6.9.2b): the walk agrees with the oracle', () => {
    for (const credits of [0, 2]) {
      let s = board(st => {
        installIceForTest(st, '34044', 'remote1', false);
        installIceForTest(st, '34110', 'remote1', true);
        installProgramForTest(st, '30015');
        installProgramForTest(st, '30016');
      });
      startRunnerTurn(s);
      s.runner.credits = credits;
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
      s = runTo(s, x => {
        const p = activePrompt(x);
        return !!p && p.side === 'corp' && 'source' in p && p.source.cardCode === '34110';
      });
      for (const r of both(s, 'remote1')) expect(r.walk, JSON.stringify(r)).toBe(r.oracle);
    }
  });

  it("Lycian's subtypes at the approach (rezzed, the encounter to come): the walk agrees with the oracle on every choice", () => {
    for (const credits of [3, 4]) {
      let s = board(st => {
        installIceForTest(st, '34044', 'remote1', false);
        installIceForTest(st, '34100', 'remote1', false);
        installProgramForTest(st, '30015');
        installProgramForTest(st, '30016');
      });
      const lycian = s.corp.servers.remote1.ice[1].instanceId;
      startRunnerTurn(s);
      s.runner.credits = credits;
      s.runner.clicks = 1;
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
      s = runTo(s, x => x.priority?.holder === 'corp' && x.activeRun?.phase === 'approach_ice');
      s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
      // A sentry choice gives Lycian "Trash 1 installed program", which the walk carries as inert (hold.ts INERT; the
      // trashed-breaker count was parked for good by Jeff, 2026-11-18): there the walk may say "in" where the oracle's
      // Corp trashes the fracter, toward letting the Runner in (the safe side for this term: it never picks such an answer as a keep-out)
      for (const r of both(s, 'remote1')) {
        if (String(r.answer).includes('sentry') || r.answer === 'all') {
          if (r.walk !== r.oracle) expect([r.walk, r.oracle], JSON.stringify(r)).toEqual(['in', 'out']);
        } else expect(r.walk, JSON.stringify(r)).toBe(r.oracle);
      }
    }
  });
});

describe("the settle: the Corp's follow-up prompts as its choice (ruling 10, option A)", () => {
  type V = 'in' | 'out' | null;
  /** Each legal answer of the open Corp prompt, played by the engine (an answer it refuses is no answer). */
  const next = (s: GameState): GameState[] => {
    const p = activePrompt(s)!;
    return (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .flatMap(a => {
        try {
          return [executeAction(s, a)];
        } catch {
          return [];
        }
      });
  };
  const followUp = (s: GameState, server: string) => {
    const p = activePrompt(s);
    return !!p && p.side === 'corp' && s.activeRun?.server === server && !s.winner;
  };
  /** The brute force by the engine: at a Corp follow-up of the run, `node` combines its answers' stands; elsewhere the walk reads the board. */
  function brute(s: GameState, server: string, node: (vs: V[]) => V, depth = 0): V {
    if (followUp(s, server) && depth < 8) {
      const vs = next(s).map(x => brute(x, server, node, depth + 1));
      if (vs.length) return vs.includes(null) ? null : node(vs);
      return runStands({ ...s, pendingPrompts: [] }, server)?.verdict() ?? null;
    }
    return runStands(s, server)?.verdict() ?? null;
  }
  const or = (vs: V[]): V => (vs.includes('out') ? 'out' : 'in');
  const and = (vs: V[]): V => (vs.every(v => v === 'out') ? 'out' : 'in');
  const first = (vs: V[]): V => vs[0];

  it('equals an OR over the answers by the engine on every answer of the recorded run prompts; AND and first-answer-only differ somewhere', () => {
    const names = ['deal-1601-t12-30062', 'deal-1601-t7-30062', 'deal-2873-t8-30062', 'deal-1641-t21-30062', 'deal-1841-t9-35005', 'report-39-t7-34109-107', 'report-39-t7-34109-108', 'report-39-t1-34109-16'];
    let nodes = 0;
    let andDiffers = 0;
    let firstDiffers = 0;
    for (const name of names) {
      const s = fixture(name);
      const server = s.activeRun!.server;
      for (const after of next(s)) {
        clearCaches();
        const got = settledStand(after, server)?.verdict() ?? null;
        expect(got, `${name}`).toBe(brute(after, server, or));
        if (!followUp(after, server)) continue;
        nodes++;
        if (brute(after, server, and) !== got) andDiffers++;
        if (brute(after, server, first) !== got) firstDiffers++;
      }
    }
    // The boards hold Corp follow-ups (Shred's reveal after Ballista's end, Boto's second subroutine) where the reading matters
    expect(nodes).toBeGreaterThanOrEqual(3);
    expect(andDiffers).toBeGreaterThan(0);
    expect(firstDiffers).toBeGreaterThan(0);
  });

  it('past the cap (3 Corp follow-ups) reads "in" and counts it; at the cap the follow-up is still followed (ruling 11.1)', () => {
    // Boto's first subroutine with the second to come: answering "no trash" opens the second, a Corp follow-up whose
    // answers separate (one ends the run), so the follow-up read as "in" is visible
    const s = fixture('report-39-t7-34109-107');
    const server = s.activeRun!.server;
    const before = runTermStats.capped;
    const past = settledStand(s, server, false, 3);
    expect(runTermStats.capped).toBe(before + 1);
    expect(past?.key).toBe('in');
    expect(past?.verdict()).toBe('in');
    // One short of the cap: the prompt is a choice node (its answers are followed), and here one answer ends the run
    const at = settledStand(s, server, false, 2);
    expect(at?.key.startsWith('["or"')).toBe(true);
    expect(at?.verdict()).toBe('out');
    // Its "no trash" answer meets the second subroutine's prompt past the cap
    expect(runTermStats.capped).toBe(before + 2);
  });

  it("a Runner prompt that is not a subroutine's choice is the Runner's side, and counted", () => {
    // Funhouse's encounter ability (end the run unless the Runner takes 1 tag) is the ice's, not a subroutine's choice
    let s = board(st => {
      installIceForTest(st, '30054', 'remote1', true);
    });
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => activePrompt(x)?.side === 'runner');
    const p = activePrompt(s)!;
    expect('source' in p && p.source.cardCode).toBe('30054');
    const before = runTermStats.runnerOther;
    expect(settledStand(s, 'remote1')?.verdict()).toBe('in');
    expect(runTermStats.runnerOther).toBe(before + 1);
  });

  it("human report-49 T12, Lycian's trash under Thunderbolt Armaments: the granted subroutine's prompt is the ice's own, and the answers' stands separate (fails on 14e22de: all \"in\")", () => {
    // Thunderbolt Armaments 34096 grants the encountered ice "End the run unless the Runner trashes 1 of their installed
    // cards" after its other subroutines; its prompt names the identity as source. Only ice has subroutines (9.8.1), and a
    // subroutine gained from an ability that adds it after the others is ordered among the ice's own (9.8.3e): the walk
    // reads the prompt as the subroutine still ahead (ruling 11.2), not as a card's trigger it cannot read
    const s = fixture('report-49-t12-34100-87');
    const server = s.activeRun!.server;
    const p = activePrompt(s)!;
    const before = runTermStats.runnerOther;
    const stands = (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .map(a => {
        const after = executeAction(s, a);
        const q = activePrompt(after)!;
        expect(q.side === 'runner' && 'source' in q && q.source.cardCode).toBe('34096');
        clearCaches();
        return settledStand(after, server)?.verdict();
      });
    // Trashing the one program that leaves the Runner unable to pay the granted subroutine and break on: out; the others in
    expect(stands).toEqual(['in', 'out', 'in']);
    expect(runTermStats.runnerOther).toBe(before);
  });
});
