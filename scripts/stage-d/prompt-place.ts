/**
 * Stage D item 6 step 1, counts 2 to 5 (stage-d/item6-install-prompts/brief.md section 2): the Corp's install prompts on
 * the record, the arm by patches, the fire count with continuations, the run term, and the time. Scripts only.
 *
 * Trees: a copy of src/ per arm under .fc-variants/prompt-place/<shard>/<arm>/, patched by prompt-place-patches.ts:
 * `base` (beta with the probe only, so every tree is timed as a copy), `owners` (every Corp install prompt answered by the
 * owners: the order's first install, place's server), `no9` (as owners, an agenda into a server that does not hold does
 * not beat a decline). ARMS=owners limits the arms.
 *
 * Sources (SHARD=k/n takes every n-th of the 92):
 *  - deal:<seed>   the 56 local deals played by the base tree's Normal Corp and Runner through GameRunner (src/ai/playout.ts,
 *                  the batch's driver), one agent per side with its memory; caches cleared before every decision;
 *  - human:<file>  the 36 human games, the recorded moves replayed.
 * At every Corp decision (chooseAction: its main phase and its prompts; chooseRez: a rez window in a run) a fresh Normal
 * Corp of each tree decides on a copy ('d' line): its pick, ms, and inside the decision the probe's counts (Corp prompts
 * answered, install prompts among them, those the owners answered, those the owners answered differently from today's
 * blocks, with that comparison's own time left out of the arm's ms), and the run term's asks and decisions.
 * At a top-level install prompt ('ip' line): the card and step, the prompt's installs (each candidate and the servers its
 * question offers), today's answer and each arm's (declined, card, server), whether a run is under way and whether the run
 * term decided it.
 * A changed decision is played on ('cont' line) in base and each changed arm by that tree's fresh Normal Corp against the
 * base tree's Normal Runner, through GameRunner, for 4 turns or to the game's end: scores, winner, credits, the Corp's first
 * moves. NO_CONT=1 skips.
 * Single decisions (the stops' median of 3): ONLY=deal:1241#77,human:report-49.json#83 REPEAT=3.
 *    SHARD=0/64 npx vite-node scripts/stage-d/prompt-place.ts > out-0.txt          (sum: prompt-place-sum.mjs)
 *    PINS=1 npx vite-node scripts/stage-d/prompt-place.ts                           (the two D3 pin boards, every tree)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { activePrompt, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import type { Agent } from '../../src/ai/agent';
import { dealState, deals, humanFiles } from '../stage-a/harness';
import { ARM_PATCHES } from './prompt-place-patches';

// The ai-script workflow passes only ARGS: NAME=value words there set the same switches (ARMS=chain)
for (const w of (process.env.ARGS ?? '').split(/\s+/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(w);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const ARMS = ['base', ...Object.keys(ARM_PATCHES).filter(a => a !== 'base' && (!(process.env.ARMS ?? '') || (process.env.ARMS ?? '').split(',').includes(a)))];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', 'prompt-place', String(shard));
const out = (o: unknown) => console.log(JSON.stringify(o));
const G = globalThis as unknown as Record<string, unknown>;

// The inventory's install steps (prompt-place-inventory.json): card code and step -> 'pick' | 'server' | 'pick+place'
const INV = JSON.parse(readFileSync('scripts/stage-d/prompt-place-inventory.json', 'utf8')) as { cards: { code: string; title: string; steps: { step: string; cls: string }[] }[] };
const STEP = new Map(INV.cards.flatMap(c => c.steps.map(s => [`${c.code}:${s.step}`, s.cls] as const)));
const stepOf = (s: GameState) => {
  const p = activePrompt(s);
  if (!p || p.side !== 'corp' || !('source' in p)) return null;
  return { key: `${p.source.cardCode}:${p.source.step}`, cls: STEP.get(`${p.source.cardCode}:${p.source.step}`) ?? (p.kind === 'effect_choice' && p.source.data?.install ? 'server(data.install)' : null), p };
};

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of ARMS) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of ARM_PATCHES[arm] ?? []) {
      const path = join(dir, 'src', file);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}: ${from.slice(0, 80)}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

interface Tree {
  name: string;
  createAgent: (side: 'corp' | 'runner', level: string) => Agent;
  clear: () => void;
  runTerm: () => { asked: number; decided: number };
  GameRunner: new (s: GameState, agents: Record<'corp' | 'runner', Agent>) => { state: GameState; step(): boolean; last: GameAction | null };
  rezCandidates: (s: GameState, step: 'approach_ice' | 'approach_server') => CardInstance[];
}
async function load(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const pr = await m('ai/prompts.ts');
  const po = await m('ai/playout.ts');
  return {
    name,
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
    runTerm: () => ({ asked: pr.runTermStats.asked, decided: pr.runTermStats.decided }),
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
  };
}

/** The probe's counts inside one decision. */
interface Inner {
  prompts: number;
  install: number;
  owned: number;
  differ: number;
  diffMs: number;
  runDecided: number;
  runDecidedInstall: number;
  keys: Record<string, number>;
  differKeys: Record<string, number>;
  /** arm tie: Corp card questions whose fallback answers all scored alike; of them install questions; of them taken by the order */
  tie: number;
  tieInstall: number;
  tieTook: number;
  tieKeys: Record<string, number>;
}
const inner0 = (): Inner => ({ prompts: 0, install: 0, owned: 0, differ: 0, diffMs: 0, runDecided: 0, runDecidedInstall: 0, keys: {}, differKeys: {}, tie: 0, tieInstall: 0, tieTook: 0, tieKeys: {} });
let inner = inner0();
let inDiff = false;
const akey = (a: GameAction | null | undefined) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'promptId').sort())) : 'null');
G.__ppProbe = (state: GameState, side: string, owned: GameAction | undefined, today: (() => GameAction) | null) => {
  if (side !== 'corp' || inDiff) return;
  inner.prompts++;
  const st = stepOf(state);
  if (st?.cls) {
    inner.install++;
    inner.keys[st.key] = (inner.keys[st.key] ?? 0) + 1;
  }
  if (owned === undefined) return;
  inner.owned++;
  if (!today) return;
  inDiff = true;
  const t0 = performance.now();
  try {
    const t = today();
    if (akey(t) !== akey(owned)) {
      inner.differ++;
      const k = st?.key ?? 'other';
      inner.differKeys[k] = (inner.differKeys[k] ?? 0) + 1;
    }
  } catch {
    /* today's answer threw: counted as no difference */
  } finally {
    inner.diffMs += performance.now() - t0;
    inDiff = false;
  }
};
G.__ppTie = (state: GameState, took: GameAction | undefined) => {
  if (inDiff) return;
  inner.tie++;
  const st = stepOf(state);
  const pid = activePrompt(state)?.id;
  if (pid) (G.__ppTieIds as Map<string, boolean> | undefined)?.set(pid, !!took);
  if (!st?.cls) return;
  inner.tieInstall++;
  inner.tieKeys[st.key] = (inner.tieKeys[st.key] ?? 0) + 1;
  if (took) inner.tieTook++;
};
G.__ppRun = (state: GameState) => {
  if (inDiff) return;
  inner.runDecided++;
  if (stepOf(state)?.cls) inner.runDecidedInstall++;
};

const name = (s: GameState, id: string | undefined) => {
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? `${cardDef(c).title}[${cardDef(c).type_code}]` : String(id);
};
/** A short form of a pick. */
function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'null';
  if (a.type === 'RESOLVE_PROMPT') {
    const ch = a.choice as { kind: string; cardInstanceIds?: string[]; optionId?: string; trashFirst?: string[] };
    if (ch.kind === 'effect_cards') return ch.cardInstanceIds?.length ? `pick ${ch.cardInstanceIds.map(i => name(s, i)).join('+')}` : 'decline';
    if (ch.kind === 'effect_choice') return `option ${ch.optionId}${ch.trashFirst?.length ? ` trash ${ch.trashFirst.map(i => name(s, i)).join('+')}` : ''}`;
    return `${ch.kind} ${JSON.stringify(ch).slice(0, 80)}`;
  }
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  return `${a.type}${x.cardInstanceId ? ` ${name(s, x.cardInstanceId)}` : ''}${x.asNewRemote ? ' -> new' : x.targetServerId ? ` -> ${x.targetServerId}` : ''}`;
}

/** The installs a top-level prompt offers: each candidate card and the servers its question offers (as the arm finds them). */
function promptInstalls(s: GameState): { card: string; type: string; options: string[] }[] {
  const p = activePrompt(s);
  if (!p) return [];
  const sim = (a: GameAction) => {
    try {
      return executeAction(s, a);
    } catch {
      return null;
    }
  };
  const isServer = (st: GameState, id: string) => id === 'new' || !!st.corp.servers[id];
  const where = (st: GameState, id: string) => Object.values(st.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;
  if (p.kind === 'effect_choice') {
    const id = String(p.source.data?.cardId ?? '');
    const card = findCardAnywhere(s, id);
    return card ? [{ card: name(s, id), type: cardDef(card).type_code, options: p.options.map(o => o.id).filter(o => isServer(s, o)) }] : [];
  }
  if (p.kind !== 'effect_cards') return [];
  const outl: { card: string; type: string; options: string[] }[] = [];
  for (const id of p.candidateIds.slice(0, 40)) {
    const card = findCardAnywhere(s, id);
    const after = card && sim({ type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_cards', cardInstanceIds: [id] } } as GameAction);
    if (!card || !after) continue;
    const next = activePrompt(after);
    if (next?.side === 'corp' && next.kind === 'effect_choice' && String(next.source.data?.cardId) === id) outl.push({ card: name(s, id), type: cardDef(card).type_code, options: next.options.map(o => o.id).filter(o => isServer(after, o)) });
    else if (where(after, id) && !where(s, id)) outl.push({ card: name(s, id), type: cardDef(card).type_code, options: [where(after, id)!] });
  }
  return outl;
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await load(arm, dirs[arm]);
  const base = trees.base;

  const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
  const repeat = Number(process.env.REPEAT ?? 1);
  let n = 0;

  type Ask = { method: 'chooseAction' | 'chooseRez'; cards?: CardInstance[] };
  const ask = (t: Tree, s: GameState, a: Ask) => {
    t.clear();
    inner = inner0();
    const r0 = t.runTerm();
    const copy = structuredClone(s);
    G.__ppOrders = new Map();
    G.__ppTieIds = new Map();
    const agent = t.createAgent('corp', 'normal');
    const t0 = performance.now();
    let pick: GameAction | null = null;
    let err: string | null = null;
    try {
      pick = a.method === 'chooseRez' ? (agent.chooseRez?.(copy, structuredClone(a.cards ?? [])) ?? null) : agent.chooseAction(copy);
    } catch (e) {
      err = `error: ${(e as Error).message}`;
    }
    const ms = performance.now() - t0 - inner.diffMs;
    const orders = G.__ppOrders as Map<string, unknown>;
    const tieIds = G.__ppTieIds as Map<string, boolean>;
    const r1 = t.runTerm();
    const pid = activePrompt(s)?.id;
    return { pick, key: err ?? akey(pick), short: err ?? short(s, pick), ms, order: pid ? orders.get(pid) : undefined, tieTop: pid && tieIds.has(pid) ? (tieIds.get(pid) ? 'took' : 'tie') : null, inner: { ...inner, diffMs: Math.round(inner.diffMs) }, run: { asked: r1.asked - r0.asked, decided: r1.decided - r0.decided } };
  };

  const treeAgent = (t: Tree, side: 'corp' | 'runner') => {
    const agent = t.createAgent(side, 'normal');
    return new Proxy(agent, {
      get(target, prop, recv) {
        if (prop === 'chooseAction' || prop === 'chooseRez' || prop === 'chooseOffTurn')
          return (...args: unknown[]) => {
            t.clear();
            return (Reflect.get(target, prop, recv) as (...x: unknown[]) => unknown).apply(target, args);
          };
        return Reflect.get(target, prop, recv);
      },
    }) as Agent;
  };

  /** Plays on from `s` with a tree's Corp against the base Runner: 4 turns or to the game's end. */
  const playOn = (t: Tree, s: GameState) => {
    const game = new t.GameRunner(structuredClone(s), { corp: treeAgent(t, 'corp'), runner: treeAgent(base, 'runner') });
    const moves: string[] = [];
    let k = 0;
    try {
      while (k++ < 1500 && !game.state.winner && game.state.turnNumber < s.turnNumber + 4) {
        const st = game.state;
        if (!game.step()) break;
        if (moves.length < 8 && actingSide(st) === 'corp' && game.last && game.last.type !== 'PASS') moves.push(short(st, game.last));
      }
    } catch (e) {
      moves.push(`error: ${(e as Error).message}`);
    }
    const e = game.state;
    return { T: e.turnNumber, winner: e.winner ?? null, score: [e.corp.score, e.runner.score], d: [e.corp.score - s.corp.score, e.runner.score - s.runner.score], credits: e.corp.credits, moves };
  };

  const decide = (src: string, who: string, i: number, s: GameState, a: Ask) => {
    if (s.winner) return;
    if (only.size && !only.has(`${src}#${i}`)) return;
    const order = [...ARMS.slice(n % ARMS.length), ...ARMS.slice(0, n % ARMS.length)];
    n++;
    const r: Record<string, ReturnType<typeof ask>> = {};
    const all: Record<string, number[]> = Object.fromEntries(ARMS.map(x => [x, []]));
    for (let k = 0; k < repeat; k++) {
      for (const arm of k % 2 ? [...order].reverse() : order) {
        r[arm] = ask(trees[arm], s, a);
        all[arm].push(Math.round(r[arm].ms));
      }
    }
    if (repeat > 1) {
      for (const arm of ARMS) r[arm].ms = [...all[arm]].sort((x, y) => x - y)[Math.floor(repeat / 2)];
      out({ kind: 'times', src, i, all });
    }
    const st = stepOf(s);
    const changed = ARMS.filter(arm => arm !== 'base' && r[arm].key !== r.base.key);
    out({
      kind: 'd',
      src,
      who,
      i,
      T: s.turnNumber,
      m: a.method,
      prompt: st?.key ?? (activePrompt(s) ? `${activePrompt(s)!.kind}` : null),
      install: st?.cls ?? null,
      inRun: !!s.activeRun,
      ms: Object.fromEntries(ARMS.map(x => [x, Math.round(r[x].ms * 10) / 10])),
      changed,
      picks: changed.length ? Object.fromEntries(ARMS.map(x => [x, r[x].short])) : undefined,
      inner: Object.fromEntries(ARMS.map(x => [x, r[x].inner])),
      run: Object.fromEntries(ARMS.map(x => [x, r[x].run])),
    });
    if (st?.cls) {
      const p = st.p;
      out({
        kind: 'ip',
        src,
        who,
        i,
        T: s.turnNumber,
        key: st.key,
        cls: st.cls,
        kindP: p.kind,
        min: (p as { min?: number }).min,
        inRun: !!s.activeRun,
        runServer: s.activeRun?.server ?? null,
        credits: s.corp.credits,
        clicks: s.corp.clicks,
        score: [s.corp.score, s.runner.score],
        installs: promptInstalls(s),
        picks: Object.fromEntries(ARMS.map(x => [x, r[x].short])),
        runDecided: Object.fromEntries(ARMS.map(x => [x, r[x].inner.runDecidedInstall > 0 && r[x].run.decided > 0])),
        // the owners' order at this prompt (each candidate's card, server, line, behind, credits the install costs)
        order: (r.owners ?? r.no9 ?? r.tie)?.order,
        // arm tie: whether the fallback tied at this prompt ('tie'), and whether the order's answer was taken ('took')
        tieTop: Object.fromEntries(ARMS.map(x => [x, r[x].tieTop])),
      });
    }
    if (changed.length && !process.env.NO_CONT && !only.size) {
      for (const arm of ['base', ...changed]) {
        try {
          out({ kind: 'cont', src, who, i, T: s.turnNumber, arm, ...playOn(trees[arm], s) });
        } catch (e) {
          out({ kind: 'cont', src, who, i, T: s.turnNumber, arm, error: (e as Error).message });
        }
      }
    }
  };

  const playDeal = (seed: number) => {
    const src = `deal:${seed}`;
    let i = 0;
    const corp = base.createAgent('corp', 'normal');
    const runner = base.createAgent('runner', 'normal');
    const wrapCorp = new Proxy(corp, {
      get(target, prop, recv) {
        if (prop === 'chooseAction' || prop === 'chooseRez')
          return (state: GameState, cards?: CardInstance[]) => {
            if (actingSide(state) === 'corp' || prop === 'chooseRez') decide(src, 'self', i++, state, prop === 'chooseRez' ? { method: 'chooseRez', cards } : { method: 'chooseAction' });
            base.clear();
            return prop === 'chooseRez' ? target.chooseRez!(state, cards!) : target.chooseAction(state);
          };
        return Reflect.get(target, prop, recv);
      },
    }) as Agent;
    const wrapRunner = new Proxy(runner, {
      get(target, prop, recv) {
        if (prop === 'chooseAction' || prop === 'chooseOffTurn')
          return (state: GameState) => {
            base.clear();
            return (Reflect.get(target, prop, recv) as (s: GameState) => GameAction | null).call(target, state);
          };
        return Reflect.get(target, prop, recv);
      },
    }) as Agent;
    const game = new base.GameRunner(dealState(seed), { corp: wrapCorp, runner: wrapRunner });
    const t0 = performance.now();
    for (let k = 0; k < 4000 && game.step(); k++);
    out({ kind: 'src', src, winner: game.state.winner ?? null, turns: game.state.turnNumber, decisions: i, ms: Math.round(performance.now() - t0) });
  };

  const replayHuman = (file: string) => {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    if (!report.moves?.length) return;
    const src = `human:${file.split('/').pop()}`;
    const who = report.config.ai === 'corp' ? 'person-runner' : 'person-corp';
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    let i = 0;
    const t0 = performance.now();
    for (const move of report.moves as GameAction[]) {
      const side = actingSide(s);
      const w = s.priority;
      if (side === 'corp' && !s.winner) {
        const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
        if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
          if (wantsStop(ai, 'corp', w) && (w.step === 'approach_ice' || w.step === 'approach_server')) decide(src, who, i++, s, { method: 'chooseRez', cards: base.rezCandidates(s, w.step) });
        } else decide(src, who, i++, s, { method: 'chooseAction' });
      }
      try {
        s = executeAction(s, move);
      } catch {
        break;
      }
    }
    out({ kind: 'src', src, winner: s.winner ?? null, turns: s.turnNumber, decisions: i, ms: Math.round(performance.now() - t0) });
  };

  if (process.env.PINS) {
    for (const [nr, mv] of [[49, 219], [50, 252]] as const) {
      const report = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${nr}.json`, 'utf8'));
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      for (const m of (report.moves as GameAction[]).slice(0, mv)) s = executeAction(s, m);
      decide(`pin:report-${nr}.json`, 'pin', mv, s, { method: 'chooseAction' });
      // and the server step that follows each arm's pick, answered by that arm
      for (const arm of ARMS) {
        let t = s;
        const steps: string[] = [];
        for (let k = 0; k < 6 && activePrompt(t)?.side === 'corp'; k++) {
          const a = ask(trees[arm], t, { method: 'chooseAction' });
          steps.push(a.short);
          if (!a.pick) break;
          t = executeAction(t, a.pick);
        }
        out({ kind: 'pinChain', src: `report-${nr}`, arm, steps, credits: t.corp.credits, servers: Object.values(t.corp.servers).map(v => `${v.id}: ${[...v.ice.map(c => cardDef(c).title), '|', ...v.root.map(c => cardDef(c).title)].join(', ')}`) });
      }
    }
    return;
  }

  const sources: (() => void)[] = [...deals().map(seed => () => playDeal(seed)), ...humanFiles().map(f => () => replayHuman(f))];
  console.error(`prompt-place: arms ${ARMS.join(',')}, ${sources.length} sources, shard ${shard}/${shards}`);
  sources.forEach((run, k) => {
    if (k % shards !== shard) return;
    try {
      run();
    } catch (e) {
      console.error(`source ${k}: ${(e as Error).stack}`);
      out({ kind: 'error', k, message: (e as Error).message });
    }
  });
  if (existsSync(root) && !process.env.PP_KEEP) rmSync(root, { recursive: true, force: true });
}

void main();
