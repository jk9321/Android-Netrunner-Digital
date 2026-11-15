import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sideOff, tuning } from '../src/ai/synergy';

/**
 * Guards from the AI code audit (2026-11-05, thread "Audit AI code for overlaps and conflicts", cleanup item 1).
 * Both lists below may only shrink: a new entry means new card data or a new dead switch, which the audit is
 * there to stop.
 */

/**
 * The shared value files price kinds of things, not cards: a card's own worth goes in its entry in
 * src/ai/cards/ (the Nov 3 refactor). These are the card codes still named in them, each waiting for a home.
 */
const VALUE_FILES = ['valueModel', 'evaluate', 'effectValues', 'counterValues', 'handValues', 'iceValues'];
const CODES_IN_VALUE_FILES: Record<string, string> = {
  'evaluate:35028': 'Madani: to its card entry',
  'evaluate:30053': 'Spin Doctor (spent): to its card entry',
  'evaluate:36009': 'Vic: an identity, fine for now',
  'effectValues:35076': 'Syailendra: a placed-counter field in CardAI',
  'effectValues:30045': 'Urtica Cipher: a placed-counter field in CardAI',
  'effectValues:35061': 'Idiosyncresis: a placed-counter field in CardAI',
  'effectValues:30061': 'Clearinghouse: a placed-counter field in CardAI',
  'counterValues:30033': 'Smartware Distributor: the step-1 rate when counterEffects is off (tested)',
  'counterValues:30007': 'Fermenter: the step-1 rate when counterEffects is off (tested)',
};

/** Plan switches that are off, each with why it stays in the code. */
const OFF_SWITCHES: Record<string, string> = {
  rigEffects: 'experiment, off until a batch says so',
  icePosition: "Jeff's ice-at-its-position model (Scatter Field); lost its batch, kept with its test for re-testing",
  'clickByPlay.corp': 'Corp side lost its batch; kept for re-testing',
  runCreditsSlide: 'breaks castWhileAble; retest once Runner income has one slide helper (cleanup item 4)',
  'handByCard.corp': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  'handByCard.runner': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  rdTurnsLeft: 'missed its paired batch (2026-11-07: decked 186 vs 173); the honest clock, kept for when urgency is priced by points',
  // Tuning pass 1 (2026-11-08, review-1 R4): measured reasons, paired vs base run 42403086049
  replyContenders: 'install-worth probe P2: extra reply samples for the top two; -0.6 ± 2.2 (run 42498949422) for +19% time',
  oneAgendaGuess: 'Runner-view consistency (runs.ts remoteAgendaOdds in corpBoardValue); -0.6 ± 0.7 alone (run 42403914400); carried broke +1.3 ± 1.0 alone and the set\'s +4.0 ± 2.0 (run 42463624862); +7% time; on when a human hole needs it',
  hqHeld: 'tuning pass 1: carried the decking bundle\'s broke +5.7 ± 2.4 (run 42403919890, with unseenOdds); not re-tried apart',
  unseenOdds: 'tuning pass 1: carried the decking bundle\'s broke +5.7 ± 2.4 (run 42403919890, with hqHeld); not re-tried apart',
  // Tuning pass round 2 (spec-round2.md): oracles measure headroom; they can never ship on
  'oracle.grip': 'measurement oracle, never a default',
  'oracle.safestRemote': 'measurement oracle, never a default',
  'oracle.rd': 'measurement oracle, never a default',
  'oracle.think': 'measurement oracle (decision-quality ceiling), never a default',
  'oracle.gripThreat': 'measurement oracle (Phase 2 K0: grip in the threat and search deals only), never a default',
  threatKeyPricing: 'Phase 2 K4b: threat key without the pricing context; moved 4 of 221 deals (run 42537621348)',
  'oracle.gripReply': 'measurement oracle (Phase 2 K0: grip in the Runner reply only), never a default',
};

/**
 * Module-level `let` in src/ai (review item 6): what a position is worth reads the pricing context (pricing.ts), not
 * flags flipped around calls. These are the ones left, each with why it is not pricing state. May only shrink.
 */
const MODULE_LETS: Record<string, string> = {
  'pricing:version': 'the context itself: bumped on every change so pricingKey is rebuilt only then',
  'pricing:basePlan': "the context itself: the outermost decision's base plan, which nested asSide builds on",
  'pricing:keyVersion': 'the context itself: the version pricingKey was last built at',
  'pricing:key': 'the context itself: the last pricingKey',
  'worker:agent': 'the web worker holds its one agent',
  'synergyTags:SYNERGY': 'the card tag table, filled once from src/ai/cards at load',
  'synergy:debug': 'a debug print switch',
  'evaluate:AGENDA_CLICK': 'a measured rate a script sets (setAgendaClick), not per call',
  'threatModel:planSig': "a cache of the plan's JSON for the threat key, rebuilt when the plan changes",
  'valueModel:deckCard': 'the deck-average hook handValues registers once (an import cycle otherwise)',
  'valueModel:nextStateId': "guardLoop's id counter for positions",
};

/**
 * Exported mutable module objects that are on-hit audits (a script switches one on and reads its counts; off in play):
 * the module-let guard above sees `let` only (audit SB-AUDIT-FLAG). May only shrink.
 */
const AUDIT_FLAGS = ['corp/rezMoney:rezMoneyAudit', 'effectValues:threatsAudit', 'handValues:clickAudit', 'handValues:drawAudit', 'threatModel:threatAudit'];

describe('AI code health (audit guards)', () => {
  it('keeps the on-hit audit objects to this list, each off by default', () => {
    const dir = new URL('../src/ai/', import.meta.url);
    const found = (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts')).flatMap(file =>
      [...readFileSync(new URL(file, dir), 'utf8').matchAll(/^export const (\w+Audit) = \{ on: (\w+)/gm)].map(m => ({ key: `${file.replace(/\\/g, '/').replace(/\.ts$/, '')}:${m[1]}`, on: m[2] })),
    );
    expect(found.map(x => x.key).sort()).toEqual([...AUDIT_FLAGS].sort());
    expect(found.filter(x => x.on !== 'false')).toEqual([]);
  });

  it('keeps pricing state in the pricing context: no new module-level let in src/ai', () => {
    const dir = new URL('../src/ai/', import.meta.url);
    const found = (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts')).flatMap(file =>
      [...readFileSync(new URL(file, dir), 'utf8').matchAll(/^(?:export )?let (\w+)/gm)].map(m => `${file.replace(/\.ts$/, '')}:${m[1]}`),
    );
    expect(found.filter(key => !(key in MODULE_LETS)), 'a flag that changes what a position is worth goes in pricing.ts (withPricing)').toEqual([]);
    expect(Object.keys(MODULE_LETS).filter(key => !found.includes(key))).toEqual([]);
  });

  it('reads the diagnostics sink only through its write helpers (audit Step 3 group B: no decision reads it)', () => {
    const dir = new URL('../src/ai/', import.meta.url);
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts'));
    const text = (file: string) => readFileSync(new URL(file, dir), 'utf8');
    // The context field is touched in diagnostics.ts only, once in each helper (tally, clockOn, note, inReply)
    expect(files.filter(f => f !== 'diagnostics.ts' && /\.diagnostics\b/.test(text(f))), 'write through tally / note / clockOn').toEqual([]);
    expect([...text('diagnostics.ts').matchAll(/pricing\(\)\.diagnostics/g)].length).toBe(4);
    // The setup functions that hand out the sink are for scripts and tests, never imported by the AI itself
    const setup = files.filter(f => /import \{[^}]*\b(installDiagnostics|withDiagnostics|newDiagnostics)\b[^}]*\} from '\.\/diagnostics'/.test(text(f)));
    expect(setup).toEqual([]);
    const exported = [...text('diagnostics.ts').matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(m => m[1]).sort();
    expect(exported).toEqual(['Diagnostics', 'clockOn', 'inReply', 'installDiagnostics', 'newDiagnostics', 'note', 'tally', 'withDiagnostics']);
  });

  it('names no new card codes in the shared value files', () => {
    const found = VALUE_FILES.flatMap(file =>
      [...readFileSync(new URL(`../src/ai/${file}.ts`, import.meta.url), 'utf8').matchAll(/'(3\d{4})'/g)].map(m => `${file}:${m[1]}`),
    );
    const unlisted = found.filter(key => !(key in CODES_IN_VALUE_FILES));
    expect(unlisted, 'move the card logic to its entry in src/ai/cards/').toEqual([]);
    // A listed code that's gone: take it off the list
    expect(Object.keys(CODES_IN_VALUE_FILES).filter(key => !found.includes(key))).toEqual([]);
  });

  it('keeps every measurement oracle off and off for the Runner (spec-round2.md: an oracle never ships on)', () => {
    expect(Object.values(tuning.plan.oracle).every(v => v === false)).toBe(true);
    expect(sideOff.runner).toContain('oracle');
  });

  it('has no off switch without a reason', () => {
    const off = Object.entries(tuning.plan).flatMap(([name, value]) =>
      value === false ? [name] : value && typeof value === 'object' ? Object.entries(value).filter(([, v]) => v === false).map(([side]) => `${name}.${side}`) : [],
    );
    expect(off.filter(name => !(name in OFF_SWITCHES)), 'an off switch: delete its path, or give the reason here').toEqual([]);
    expect(Object.keys(OFF_SWITCHES).filter(name => !off.includes(name))).toEqual([]);
  });

  // Step 4 Stage B guards (brief-stage-b.md, spec-step4-corp-core.md P10)
  const aiFiles = () => (readdirSync(new URL('../src/ai/', import.meta.url), { recursive: true }) as string[]).filter(f => f.endsWith('.ts'));
  const aiText = (f: string) => readFileSync(new URL(`../src/ai/${f}`, import.meta.url), 'utf8');
  const lines = (f: string) => aiText(f).split('\n').length - 1;

  it('returns an install destination for an ordinary Corp install only in corp/placement.ts', () => {
    // An install action built with a server: the placement owner, the counted lines' steps (in it too), and the ranking's
    // own ice-trash variants (corpAI.ts iceTrashInstalls, ranking debt deleted by Stage C)
    const ALLOWED: Record<string, string> = { 'corpAI.ts': 'iceTrashInstalls: the ranking (Stage C)', 'runnerAI.ts': 'Runner installs have no server' };
    // A destination written any way: a property (`targetServerId: x`), a shorthand (`{ ...pick, targetServerId }`) or an
    // assignment (`a.targetServerId = x`); a type's optional field (`targetServerId?:`) is not a write (audit SB-PLACEMENT-GUARD-WEAK)
    const writes = /\b(targetServerId|asNewRemote)\s*:(?!\s*(string|boolean)\b)|[{,]\s*(targetServerId|asNewRemote)\s*[,}]|\.(targetServerId|asNewRemote)\s*=(?!=)/;
    const found = aiFiles().filter(f => f.replace(/\\/g, '/') !== 'corp/placement.ts' && writes.test(aiText(f)));
    expect(found.filter(f => !(f in ALLOWED))).toEqual([]);
  });

  // Stage B review R8: the value-import graph of src/ai (type-only imports left out: they vanish at run time)
  const importGraph = () => {
    const files = aiFiles().map(f => f.replace(/\\/g, '/'));
    const graph: Record<string, string[]> = {};
    for (const f of files) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
      graph[f] = [...aiText(f).matchAll(/^(?:import|export)\s+(?!type\b)[^'"]*?from\s+'(\.[^']+)'/gm)]
        .map(m => new URL(m[1], `file:///${dir}`).pathname.slice(1))
        .flatMap(p => [`${p}.ts`, `${p}/index.ts`].filter(c => c in Object.fromEntries(files.map(x => [x, 1]))).slice(0, 1));
    }
    return graph;
  };
  /** The strongly connected components with more than one module (Tarjan). */
  const cycles = (graph: Record<string, string[]>): string[][] => {
    let n = 0;
    const index: Record<string, number> = {}, low: Record<string, number> = {}, stack: string[] = [], on = new Set<string>(), out: string[][] = [];
    const visit = (v: string) => {
      index[v] = low[v] = n++;
      stack.push(v);
      on.add(v);
      for (const w of graph[v]) {
        if (!(w in index)) {
          visit(w);
          low[v] = Math.min(low[v], low[w]);
        } else if (on.has(w)) low[v] = Math.min(low[v], index[w]);
      }
      if (low[v] !== index[v]) return;
      const c: string[] = [];
      for (let w = ''; w !== v; ) {
        w = stack.pop()!;
        on.delete(w);
        c.push(w);
      }
      if (c.length > 1) out.push(c);
    };
    for (const v of Object.keys(graph)) if (!(v in index)) visit(v);
    return out;
  };

  it('keeps corp/ out of every import cycle, and the largest cycle in src/ai at or under 16 modules (29 before R8)', () => {
    const found = cycles(importGraph());
    expect(found.filter(c => c.some(f => f.startsWith('corp/'))), 'corp/ reads the valuation layer; the layer reads corp/ only through corpPorts.ts').toEqual([]);
    expect(Math.max(...found.map(c => c.length))).toBeLessThanOrEqual(16);
  });

  it('imports corp/ from outside it only in these files', () => {
    const ALLOWED: Record<string, string> = {
      'corpAI.ts': 'the Corp agent, and the one corpPorts registration',
      'search.ts': 'the Hard Corp agent (corpDecide)',
      'index.ts': 'the AI entry',
      'incomeLine.ts': "the counted lines' knownIncome (corp/lines.ts), which incomeLine prices a line with",
      'rezModel.ts': 'the Corp agenda pool (corp/pools.ts) inside the priced rez',
    };
    const graph = importGraph();
    const found = Object.keys(graph).filter(f => !f.startsWith('corp/') && graph[f].some(d => d.startsWith('corp/')));
    expect(found.filter(f => !(f in ALLOWED)), 'read a Corp owner through corpPorts.ts').toEqual([]);
  });

  it('keeps the Corp ports to exactly these four (corpPorts.ts; freeInstallTarget goes with Stage D3)', async () => {
    const { corpPorts } = await import('../src/ai/corpPorts');
    expect(Object.keys(corpPorts).sort()).toEqual(['freeInstallTarget', 'holdingRezIds', 'keep', 'perfectRecallTarget']);
    expect(aiFiles().filter(f => /\bregisterCorpPorts\(/.test(aiText(f)) && !f.endsWith('corpPorts.ts'))).toEqual(['corpAI.ts']);
  });

  it("keeps the hold owner's readers to this list (corp/hold.ts serverHold)", () => {
    const readers = aiFiles().filter(f => f.replace(/\\/g, '/') !== 'corp/hold.ts' && /\bserverHold\b/.test(aiText(f))).map(f => f.replace(/\\/g, '/')).sort();
    expect(readers).toEqual(['corp/lines.ts', 'corp/placement.ts', 'corp/rez.ts', 'corp/rezMoney.ts']);
  });

  // src/ai's total may only go down. Stage B ends at 13,938: beta at 545f146 is 13,851 (the Runner draws branch added 52
  // to the Stage A tree's 13,799), Stage B adds 77 (corp/core.ts's pipeline and the B5 time fix; AI Coordinator
  // 2026-11-14 21:05Z) and review R8 adds 10 (board.ts and corpPorts.ts, the seam that takes corp/ out of the cycle).
  // Stage C repays this when the ranking is deleted; target after C is below 13,799.
  // Raised to 14,173 by ai-runner-fixes for the Runner audit's new owners (icePrice's credits/value split, breachRest, the
  // steal-damage owner, damageWorth's draw-back, the whole-ice damage count), named in review-runner-fixes.md as a recorded debt (AI Coordinator
  // 2026-11-15 01:29Z). Stage C's target after its deletions is unchanged (below 13,799) and this guard goes back down then
  it('keeps src/ai/corp under 1,900 lines and src/ai at or under the Stage B total plus the Runner fixes (14,173)', () => {
    const corp = aiFiles().filter(f => f.replace(/\\/g, '/').startsWith('corp/')).reduce((n, f) => n + lines(f), 0);
    expect(corp).toBeLessThan(1900);
    expect(aiFiles().reduce((n, f) => n + lines(f), 0)).toBeLessThanOrEqual(14173);
  });
});
