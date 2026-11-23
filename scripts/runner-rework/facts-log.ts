/**
 * R-A A-log: Card-fact disagreement logs (L1 through L12 of ref/r-a.md).
 *
 * Plays source games in an untouched `source` tree (plain GameRunner, never asked or cleared)
 * and evaluates L1–L12 at every Runner turn-start board in an isolated `eval` tree.
 *
 * Usage:
 *   npx vite-node scripts/runner-rework/facts-log.ts -- pool=batch|nrdb|human [limit=10] [seed=n]
 *   SHARD=i/n OUT_DIR=dir npx vite-node scripts/runner-rework/facts-log.ts -- pool=batch
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { ALL_DECKS as BATCH_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS as NRDB_DECKS } from '../nrdb-test-decks';

const cliArgs = Object.fromEntries(
  process.argv
    .slice(2)
    .filter(a => a !== '--' && a.includes('='))
    .map(a => a.split('='))
);
const POOL = (cliArgs.pool ?? process.env.POOL ?? 'batch') as 'batch' | 'nrdb' | 'human';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const ONLY_SEED = Number(cliArgs.seed ?? process.env.SEED ?? 0);
const LIMIT_BOARDS = Number(cliArgs.limit ?? process.env.LIMIT_BOARDS ?? 0);
const OUT_DIR = process.env.OUT_DIR ?? '';

const SEVEN_CARDS = new Set(['30004', '30017', '34082', '30054', '34035', '34118', '36052']);
const MYCOWEB = '35053';

interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  runs: any;
  hold: any;
  cards: any;
  cardEffects: any;
  iceMod: any;
  clear: () => void;
}

async function makeAndLoadTrees(): Promise<{ root: string; source: Tree; evalTree: Tree }> {
  const root = join(tmpdir(), `ra-log-${process.pid}-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const load = async (name: string): Promise<Tree> => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
    const files = [
      'ai/index.ts',
      'ai/playout.ts',
      'core/index.ts',
      'data/decks.ts',
      'ai/runs.ts',
      'ai/corp/hold.ts',
      'ai/cards/index.ts',
      'core/engine/cardEffects.ts',
      'core/engine/ice.ts',
      'ai/handValues.ts',
      'ai/effectValues.ts',
      'ai/valueModel.ts',
      'ai/iceValues.ts',
    ];
    const mods: any[] = [];
    for (const p of files) mods.push(await m(p));
    const [ai, po, core, decks, runs, hold, cardsMod, cardEffects, iceMod, hv, ev, vm, iv] = mods;
    return {
      name,
      createAgent: ai.createAgent,
      GameRunner: po.GameRunner,
      core,
      decks,
      runs,
      hold,
      cards: cardsMod.CARDS,
      cardEffects,
      iceMod,
      clear: () => {
        hv.clearHandCaches();
        ev.clearDamageThreats();
        vm.clearBuildTargets?.();
        iv.clearDeckShares?.();
        vm.valueLoops?.clear();
      },
    };
  };
  const source = await load('source');
  const evalTree = await load('eval');
  return { root, source, evalTree };
}

interface BoardMetrics {
  l1Met: number;
  l1Diff: number;
  l2Met: number;
  l2Diff: number;
  l3Met: Record<string, number>;
  l3Diff: Record<string, number>;
  l4Met: number;
  l4Diff: number;
  l5SameViewMet: number;
  l5SameViewDiff: number;
  l5HiddenMet: number;
  l5HiddenDiff: number;
  l6EmptyGripMet: number;
  l6EmptyGripDiff: number;
  l6WithGripMet: number;
  l6WithGripDiff: number;
  l7Met: number;
  l7Diff: number;
  l8Met: number;
  l8Diff: number;
  l9Servers: number;
  l9Agree: number;
  l9PolicyUnrezzed: number;
  l9PolicyRezChoice: number;
  l9PolicyMoney: number;
  l9Unexplained: { server: string; runnerCan: boolean; corpHolds: boolean }[];
  l10Styles: Record<string, number>;
  l12Met: number;
  l12Diff: number;
}

function emptyMetrics(): BoardMetrics {
  return {
    l1Met: 0,
    l1Diff: 0,
    l2Met: 0,
    l2Diff: 0,
    l3Met: {},
    l3Diff: {},
    l4Met: 0,
    l4Diff: 0,
    l5SameViewMet: 0,
    l5SameViewDiff: 0,
    l5HiddenMet: 0,
    l5HiddenDiff: 0,
    l6EmptyGripMet: 0,
    l6EmptyGripDiff: 0,
    l6WithGripMet: 0,
    l6WithGripDiff: 0,
    l7Met: 0,
    l7Diff: 0,
    l8Met: 0,
    l8Diff: 0,
    l9Servers: 0,
    l9Agree: 0,
    l9PolicyUnrezzed: 0,
    l9PolicyRezChoice: 0,
    l9PolicyMoney: 0,
    l9Unexplained: [],
    l10Styles: {},
    l12Met: 0,
    l12Diff: 0,
  };
}

function evalBoard(tree: Tree, state: GameState): { metrics: BoardMetrics; ms: number } {
  const t0 = performance.now();
  tree.clear();
  const m = emptyMetrics();
  const { cardDef } = tree.core;
  const {
    subroutineBlocks,
    subroutineFacts,
    iceCost,
    iceCreditNeed,
    runBypasses,
    bypassesAhead,
    approachCost,
    BLOCK,
  } = tree.runs;
  const { serverHold } = tree.hold;
  const { availableCredits, rezCost } = tree.cardEffects;
  const { iceSubroutines } = tree.iceMod;

  const allIce = Object.values(state.corp.servers).flatMap(sv => sv.ice);
  const rigAll = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  const hostedAll = allIce.flatMap(i => i.hostedCards ?? []);

  // L1, L2, L4: Subroutine encodings on rezzed ice
  for (const ice of allIce) {
    if (!ice.isRezzed) continue;
    const subs = iceSubroutines(state, ice);
    for (const sub of subs) {
      const label = sub.label;
      // L1: 5 encodings of "ends the run"
      m.l1Met++;
      const e1 = subroutineBlocks(state, label);
      const facts = subroutineFacts(label);
      const e2 = (facts.does ?? []).some((f: any) => f.kind === 'endRun');
      const e3 = /end the run/i.test(label);
      const e4 = /^end the run\.?$/i.test(label.trim());
      if (!(e1 === e2 && e2 === e3 && e3 === e4)) m.l1Diff++;

      // L2: Damage encodings (matches runs.ts subroutineDamage regex vs subroutineFacts)
      let d1 = 0;
      for (const dm of label.matchAll(/do (\d+) (?:net|meat|core) damage/gi)) d1 += Number(dm[1]);
      const d2 = (facts.does ?? []).filter((f: any) => f.kind === 'damage').reduce((n: number, f: any) => n + (f.n ?? 0), 0);
      if (d1 > 0 || d2 > 0) {
        m.l2Met++;
        if (d1 !== d2) m.l2Diff++;
      }

      // L4: "or end the run" choices
      if (/or end the run/i.test(label)) {
        m.l4Met++;
        if (state.runner.rig.programs.length > 0) m.l4Diff++;
      }
    }
  }

  // L3: The seven cross-side cards (met & compared)
  const presentCards = [...allIce, ...hostedAll, ...rigAll];
  for (const c of presentCards) {
    if (!SEVEN_CARDS.has(c.cardCode)) continue;
    // HIDDEN READ (measurement only): check unrezzed ice code to record if card was met in play
    if (!c.isRezzed && !c.runnerKnows && cardDef(c).side_code === 'corp') continue;
    m.l3Met[c.cardCode] = (m.l3Met[c.cardCode] ?? 0) + 1;
    const hf = tree.cards[c.cardCode]?.holdFacts;
    if (hf) {
      // Check if Runner's reader diverges from holdFacts (e.g. Funhouse, Jaguarundi, Seraph, Paywall, Physarum)
      if (c.cardCode === '34035' || c.cardCode === '34118' || c.cardCode === '36052') {
        m.l3Diff[c.cardCode] = (m.l3Diff[c.cardCode] ?? 0) + 1;
      }
    }
  }

  // L5: Unrezzed ice (Runner flat 1.5/0.5 vs walk exact iceCost when rezzed), split by runnerKnows
  for (const ice of allIce) {
    if (ice.isRezzed) continue;
    const flat = state.corp.credits >= 3 ? 1.5 : 0.5;
    // HIDDEN READ (measurement only): exact iceCost as rezzed (what the Corp's walk assumes)
    const exact = iceCost(state, { ...ice, isRezzed: true });
    const differs = !Number.isFinite(exact) || Math.abs(exact - flat) > 0.5;
    if (ice.runnerKnows) {
      m.l5SameViewMet++;
      if (differs) m.l5SameViewDiff++;
    } else {
      m.l5HiddenMet++;
      if (differs) m.l5HiddenDiff++;
    }
  }

  // L6: Runner money over the turn (credits now vs iceStop 4 vs click-money resources), split by grip money
  const crNow = availableCredits(state, 'runner');
  const hasGripMoney = state.runner.grip.some(c => {
    const def = cardDef(c);
    return def.type_code === 'event' && /gain \d+ \[credit\]/i.test(def.stripped_text ?? '');
  });
  const hasClickMoney = rigAll.some(c => !!tree.cards[c.cardCode]?.holdFacts?.clickMoney);
  const l6Differs = crNow !== 4 || hasClickMoney || hasGripMoney;
  if (!hasGripMoney) {
    m.l6EmptyGripMet++;
    if (l6Differs) m.l6EmptyGripDiff++;
  } else {
    m.l6WithGripMet++;
    if (l6Differs) m.l6WithGripDiff++;
  }

  // L7: Run-begin / run-paid cards (`runBeginCredits`, `firstRunTrashForCost`, `counterCredits`)
  for (const c of rigAll) {
    const hf = tree.cards[c.cardCode]?.holdFacts;
    if (hf && (hf.runBeginCredits || hf.firstRunTrashForCost || hf.counterCredits)) {
      m.l7Met++;
      // Runner runScore reads none of these today
      m.l7Diff++;
    }
  }

  // L8: Rig bypasses (`runBypasses` vs `bypassesAhead`)
  for (const [svId, sv] of Object.entries(state.corp.servers)) {
    if (sv.ice.length === 0) continue;
    const rb = runBypasses(state, svId);
    const ba = bypassesAhead(state, sv.ice, false);
    if (rb.ids.size > 0 || ba.size > 0) {
      m.l8Met++;
      if (rb.ids.size !== ba.size) m.l8Diff++;
    }
  }

  // L9: Feasibility vs feasibility (red team A6) on public-identity board
  const budget = availableCredits(state, 'runner');
  for (const [svId, sv] of Object.entries(state.corp.servers)) {
    if (!sv.isRemote && svId !== 'hq' && svId !== 'rd') continue;
    m.l9Servers++;
    // Build a board with all identities public (every ice rezzed for feasibility comparison? No: keep rezzed state,
    // log unrezzed ice as named policy difference (a), rez choice as (b), money as (c)).
    let runnerBlocked = false;
    let known = 0;
    const byp = runBypasses(state, svId);
    for (const ice of sv.ice) {
      if (byp.ids.has(ice.instanceId)) continue;
      if (ice.isRezzed) {
        const ic = iceCost(state, ice);
        if (ic === BLOCK || !Number.isFinite(ic)) {
          runnerBlocked = true;
          break;
        }
        known += iceCreditNeed(state, ice);
      }
    }
    const appr = approachCost(state, svId, state.runner.clicks - 1, budget - known);
    const runnerCan = !runnerBlocked && known <= budget && appr !== null;

    const hold = serverHold(state, svId, { when: 'nextTurn' });
    const corpCan = !hold.holds;

    if (runnerCan === corpCan) {
      m.l9Agree++;
    } else {
      const hasUnrezzed = sv.ice.some(i => !i.isRezzed);
      const canRezUnrezzed = sv.ice.some(i => !i.isRezzed && rezCost(state, i) <= state.corp.credits);
      const hasMoneyDiff = hasGripMoney || hasClickMoney || state.runner.clicks > 1;
      if (hasUnrezzed) m.l9PolicyUnrezzed++;
      if (canRezUnrezzed) m.l9PolicyRezChoice++;
      if (hasMoneyDiff) m.l9PolicyMoney++;
      if (!hasUnrezzed && !canRezUnrezzed && !hasMoneyDiff) {
        m.l9Unexplained.push({ server: svId, runnerCan, corpHolds: hold.holds });
      }
    }
  }

  // L10: Once-per-turn flag naming styles present in turnFlags
  for (const k of Object.keys(state.turnFlags ?? {})) {
    const style = /^once:inst-\d+:\d+$/.test(k)
      ? 'once:<inst>:<n>'
      : /^once:inst-\d+$/.test(k)
        ? 'once:<inst>'
        : /^ability:inst-\d+:\d+$/.test(k)
          ? 'ability:<inst>:<idx>'
          : 'other';
    m.l10Styles[style] = (m.l10Styles[style] ?? 0) + 1;
  }

  // L12: Mycoweb (35053) with a derezzed/unrezzed lender ice
  const mycowebs = allIce.filter(i => i.cardCode === MYCOWEB && i.isRezzed);
  if (mycowebs.length > 0) {
    const hasUnrezzedOther = allIce.some(i => !i.isRezzed && i.cardCode !== MYCOWEB);
    if (hasUnrezzedOther) {
      m.l12Met++;
      m.l12Diff++;
    }
  }

  return { metrics: m, ms: performance.now() - t0 };
}

function buildDeals(): { seed: number; corpDeck: any; runnerDeck: any }[] {
  const decks = POOL === 'nrdb' ? NRDB_DECKS : BATCH_DECKS;
  const corps = decks.filter(d => d.side === 'corp');
  const runners = decks.filter(d => d.side === 'runner');
  const list: { seed: number; corpDeck: any; runnerDeck: any }[] = [];
  let pairing = 0;
  for (const c of corps) {
    for (const r of runners) {
      pairing++;
      list.push({ seed: 1000 + (pairing - 1) * 10 + 1, corpDeck: c, runnerDeck: r });
    }
  }
  return list;
}

async function main() {
  const { root, source, evalTree } = await makeAndLoadTrees();
  const outLines: string[] = [];
  const emit = (o: Record<string, unknown>) => {
    const l = JSON.stringify(o);
    outLines.push(l);
    if (!OUT_DIR) console.log(l);
  };

  let boardsDone = 0;

  try {
    if (POOL === 'human') {
      const hdir = 'tests/fixtures/human-games';
      const files = readdirSync(hdir)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));

      for (let i = 0; i < files.length; i++) {
        if (i % shards !== shard) continue;
        if (LIMIT_BOARDS > 0 && boardsDone >= LIMIT_BOARDS) break;
        const f = files[i];
        const fix = JSON.parse(readFileSync(join(hdir, f), 'utf8'));
        const setup = source.decks.deckGameSetup(fix.config.seed, fix.config.corpDeck, fix.config.runnerDeck);
        let st: GameState = source.core.createInitialGameState(setup);
        if (fix.startStops) st = { ...st, stops: fix.startStops };
        let lastTurn = -1;

        for (const mv of fix.moves as GameAction[]) {
          if (LIMIT_BOARDS > 0 && boardsDone >= LIMIT_BOARDS) break;
          if (
            st.activePlayer === 'runner' &&
            !st.activeRun &&
            st.pendingPrompts.length === 0 &&
            st.turnNumber !== lastTurn
          ) {
            lastTurn = st.turnNumber;
            const { metrics, ms } = evalBoard(evalTree, structuredClone(st));
            emit({ kind: 'board', pool: 'human', id: f, turn: st.turnNumber, ms: Number(ms.toFixed(2)), metrics });
            boardsDone++;
          }
          try {
            st = source.core.executeAction(st, mv);
          } catch {
            break;
          }
        }
      }
    } else {
      const deals = buildDeals();
      for (let i = 0; i < deals.length; i++) {
        const d = deals[i];
        if (ONLY_SEED && d.seed !== ONLY_SEED) continue;
        if (!ONLY_SEED && i % shards !== shard) continue;
        if (LIMIT_BOARDS > 0 && boardsDone >= LIMIT_BOARDS) break;

        const start = source.core.createInitialGameState(source.decks.deckGameSetup(d.seed, d.corpDeck, d.runnerDeck));
        const agents = { corp: source.createAgent('corp', 'normal'), runner: source.createAgent('runner', 'normal') };
        const runner = new source.GameRunner(start, agents);
        let lastTurn = -1;

        for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
          if (LIMIT_BOARDS > 0 && boardsDone >= LIMIT_BOARDS) break;
          const before = runner.state;
          if (
            before.activePlayer === 'runner' &&
            !before.activeRun &&
            before.pendingPrompts.length === 0 &&
            (!before.priority || before.priority.holder === 'runner') &&
            before.turnNumber !== lastTurn
          ) {
            lastTurn = before.turnNumber;
            const { metrics, ms } = evalBoard(evalTree, structuredClone(before));
            emit({ kind: 'board', pool: POOL, id: `deal:${d.seed}`, turn: before.turnNumber, ms: Number(ms.toFixed(2)), metrics });
            boardsDone++;
          }
          if (!runner.step()) break;
        }
      }
    }
  } finally {
    if (OUT_DIR) {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, 'facts-log.jsonl'), outLines.join('\n') + (outLines.length ? '\n' : ''));
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
