/**
 * B0 Part T: Lockstep trace of deal 2211 (shard 57, second game after deal 1571)
 * between the two null head-to-head cells (`h2h=corp` vs `h2h=runner`) on the current commit.
 *
 * Copies `src/` and `scripts/` into isolated temp directories (never touching repo `src/`),
 * instruments the value caches (`threats`, `buildTargets`, `iceMeans`, `deckShares`) in both
 * the `new` and `old` module graphs, replays shard 57 (deals 1571 and 2211) under both cells,
 * finds the first differing decision on deal 2211, and reports the first differing cache hit
 * under that decision (cache name, key, values, and writer).
 *
 * Usage:
 *   npx vite-node scripts/runner-rework/b0-trace-2211.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface CacheEvent {
  op: 'set' | 'hit' | 'clear';
  cache: string;
  key: string;
  val: string;
  graph: string;
  caller: string;
  deal: number;
  step: number;
  turn: number;
  stackTop: string;
}

interface TraceCtx {
  graph: string;
  deal: number;
  step: number;
  turn: number;
  caller: string;
  recording: boolean;
  events: CacheEvent[];
  writers: Map<string, { val: string; caller: string; deal: number; step: number; turn: number; stackTop: string }>;
}

function patchCacheFile(filePath: string, replacements: [string, string][]) {
  let txt = readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    const idx = txt.indexOf(from);
    if (idx === -1 || txt.indexOf(from, idx + 1) !== -1) {
      throw new Error(`Patch target did not match uniquely in ${filePath}: ${from.slice(0, 80)}`);
    }
    txt = txt.replace(from, to);
  }
  writeFileSync(filePath, txt);
}

function instrumentSrc(srcDir: string, graphTag: string) {
  const helper = `
const __trace = (op: 'set' | 'hit' | 'clear', cache: string, key: string, val: unknown) => {
  const ctx = (globalThis as any).__B0_TRACE_CTX__;
  if (!ctx) return;
  if (op !== 'set' && !ctx.recording) return;
  const g = ${JSON.stringify(graphTag)};
  const vStr = JSON.stringify(val);
  const stackTop = ctx.recording ? (new Error().stack ?? '').split('\\n').slice(2, 6).map(s => s.trim()).join(' <- ') : '';
  if (op === 'set') {
    ctx.writers.set(g + '|' + cache + '|' + key, { val: vStr, caller: ctx.caller, deal: ctx.deal, step: ctx.step, turn: ctx.turn, stackTop });
  }
  if (ctx.recording) {
    ctx.events.push({ op, cache, key, val: vStr, graph: g, caller: ctx.caller, deal: ctx.deal, step: ctx.step, turn: ctx.turn, stackTop });
  }
};
`;

  // 1. effectValues.ts: `threats` cache
  patchCacheFile(join(srcDir, 'ai/effectValues.ts'), [
    [
      'const threats = new Map<string, { burst: number; share: number }>();',
      `${helper}\nconst threats = new Map<string, { burst: number; share: number }>();`,
    ],
    [
      '  const cached = threats.get(key);\n  if (cached && !threatsAudit.on) return cached;',
      '  const cached = threats.get(key);\n  if (cached && !threatsAudit.on) { __trace("hit", "threats", key, cached); return cached; }',
    ],
    [
      '  if (threats.size > 200) threats.clear();\n  threats.set(key, threat);',
      '  if (threats.size > 200) { __trace("clear", "threats", "size>200", threats.size); threats.clear(); }\n  __trace("set", "threats", key, threat);\n  threats.set(key, threat);',
    ],
  ]);

  // 2. valueModel.ts: `buildTargets` and `iceMeans` caches
  patchCacheFile(join(srcDir, 'ai/valueModel.ts'), [
    [
      'const buildTargets = new Map<string, number>();',
      `${helper}\nconst buildTargets = new Map<string, number>();`,
    ],
    [
      '  const cached = iceMeans.get(key);\n  if (cached !== undefined) return cached;',
      '  const cached = iceMeans.get(key);\n  if (cached !== undefined) { __trace("hit", "iceMeans", key, cached); return cached; }',
    ],
    [
      '  iceMeans.set(key, value);',
      '  __trace("set", "iceMeans", key, value);\n  iceMeans.set(key, value);',
    ],
    [
      '  const cached = buildTargets.get(key);\n  if (cached !== undefined) return cached;',
      '  const cached = buildTargets.get(key);\n  if (cached !== undefined) { __trace("hit", "buildTargets", key, cached); return cached; }',
    ],
    [
      '  buildTargets.set(key, target);',
      '  __trace("set", "buildTargets", key, target);\n  buildTargets.set(key, target);',
    ],
  ]);

  // 3. iceValues.ts: `deckShares` cache
  patchCacheFile(join(srcDir, 'ai/iceValues.ts'), [
    [
      'const deckShares = new Map<string, Record<string, number>>();',
      `${helper}\nconst deckShares = new Map<string, Record<string, number>>();`,
    ],
    [
      '  const cached = deckShares.get(key);\n  if (cached) return cached;',
      '  const cached = deckShares.get(key);\n  if (cached) { __trace("hit", "deckShares", key, cached); return cached; }',
    ],
    [
      '  deckShares.set(key, share);',
      '  __trace("set", "deckShares", key, share);\n  deckShares.set(key, share);',
    ],
  ]);
}

interface ActionStep {
  step: number;
  turn: number;
  active: string;
  acting: string;
  action: any;
  corpCr: number;
  runnerCr: number;
  corpScore: number;
  runnerScore: number;
}

async function runCell(
  cellDir: string,
  mode: 'corp' | 'runner',
  recordStep?: { deal: number; step: number }
): Promise<{ steps2211: ActionStep[]; eventsAtStep: CacheEvent[]; writers: TraceCtx['writers']; winner2211: string; turns2211: number }> {
  mkdirSync(cellDir, { recursive: true });
  cpSync('src', join(cellDir, 'src'), { recursive: true });
  cpSync('src', join(cellDir, 'old/src'), { recursive: true });
  cpSync('scripts', join(cellDir, 'scripts'), { recursive: true });

  instrumentSrc(join(cellDir, 'src'), 'new');
  instrumentSrc(join(cellDir, 'old/src'), 'old');

  const imp = (p: string) => import(/* @vite-ignore */ join(cellDir, p));
  // Sequential imports for circular AI graph safety
  const core = await imp('src/core/index.ts');
  const decksMod = await imp('src/data/decks.ts');
  const nsgDecks = await imp('scripts/nsg-sample-decks.ts');
  const newAi = await imp('src/ai/index.ts');
  const oldAi = await imp('old/src/ai/index.ts');
  const lossLog = await imp('scripts/lossLog.ts');

  const ctx: TraceCtx = {
    graph: '',
    deal: 0,
    step: 0,
    turn: 0,
    caller: 'init',
    recording: false,
    events: [],
    writers: new Map(),
  };
  (globalThis as any).__B0_TRACE_CTX__ = ctx;

  // Build shard 57 deal list (same pairing loop as head-to-head.ts)
  const DECKS = nsgDecks.ALL_DECKS;
  const shard57: { seed: number; c: any; r: any }[] = [];
  let pairing = 0;
  let dealIdx = 0;
  for (const c of DECKS.filter((d: any) => d.side === 'corp')) {
    for (const r of DECKS.filter((d: any) => d.side === 'runner')) {
      pairing++;
      const seed = 1000 + (pairing - 1) * 10 + 1;
      if (dealIdx++ % 64 !== 57) continue;
      shard57.push({ seed, c, r });
    }
  }

  const newSide = mode === 'corp' ? 'corp' : 'runner';
  const steps2211: ActionStep[] = [];
  let winner2211 = '';
  let turns2211 = 0;

  // We only need deals 1571 (index 0) and 2211 (index 1) of shard 57.
  for (const item of shard57.slice(0, 2)) {
    ctx.deal = item.seed;
    ctx.step = 0;
    const rawCorp = (newSide === 'corp' ? newAi : oldAi).createAgent('corp', 'normal');
    const rawRunner = (newSide === 'runner' ? newAi : oldAi).createAgent('runner', 'normal');

    const wrapAgent = (side: 'corp' | 'runner', ag: any) => {
      const label = `${side}(${side === newSide ? 'new' : 'old'})`;
      return {
        chooseAction: (s: any) => {
          ctx.turn = s.turnNumber;
          ctx.caller = `${label}.chooseAction`;
          const shouldRec = recordStep && item.seed === recordStep.deal && ctx.step === recordStep.step;
          if (shouldRec) ctx.recording = true;
          const act = ag.chooseAction(s);
          if (shouldRec) {
            ctx.recording = false;
            throw { __STOP_TRACE__: true, action: act };
          }
          if (item.seed === 2211) {
            steps2211.push({
              step: ctx.step,
              turn: s.turnNumber,
              active: s.activePlayer,
              acting: side,
              action: act,
              corpCr: s.corp.credits,
              runnerCr: s.runner.credits,
              corpScore: s.corp.score,
              runnerScore: s.runner.score,
            });
          }
          ctx.step++;
          ctx.caller = 'lossLog/other';
          return act;
        },
        chooseRez: ag.chooseRez
          ? (s: any, cands: any) => {
              ctx.turn = s.turnNumber;
              ctx.caller = `${label}.chooseRez`;
              const shouldRec = recordStep && item.seed === recordStep.deal && ctx.step === recordStep.step;
              if (shouldRec) ctx.recording = true;
              const act = ag.chooseRez(s, cands);
              if (shouldRec) {
                ctx.recording = false;
                throw { __STOP_TRACE__: true, action: act };
              }
              if (item.seed === 2211) {
                steps2211.push({
                  step: ctx.step,
                  turn: s.turnNumber,
                  active: s.activePlayer,
                  acting: `${side}:rez`,
                  action: act ?? { type: 'PASS', player: side },
                  corpCr: s.corp.credits,
                  runnerCr: s.runner.credits,
                  corpScore: s.corp.score,
                  runnerScore: s.runner.score,
                });
              }
              ctx.step++;
              ctx.caller = 'lossLog/other';
              return act;
            }
          : undefined,
        chooseOffTurn: ag.chooseOffTurn
          ? (s: any) => {
              ctx.turn = s.turnNumber;
              ctx.caller = `${label}.chooseOffTurn`;
              const shouldRec = recordStep && item.seed === recordStep.deal && ctx.step === recordStep.step;
              if (shouldRec) ctx.recording = true;
              const act = ag.chooseOffTurn(s);
              if (shouldRec) {
                ctx.recording = false;
                throw { __STOP_TRACE__: true, action: act };
              }
              if (item.seed === 2211) {
                steps2211.push({
                  step: ctx.step,
                  turn: s.turnNumber,
                  active: s.activePlayer,
                  acting: `${side}:offTurn`,
                  action: act ?? { type: 'PASS', player: side },
                  corpCr: s.corp.credits,
                  runnerCr: s.runner.credits,
                  corpScore: s.corp.score,
                  runnerScore: s.runner.score,
                });
              }
              ctx.step++;
              ctx.caller = 'lossLog/other';
              return act;
            }
          : undefined,
      };
    };

    const start = core.createInitialGameState(decksMod.deckGameSetup(item.seed, item.c, item.r));
    try {
      const rec = lossLog.playLogged(start, { corp: wrapAgent('corp', rawCorp), runner: wrapAgent('runner', rawRunner) }, { corp: item.c.name, runner: item.r.name });
      if (item.seed === 2211) {
        winner2211 = rec.winner;
        turns2211 = rec.turns;
      }
    } catch (e: any) {
      if (!e?.__STOP_TRACE__) throw e;
    }
  }

  return { steps2211, eventsAtStep: ctx.events, writers: ctx.writers, winner2211, turns2211 };
}

async function main() {
  const root = join(tmpdir(), `b0-trace-2211-${process.pid}-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  try {
    let diffStep = process.env.ONLY_STEP ? Number(process.env.ONLY_STEP) : -1;
    if (diffStep < 0) {
      console.log('Pass 1: Replaying shard 57 (deals 1571 + 2211) under h2h=corp and h2h=runner...');
      const resCorp = await runCell(join(root, 'pass1-corp'), 'corp');
      const resRunner = await runCell(join(root, 'pass1-runner'), 'runner');

      console.log(`h2h=corp:   winner=${resCorp.winner2211}, turns=${resCorp.turns2211}, steps=${resCorp.steps2211.length}`);
      console.log(`h2h=runner: winner=${resRunner.winner2211}, turns=${resRunner.turns2211}, steps=${resRunner.steps2211.length}`);

      const n = Math.min(resCorp.steps2211.length, resRunner.steps2211.length);
      for (let i = 0; i < n; i++) {
        const a = resCorp.steps2211[i];
        const b = resRunner.steps2211[i];
        if (JSON.stringify(a.action) !== JSON.stringify(b.action) || a.acting !== b.acting) {
          diffStep = i;
          console.log(`\n=== FIRST DIFFERING DECISION on deal 2211 ===`);
          console.log(`Step ${a.step} | Turn ${a.turn} | Active=${a.active} | Acting=${a.acting}`);
          console.log(`  Corp cr=${a.corpCr} sc=${a.corpScore} | Runner cr=${a.runnerCr} sc=${a.runnerScore}`);
          console.log(`  h2h=corp   chose: ${JSON.stringify(a.action)}`);
          console.log(`  h2h=runner chose: ${JSON.stringify(b.action)}`);
          break;
        }
      }
    }

    if (diffStep === -1) {
      console.log('No differing decision found on deal 2211!');
      return;
    }

    console.log(`\nPass 2: Recording all cache events at deal 2211 step ${diffStep}...`);
    const recCorp = await runCell(join(root, 'pass2-corp'), 'corp', { deal: 2211, step: diffStep });
    const recRunner = await runCell(join(root, 'pass2-runner'), 'runner', { deal: 2211, step: diffStep });

    console.log(`Cache events at step ${diffStep}: h2h=corp=${recCorp.eventsAtStep.length}, h2h=runner=${recRunner.eventsAtStep.length}`);

    // Compare cache values between the two cells!
    const m = Math.min(recCorp.eventsAtStep.length, recRunner.eventsAtStep.length);
    let foundOpDiff = false;
    let foundValDiff = false;
    for (let i = 0; i < m; i++) {
      const eC = recCorp.eventsAtStep[i];
      const eR = recRunner.eventsAtStep[i];
      if (!foundOpDiff && (eC.op !== eR.op || eC.cache !== eR.cache || eC.key !== eR.key)) {
        foundOpDiff = true;
        console.log(`\n=== FIRST DIFFERING CACHE OP (index ${i} at step ${diffStep}) ===`);
        console.log(`  h2h=corp:   op=${eC.op} graph=${eC.graph} cache=${eC.cache} key=${eC.key} val=${eC.val}`);
        console.log(`  h2h=runner: op=${eR.op} graph=${eR.graph} cache=${eR.cache} key=${eR.key} val=${eR.val}`);
      }
      if (eC.cache !== eR.cache || eC.key !== eR.key || eC.val !== eR.val) {
        foundValDiff = true;
        console.log(`\n=== FIRST DIFFERING CACHE VALUE (index ${i} at step ${diffStep}) ===`);
        console.log(`  h2h=corp:   op=${eC.op} graph=${eC.graph} cache=${eC.cache} key=${eC.key} val=${eC.val}`);
        console.log(`              caller=${eC.caller} stack=${eC.stackTop}`);
        const wC = recCorp.writers.get(`${eC.graph}|${eC.cache}|${eC.key}`);
        console.log(`              last writer in h2h=corp: ${JSON.stringify(wC)}`);
        console.log(`  h2h=runner: op=${eR.op} graph=${eR.graph} cache=${eR.cache} key=${eR.key} val=${eR.val}`);
        console.log(`              caller=${eR.caller} stack=${eR.stackTop}`);
        const wR = recRunner.writers.get(`${eR.graph}|${eR.cache}|${eR.key}`);
        console.log(`              last writer in h2h=runner: ${JSON.stringify(wR)}`);
        break;
      }
    }
    if (!foundValDiff) {
      console.log('All four instrumented value caches (threats, buildTargets, iceMeans, deckShares) returned identical VALUES at step ' + diffStep + '!');
      for (const cache of ['threats', 'buildTargets', 'iceMeans', 'deckShares']) {
        const cKeys = [...recCorp.writers.keys()].filter(k => k.includes(`|${cache}|`));
        const rKeys = [...recRunner.writers.keys()].filter(k => k.includes(`|${cache}|`));
        console.log(`  ${cache}: corp writers=${cKeys.length}, runner writers=${rKeys.length}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
