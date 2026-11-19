/**
 * Stage D exploit F3 (bait run) count, Part B "the suite on the arm's tree": copies this checkout (src patched as the arm, by
 * bait-run-trees.ts makeTrees; tests, configs and fixtures as they are; node_modules linked) to SUITE_ROOT/<arm> and
 * runs vitest there with the JSON reporter, so the summing step can list the tests and pins whose result changes.
 *   ARMS=beta,stopOverTurn npx vite-node scripts/stage-d/bait-run-suite.ts
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Arm, makeTrees } from "./bait-run-trees";

const all = (
  process.env.ARMS ?? "beta,stopOverTurn,outOverTurn,both,outSettled"
).split(",") as Arm[];
// On the ai-script workflow (SHARD=k/64): process 4i runs arm i, one arm per runner so suites never share a runner (time-limited tests); the others exit. The JSON goes to OUT_DIR
const [k, n] = (process.env.SHARD ?? "").split("/").map(Number);
const arms = Number.isFinite(n) ? all.filter((_, i) => 4 * i === k) : all;
const root = resolve(
  process.env.OUT_DIR ??
    process.env.SUITE_ROOT ??
    "node_modules/.cache/bait-run-suite",
);
for (const arm of arms) {
  const trees = resolve("node_modules/.cache/bait-run-suite-trees", arm);
  const dirs = makeTrees(trees, [arm]);
  const dir = resolve("node_modules/.cache/bait-run-suite", arm);
  rmSync(dir, { recursive: true, force: true });
  for (const f of readdirSync(".")) {
    if (["node_modules", ".git", "src", "dist"].includes(f)) continue;
    cpSync(f, join(dir, f), { recursive: true });
  }
  cpSync(join(dirs[arm], "src"), join(dir, "src"), { recursive: true });
  if (!existsSync(join(dir, "node_modules")))
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  const outFile = join(root, `${arm}.json`);
  const t0 = Date.now();
  try {
    execSync(`npx vitest run --reporter=json --outputFile=${outFile}`, {
      cwd: dir,
      stdio: "ignore",
      timeout: 3_600_000,
    });
  } catch {
    // failing tests exit non-zero; the JSON holds them
  }
  console.log(`${arm}: ${outFile} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
