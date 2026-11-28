/**
 * F117 step 0 counts (item 5, bar 10): widened chains by source and depth, Runner prompts answered on the root
 * (`rootRunner`, must be 0), chains past the budget (`capped`), cards set aside at a chain's end (`aside`, by why), scored
 * answers per prompt (`used`). Counted only with `on` (tests/setup.ts and the scripts; speed pass lever A); play never reads
 * them. Their own file, not prompts.ts (which re-exports them) or diagnostics.ts (whose exports are the sink's), so the test
 * setup sets `on` without loading the AI before mocks.
 */
export const chainStats = {
  on: false,
  widened: new Map<string, number>(),
  rootRunner: 0,
  capped: new Map<string, number>(),
  aside: new Map<string, number>(),
  used: [] as number[],
};

/**
 * The run term's asks and decided ones, with ruling 10's counts: settles stopped at the depth cap (`capped`), at a Runner
 * prompt not the encountered ice's (`runnerOther`), and picks letting the Runner in (`inPick`). Counted only with `on`.
 */
export const runTermStats = { on: false, asked: 0, decided: 0, capped: 0, runnerOther: 0, inPick: 0 };
/** `runnerOther` by the prompt (its card and step, or its kind) and the run's phase, for the fire run's report (ruling 11.2). */
export const runnerOtherKinds = new Map<string, number>();
