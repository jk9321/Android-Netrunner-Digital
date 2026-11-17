/**
 * Stage D item 1 (brief rev 2, 4.6): the golden table of the Runner's run prices, so a branch that adds facts beside
 * them can show that no price moved. For every ice of the four sets and every icebreaker (each alone, and none), on a
 * fixed list of boards: subroutineCost of each planned subroutine, icePrice, iceCreditNeed, and bestBreakPlan for 1 to
 * all of its subroutines. Reads only APIs present on beta 0920319, so the same code runs on the base and the branch.
 * One hash per ice (tests/fixtures/stage-d/golden-prices.json); regenerate on the base with
 *   npx vite-node scripts/stage-d/golden-prices.ts -- write
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ALL_CARDS, CardInstance, GameState, getCardScript } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { bestBreakPlan, iceCreditNeed, icePrice, plannedSubroutines, subroutineCost } from '../../src/ai/runs';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { newGame } from '../../tests/helpers';

export const GOLDEN_FILE = 'tests/fixtures/stage-d/golden-prices.json';

/** The boards: [runner credits, tags, grip, corp credits, score each, runner clicks, hq size]. */
export const BOARDS: [number, number, number, number, number, number, number][] = [
  [0, 0, 5, 5, 0, 4, 3],
  [5, 0, 5, 12, 2, 4, 5],
  [12, 2, 1, 3, 4, 1, 0],
  [8, 1, 3, 20, 5, 3, 8],
];

export const iceCodes = () => ALL_CARDS.filter(c => c.type_code === 'ice').map(c => c.code).sort();
export const breakerCodes = () => ALL_CARDS.filter(c => /icebreaker/i.test(c.keywords ?? '')).map(c => c.code).sort();

export function board(b: (typeof BOARDS)[number], iceCode: string, breaker: string | null): { s: GameState; ice: CardInstance } {
  const s = newGame(3);
  s.turnNumber = 7;
  s.corp.hq = s.corp.hq.slice(0, b[6]);
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  [s.runner.credits, s.runner.tags] = [b[0], b[1]];
  s.runner.grip = s.runner.grip.slice(0, b[2]);
  s.corp.credits = b[3];
  s.corp.score = s.runner.score = b[4];
  s.runner.clicks = b[5];
  const ice = createCardInstance(s, iceCode);
  ice.isRezzed = true;
  s.corp.servers.remote1 = { id: 'remote1', name: 'Server 1', isRemote: true, ice: [ice], root: [] };
  if (breaker) {
    const c = createCardInstance(s, breaker);
    c.isRezzed = true;
    c.tokens = { virus: 2, power: 1, credit: 2 };
    s.runner.rig.programs.push(c);
  }
  return { s, ice };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : String(x));

/** The rows of one ice, as text (one line per breaker and board). */
export function iceRows(iceCode: string): string[] {
  const rows: string[] = [];
  for (const breaker of [null, ...breakerCodes()]) {
    for (const [k, b] of BOARDS.entries()) {
      const { s, ice } = board(b, iceCode, breaker);
      const row = withPricing({ plan: { ...plan() } }, () =>
        asSide('corp', () => {
          decisionContext(s, 'corp');
          const subs = plannedSubroutines(s, ice);
          const p = icePrice(s, ice);
          const plans = subs.map((_, i) => {
            const bp = bestBreakPlan(s, ice, i + 1);
            return bp ? [bp.breaker.cardCode, round(bp.credits), round(bp.value), bp.boostsNeeded, !!bp.boostByAbility, !!bp.breakByAbility] : null;
          });
          return [subs.map(x => round(subroutineCost(s, x.label))), [round(p.credits), round(p.value), round(p.damage ?? 0)], round(iceCreditNeed(s, ice)), plans];
        }),
      );
      rows.push(`${breaker ?? '-'} ${k} ${JSON.stringify(row)}`);
    }
  }
  return rows;
}

/** One hash per ice of the pool (scripted ice only). */
export function goldenHashes(only?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of only ?? iceCodes()) {
    if (!getCardScript(code)?.ice) continue;
    out[code] = createHash('sha1').update(iceRows(code).join('\n')).digest('hex').slice(0, 16);
  }
  return out;
}

if (process.argv.includes('write')) {
  writeFileSync(GOLDEN_FILE, JSON.stringify(goldenHashes(), null, 1) + '\n');
  console.log(`wrote ${GOLDEN_FILE}`);
}
