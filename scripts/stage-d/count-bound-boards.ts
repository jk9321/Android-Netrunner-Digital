/**
 * The count bound item, step 1 (brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief.md), parts A, B and C on
 * the built boards: row 57's ladder (one server with 4 to 7 unrezzed ice, an open and a shut variant), row 75a's board
 * (five ice, five programs installed: the Madani worst board of count 2 with its four programs installed), the trash
 * work's M1 to M6 and Hammer boards (scripts/stage-d/rt-time2.ts, rt-time3.ts, rt-time-m.ts), and the rig ladder of
 * part C (one recorded-like board, the Runner's rig grown one legal program at a time).
 *
 * Per board: a Normal Corp decision on base, control and arm (medians of REPS, default 3, order rotated), the serverHold
 * of the board's server alone on each, the instr tree's split of the decision, and every question the decision gathered
 * searched three ways (beta, the arm, the brute force; count-bound-lib.ts searchQuestion). Max RSS at the end.
 *
 *   ONLY=ladder TREES=base,control,arm npx vite-node scripts/stage-d/count-bound-boards.ts
 *   ONLY="ladder open 7" TREES=arm Q=0 npx vite-node scripts/stage-d/count-bound-boards.ts   (one tree, memory)
 * Q=0 skips the per-question searches; SPLIT=0 skips the instr tree.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import type { CardInstance, GameState } from '../../src/core';
import { cardDef } from '../../src/core';
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
import { createCardInstance } from '../../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
import { breakerCodes } from './golden-prices';
import { Tree, ask, askInstr, iceFacts, loadTree, makeTrees, median, out, pairCause, r1, searchQuestion } from './count-bound-lib';

const REPS = Number(process.env.REPS ?? 3);
const ONLY = process.env.ONLY;
const TREES_ON = (process.env.TREES ?? 'base,control,arm').split(',');

const installHardwareForTest = (s: GameState, code: string) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig.hardware.push(c);
};
const installResourceForTest = (s: GameState, code: string) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig.resources.push(c);
};
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 3;
  s.corp.credits = 12;
  s.turnNumber = 7;
  s.runner.maxClicks = 4;
  s.runner.grip = s.runner.grip.slice(0, 5);
  setup(s);
  return s;
}
const ice = (s: GameState, code: string, rezzed: boolean, server: string) => installIceForTest(s, code, server, rezzed);
const agenda = (s: GameState, server: string) => s.corp.servers[server].root.push(createCardInstance(s, '30036'));
const RIG = ['30026', '30016', '30016', '30015', '30006', '30032', '36004', '30007'];
const rig = (s: GameState, n: number) => {
  for (const c of RIG.slice(0, n)) installProgramForTest(s, c);
};

const boards: { name: string; server: string; s: GameState }[] = [];
// Row 57's ladder: one remote with an agenda, n unrezzed deck ice (Palisade, Whitespace, Tithe, Ping, Funhouse, Brân 1.0,
// Ansel 1.0, outermost last), the Corp able to rez them all (30), a Runner with a decoder, a fracter and a killer.
// `open`: 12 credits; `shut`: 2 credits.
const LADDER = ['30072', '30074', '30073', '30055', '30054', '30039', '30038'];
for (const n of [4, 5, 6, 7])
  for (const [kind, credits] of [['open', 12], ['shut', 2]] as const)
    boards.push({
      name: `ladder ${kind} ${n}`,
      server: 'remote1',
      s: board(st => {
        st.corp.credits = 30;
        st.runner.credits = credits;
        for (const c of LADDER.slice(0, n)) ice(st, c, false, 'remote1');
        agenda(st, 'remote1');
        for (const c of ['30026', '30006', '30015']) installProgramForTest(st, c);
      }),
    });

// Row 57's ladder, heavy: the same remote with Tatu-Bola, Mycoweb, Whitespace, Mycoweb, Palisade, Bumi 1.0, Funhouse
// (outermost last, unrezzed), a rezzed Cloud Eater on HQ to lend from, the Runner's 8 programs (RIG), 5 clicks, 5
// credits (open) or 0 (shut)
const HEAVY = ['34044', '35053', '30074', '35053', '30072', '35041', '30054'];
for (const n of [4, 5, 6, 7])
  for (const [kind, credits] of [['open', 5], ['shut', 0]] as const)
    boards.push({
      name: `heavy ${kind} ${n}`,
      server: 'remote1',
      s: board(st => {
        st.corp.credits = 30;
        st.runner.credits = credits;
        st.runner.maxClicks = 5;
        for (const c of HEAVY.slice(0, n)) ice(st, c, false, 'remote1');
        ice(st, '34110', true, 'hq');
        agenda(st, 'remote1');
        rig(st, 8);
      }),
    });

// Row 75a: count 2's worst board with its four Madani programs installed (Cleaver; Buzzsaw, Sang Kancil, Chromatophores
// on Bumi 1.0, Botulus with 1 virus on Lycian): five ice on a remote with an agenda, two rezzed
{
  const BREAKERS = breakerCodes();
  const s = newGame(5);
  s.turnNumber = 9;
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.memoryUnitsUsed = 0;
  s.runner.credits = 9;
  s.corp.credits = 14;
  ['30072', '35079', '30055', '35041', '34100'].forEach((code, k) => installIceForTest(s, code, 'remote1', k < 2));
  const ag = s.corp.hq.find(isAgenda) ?? s.corp.rd.find(isAgenda)!;
  s.corp.hq = s.corp.hq.filter(c => c !== ag);
  s.corp.rd = s.corp.rd.filter(c => c !== ag);
  s.corp.servers.remote1.root.push(ag);
  installProgramForTest(s, BREAKERS.find(c => /fracter/i.test(cardDef({ cardCode: c } as CardInstance).keywords ?? ''))!);
  const fr = BREAKERS.filter(c => /killer|decoder/i.test(cardDef({ cardCode: c } as CardInstance).keywords ?? ''));
  const iceIds = s.corp.servers.remote1.ice.map(c => c.instanceId);
  for (const code of [fr[0], fr[fr.length - 1], '35030', '30004']) {
    const c = Object.assign(createCardInstance(s, code), { isRezzed: true });
    if (code === '35030') c.hostedOnId = iceIds[3];
    if (code === '30004') {
      c.hostedOnId = iceIds[4];
      c.tokens = { virus: 1 };
    }
    s.runner.rig.programs.push(c);
  }
  boards.push({ name: 'row 75a: Madani worst board, five programs installed', server: 'remote1', s });
}

// The trash work's boards (rt-time2.ts M1-M3 at 4 and 5 clicks, rt-time3.ts M4-M6, rt-time-m.ts Hammer)
for (const clicks of [4, 5]) {
  boards.push({ name: `M1 ${clicks} clicks`, server: 'rd', s: board(st => { st.runner.maxClicks = clicks; ice(st, '34044', false, 'rd'); ice(st, '34110', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd'); ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 25; rig(st, 8); }) });
  boards.push({ name: `M2 ${clicks} clicks`, server: 'rd', s: board(st => { st.runner.maxClicks = clicks; ice(st, '34044', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd'); ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '34110', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 25; rig(st, 8); }) });
  boards.push({ name: `M3 ${clicks} clicks`, server: 'remote1', s: board(st => { st.runner.maxClicks = clicks; ice(st, '34044', false, 'remote1'); ice(st, '35041', false, 'remote1'); ice(st, '35053', false, 'remote1'); agenda(st, 'remote1'); ice(st, '30038', true, 'hq'); st.corp.credits = 25; rig(st, 8); }) });
}
boards.push({ name: 'M4 5 clicks', server: 'rd', s: board(st => { st.runner.maxClicks = 5; ice(st, '34044', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd'); ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '34110', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 30; rig(st, 8); }) });
boards.push({ name: 'M5 5 clicks', server: 'rd', s: board(st => { st.runner.maxClicks = 5; ice(st, '34044', false, 'rd'); ice(st, '34110', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd'); ice(st, '30072', false, 'rd'); ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 30; rig(st, 8); }) });
boards.push({ name: 'M6 5 clicks', server: 'remote1', s: board(st => { st.runner.maxClicks = 5; ice(st, '34044', false, 'remote1'); ice(st, '35053', false, 'remote1'); ice(st, '35053', false, 'remote1'); ice(st, '30074', false, 'remote1'); agenda(st, 'remote1'); ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '34110', true, 'hq'); st.corp.credits = 25; rig(st, 8); }) });
for (const n of [5, 8])
  boards.push({
    name: `Hammer ${n} programs`,
    server: 'remote1',
    s: board(st => {
      ice(st, '34044', false, 'remote1');
      ice(st, '34126', false, 'remote1');
      agenda(st, 'remote1');
      st.corp.credits = 20;
      rig(st, n);
      installHardwareForTest(st, '30023');
      installHardwareForTest(st, '30022');
      installResourceForTest(st, '30009');
      installResourceForTest(st, '30027');
    }),
  });

// Part C, the rig's reach: row 57's 5-ice open board, the Runner's rig grown one program at a time (the test decks'
// breakers and Botulus, memory not checked: the most a rig of that size can be)
{
  const GROW = ['30026', '30006', '30015', '30016', '36004', '30032', '30007', '30004'];
  for (let n = 0; n <= GROW.length; n++)
    boards.push({
      name: `rig ${n} on ladder open 5`,
      server: 'remote1',
      s: board(st => {
        st.corp.credits = 30;
        st.runner.credits = 12;
        for (const c of LADDER.slice(0, 5)) ice(st, c, false, 'remote1');
        agenda(st, 'remote1');
        for (const c of GROW.slice(0, n)) installProgramForTest(st, c);
      }),
    });
}

async function main() {
  const names = [...new Set([...TREES_ON, ...(process.env.SPLIT === '0' ? [] : ['instr'])])] as any[];
  const dirs = makeTrees(process.env.TROOT ?? 'node_modules/.cache/cb-boards', names);
  const trees: Record<string, Tree> = {};
  for (const t of names) trees[t] = await loadTree(t, dirs[t]);
  for (const b of boards) {
    if (ONLY && !ONLY.split('|').some(o => b.name.startsWith(o))) continue;
    const q = { side: 'corp', fn: 'chooseAction', args: [b.s] };
    const ms: Record<string, number[]> = {};
    const hold: Record<string, number[]> = {};
    const picks: Record<string, string> = {};
    for (let rep = 0; rep < REPS; rep++) {
      const order = TREES_ON.map((_, i) => TREES_ON[(i + rep) % TREES_ON.length]);
      for (const t of order) {
        const tr = trees[t];
        const r = ask(tr, q);
        (ms[t] ??= []).push(r.ms);
        picks[t] = r.a.slice(0, 120);
        tr.clear();
        const st = structuredClone(b.s);
        const t0 = performance.now();
        tr.asSide('corp', () => (tr.decisionContext(st, 'corp'), tr.hold.serverHold(st, b.server, { when: 'runnerTurn' })));
        (hold[t] ??= []).push(performance.now() - t0);
      }
    }
    const row: Record<string, unknown> = {
      kind: 'b',
      board: b.name,
      server: b.server,
      decision: Object.fromEntries(TREES_ON.map(t => [t, r1(median(ms[t]))])),
      all: Object.fromEntries(TREES_ON.map(t => [t, ms[t].map(r1)])),
      serverHold: Object.fromEntries(TREES_ON.map(t => [t, r1(median(hold[t]))])),
      picks,
      armSame: picks.arm === undefined || picks.arm === picks.base,
      controlSame: picks.control === undefined || picks.control === picks.base,
    };
    if (trees.instr) {
      const r = askInstr(trees.instr, q);
      row.instr = { ms: r1(r.ms), split: Object.fromEntries(Object.entries(r.split).map(([k, v]) => [k, r1(v)])), asked: r.asked, searched: r.searched, runStands: r.runStands, nodes: r.searches.reduce((n, x) => n + x.nodes, 0), entriesNodes: r.entriesNodes, questions: r.questions.size, pick: r.a.slice(0, 120) };
      out(row);
      if (process.env.Q !== '0') {
        for (const [k, qq] of r.questions) {
          const sq = searchQuestion(trees.instr, qq);
          const byMask = new Map(sq.rows.map(x => [x.mask, x]));
          const causes: Record<string, number> = {};
          for (const [s, t] of [...sq.v1, ...sq.v2.map(v => [v[0], v[1]] as [number, number])]) for (const c of pairCause(qq, s, t, byMask).causes) causes[c] = (causes[c] ?? 0) + 1;
          out({
            kind: 'q',
            board: b.name,
            qid: createHash('md5').update(k).digest('hex').slice(0, 12),
            ...sq.facts,
            beta: sq.beta,
            arm: sq.arm,
            brute: sq.brute,
            // What the readers see: holds, the rez set when it holds (null when not), need (and margin), entries
            same: sq.beta.holds === sq.arm.holds && (!sq.beta.holds || sq.beta.mask === sq.arm.mask) && sq.beta.need === sq.arm.need && sq.beta.entries === sq.arm.entries,
            setSame: sq.beta.mask === sq.arm.mask,
            armTie: sq.armTie,
            tieSame: sq.beta.holds === sq.armTie.holds && sq.beta.mask === sq.armTie.mask && sq.beta.need === sq.armTie.need && sq.beta.entries === sq.armTie.entries,
            cls: sq.cls,
            v1: sq.v1.length,
            v2: sq.v2.length,
            v1pairs: sq.v1.slice(0, 5),
            v2pairs: sq.v2.slice(0, 5),
            causes,
            ...(sq.v1.length || sq.v2.length ? { ice: iceFacts(qq) } : {}),
          });
        }
      }
    } else out(row);
  }
  out({ kind: 'mem', maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
