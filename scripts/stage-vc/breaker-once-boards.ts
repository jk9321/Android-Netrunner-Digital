/**
 * V-C item 1 count, the two named boards on each tree (brief, B: "The pin's board and deal 1601 T6 on each tree: the pick,
 * and whether the agenda is stolen"). Trees: breaker-once-trees.ts.
 *  - pin: tests/exploitPins.test.ts "Ballista alone on a root agenda against one breaker: not stolen", built the same way
 *    (fixture rez-toll.json; Ballista unrezzed alone on remote-1 with the HQ agenda in the root; Corp 8, Runner 5, Cleaver
 *    the only program). Played by GameRunner with the tree's Normal agents on both sides until the run ends, as the pin.
 *    Reported: Ballista rezzed, the Corp's answer at Ballista's prompt with each answer's price (RECORD), the agenda stolen.
 *  - deal 1601: the game played by the `source` tree (beta) as the batch; every Ballista prompt (30062) of the Corp's in
 *    it is a board. On each, each tree answers (fresh agents, one step), and the rest of that run and turn is played by
 *    that tree's agents on both sides: the pick, its price, points stolen in that run.
 *   npx vite-node scripts/stage-vc/breaker-once-boards.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Tree, loadTree, makeTrees } from './breaker-once-trees';

const G = globalThis as any;
const r2 = (x: number) => Math.round(x * 100) / 100;
const BALLISTA = '30062';

function label(t: Tree, s: GameState, a: any): string {
  if (!a) return 'none';
  if (a.type === 'RESOLVE_PROMPT') {
    const c = a.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => t.core.cardDef(t.core.findCardAnywhere(s, id)).title).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  return a.type;
}
const prices = (t: Tree, s: GameState) => {
  const rec = G.__boRun ?? (G.__boFb ? { opts: G.__boFb } : null);
  return rec ? { by: G.__boRun ? 'run' : 'fb', loss: rec.loss, opts: rec.opts.map((o: any) => `${label(t, s, o.a)} ${r2(o.price ?? o.score)}${o.v ? ` (${o.v})` : ''}`) } : null;
};
const isBallista = (t: Tree, s: GameState) => {
  const p = t.core.activePrompt(s);
  return !!p && p.side === 'corp' && 'source' in p && p.source.cardCode === BALLISTA;
};

/** Per ice, its Corp-view and Runner-view worth on this board and with each program out (beta tree): where the ice movement sits. */
function iceTable(t: Tree, s: GameState): string[] {
  t.clear();
  const lines: string[] = [];
  const progs = s.runner.rig.programs;
  const w = (b: GameState, ice: any, v: string) => r2(t.iceValues.iceWorth(b, ice, v));
  for (const [id, sv] of Object.entries(s.corp.servers)) {
    for (const ice of (sv as any).ice) {
      const cells = progs.map(p => {
        const b = { ...s, runner: { ...s.runner, rig: { ...s.runner.rig, programs: progs.filter(x => x !== p) } } } as GameState;
        return `-${t.core.cardDef(p).title} ${w(b, ice, 'corp')}/${w(b, ice, 'runner')}`;
      });
      lines.push(`      ${id} ${t.core.cardDef(ice).title}${ice.isRezzed ? '' : '(u)'}: ${w(s, ice, 'corp')}/${w(s, ice, 'runner')}; ${cells.join('; ')}`);
    }
  }
  const rig = progs.map(p => `-${t.core.cardDef(p).title} ${r2(t.evaluate.runnerRigValue(s) - t.evaluate.runnerRigValue({ ...s, runner: { ...s.runner, rig: { ...s.runner.rig, programs: progs.filter(x => x !== p) } } }))}`);
  lines.push(`      rig movement: ${rig.join('; ')}`);
  return lines;
}

/** Plays `s` with the tree's agents until the run on `server` ends (or `limit` steps); notes the Corp's Ballista answers. */
function playRun(t: Tree, s: GameState, server: string) {
  t.clear();
  const g = new t.GameRunner(structuredClone(s), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const answers: any[] = [];
  const rs0 = s.runner.score;
  for (let i = 0; i < 300 && g.state.activeRun && g.state.activeRun.server === server && !g.state.winner; i++) {
    const before = g.state;
    const ball = isBallista(t, before);
    G.__boRun = null;
    G.__boFb = null;
    if (!g.step()) break;
    if (ball) answers.push({ pick: label(t, before, g.last), prices: prices(t, before) });
  }
  const ice = s.corp.servers[server].ice.map((c: any) => g.state.corp.servers[server]?.ice.find((x: any) => x.instanceId === c.instanceId)?.isRezzed ?? null);
  return { answers, stolen: g.state.runner.score - rs0, rezzed: ice, runOver: !g.state.activeRun };
}

async function main() {
  const dirs = makeTrees(resolve('node_modules/.cache/breaker-once-boards'), ARMS);
  const trees: Record<string, Tree> = {};
  for (const arm of ARMS) trees[arm] = await loadTree(arm, dirs[arm]);
  const beta = trees.beta;

  // ---- the pin's board (as tests/exploitPins.test.ts builds it)
  const s = structuredClone(JSON.parse(readFileSync('tests/fixtures/rez-toll.json', 'utf8')).state as GameState);
  const agenda = s.corp.hq.find(c => beta.core.cardDef(c).type_code === 'agenda')!;
  s.corp.hq = s.corp.hq.filter(c => c !== agenda);
  const ballista = Object.assign(beta.core.createCardInstance(s, BALLISTA), { isRezzed: false });
  s.corp.servers.rd = { ...s.corp.servers.rd, ice: [] };
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [ballista], root: [agenda] } as never;
  s.runner.credits = 5;
  s.corp.credits = 8;
  s.activeRun = { ...s.activeRun!, server: 'remote-1', icePosition: 0 };
  console.log(`PIN board: programs [${s.runner.rig.programs.map(c => beta.core.cardDef(c).title)}], agenda ${beta.core.cardDef(agenda).title}`);
  {
    // The board at Ballista's prompt on beta, for the ice table (Corp-view/Runner-view worth, with each program out)
    const g0 = new beta.GameRunner(structuredClone(s), { corp: beta.createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    for (let i = 0; i < 300 && g0.state.activeRun && !isBallista(beta, g0.state); i++) if (!g0.step()) break;
    if (isBallista(beta, g0.state)) for (const l of iceTable(beta, g0.state)) console.log(l);
  }
  for (const arm of ARMS) {
    if (arm === 'source') continue;
    const r = playRun(trees[arm], s, 'remote-1');
    console.log(`  ${arm}: Ballista rezzed ${r.rezzed[0]}; ${r.answers.map(a => `${a.pick} [${a.prices?.by} loss ${a.prices?.loss}: ${a.prices?.opts.join('; ')}]`).join(' / ') || 'no Ballista prompt'}; stolen ${r.stolen}${r.stolen ? ' STOLEN' : ''}`);
  }

  // ---- deal 1601, every Corp Ballista prompt of the game the batch plays
  const t = trees.source;
  t.clear();
  const g = new t.GameRunner(dealState(1601), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const boards: GameState[] = [];
  for (let n = 0; n < 5000 && !g.state.winner; n++) {
    if (isBallista(t, g.state)) boards.push(structuredClone(g.state));
    if (!g.step()) break;
  }
  console.log(`DEAL 1601 (source tree): winner ${g.state.winner} T${g.state.turnNumber} ${g.state.corp.score}-${g.state.runner.score}; Ballista prompts ${boards.length}`);
  for (const b of boards) {
    const server = b.activeRun!.server;
    // HIDDEN-READ (measuring script): the root's cards, to say what the run could reach
    const root = b.corp.servers[server]?.root.map(c => beta.core.cardDef(c).title) ?? [];
    console.log(`  T${b.turnNumber} ${server} root [${root}]; Corp ${b.corp.credits}, Runner ${b.runner.credits} credits ${b.runner.clicks} clicks; programs [${b.runner.rig.programs.map(c => beta.core.cardDef(c).title)}]`);
    for (const l of iceTable(beta, b)) console.log(l);
    for (const arm of ARMS) {
      if (arm === 'source') continue;
      const r = playRun(trees[arm], b, server);
      console.log(`    ${arm}: ${r.answers.map(a => `${a.pick} [${a.prices?.by} loss ${a.prices?.loss}: ${a.prices?.opts.join('; ')}]`).join(' / ')}; stolen in the run ${r.stolen}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
