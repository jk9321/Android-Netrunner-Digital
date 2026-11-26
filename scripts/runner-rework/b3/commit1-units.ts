/**
 * B3 commit 1, bar 2's unit comparison (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b3-prompt-view.md
 * rev 2): the old chain (BASE's prompts.ts, the Runner card cases inline) against the new one (this checkout: the cases
 * in the card entries, read at one dispatch point) on built prompts. Real states come from the first DEALS deals of g1
 * 45716865309 played on the base tree (every STRIDE-th step, in a run and out of one); on each, every moved case's prompt
 * is built in place (pendingPrompts = [prompt]) with variants: the answering side, the case's step and a step it does not
 * have, its options or candidates, plan.bypass on and off, synergy on and off. Both trees answer a copy each; the answers
 * (or the errors) must be equal. Measurement only: no src change.
 *
 *   npx vite-node scripts/runner-rework/b3/commit1-units.ts -- BASE=<sha> DEALS=4 STRIDE=9 EACH=12
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '5fbdd17adb0d5307401f7db42f8adaa9d1a3941e';
const NDEALS = Number(process.env.DEALS ?? 4);
const STRIDE = Number(process.env.STRIDE ?? 9);
/** At most this many states of each sort (in an encounter, in a run, neither), spread evenly. */
const EACH = Number(process.env.EACH ?? 12);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3-commit1-units');

type Name = 'base' | 'branch';
type Built = { tree: Tree; prompts: any; synergy: any };
async function trees(): Promise<Record<Name, Built>> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  try {
    execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
  } catch {
    execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
  }
  const out = {} as Record<Name, Built>;
  for (const name of ['base', 'branch'] as Name[]) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (name === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    const tree = await loadTree(name, dir);
    const prompts = await import(/* @vite-ignore */ join(dir, 'src', 'ai/prompts.ts'));
    const synergy = await import(/* @vite-ignore */ join(dir, 'src', 'ai/synergy.ts'));
    out[name] = { tree, prompts, synergy };
  }
  return out;
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function states(t: Tree, deals: Deal[]): GameState[] {
  const got: GameState[] = [];
  for (const d of deals) {
    const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
    const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
    t.clear();
    const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r)), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
    for (let i = 0; i < 6000; i++) {
      const s: GameState = g.state;
      // every STRIDE-th step, and every step in an encounter (Botulus, Lobisomem, Window of Opportunity read the run)
      if (s.turnNumber > 1 && s.pendingPrompts.length === 0 && (i % STRIDE === 0 || s.activeRun?.encounter)) got.push(structuredClone(s));
      if (!g.step()) break;
    }
  }
  const spread = (xs: GameState[]) => (xs.length <= EACH ? xs : Array.from({ length: EACH }, (_, i) => xs[Math.floor((i * xs.length) / EACH)]));
  return [...spread(got.filter(s => s.activeRun?.encounter)), ...spread(got.filter(s => s.activeRun && !s.activeRun.encounter)), ...spread(got.filter(s => !s.activeRun))];
}

const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId);
const installedIce = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.ice);
/** Each moved case: its code, its kind, the steps it answers (and one it doesn't), and the options or candidates offered. */
const CASES: { code: string; name: string; kind: 'effect_choice' | 'effect_cards'; steps: string[]; build: (s: GameState) => { options?: string[][]; candidates?: string[][]; data?: Record<string, number>[] } }[] = [
  { code: '34001', name: 'Strike Fund', kind: 'effect_choice', steps: ['trashed', 'other'], build: () => ({ options: [['yes', 'no']] }) },
  { code: '34093', name: '"Pretty" Mary da Silva', kind: 'effect_choice', steps: ['extra', 'other'], build: () => ({ options: [['yes', 'no']] }) },
  { code: '34076', name: 'Meeting of Minds', kind: 'effect_cards', steps: ['reveal', 'other'], build: s => ({ candidates: [ids(s.runner.grip), ids(s.runner.grip.slice(0, 1))] }) },
  { code: '34090', name: 'Lobisomem', kind: 'effect_choice', steps: ['x', 'other'], build: () => ({ options: [['2', '1', '0'], ['1', '0']] }) },
  { code: '34078', name: 'Alarm Clock', kind: 'effect_choice', steps: ['run', 'other'], build: () => ({ options: [['yes', 'no']] }) },
  { code: '34077', name: 'Window of Opportunity', kind: 'effect_cards', steps: ['derez', 'other'], build: s => ({ candidates: [ids(installedIce(s).filter(c => c.isRezzed)), ids(installedIce(s).filter(c => c.isRezzed).slice(0, 1))] }) },
  { code: '36015', name: 'Baker', kind: 'effect_choice', steps: ['redirect', 'other'], build: () => ({ options: [['hq', 'rd', 'no']] }) },
  { code: '36014', name: 'Rotary', kind: 'effect_choice', steps: ['breach', 'other'], build: () => ({ options: [['tag', 'no']] }) },
  { code: '36022', name: 'Read-Write Share', kind: 'effect_cards', steps: ['host', 'other'], build: s => ({ candidates: [ids(s.runner.grip)] }) },
  { code: '36020', name: 'Methuselah', kind: 'effect_cards', steps: ['trash', 'other'], build: s => ({ candidates: [ids([...s.runner.grip, ...s.runner.rig.hardware]), ids(s.runner.rig.hardware)] }) },
  { code: '35033', name: '"Knickknack" O\'Brian', kind: 'effect_cards', steps: ['trash', 'other'], build: s => ({ candidates: [ids([...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources])] }) },
  { code: '30004', name: 'Botulus', kind: 'effect_choice', steps: ['sub', 'other'], build: () => ({ options: [['0', '1', '2'], ['1', '0']] }) },
  { code: '30010', name: 'Zahya Sadeghi', kind: 'effect_choice', steps: ['gain', 'other'], build: () => ({ options: [['gain', 'no']], data: [{ credits: 1 }, { credits: 3 }, {}] }) },
  { code: '30019', name: 'Tāo Salonga', kind: 'effect_cards', steps: ['swap', 'other'], build: s => ({ candidates: [ids(installedIce(s))] }) },
];

function answer(b: Built, s: GameState, side: 'corp' | 'runner', bypass: boolean, synergy: boolean): string {
  const t = b.tree;
  t.clear();
  try {
    const plan = t.pricing.plan();
    const a = t.pricing.withPricing({ plan: { ...plan, bypass } }, () => t.pricing.asSide(side, () => b.prompts.answerPrompt(structuredClone(s), side, undefined, synergy)));
    return String(JSON.stringify(a));
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 120)}`;
  }
}

async function main() {
  const T = await trees();
  const deals: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/b3/deals-45716865309.json', 'utf8')).slice(0, NDEALS);
  const S = states(T.base.tree, deals);
  console.log(`states ${S.length} from ${deals.length} deals (in an encounter ${S.filter(s => s.activeRun?.encounter).length}, in a run ${S.filter(s => s.activeRun).length})`);
  let total = 0;
  let differ = 0;
  for (const c of CASES) {
    const per = { n: 0, same: 0, answered: 0, bypassOff: 0, errors: 0, diffs: [] as string[] };
    const answers = new Set<string>();
    for (const [k, s0] of S.entries()) {
      const b = c.build(s0);
      for (const step of c.steps)
        for (const opts of c.kind === 'effect_choice' ? b.options! : b.candidates!)
          for (const data of b.data ?? [undefined])
            for (const side of ['runner', 'corp'] as const)
              for (const bypass of [true, false])
                for (const synergy of [false, true]) {
                  const s = structuredClone(s0);
                  const source = { cardCode: c.code, instanceId: `b3-${c.code}`, step, ...(data && { data }) };
                  const prompt = c.kind === 'effect_choice' ? { id: 'b3', side, message: '', kind: c.kind, options: opts.map(id => ({ id, label: id })), source } : { id: 'b3', side, message: '', kind: c.kind, candidateIds: opts, min: 0, max: 1, source };
                  s.pendingPrompts = [prompt as any];
                  const old = answer(T.base, s, side, bypass, synergy);
                  const now = answer(T.branch, s, side, bypass, synergy);
                  per.n++;
                  if (!bypass) per.bypassOff++;
                  if (old.startsWith('error')) per.errors++;
                  answers.add(old);
                  if (old === now) per.same++;
                  else if (per.diffs.length < 5) per.diffs.push(`state ${k} T${s0.turnNumber} step ${step} side ${side} bypass ${bypass} synergy ${synergy}: old ${old.slice(0, 120)} | new ${now.slice(0, 120)}`);
                }
    }
    per.answered = answers.size;
    total += per.n;
    differ += per.n - per.same;
    console.log(`${c.code} ${c.name}: built ${per.n} (plan.bypass off ${per.bypassOff}), equal ${per.same}, differ ${per.n - per.same}, errors (both) ${per.errors}, distinct answers ${per.answered}`);
    for (const d of per.diffs) console.log(`    ${d}`);
  }
  console.log(`\ntotal built ${total}, differ ${differ}`);
  if (differ) process.exitCode = 1;
}
main();
