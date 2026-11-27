// B4b g3 fruitless-runs trace (b4c/b4b-g3-fruitless-trace.md): TREE=<worktree> SEED=<s> CORP=<name> RUNNER=<name> npx vite-node scripts/runner-rework/b4c/runlog.ts (run from that worktree; B4B = a worktree of 952acd6)
/* eslint-disable @typescript-eslint/no-explicit-any */
// Plays one deal on the tree at TREE and prints each Runner run: turn, target, kind of target (Runner's view, with
// B4b's runnerRootKinds from the B4b tree), success, and whether the Runner's turn gained anything.
const TREE = process.env.TREE!;
const B4B = process.env.B4B ?? '/tmp/claude-0/wt-952acd6';
const seed = Number(process.env.SEED);
const core = await import(`${TREE}/src/core/index.ts`);
const ai = await import(`${TREE}/src/ai/index.ts`);
const { GameRunner } = await import(`${TREE}/src/ai/playout.ts`);
const { ALL_DECKS } = await import(`${TREE}/scripts/nsg-sample-decks.ts`);
const { deckGameSetup } = await import(`${TREE}/src/data/decks.ts`);
await import(`${B4B}/src/core/index.ts`);
const kinds = (await import(`${B4B}/src/core/engine/helpers.ts`)).runnerRootKinds;
const c = ALL_DECKS.find((d: any) => d.side === 'corp' && d.name === process.env.CORP);
const r = ALL_DECKS.find((d: any) => d.side === 'runner' && d.name === process.env.RUNNER);
const gr = new GameRunner(core.createInitialGameState(deckGameSetup(seed, c, r)), { corp: ai.createAgent('corp', 'normal'), runner: ai.createAgent('runner', 'normal') });
const target = (s: any, id: string) => {
  if (!id.startsWith('remote')) return id;
  const sv = s.corp.servers[id];
  if (!sv || sv.root.length === 0) return `${id} (empty root)`;
  const open = sv.root.filter((x: any) => x.isRezzed || x.faceUp || x.runnerKnows);
  const hidden = sv.root.filter((x: any) => !(x.isRezzed || x.faceUp || x.runnerKnows));
  const up = hidden.length > 0 && hidden.every((x: any) => { const k = kinds(s, x); return k && k.kinds.length === 1 && k.kinds[0] === 'upgrade'; });
  const truth = sv.root.map((x: any) => core.getCardDefinition(x.cardCode)?.type_code).join('+');
  return `${id} (${up ? 'upgrade-only for the Runner' : hidden.length ? 'hidden may be agenda/asset' : 'all known'}; really ${truth}; ${sv.ice.length} ice)`;
};
let runStart: any = null;
for (let i = 0; i < 6000; i++) {
  const before = gr.state;
  if (!gr.step()) break;
  const a = gr.last;
  if (a?.type === 'INITIATE_RUN') runStart = { T: before.turnNumber, t: target(before, a.targetServerId), sc: before.runner.score, id: a.targetServerId };
  const s = gr.state;
  if (runStart && !s.activeRun) {
    const rec = s.runsThisTurn?.[s.runsThisTurn.length - 1];
    console.log(`T${runStart.T} run ${runStart.t}: ${rec?.successful ? 'successful' : 'not successful'}${s.runner.score > runStart.sc ? ', scored' : ''}`);
    runStart = null;
  }
}
console.log('winner', gr.state.winner, 'T', gr.state.turnNumber);
