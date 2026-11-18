/**
 * Stage D item 5 step 1 (brief section 3, "the pins of the hand-off", and 4.5, the boards): each tree of
 * place-open-patches.ts asked at Jeff's recorded states (the report's moves replayed to move N, as tests/stageDPins.test.ts)
 * and at each board's mirror (every agenda in HQ swapped for a non-agenda card of the same deck: HQ's stake becomes 0),
 * the Normal Corp with the look-ahead and the Corp without it (planner off). For each: the decision, and the rest of that
 * Corp turn played by the same Corp (moves, then HQ and R&D ice and the hold count of every staked server at the turn's
 * end, serverHold 'runnerTurn').
 *    npx vite-node scripts/stage-d/place-open-boards.ts            (all boards)
 *    BOARDS=49:111,53:191 ARMS=a1 PLANNER=off npx vite-node scripts/stage-d/place-open-boards.ts
 * A board "53:T4" is the first Corp main-phase state of turn 4.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { asSide } from '../../src/ai/pricing';
import { serverHold } from '../../src/ai/corp/hold';
import { stake } from '../../src/ai/corp/pools';
import { probe } from './game-end-patches';
import { PATCHES, placeProbe } from './place-open-patches';

const want = (process.env.ARMS ?? '').split(',').filter(Boolean);
const ARMS = ['base', ...Object.keys(PATCHES).filter(a => !want.length || want.includes(a))];
const BOARDS = (process.env.BOARDS ?? '49:82,49:111,49:121,53:191,53:T4,35:77,35:130,35:215,37:109,37:130,37:152').split(',');
const PLANNERS = (process.env.PLANNER ?? 'on,off').split(',');
const MIRROR = process.env.MIRROR ?? 'both';
const root = resolve('.fc-variants', 'place-open-boards');

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of ARMS) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of [...probe, ...placeProbe, ...(PATCHES[arm] ?? [])]) {
      const path = join(dir, 'src', file);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
}

function board(spec: string): { s: GameState; recorded: string } {
  const [n, m] = spec.split(':');
  const r = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const moves = r.moves as GameAction[];
  for (let i = 0; i < moves.length; i++) {
    if (m.startsWith('T') ? s.turnNumber === Number(m.slice(1)) && s.activePlayer === 'corp' && actingSide(s) === 'corp' && !s.pendingPrompts.length && s.turnStep?.kind !== 'corp_turn_start' && !s.priority : i === Number(m))
      return { s, recorded: short(s, moves[i]) };
    s = executeAction(s, moves[i]);
  }
  throw new Error(`board ${spec} not found`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the probe globals of the patched trees
const G = globalThis as unknown as Record<string, any>;
function short(s: GameState, a: GameAction | null): string {
  if (!a) return 'pass';
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const c = x.cardInstanceId ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(k => k.instanceId === x.cardInstanceId) : null;
  return `${a.type}${c ? ` ${cardDef(c).title}` : ''}${x.asNewRemote ? '->new' : x.targetServerId ? `->${x.targetServerId}` : ''}`;
}

/** The mirror: every agenda in HQ becomes a non-agenda card of the Corp's deck (its code; the instance keeps its id). */
function mirror(s: GameState): GameState | null {
  const c = structuredClone(s);
  const other = [...c.corp.rd, ...c.corp.hq].find(k => cardDef(k).type_code === 'operation') ?? [...c.corp.rd, ...c.corp.hq].find(k => cardDef(k).type_code !== 'agenda');
  if (!other || !c.corp.hq.some(k => cardDef(k).type_code === 'agenda')) return null;
  for (const k of c.corp.hq) if (cardDef(k).type_code === 'agenda') k.cardCode = other.cardCode;
  return c;
}

function endOf(s: GameState) {
  return asSide('corp', () => {
    const servers = Object.keys(s.corp.servers)
      .filter(id => stake(s, id).loss > 0)
      .map(id => {
        const h = serverHold(s, id, { when: 'runnerTurn' });
        return `${id}${h.holds ? '+' : '-'}${s.corp.servers[id].ice.length}${h.holds ? '' : `(need ${h.need} / ${h.budget}, ${h.entries} in)`}`;
      });
    return `staked: ${servers.join(' ')}; HQ agendas ${s.corp.hq.filter(k => cardDef(k).type_code === 'agenda').length}`;
  });
}

async function main() {
  const dirs = makeTrees();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- modules imported from the patched trees
  const trees: Record<string, { ai: Record<string, any>; clear: () => void }> = {};
  for (const arm of ARMS) {
    const m = (p: string) => import(/* @vite-ignore */ join(dirs[arm], 'src', p));
    const ai = await m('ai/index.ts');
    const hv = await m('ai/handValues.ts');
    const ev = await m('ai/effectValues.ts');
    const vm = await m('ai/valueModel.ts');
    trees[arm] = { ai, clear: () => (hv.clearHandCaches(), ev.clearDamageThreats(), vm.valueLoops?.clear()) };
  }
  for (const spec of BOARDS) {
    const { s: s0, recorded } = board(spec);
    const variants: [string, GameState | null][] = [];
    if (MIRROR !== 'only') variants.push(['board', s0]);
    if (MIRROR !== 'none') variants.push(['mirror', mirror(s0)]);
    console.log(`\n## ${spec} T${s0.turnNumber} (recorded: ${recorded}); Corp ${s0.corp.credits}cr ${s0.corp.clicks}cl, score ${s0.corp.score}-${s0.runner.score}; HQ ice ${s0.corp.servers.hq.ice.length}, R&D ice ${s0.corp.servers.rd.ice.length}; at the start ${endOf(s0)}`);
    for (const [label, s] of variants) {
      if (!s) {
        console.log(`  ${label}: none (no agenda in HQ)`);
        continue;
      }
      for (const planner of PLANNERS) {
        for (const arm of ARMS) {
          const t = trees[arm];
          const make = () => (planner === 'off' ? new t.ai.HeuristicCorpAI({ planner: false }) : t.ai.createAgent('corp', 'normal'));
          let st = structuredClone(s);
          const corp = make();
          const moves: string[] = [];
          let first = '';
          try {
            for (let i = 0; i < 20 && st.activePlayer === 'corp' && actingSide(st) === 'corp' && !st.winner; i++) {
              t.clear();
              G.__geLayer = undefined;
              const a = corp.chooseAction(st) as GameAction;
              const m = `${short(st, a)}${i === 0 && G.__geLayer ? ` [${G.__geLayer}]` : ''}`;
              if (i === 0) first = m;
              if (a.type !== 'PASS') moves.push(m);
              st = executeAction(st, a);
              if (a.type === 'END_TURN') break;
            }
          } catch (e) {
            moves.push(`error ${(e as Error).message}`);
          }
          console.log(`  ${label} planner ${planner} ${arm}: first ${first} | turn: ${moves.slice(1).join('; ')} | end ${endOf(st)}`);
        }
      }
    }
  }
  rmSync(root, { recursive: true, force: true });
}

void main();
