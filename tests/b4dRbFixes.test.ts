/**
 * B4d (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4d-rb-fixes.md rev 2), bar 1: one pin per fault,
 * each red on beta 0b9d44a and green on the branch, with its control where the brief asks for one. Boards from Gemini's
 * checkpoint audit, the exploit hunt (adversarial/2026-11-27-rb-checkpoint-hunt/states), the Fable audit's probes and
 * the red team's (adversarial/2026-11-27-b4d-rb-fixes/probes).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance, executeAction, getCardDefinition, getLegalActions } from '../src/core';
import { noteRdPrivate, runnerSeesRd, shuffleRD, updateKnowledge } from '../src/core/engine/rdKnowledge';
import { certainInArchives, certainInHand, revealInHand, runnerRootKinds } from '../src/core/engine/helpers';
import { guessRunnerView, runnerUnknownSlots } from '../src/ai/runnerReply';
import { honestPromptView } from '../src/ai/runner/prompt';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { GameRunner } from '../src/ai/playout';
import { asSide } from '../src/ai/pricing';
import { runScore, serverValue } from '../src/ai/runs';
import { inDecision } from './helpers/pricing';
import { nudge, tuning } from '../src/ai/synergy';
import { knownByCopy, relabelledRdCopy } from '../scripts/engine-fuzz-check';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce } from './helpers';

const BOTO = '34109';
const CLEAVER = '30006';
const KARUNA = '30047';
const CARMEN = '30015';
const PALISADE = '30072';

/** The run played to its end by the deciding Runner (the Corp passes, answers its prompts with the first answer). */
function playRun(s0: GameState, max = 40): { winner: string | null; acts: string[] } {
  let s = s0;
  const ai = new HeuristicRunnerAI();
  const acts: string[] = [];
  for (let i = 0; i < max && s.activeRun && !s.winner; i++) {
    const corpPrompt = s.pendingPrompts[0]?.side === 'corp';
    const runnerLegal = corpPrompt ? [] : getLegalActions(s, 'runner');
    if (runnerLegal.length === 0) {
      const legal = getLegalActions(s, 'corp');
      if (!legal.length) break;
      const a = legal.find(x => x.type === 'RESOLVE_PROMPT') ?? legal.find(x => x.type === 'CONTINUE_RUN' || x.type === 'PASS') ?? legal[0];
      acts.push(`corp:${a.type}`);
      s = executeAction(s, a);
      continue;
    }
    const a = asSide('runner', () => ai.chooseAction(s));
    acts.push(a.type);
    s = executeAction(s, a);
  }
  return { winner: s.winner ?? null, acts };
}

describe('B4d (f): a subroutine that would flatline is broken with all the credits (rules 1.7.2b, 10.4.4)', () => {
  /** Outer Karunā (2 net, 2 net) before Palisade on a remote, Carmen, 4 credits, 1 card in the grip (Gemini's boards). */
  function karuna(cleaver: boolean): GameState {
    const state = newGame();
    installIceForTest(state, PALISADE, 'remote-9');
    installIceForTest(state, KARUNA, 'remote-9');
    installProgramForTest(state, CARMEN);
    if (cleaver) installProgramForTest(state, CLEAVER);
    const s = runIntoFirstIce(state, 'remote-9');
    s.runner.credits = 4;
    s.runner.grip.splice(1);
    return s;
  }
  it('Karunā before an unbreakable Palisade: breaks both damage subroutines, then jacks out (was flatlined)', () => {
    const { winner, acts } = playRun(karuna(false));
    expect(winner).toBeNull();
    expect(acts).toContain('JACK_OUT');
  });
  it('Karunā before a Palisade Cleaver can break (creditsAhead 3): not flatlined', () => {
    expect(playRun(karuna(true)).winner).toBeNull();
  });

  /** RT1: Boto alone (2 net, then two "trash 1 card from HQ to end the run"), Cleaver, 1 card in the grip. */
  function boto(credits: number): GameState {
    const state = newGame();
    installIceForTest(state, BOTO, 'remote-9');
    installProgramForTest(state, CLEAVER);
    const s = runIntoFirstIce(state, 'remote-9');
    s.runner.credits = credits;
    s.runner.grip.splice(1);
    return s;
  }
  it('RT1: Boto alone at 3 credits (creditsAhead 0): breaks the damage subroutine and lives (was flatlined)', () => {
    expect(playRun(boto(3)).winner).toBeNull();
  });
  it('RT1 control: Boto at 4 credits breaks everything and lives', () => {
    const { winner, acts } = playRun(boto(4));
    expect(winner).toBeNull();
    expect(acts.filter(a => a === 'BREAK_SUBROUTINE').length).toBe(2);
  });
});

/** A hunt board (adversarial/2026-11-27-rb-checkpoint-hunt/states, copied to tests/fixtures/b4d). */
const board = (file: string): GameState => {
  const raw = JSON.parse(readFileSync(`tests/fixtures/b4d/${file}`, 'utf8'));
  return raw.state ?? raw;
};
/** The rest of the Runner's turn, played by the deciding Runner (planner on) against the rule-based Corp. */
function playTurn(s0: GameState, max = 400): { runs: string[]; end: GameState } {
  const g = new GameRunner(structuredClone(s0), { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({ planner: true }) });
  const runs: string[] = [];
  for (let i = 0; i < max && !g.state.winner; i++) {
    if (!g.step()) break;
    const a = g.last;
    if (a?.type === 'INITIATE_RUN') runs.push(a.targetServerId);
    if (g.state.activePlayer !== s0.activePlayer) break;
  }
  return { runs, end: g.state };
}
const spinDoctorLeft = (s: GameState, server: string) => s.corp.servers[server]?.root.some(c => c.cardCode === '30053') ?? false;

describe('B4d (d): a trash is priced on the credits left at the access, after the ice (hunt finding 1)', () => {
  const seed110 = (credits: number) => {
    const s = board('hunt-seed110-T5-2c-2k.json');
    s.runner.credits = credits;
    return s;
  };
  const seed217 = (credits: number) => {
    const s = board('hunt-seed217-T16.json');
    s.runner.credits = credits;
    return s;
  };
  /** The run's price on the board (the root known: the Runner saw both cards) and the turn as played. */
  const priced = (s: GameState, server: string) => {
    const memory = new Map(s.corp.servers[server].root.map(c => [c.instanceId, c.cardCode]));
    return inDecision(s, 'runner', () => runScore(s, server, { memory, wary: true }));
  };
  const fruitless = (s: GameState, server: string) => {
    const { runs, end } = playTurn(s);
    return runs.includes(server) && spinDoctorLeft(end, server);
  };
  it('seed 110 [Flyswatter | Spin Doctor], 2 credits 2 clicks: no run on remote-1 (was a run that cannot trash)', () => {
    const s = seed110(2);
    expect(priced(s, 'remote-1') ?? -Infinity).toBeLessThanOrEqual(0);
    expect(playTurn(s).runs).not.toContain('remote-1');
  });
  it('seed 110 counter-pin (RT7): at 3 credits the Runner runs remote-1 and trashes Spin Doctor', () => {
    const { runs, end } = playTurn(seed110(3));
    expect(runs).toContain('remote-1');
    expect(spinDoctorLeft(end, 'remote-1')).toBe(false);
  });
  for (const credits of [4, 5])
    it(`seed 217 [Lamplighter | Spin Doctor], ${credits} credits: no run on remote-6 that cannot trash (Carmen spends 4 on the ice)`, () => {
      const s = seed217(credits);
      expect(priced(s, 'remote-6') ?? -Infinity).toBeLessThanOrEqual(0);
      // A credit event first (5 credits: Sure Gamble to 9) makes the run worth it: what is pinned is the run that cannot trash
      expect(fruitless(s, 'remote-6')).toBe(false);
    });
  it('seed 217 counter-pin (RT7): at 7 credits the Runner runs remote-6 and trashes Spin Doctor', () => {
    const { runs, end } = playTurn(seed217(7));
    expect(runs).toContain('remote-6');
    expect(spinDoctorLeft(end, 'remote-6')).toBe(false);
  });
  // R-14l (R-C1, the walk's end board) replaces the stopgap owner: the run's price counts only the ice's run-ending
  // breaks (icePrice prices Tithe's tank at 0 credits), while encounterAction breaks every subroutine priced 1 or more
  // (src/ai/runner/run.ts must-break floor), so the trash stays priced at 2 credits and the run leaves 1 (red team RT4, D2)
  it.fails('R-14l known failure (D2): Tithe in Flyswatter\'s place, Carmen installed: no run on remote-1 at 2 credits', () => {
    const s = seed110(2);
    const tithe = createCardInstance(s, '30073');
    tithe.isRezzed = true;
    s.corp.servers['remote-1'].ice = [tithe];
    installProgramForTest(s, CARMEN);
    const memory = new Map(s.corp.servers['remote-1'].root.map(c => [c.instanceId, c.cardCode]));
    const score = inDecision(s, 'runner', () => runScore(s, 'remote-1', { memory, wary: true }));
    expect(score === null || score <= 0).toBe(true);
  });
});

describe('B4d (a): the R&D price reads only the marks still certain (certainRdMarks; rules 10.2.2b, 1.12.3)', () => {
  const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];
  function act(s: GameState, change: (next: GameState) => void): GameState {
    const next = structuredClone(s);
    change(next);
    updateKnowledge(s, next);
    return next;
  }
  it('P4: an agenda seen on top of R&D, then taken into HQ in secret (left: hq): the access prices as unseen (was 3x)', () => {
    const s0 = newGame();
    const agenda = s0.corp.rd.find(c => getCardDefinition(c.cardCode).type_code === 'agenda')!;
    const s1 = structuredClone(s0);
    s1.corp.rd.unshift(take(s1.corp.rd, agenda.instanceId));
    const plain = s1.corp.rd.filter(c => getCardDefinition(c.cardCode).type_code !== 'agenda').slice(0, 2);
    for (const c of plain) take(s1.corp.rd, c.instanceId);
    s1.corp.rd.splice(1, 0, ...plain);
    const value = (s: GameState) => asSide('runner', () => serverValue(s, 'rd', 0, undefined, true));
    const unseen = value(s1);
    const s2 = act(s1, n => runnerSeesRd(n, n.corp.rd[0]));
    expect(value(s2)).toBeGreaterThan(unseen * 2); // control: seen on top, the agenda is priced as there
    const s3 = act(s2, n => {
      noteRdPrivate(n, 3);
      n.corp.hq.push(take(n.corp.rd, agenda.instanceId));
    });
    expect(s3.corp.rdKnownToRunner?.[0]?.left).toBe('hq');
    expect(value(s3)).toBeCloseTo(unseen, 6);
  });
});

describe('B4d (b): after a shuffle, which copy moved does not change the R&D marks (rules 10.2.2b, 1.12.3)', () => {
  const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];
  function act(s: GameState, change: (next: GameState) => void): GameState {
    const next = structuredClone(s);
    change(next);
    updateKnowledge(s, next);
    return next;
  }
  /** The marks as the Runner holds them, ids left out (which copy a mark names is not the Runner's to know). */
  const marks = (s: GameState) => JSON.stringify((s.corp.rdKnownToRunner ?? []).map(e => ({ code: e.code, lo: e.lo, hi: e.hi, n0: e.n0, left: e.left })));
  for (const dest of ['ice', 'hq'] as const)
    it(`P1: a Palisade seen in HQ goes into R&D unseen; one R&D card leaves unseen (${dest}) in a shuffle: the same marks whichever card it was`, () => {
      const run = (which: 'labelled' | 'other') => {
        const s0 = newGame();
        const x = createCardInstance(s0, '30072');
        s0.corp.hq = [x, createCardInstance(s0, '30075'), createCardInstance(s0, '30075')];
        let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
        s = act(s, n => {
          n.corp.rd.push(take(n.corp.hq, x.instanceId));
          shuffleRD(n);
        });
        const y = createCardInstance(s, '30054');
        s = act(s, n => n.corp.rd.splice(3, 0, y));
        s = act(s, n => runnerSeesRd(n, n.corp.rd.find(c => c.instanceId === y.instanceId)!));
        const z = s.corp.rd.find(c => c.instanceId !== x.instanceId && c.instanceId !== y.instanceId && getCardDefinition(c.cardCode).type_code === 'ice')!;
        const moved = which === 'labelled' ? x.instanceId : z.instanceId;
        s = act(s, n => {
          const c = take(n.corp.rd, moved);
          if (dest === 'ice') n.corp.servers.hq.ice.push(c);
          else n.corp.hq.push(c);
          shuffleRD(n);
        });
        return marks(s);
      };
      expect(run('labelled')).toBe(run('other'));
    });
  it('RT3 B1: a tutor (taken from R&D, revealed, into HQ, R&D shuffled) of either of two copies leaves the same marks', () => {
    const base = newGame();
    const code = '30075';
    const a = createCardInstance(base, code);
    const b = createCardInstance(base, code);
    base.corp.rd.splice(3, 0, a);
    base.corp.rd.splice(9, 0, b);
    base.corp.rdKnownToRunner = [{ id: a.instanceId, code, lo: 3, hi: 3 }];
    const tutor = (id: string) =>
      act(base, n => {
        const card = take(n.corp.rd, id);
        n.corp.hq.push(card);
        revealInHand(n, 'corp', [card]);
        shuffleRD(n);
      });
    expect(marks(tutor(a.instanceId))).toBe(marks(tutor(b.instanceId)));
  });
});

describe('B4d (b), bar 2: the fuzzer\'s R&D known-by-copy check sees the share removal by id (rdKnowledge.ts afterShuffle)', () => {
  it('the B1 tutor with the share relabelled to the other copy (relabelledRdCopy) ends with the same R&D shares', () => {
    const base = newGame();
    const a = createCardInstance(base, '30075');
    const b = createCardInstance(base, '30075');
    base.corp.rd.splice(3, 0, a);
    base.corp.rd.splice(9, 0, b);
    base.corp.rdKnownToRunner = [{ id: a.instanceId, code: '30075', lo: 3, hi: 3 }];
    // A shuffle first, so the mark is a share (the check relabels shares only)
    const shuffled = structuredClone(base);
    shuffleRD(shuffled);
    updateKnowledge(base, shuffled);
    expect(shuffled.corp.rdKnownToRunner?.[0]?.n0).toBeGreaterThan(0);
    const relabelled = relabelledRdCopy(shuffled)!;
    expect(relabelled.corp.rdKnownToRunner![0].id).not.toBe(shuffled.corp.rdKnownToRunner![0].id);
    const tutor = (s: GameState) => {
      const next = structuredClone(s);
      const at = next.corp.rd.findIndex(c => c.instanceId === a.instanceId);
      const card = next.corp.rd.splice(at, 1)[0];
      next.corp.hq.push(card);
      revealInHand(next, 'corp', [card]);
      shuffleRD(next);
      updateKnowledge(s, next);
      return knownByCopy(next);
    };
    expect(tutor(relabelled)).toBe(tutor(shuffled));
  });
});

describe('B4d (c): the cards a prompt shows are pinned identities of the deal, so the honest view keeps the deal\'s rules', () => {
  const type = (code: string) => getCardDefinition(code).type_code;
  const UPGRADE = '30042'; // Manegarm Skunkworks
  const ASSET = '30053'; // Spin Doctor
  const AGENDA = '30070'; // Superconducting Hub
  const HEDGE = '30075'; // Hedge Fund
  type Server = GameState['corp']['servers'][string];
  const access = (s: GameState, id: string, trashCost: number | null = 0) => {
    s.pendingPrompts = [{ id: 'p1', side: 'runner', kind: 'access_trash', cardInstanceId: id, trashCost } as GameState['pendingPrompts'][number]];
  };
  /** The honest view on 24 deals of the Runner's guess (guessRunnerView, as runnerDecisionView makes it), each checked. */
  function honestViews(s: GameState): GameState[] {
    return asSide('runner', () =>
      Array.from({ length: 24 }, (_, k) => {
        const view = guessRunnerView(s, k);
        return honestPromptView(s, { view, slots: (v: GameState) => runnerUnknownSlots(v), synergy: true, answer: () => { throw new Error('not asked'); } }).view;
      }),
    );
  }
  /** The deal's rules on a view: one agenda or asset per remote root, the root kinds, each zone's certain counts, the shown card's identity. */
  function broken(s: GameState, v: GameState, shownId: string): string[] {
    const out: string[] = [];
    for (const sv of Object.values(v.corp.servers)) {
      if (sv.isRemote && sv.root.filter(c => ['agenda', 'asset'].includes(type(c.cardCode))).length > 1) out.push(`${sv.id}: two agendas or assets`);
      for (const c of sv.root) {
        const kinds = runnerRootKinds(s, s.corp.servers[sv.id].root.find(x => x.instanceId === c.instanceId)!)?.kinds;
        if (kinds && !kinds.includes(type(c.cardCode) as never)) out.push(`${c.instanceId}: a ${type(c.cardCode)} where only ${kinds} can be`);
      }
    }
    for (const [zone, cards, certain] of [['HQ', v.corp.hq, certainInHand(s, 'corp')], ['Archives', v.corp.archives.faceDown, certainInArchives(s)]] as const)
      for (const [code, n] of certain) if (cards.filter(c => c.cardCode === code).length < n) out.push(`${zone}: fewer than ${n} of ${code}`);
    const real = [...s.corp.hq, ...s.corp.rd, ...Object.values(s.corp.servers).flatMap(x => x.root)].find(c => c.instanceId === shownId)!;
    const dealt = [...v.corp.hq, ...v.corp.rd, ...Object.values(v.corp.servers).flatMap(x => x.root)].find(c => c.instanceId === shownId)!;
    if (dealt.cardCode !== real.cardCode) out.push(`the shown card ${shownId} is dealt ${dealt.cardCode}, not ${real.cardCode}`);
    return out;
  }
  const check = (s: GameState, shownId: string) => expect(honestViews(s).flatMap(v => broken(s, v, shownId))).toEqual([]);

  it('RT2 C1: a root-mate of an upgrade is accessed (an asset): its root never holds an agenda beside it (3.3.1)', () => {
    const s = newGame();
    const x = createCardInstance(s, UPGRADE);
    const y = createCardInstance(s, ASSET);
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote 1', isRemote: true, ice: [], root: [x, y] } as Server;
    s.corp.hq = [createCardInstance(s, AGENDA)];
    access(s, y.instanceId);
    check(s, y.instanceId);
  });
  it('RT2 C2: an HQ card is accessed beside a Hedge Fund the Runner saw: HQ keeps its Hedge Fund (10.2.2b)', () => {
    const s = newGame();
    const a = createCardInstance(s, ASSET);
    const b = createCardInstance(s, HEDGE);
    s.corp.hq = [a, b];
    s.corp.rd = [createCardInstance(s, AGENDA), ...s.corp.rd.filter(c => c.cardCode !== HEDGE && c.cardCode !== ASSET)];
    s.corp.knownToRunner = [{ id: b.instanceId, code: HEDGE }];
    access(s, a.instanceId, 1);
    check(s, a.instanceId);
  });
  it('Gemini 1: a Manegarm accessed in R&D, a facedown Manegarm in HQ\'s root: no agenda in a central root (3.6.1)', () => {
    const s = newGame();
    const root = createCardInstance(s, UPGRADE);
    s.corp.servers.hq.root = [root];
    const top = createCardInstance(s, UPGRADE);
    s.corp.rd = [top, ...s.corp.rd];
    access(s, top.instanceId, 1);
    check(s, top.instanceId);
  });
  it('Gemini 2: a Hedge Fund accessed in R&D, another seen in HQ: HQ keeps one', () => {
    const s = newGame();
    const seen = createCardInstance(s, HEDGE);
    s.corp.hq = [seen, ...s.corp.hq.filter(c => c.cardCode !== HEDGE)];
    s.corp.knownToRunner = [{ id: seen.instanceId, code: HEDGE }];
    const top = createCardInstance(s, HEDGE);
    s.corp.rd = [top, ...s.corp.rd];
    access(s, top.instanceId, null);
    check(s, top.instanceId);
  });
  it('P5: a Manegarm accessed in HQ, a facedown card beside a rezzed asset: that card stays an upgrade', () => {
    const s = newGame();
    const corp = [...s.corp.rd, ...s.corp.hq];
    const asset = { ...createCardInstance(s, corp.find(c => type(c.cardCode) === 'asset')!.cardCode), isRezzed: true };
    const u = createCardInstance(s, UPGRADE);
    const h = createCardInstance(s, UPGRADE);
    const g = createCardInstance(s, corp.find(c => type(c.cardCode) === 'agenda')!.cardCode);
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote 1', isRemote: true, ice: [], root: [asset, u] } as Server;
    s.corp.hq = [h, g];
    access(s, h.instanceId, null);
    check(s, h.instanceId);
  });
  it('no prompt: the deal is the same as before the pins (guessRunnerView with no shown card)', () => {
    const s = newGame();
    const x = createCardInstance(s, UPGRADE);
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote 1', isRemote: true, ice: [], root: [x] } as Server;
    const codes = (v: GameState) => [...v.corp.hq, ...v.corp.rd, ...v.corp.servers['remote-1'].root].map(c => c.cardCode).join(',');
    const a = asSide('runner', () => codes(guessRunnerView(s, 3)));
    const t = structuredClone(s);
    expect(asSide('runner', () => codes(guessRunnerView(t, 3)))).toBe(a);
  });
});

describe('B4d (e): the main-phase ranking reads the Runner\'s view, not the Corp\'s hidden cards (rule 10.2.2a; tracker R-16)', () => {
  const CHAIN_REACTION = '36001';
  const SPIN_DOCTOR = '30053';
  type Server = GameState['corp']['servers'][string];
  /** A Runner turn with Chain Reaction in the grip and a rezzed asset in a remote; `swap`: an HQ agenda traded with an R&D card. */
  function board(swap: boolean): GameState {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));
    s.runner.credits = 6;
    s.runner.grip.push(createCardInstance(s, CHAIN_REACTION));
    // Gemini's board: a rezzed Spin Doctor (its worth reads the Corp's later draws) and three faceup Archives cards
    const spin = createCardInstance(s, SPIN_DOCTOR);
    spin.isRezzed = true;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote 9', isRemote: true, ice: [], root: [spin] } as Server;
    const corp = (t: string) => getCardDefinition(t);
    const agenda = [...s.corp.rd, ...s.corp.hq].find(c => corp(c.cardCode).type_code === 'agenda')!;
    const other = [...s.corp.rd, ...s.corp.hq].find(c => corp(c.cardCode).type_code === 'operation')!;
    // Both cards unseen: the same in each board, with which zone holds the agenda the only change
    for (const z of [s.corp.rd, s.corp.hq]) for (const c of [agenda, other]) { const i = z.indexOf(c); if (i >= 0) z.splice(i, 1); }
    const [hq, rd] = swap ? [other, agenda] : [agenda, other];
    s.corp.hq.push(hq);
    s.corp.rd.push(rd);
    const ops = s.corp.rd.filter(c => c !== rd && corp(c.cardCode).type_code === 'operation').slice(0, 3);
    s.corp.rd = s.corp.rd.filter(c => !ops.includes(c));
    s.corp.archives.faceUp.push(...ops);
    s.corp.rdKnownToRunner = (s.corp.rdKnownToRunner ?? []).filter(e => e.id !== agenda.instanceId && e.id !== other.instanceId);
    s.corp.knownToRunner = (s.corp.knownToRunner ?? []).filter(e => e.id !== agenda.instanceId && e.id !== other.instanceId);
    return s;
  }
  const hqRun = (s: GameState) =>
    inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true }).rankMainActions(s)).find(r => r.action.type === 'INITIATE_RUN' && r.action.targetServerId === 'hq')!.score;
  it('Gemini S1: two boards the Runner cannot tell apart (an agenda in HQ or in R&D) give the same HQ run score', () => {
    expect(hqRun(board(true))).toBe(hqRun(board(false)));
  });
  it('Gemini S1 (latent): the nudge for a run on a facedown card reads no type, so an agenda and an asset nudge alike at synergy 1', () => {
    const nudgeFor = (code: string) => {
      const s = newGame();
      s.runner.identity = { ...s.runner.identity, cardCode: '30001' }; // René "Loup" Arcemont: wants trash
      const c = createCardInstance(s, code);
      s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote 9', isRemote: true, ice: [], root: [c] } as Server;
      const was = tuning.synergy.runner;
      tuning.synergy.runner = 1;
      try {
        return nudge(s, 'runner', { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-9' }).bonus;
      } finally {
        tuning.synergy.runner = was;
      }
    };
    expect(nudgeFor('30070')).toBe(nudgeFor('30071')); // Superconducting Hub (agenda), Regolith Mining License (asset)
  });
  it('BANGUN: a faceup agenda is worth nothing to access when the grip left after the ice cannot take the 2 meat damage (rule 10.4.4)', () => {
    const s = newGame();
    s.corp.identity = { ...s.corp.identity, cardCode: '35068' }; // BANGUN
    const a = createCardInstance(s, '30070');
    a.faceUp = true;
    s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote 9', isRemote: true, ice: [], root: [a] } as Server;
    expect(s.runner.grip.length).toBeGreaterThan(2);
    const worth = (grip: number) => inDecision(s, 'runner', () => serverValue(s, 'remote-9', 0, undefined, false, undefined, grip));
    expect(worth(s.runner.grip.length)).not.toBe(0);
    expect(worth(1)).toBe(0);
  });
});
