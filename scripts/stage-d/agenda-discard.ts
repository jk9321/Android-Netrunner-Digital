/**
 * Stage D item 7 (D6), count step: does the AI Corp discard an agenda at its discard step while it keeps a non-agenda?
 * Brief: /mnt/project-files/netrunner-ai/stage-d/item7-agenda-discard/brief.md. Scripts only: nothing in src or tests.
 *
 * Trees (copies of this checkout's src/, each its own module graph, as make-room-fire.ts makeTrees):
 *  - `source` plays the source deals with a plain GameRunner (as the batch's playLogged: Normal v Normal, no cache clears)
 *    and is never asked or cleared mid-game (found row 71b). Its agents are wrapped by a Proxy that only clones the
 *    states it is handed and notes the answer.
 *  - `probe` is asked at every recorded Corp discard prompt (a fresh Normal Corp on a clone). Its prompts.ts carries one
 *    text hook at the top of the discard answer that, inside the Corp's own decision (its view and pricing context),
 *    splits each HQ card's `keep` into its terms: playedWorth, the click, the hand floor, archivedAgendaLoss, keepBonus
 *    (only for the deck-aware AI: `synergy`). It also reads Archives' ice and what the Runner needs to pass each
 *    (runs.ts iceCreditNeed with the ice rezzed: public rig, public credits).
 *  - `cont` plays the continuations (GameRunner, fresh Normal agents both sides) from a class case's board: the recorded
 *    answer, and the lowest-keep non-agenda discarded in the agenda's place.
 *
 * Sources: (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/agenda-discard-deals.json; each game's
 * winner, cr and sc are checked against that record), one game a deal; (b) human-Runner files (config.ai = 'corp': the
 * AI Corp's recorded answer, and today's answer at the same board); (c) human-Corp files (config.ai = 'runner': the
 * person's answer, and today's AI answer beside it). Human games replay the recorded moves (report-40b/40c from their
 * `state`, as harness.ts replayHuman).
 *
 * Hidden information: the AI is asked only through createAgent(...).chooseAction, which builds its own view. The
 * measuring script reads hidden zones to say what was true: [HIDDEN-READ] marks each place (the discarded cards' later
 * zone, Archives' facedown cards, the Runner's grip size).
 *
 * Q4 (the same choice elsewhere): after every step where the Corp chose (a Corp agent call in a deal; a recorded Corp
 * move in a human game), cards that left HQ for Archives, R&D or out of the game, not the card the action played, are
 * noted with the action or prompt that took them ([HIDDEN-READ]: HQ and R&D).
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/agenda-discard.ts
 *   DEALS=1001,1641 HUMAN=none npx vite-node scripts/stage-d/agenda-discard.ts
 *   CONT=0 skips the continuations
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/agenda-discard', String(shard));
const CONT = process.env.CONT !== '0';
const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : String(x));
const key = (a: unknown) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a as object).sort())) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

const HOOK_AT = "  if (prompt.kind === 'discard') {\n";

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const t of ['source', 'probe', 'cont']) {
    const dir = join(root, t);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (t === 'probe') {
      const path = join(dir, 'src', 'ai/prompts.ts');
      const text = readFileSync(path, 'utf8');
      if (text.split(HOOK_AT).length !== 2) throw new Error('probe: the hook does not match once in prompts.ts');
      writeFileSync(path, text.replace(HOOK_AT, `${HOOK_AT}    (globalThis as any).__adHook?.(state, side, synergy, prompt);\n`));
    }
    dirs[t] = dir;
  }
  return dirs;
}

interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  hv: any;
  ev: any;
  syn: any;
  vm: any;
  runs: any;
  clear: () => void;
}

async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/evaluate.ts', 'ai/synergy.ts', 'ai/valueModel.ts', 'ai/runs.ts', 'ai/effectValues.ts', 'ai/iceValues.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, syn, vm, runs, efv, iv] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    hv,
    ev,
    syn,
    vm,
    runs,
    clear: () => {
      hv.clearHandCaches();
      efv.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

// ------------------------------------------------------------------------------------------------ zones
/** Where a card is now, by instance id ([HIDDEN-READ]: HQ, R&D, facedown Archives). */
function zoneOf(s: GameState, id: string): string {
  const has = (xs: { instanceId: string }[] | undefined) => !!xs?.some(c => c.instanceId === id);
  if (has(s.corp.hq)) return 'hq';
  if (has(s.corp.rd)) return 'rd';
  if (has(s.corp.archives.faceDown)) return 'archives-down';
  if (has(s.corp.archives.faceUp)) return 'archives-up';
  if (has(s.runner.scoreArea)) return 'runner-score';
  if (has(s.corp.scoreArea)) return 'corp-score';
  for (const v of Object.values(s.corp.servers)) {
    if (has(v.root)) return `root:${v.id}`;
    if (has(v.ice)) return `ice:${v.id}`;
  }
  return 'elsewhere';
}

/** Follows the given cards through a game: each change of zone, with the turn. */
class Fates {
  private now = new Map<string, string>();
  readonly log = new Map<string, { T: number; zone: string }[]>();
  watch(s: GameState, ids: string[]) {
    for (const id of ids) {
      const z = zoneOf(s, id);
      this.now.set(id, z);
      this.log.set(id, [{ T: s.turnNumber, zone: z }]);
    }
  }
  step(s: GameState) {
    for (const [id, z] of this.now) {
      const n = zoneOf(s, id);
      if (n !== z) {
        this.now.set(id, n);
        this.log.get(id)!.push({ T: s.turnNumber, zone: n });
      }
    }
  }
  of(id: string) {
    return this.log.get(id) ?? [];
  }
}

/** The fate of a discarded agenda from its zone log: stolen (turn), returned (where), still in Archives. */
function fate(log: { T: number; zone: string }[]): string {
  const stolen = log.find(e => e.zone === 'runner-score');
  if (stolen) return `stolen T${stolen.T}`;
  const back = log.find(e => !e.zone.startsWith('archives'));
  if (back) return `left Archives to ${back.zone} T${back.T}`;
  const up = log.find(e => e.zone === 'archives-up');
  return up ? `turned faceup T${up.T}, not stolen` : 'never accessed';
}

// ------------------------------------------------------------------------------------------------ probe
interface CardTerms {
  id: string;
  title: string;
  type: string;
  pts?: number;
  played: number | string;
  click: number;
  floor: number;
  floored: boolean;
  loss: number | string;
  bonus: number | string;
  keepValue: number | string;
  keep: number | string;
}
interface Probe {
  answer: string[];
  synergy: boolean;
  terms: CardTerms[];
  archIce: { title: string; rezzed: boolean; need: number | string }[];
  runner: { credits: number; clicksPerTurn: number; grip: number; score: number; tags: number };
  corp: { credits: number; score: number; archDown: number; archAgendas: number };
  error?: string;
}

function probeAt(t: Tree, s: GameState): Probe {
  t.clear();
  let got: Omit<Probe, 'answer'> | null = null;
  const promptId = t.core.activePrompt(s)?.id;
  (globalThis as any).__adHook = (st: GameState, side: string, synergy: boolean, prompt: any) => {
    if (got || side !== 'corp' || prompt.id !== promptId || st.turnNumber !== s.turnNumber) return;
    const { cardDef } = t.core;
    const CLICK = t.vm.CLICK;
    const FLOOR = t.hv.HAND_FLOOR;
    const terms: CardTerms[] = st.corp.hq.map((c: any) => {
      const def = cardDef(c);
      const safe = (f: () => number) => {
        try {
          return f();
        } catch (e) {
          return `err ${(e as Error).message.slice(0, 40)}`;
        }
      };
      const played = safe(() => t.hv.playedWorth(st, c));
      const loss = def.type_code === 'agenda' ? safe(() => t.ev.archivedAgendaLoss(st, def.agenda_points ?? 1)) : 0;
      const bonus = synergy ? safe(() => t.syn.keepBonus(st, c)) : 0;
      const kv = safe(() => t.ev.keepValue(st, c));
      const keep = typeof kv === 'number' && typeof bonus === 'number' ? kv + bonus : 'err';
      return {
        id: c.instanceId,
        title: def.title,
        type: def.type_code,
        pts: def.type_code === 'agenda' ? def.agenda_points : undefined,
        played: typeof played === 'number' ? r2(played) : played,
        click: CLICK,
        floor: FLOOR,
        floored: typeof played === 'number' && played + CLICK < FLOOR,
        loss: typeof loss === 'number' ? r2(loss) : loss,
        bonus: typeof bonus === 'number' ? r2(bonus) : bonus,
        keepValue: typeof kv === 'number' ? r2(kv) : kv,
        keep: typeof keep === 'number' ? r2(keep) : keep,
      } as CardTerms;
    });
    const arch = st.corp.servers.archives;
    const archIce = (arch?.ice ?? []).map((ice: any) => {
      let need: number | string;
      try {
        need = r2(t.runs.iceCreditNeed(st, { ...ice, isRezzed: true }));
      } catch (e) {
        need = `err ${(e as Error).message.slice(0, 40)}`;
      }
      return { title: cardDef(ice).title, rezzed: !!ice.isRezzed, need };
    });
    got = {
      synergy,
      terms,
      archIce,
      runner: { credits: st.runner.credits, clicksPerTurn: (st.runner as any).clicksPerTurn ?? (st.runner as any).allottedClicks ?? 4, grip: st.runner.grip.length, score: st.runner.score, tags: (st.runner as any).tags ?? 0 },
      // [HIDDEN-READ] (the Corp's own): facedown Archives
      corp: {
        credits: st.corp.credits,
        score: st.corp.score,
        archDown: st.corp.archives.faceDown.length,
        archAgendas: [...st.corp.archives.faceDown, ...st.corp.archives.faceUp].filter((c: any) => cardDef(c).type_code === 'agenda').length,
      },
    };
  };
  try {
    const agent = t.createAgent('corp', 'normal');
    const a = agent.chooseAction(structuredClone(s));
    const answer: string[] = a?.choice?.kind === 'discard' ? a.choice.cardInstanceIds : [];
    if (!got) return { answer, synergy: false, terms: [], archIce: [], runner: {} as any, corp: {} as any, error: `hook not reached: ${key(a).slice(0, 120)}` };
    return { answer, ...(got as Omit<Probe, 'answer'>) };
  } catch (e) {
    return { answer: [], synergy: false, terms: [], archIce: [], runner: {} as any, corp: {} as any, error: (e as Error).message.slice(0, 160) };
  } finally {
    (globalThis as any).__adHook = undefined;
  }
}

// ------------------------------------------------------------------------------------------------ continuations
function playOn(t: Tree, s0: GameState, answer: GameAction, watch: string[]) {
  t.clear();
  let s: GameState;
  try {
    s = t.core.executeAction(structuredClone(s0), answer);
  } catch (e) {
    return { error: (e as Error).message.slice(0, 120) };
  }
  const fates = new Fates();
  fates.watch(s, watch);
  const g = new t.GameRunner(s, { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  let n = 0;
  try {
    for (; n < 4000 && g.step(); n++) fates.step(g.state);
  } catch (e) {
    return { error: `step ${n}: ${(e as Error).message.slice(0, 120)}` };
  }
  return {
    winner: g.state.winner ?? null,
    T: g.state.turnNumber,
    score: [g.state.corp.score, g.state.runner.score],
    fates: Object.fromEntries(watch.map(id => [id, fate(fates.of(id))])),
  };
}

// ------------------------------------------------------------------------------------------------ one prompt
interface Seen {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  s: GameState;
  recorded: string[];
  fates: Fates;
}

function report(trees: Record<string, Tree>, seen: Seen) {
  const { core } = trees.probe;
  const s = seen.s;
  const prompt = core.activePrompt(s);
  const hq = s.corp.hq;
  const typeOf = (id: string) => core.cardDef(hq.find((c: any) => c.instanceId === id)).type_code;
  const isAg = (id: string) => typeOf(id) === 'agenda';
  const letter = (id: string) => ({ agenda: 'G', asset: 'a', ice: 'i', operation: 'o', upgrade: 'u' })[typeOf(id) as string] ?? '?';
  const nAg = hq.filter((c: any) => core.cardDef(c).type_code === 'agenda').length;
  const nNon = hq.length - nAg;
  const p = probeAt(trees.probe, s);
  const classOf = (ans: string[]) => (ans.some(isAg) && hq.some((c: any) => !ans.includes(c.instanceId) && core.cardDef(c).type_code !== 'agenda') ? 'class' : '');
  const recClass = classOf(seen.recorded);
  const todayClass = classOf(p.answer);
  const row: Record<string, unknown> = {
    kind: 'p',
    src: seen.src,
    who: seen.kind,
    T: s.turnNumber,
    count: prompt?.count,
    hq: hq.length,
    nAg,
    nNon,
    mixed: nAg > 0 && nNon > 0,
    forced: nNon === 0 && nAg > 0,
    rec: seen.recorded.map(letter).join(''),
    today: p.answer.map(id => (hq.some((c: any) => c.instanceId === id) ? letter(id) : '?')).join(''),
    agree: [...seen.recorded].sort().join() === [...p.answer].sort().join(),
    recClass: !!recClass,
    todayClass: !!todayClass,
    synergy: p.synergy,
  };
  if (p.error) row.error = p.error;
  // Every mixed HQ: each card's keep and terms, compact ([type letter, keep, playedWorth, archivedAgendaLoss, keepBonus,
  // floored]), and the gap: the lowest agenda keep less the highest non-agenda keep (below 0: the sort puts a
  // non-agenda above an agenda, a class case whenever the count reaches that agenda); reach: the lowest agenda keep
  // less the keep of the count-th lowest card (at or below 0: an agenda is among the discards)
  if (row.mixed && p.terms.length) {
    row.ks = p.terms.map(c => [letter(c.id), c.keep, c.played, c.loss, c.bonus, c.floored ? 1 : 0]);
    const num = (x: number | string) => (typeof x === 'number' ? x : NaN);
    const ag = p.terms.filter(c => c.type === 'agenda').map(c => num(c.keep));
    const non = p.terms.filter(c => c.type !== 'agenda').map(c => num(c.keep));
    row.gap = r2(Math.min(...ag) - Math.max(...non));
    row.reach = r2(Math.min(...ag) - [...p.terms.map(c => num(c.keep))].sort((a, b) => a - b)[Math.max(0, (prompt?.count ?? 1) - 1)]);
  }
  const wantDetail = !!recClass || !!todayClass || (row.mixed && seen.kind !== 'self');
  if (wantDetail) {
    row.terms = p.terms;
    row.archIce = p.archIce;
    row.runner = p.runner;
    row.corp = p.corp;
    row.recorded = seen.recorded;
    row.answer = p.answer;
    // [HIDDEN-READ]: what happened to each discarded agenda (recorded answer) in the source game
    row.fate = Object.fromEntries(seen.recorded.filter(isAg).map(id => [id, fate(seen.fates.of(id))]));
  }
  // Continuations: every class case of the answer that is today's AI (the recorded one in self-play, today's in human)
  const ans = seen.kind === 'self' ? seen.recorded : p.answer;
  if (CONT && classOf(ans) && p.terms.length) {
    const keepOf = new Map(p.terms.map(c => [c.id, typeof c.keep === 'number' ? c.keep : 0]));
    const non = hq.filter((c: any) => core.cardDef(c).type_code !== 'agenda').map((c: any) => c.instanceId).sort((a: string, b: string) => keepOf.get(a)! - keepOf.get(b)!);
    const ags = hq.filter((c: any) => core.cardDef(c).type_code === 'agenda').map((c: any) => c.instanceId).sort((a: string, b: string) => keepOf.get(a)! - keepOf.get(b)!);
    const count = prompt.count as number;
    const alt = [...non.slice(0, count), ...ags.slice(0, Math.max(0, count - non.length))];
    const base = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: prompt.id };
    const watch = hq.filter((c: any) => core.cardDef(c).type_code === 'agenda').map((c: any) => c.instanceId);
    row.alt = alt;
    row.contAI = playOn(trees.cont, s, { ...base, choice: { kind: 'discard', cardInstanceIds: ans } } as GameAction, watch);
    row.contAlt = playOn(trees.cont, s, { ...base, choice: { kind: 'discard', cardInstanceIds: alt } } as GameAction, watch);
  }
  out(row);
}

// ------------------------------------------------------------------------------------------------ Q4
interface HqSnap {
  ids: string[];
  types: Map<string, string>;
}
const snap = (t: Tree, s: GameState): HqSnap => ({ ids: s.corp.hq.map(c => c.instanceId), types: new Map(s.corp.hq.map(c => [c.instanceId, t.core.cardDef(c).type_code])) });

/** Cards the Corp's own choice took from HQ to Archives, R&D or out of the game ([HIDDEN-READ]). */
function q4(t: Tree, src: string, who: string, before: GameState, b: HqSnap, after: GameState, action: GameAction | null) {
  if (!action) return;
  const prompt = t.core.activePrompt(before);
  if (prompt?.kind === 'discard' || prompt?.kind === 'mulligan') return; // Q1; a mulligan is no choice of cards
  const own = (action as any).cardInstanceId;
  const left = b.ids.filter(id => !after.corp.hq.some(c => c.instanceId === id) && id !== own);
  const lost = left.map(id => ({ id, type: b.types.get(id)!, to: zoneOf(after, id) })).filter(x => x.to === 'rd' || x.to.startsWith('archives') || x.to === 'elsewhere');
  if (!lost.length) return;
  const stayedNon = after.corp.hq.filter(c => t.core.cardDef(c).type_code !== 'agenda').length;
  const via = prompt ? `prompt ${prompt.kind} ${prompt.source?.cardCode ? t.core.cardDef({ cardCode: prompt.source.cardCode }).title : '?'}/${prompt.source?.step ?? ''}` : `${action.type}${own ? ` ${t.core.cardDef(before.corp.hq.find(c => c.instanceId === own) ?? { cardCode: '' })?.title ?? ''}` : ''}`;
  const cls = lost.some(x => x.type === 'agenda') && stayedNon > 0;
  // A class case: the HQ before and the run under way ([HIDDEN-READ]: HQ)
  const detail = cls ? { hqBefore: before.corp.hq.map(c => `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}`), lostTitles: lost.map(x => t.core.cardDef(before.corp.hq.find(c => c.instanceId === x.id)!).title), run: before.activeRun ? `${before.activeRun.server} ${before.activeRun.phase}` : null } : {};
  out({ kind: 'q4', src, who, T: before.turnNumber, via, ...detail, lost: lost.map(x => `${x.type}->${x.to}`), agendaLost: lost.some(x => x.type === 'agenda'), stayedNon, cls: lost.some(x => x.type === 'agenda') && stayedNon > 0 });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const t of ['source', 'probe', 'cont']) trees[t] = await loadTree(t, dirs[t]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/agenda-discard-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...dealList.map(r => ({ kind: 'deal' as const, id: r })), ...humans.map(f => ({ kind: 'human' as const, id: f }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const t = trees.source;
      const seen: Seen[] = [];
      const last: { call: { side: string; action: GameAction | null } | null } = { call: null };
      const fates = new Fates();
      const wrap = (side: string, inner: any) =>
        new Proxy(inner, {
          get(target, prop, recv) {
            const v = Reflect.get(target, prop, recv);
            if (typeof v !== 'function' || typeof prop !== 'string' || !prop.startsWith('choose')) return v;
            return (...args: unknown[]) => {
              const s = args[0] as GameState;
              const p = side === 'corp' ? t.core.activePrompt(s) : null;
              const copy = p?.kind === 'discard' && p.side === 'corp' ? structuredClone(s) : null;
              const r = v.apply(target, args);
              last.call = { side, action: r ?? null };
              if (copy) seen.push({ src: `deal:${rec.seed}`, kind: 'self', s: copy, recorded: r?.choice?.cardInstanceIds ?? [], fates });
              return r;
            };
          },
        });
      const start = dealState(rec.seed);
      const g = new t.GameRunner(start, { corp: wrap('corp', t.createAgent('corp', 'normal')), runner: wrap('runner', t.createAgent('runner', 'normal')) });
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      let watched = 0;
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const b = snap(t, s);
        last.call = null;
        if (!g.step()) break;
        const lc = last.call as { side: string; action: GameAction | null } | null;
        if (lc?.side === 'corp') q4(t, `deal:${rec.seed}`, 'self', s, b, g.state, lc.action);
        if (seen.length > watched) {
          for (const x of seen.slice(watched)) fates.watch(g.state, x.recorded);
          watched = seen.length;
        }
        fates.step(g.state);
      }
      const same = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: `deal:${rec.seed}`, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: same, ...(same ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }), prompts: seen.length });
      for (const x of seen) report(trees, x);
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const who = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const t = trees.source;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = t.core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      const fates = new Fates();
      const seen: Seen[] = [];
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const p = t.core.activePrompt(s);
        const isDiscard = p?.kind === 'discard' && p.side === 'corp' && (move as any).type === 'RESOLVE_PROMPT' && (move as any).promptId === p.id;
        const copy = isDiscard ? structuredClone(s) : null;
        const b = snap(t, s);
        let next: GameState;
        try {
          next = t.core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        if ((move as any).player === 'corp') q4(t, name, who, s, b, next, move);
        if (copy) {
          const x: Seen = { src: `${name}#${j}`, kind: who, s: copy, recorded: (move as any).choice?.cardInstanceIds ?? [], fates };
          seen.push(x);
          fates.watch(next, x.recorded);
        }
        s = next;
        fates.step(s);
      }
      out({ kind: 'h', src: name, who, moves: r.moves.length, stopped, prompts: seen.length });
      for (const x of seen) report(trees, x);
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0) });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
