import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sideOff, tuning } from '../src/ai/synergy';
import { ALL_CARDS, getCardScript } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { iceScript, iceSubtypes } from '../src/core/engine/ice';
import { subroutineFacts } from '../src/ai/runs';
import { lends } from '../src/ai/corp/hold';
import { newGame } from './helpers';

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
};

/** Plan switches that are off, each with why it stays in the code. */
const OFF_SWITCHES: Record<string, string> = {
  rigEffects: 'experiment, off until a batch says so',
  'clickByPlay.corp': 'Corp side lost its batch; kept for re-testing',
  runCreditsSlide: 'breaks castWhileAble; retest once Runner income has one slide helper (cleanup item 4)',
  'handByCard.corp': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  'handByCard.runner': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  rdTurnsLeft: 'missed its paired batch (2026-11-07: decked 186 vs 173); the honest clock, kept for when urgency is priced by points',
  // Tuning pass 1 (2026-11-08, review-1 R4): measured reasons, paired vs base run 42403086049
  replyContenders: 'install-worth probe P2: extra reply samples for the top two; -0.6 ± 2.2 (run 42498949422) for +19% time',
  oneAgendaGuess: 'Runner-view consistency (runs.ts remoteAgendaOdds in corpBoardValue); -0.6 ± 0.7 alone (run 42403914400); carried broke +1.3 ± 1.0 alone and the set\'s +4.0 ± 2.0 (run 42463624862); +7% time; on when a human hole needs it',
  unseenOdds: 'tuning pass 1: carried the decking bundle\'s broke +5.7 ± 2.4 (run 42403919890, with hqHeld, deleted in Step 4 Stage C7); not re-tried apart',
  // Tuning pass round 2 (spec-round2.md): oracles measure headroom; they can never ship on
  'oracle.grip': 'measurement oracle, never a default',
  'oracle.safestRemote': 'measurement oracle, never a default',
  'oracle.rd': 'measurement oracle, never a default',
  'oracle.think': 'measurement oracle (decision-quality ceiling), never a default',
  'oracle.gripThreat': 'measurement oracle (Phase 2 K0: grip in the threat and search deals only), never a default',
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
  'valueModel:deckCard': 'the deck-average hook handValues registers once (an import cycle otherwise)',
  'valueModel:agendaOdds': "the Runner's agenda-odds port evaluate.ts registers once (runs.ts remoteAgendaOdds; an import cycle otherwise, ai-honest-runner-view)",
  'valueModel:nextStateId': "guardLoop's id counter for positions",
};

/**
 * Exported mutable module objects that are on-hit audits (a script switches one on and reads its counts; off in play):
 * the module-let guard above sees `let` only (audit SB-AUDIT-FLAG). May only shrink.
 */
const AUDIT_FLAGS = ['corp/rezMoney:rezMoneyAudit', 'effectValues:threatsAudit', 'handValues:clickAudit', 'handValues:drawAudit'];

describe('AI code health (audit guards)', () => {
  // Found-list rows 20 and 34: every `name` (path:line) location in docs/ai-priced-quantities.md must hold the name. A branch that
  // moves an owner's line refreshes the location by hand (the script's --fix only moves one it can prove).
  it('keeps every location in the AI registry on a line that holds its name', () => {
    const root = new URL('..', import.meta.url);
    const run = spawnSync(process.execPath, ['scripts/value-owners/verify-registry.mjs', '--all'], { cwd: root, encoding: 'utf8' });
    expect(run.stdout).toMatch(/locations checked/);
    expect(run.stdout + run.stderr, 'stale registry locations (docs/ai-priced-quantities.md)').toMatch(/ 0 stale/);
  });

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
    // The context field is touched in diagnostics.ts only, once in each helper (tally, note, inReply; clockOn went with the threat model, ai-threat-delete)
    expect(files.filter(f => f !== 'diagnostics.ts' && /\.diagnostics\b/.test(text(f))), 'write through tally / note').toEqual([]);
    expect([...text('diagnostics.ts').matchAll(/pricing\(\)\.diagnostics/g)].length).toBe(3);
    // The setup functions that hand out the sink are for scripts and tests, never imported by the AI itself
    const setup = files.filter(f => /import \{[^}]*\b(installDiagnostics|withDiagnostics|newDiagnostics)\b[^}]*\} from '\.\/diagnostics'/.test(text(f)));
    expect(setup).toEqual([]);
    const exported = [...text('diagnostics.ts').matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(m => m[1]).sort();
    expect(exported).toEqual(['Diagnostics', 'inReply', 'installDiagnostics', 'newDiagnostics', 'note', 'tally', 'unsunk', 'withDiagnostics']);
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

  it('reads the run position in src/ai only through iceAtPosition or at a listed read that is right while the position is empty (audit 2026-11-18, AI-RUN-POSITION-EMPTY)', () => {
    // While run.positionEmpty is set (the Runner's ice left: rules 6.2.4, 8.5.10), server.ice[icePosition] is the ice just
    // outward of the empty position, already passed (6.2.6b; src/core/engine/helpers.ts iceLeavingPosition). A new read
    // goes through iceAtPosition, or comes here with why it is right then. The reasons are the audit's table (question 4)
    const REZ_WINDOW = 'a rez window only, and the engine allows no rez at an empty position (src/core/engine/actions/corp.ts, iceAtPosition)';
    const INWARD = 'slice(0, icePosition) is exactly the ice inward of the Runner, empty position or not';
    const READS: [file: string, line: string, why: string][] = [
      ['corp/rez.ts', 'if (!run || run.icePosition === null) return null;', `countedRez: ${REZ_WINDOW}`],
      ['corp/rez.ts', 'if (!run || !server || run.icePosition === null) return null;', `matchPointRez: ${REZ_WINDOW}`],
      ['corp/hold.ts', 'const pos = opts.from ?? run?.icePosition ?? null;', `runQuestion's default: every caller without \`from\` is ${REZ_WINDOW}`],
      ['corp/hold.ts', 'sv.ice[run.icePosition ?? -1]?.instanceId && isLegalAction', `runQuestion's paidAnotherWay: ${REZ_WINDOW}, and the rez's legality is asked`],
      ['corp/hold.ts', 'from = run.icePosition === null ? -1 : Math.min(run.icePosition, sv.ice.length) - 1;', 'runStands, the Movement Phase or an empty position: icePosition - 1 is the next ice inward either way'],
      ['corp/hold.ts', 'from = run.icePosition ?? -1;', "runStands' encounter: an empty position takes the Movement branch before it"],
      ['corp/hold.ts', 'from = run.icePosition ?? sv.ice.length - 1;', "runStands' approach: an empty position takes the Movement branch before it"],
      ['runnerAI.ts', "if (run.phase === 'movement' && run.icePosition !== null && server) {", `the jack-out check: a null check; creditsAhead reads ${INWARD}`],
      ['runs.ts', 'if (!run || !server || run.icePosition === null) return 0;', 'creditsAhead and iceCreditsAhead: null checks'],
      ['runs.ts', 'bioroidClicks(state, server.ice.slice(0, run.icePosition))', `creditsAhead: ${INWARD}`],
      ['runs.ts', 'const inner = server.ice.slice(0, run.icePosition);', `iceCreditsAhead: ${INWARD}`],
      ['runs.ts', 'if (!plan().bypass || !run || run.icePosition === null) return new Set();', 'bypassesAhead: a null check'],
      ['runs.ts', 'const current = state.corp.servers[run.server]?.ice[run.icePosition];', "bypassesAhead: the outward ice counts as one more encounter, the same \"to be safe\" count it makes for the ice just passed"],
      ['runs.ts', 'const pos = run.icePosition;', "runRestWorth: `i < pos` is the ice inward; `i === pos` only with the position not empty"],
      ['playout.ts', 'server.ice[run.icePosition] ? [server.ice[run.icePosition]] : []', 'rezCandidates: the legality filter after it drops the outward ice (no rez at an empty position)'],
      ['rezModel.ts', 'if (!run || run.icePosition === null) return undefined;', `modelRezParts: ${REZ_WINDOW}`],
      ['rezModel.ts', 'const pass = restOfRun(state, run.icePosition - 1, synergy);', `modelRezParts: ${REZ_WINDOW}`],
      ['rezModel.ts', 'if (runBypassed(after, rezzed)) return { pass, rez: restOfRun(after, run.icePosition - 1, synergy), stops: false };', `modelRezParts: ${REZ_WINDOW}`],
      ['rezModel.ts', 'throughIce(after, rezzed, run.icePosition, synergy)', `modelRezParts: ${REZ_WINDOW}`],
      ['rezModel.ts', 'if (!run || run.icePosition === null) return false;', `runBypassed: ${REZ_WINDOW}`],
      ['rezModel.ts', 'ice.slice(0, run.icePosition + 1), true).has(ice.instanceId);', `runBypassed: ${REZ_WINDOW}`],
    ];
    const comment = (t: string) => /^(\/\/|\*|\/\*\*)/.test(t);
    const reads = aiFiles().flatMap(f =>
      aiText(f)
        .split('\n')
        .map(l => l.trim())
        .filter(l => !comment(l) && /\bicePosition\b/.test(l.replace(/'icePosition'/g, '')) && !l.includes('iceAtPosition('))
        .map(l => ({ file: f.replace(/\\/g, '/'), line: l })),
    );
    const unlisted = reads.filter(r => READS.filter(([f, l]) => f === r.file && r.line.includes(l)).length !== 1);
    expect(unlisted, 'a read of run.icePosition with no reason listed: use iceAtPosition, or list why it is right while run.positionEmpty').toEqual([]);
    const unused = READS.filter(([f, l]) => !reads.some(r => r.file === f && r.line.includes(l)));
    expect(unused, 'a listed read that is gone: drop it from the list').toEqual([]);
  });

  it("runStands' one reading at an open subroutine choice stays sound: no self-trashing ice can lend to a borrow (AI Coordinator ruling on found row 68; read the comment at runStands in src/ai/corp/hold.ts)", () => {
    // The argument: a subroutine still ahead never lowers what the Runner needs, except trashThisIce, which takes its ice
    // out of a later borrow (Mycoweb 35053: "Resolve 1 subroutine on a rezzed sentry." / "... on another rezzed code
    // gate."). So every ice with a trashThisIce fact, printed or granted, is run through the walk's lender rule (lends) for
    // every borrow any ice makes, and none may lend
    const s = newGame(3);
    const facts = (labels: string[]) => labels.map(l => subroutineFacts(l).does);
    const ice = ALL_CARDS.filter(c => c.type_code === 'ice').map(c => createCardInstance(s, c.code));
    const labelsOf = (c: ReturnType<typeof createCardInstance>) => (iceScript(c)?.subroutines ?? []).map(sub => sub.label);
    const borrows = [...new Set(ice.flatMap(c => facts(labelsOf(c)).flat().flatMap(e => (e.kind === 'borrow' ? [e.subtype] : []))))];
    const trashes = (does: { kind: string }[][]) => does.some(d => d.some(e => e.kind === 'trashThisIce'));
    const selfTrashers = ice.filter(c => trashes(facts(labelsOf(c))));
    // Not vacuous: Vicsek trashes itself, Mycoweb borrows
    expect(selfTrashers.map(c => c.cardCode)).toContain('36042');
    expect(borrows.length).toBeGreaterThan(0);
    const lending = selfTrashers.flatMap(c => borrows.filter(b => lends(iceSubtypes(c, s), b)).map(b => `${c.cardCode} lends to a ${b} borrow`));
    expect(lending, 'a self-trashing ice can lend: read the comment at runStands (src/ai/corp/hold.ts) and read that subroutine both ways again for this case').toEqual([]);
    // A granted subroutine (Thunderbolt Armaments) goes on any ice, a lender too: none may trash its ice
    const granted = ALL_CARDS.filter(c => trashes(facts((getCardScript(c.code)?.grantedSubroutines ?? []).map(sub => sub.label)))).map(c => c.code);
    expect(granted, 'a granted subroutine trashes its ice: read the comment at runStands (src/ai/corp/hold.ts)').toEqual([]);
  });

  it('returns an install destination for an ordinary Corp install only in corp/placement.ts', () => {
    // An install action built with a server: the placement owner, the counted lines' steps (in it too). The ranking's own
    // ice-trash variants (corpAI.ts iceTrashInstalls) went with it in Stage C7
    const ALLOWED: Record<string, string> = {
      'runnerAI.ts': 'Runner installs have no server',
      'corp/candidates.ts': "freeInstallOrder (Stage C1b): an install prompt's options written as installs, one per option; place chooses among them",
    };
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

  // Four to six with ai-run-answers (Stage D item 1 follow-up 3, ruling 9.1): prompts.ts's run term reads the hold
  // owner's run stand (its walk key with it, not a third port) and the let-in loss, runLoss, and may not import corp/
  it('keeps the Corp ports to exactly these six (corpPorts.ts; freeInstallTarget goes with Stage D3)', async () => {
    const { corpPorts } = await import('../src/ai/corpPorts');
    expect(Object.keys(corpPorts).sort()).toEqual(['freeInstallTarget', 'holdingRezIds', 'keep', 'perfectRecallTarget', 'runLoss', 'runStands']);
    expect(aiFiles().filter(f => /\bregisterCorpPorts\(/.test(aiText(f)) && !f.endsWith('corpPorts.ts'))).toEqual(['corpAI.ts']);
  });

  // Step 4 Stage C4 (brief-stage-c.md): the card-specific rules live in corp/cardRules.ts; its exports may only shrink
  it('keeps the card rules of corp/cardRules.ts to this list (shrink only)', () => {
    const names = [...aiText('corp/cardRules.ts').matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]).sort();
    // Stage C7: bangunBait, myoshuSaving and untaianAdvance had only the ranking as their reader and went with it
    expect(names).toEqual(['advancesAsIce', 'iceAdvanceValue', 'isPettyCash', 'overAdvance', 'trapAdvanceCap']);
  });

  it("keeps the hold owner's readers to this list (corp/hold.ts serverHold)", () => {
    const readers = aiFiles().filter(f => f.replace(/\\/g, '/') !== 'corp/hold.ts' && /\bserverHold\b/.test(aiText(f))).map(f => f.replace(/\\/g, '/')).sort();
    expect(readers).toEqual(['corp/candidates.ts', 'corp/lines.ts', 'corp/placement.ts', 'corp/rez.ts', 'corp/rezMoney.ts']);
  });

  // Valuation V-A (brief-stage-va-owners.md rev 2, ruling 8; audit VAL-DEAD): every export of the eight valuation files
  // has a reader in src. A reader is a use in a src file outside the export's own statement; in another file only where
  // that file imports the name (a same-named local is not a reader); a re-export or a test is not a reader. The exports
  // with no reader are listed here, each with why it stays, for V-B and Jeff; the list may only shrink.
  const DEAD_VALUATION_EXPORTS: Record<string, string> = {
    'valueModel:clearBuildTargets': 'test and script cache reset (scripts/cache-bisect.ts)',
    'handValues:clearHandCaches': 'test and script cache reset',
    'effectValues:clearDamageThreats': 'test and script cache reset',
    'iceValues:clearDeckShares': 'test and script cache reset',
    'evaluate:AGENDA_RUN': 'scripts only (a measured rate, logged)',
    'evaluate:setAgendaClick': 'scripts only (scripts/human-agreement.ts sweeps AGENDA_CLICK)',
  };
  it('has a src reader for every valuation export but the listed ones (V-A; shrink only)', () => {
    const VALUATION = ['valueModel', 'handValues', 'effectValues', 'evaluate', 'cardValues', 'cardProfiles', 'counterValues', 'iceValues'];
    const src = (readdirSync(new URL('../src/', import.meta.url), { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f)).map(f => f.replace(/\\/g, '/'));
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    const raw: Record<string, string> = Object.fromEntries(src.map(f => [f, readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')]));
    const code: Record<string, string[]> = Object.fromEntries(src.map(f => [f, strip(raw[f]).split('\n')]));
    const imports = (f: string, name: string) => [...raw[f].matchAll(/^import\s+(?!type\b)\{([^}]*)\}/gm)].some(m => new RegExp(`\\b${name}\\b`).test(m[1]));
    // V-B B1 (recount VA-DEAD-GUARD-REEXPORTS): a reader must be loaded by the app. The src modules reachable from the
    // entry points (src/main.tsx and the server's imports of src), following relative imports and re-exports
    const resolveFrom = (from: string, spec: string) => {
      const base = new URL(spec, `file:///src/${from}`).pathname.replace(/^\/src\//, '');
      return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find(f => f in raw);
    };
    const reachable = new Set<string>();
    const visit = (f: string | undefined) => {
      if (!f || reachable.has(f)) return;
      reachable.add(f);
      for (const m of raw[f].matchAll(/^(?:import|export)\b[^'"]*?from\s+['"](\.[^'"]+)['"]|^import\s+['"](\.[^'"]+)['"]/gm)) visit(resolveFrom(f, m[1] ?? m[2]));
    };
    visit('main.tsx');
    for (const dir of ['../server/', '../worker/']) {
      let files: string[];
      try {
        files = (readdirSync(new URL(dir, import.meta.url), { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f));
      } catch {
        continue;
      }
      for (const f of files) for (const m of readFileSync(new URL(`${dir}${f}`, import.meta.url), 'utf8').matchAll(/from\s+['"](?:\.\.\/)+src\/([^'"]+)['"]/g)) visit(resolveFrom('x', `./${m[1]}`));
    }
    const dead: string[] = [];
    for (const v of VALUATION) {
      const file = `ai/${v}.ts`;
      const lines = code[file];
      lines.forEach((line, i) => {
        const m = /^export (?:function|const|let) (\w+)/.exec(line);
        if (!m) return;
        // The export's own statement: to the next line that starts a top-level statement
        let end = i + 1;
        while (end < lines.length && !/^[^\s})\]]/.test(lines[end])) end++;
        const name = m[1];
        const re = new RegExp(`\\b${name}\\b`);
        const use = (l: string) => re.test(l) && !/^\s*(import\b|export \{|export \*)/.test(l) && !/^\s*\w+,?\s*$/.test(l);
        const read = src.some(f => reachable.has(f) && (f === file ? lines.some((l, j) => (j < i || j >= end) && use(l)) : imports(f, name) && code[f].some(use)));
        if (!read) dead.push(`${v}:${name}`);
      });
      // re-exports (`export { NAME } from './x'`): read only where a loaded src file imports NAME from this file
      for (const m of raw[file].matchAll(/^export\s+\{([^}]*)\}\s+from/gm))
        for (const name of m[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
          const fromHere = (f: string) => [...raw[f].matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)].some(i => resolveFrom(f, i[2]) === file && new RegExp(`\\b${name}\\b`).test(i[1]));
          if (!src.some(f => f !== file && reachable.has(f) && fromHere(f))) dead.push(`${v}:${name}`);
        }
    }
    expect(dead.filter(k => !(k in DEAD_VALUATION_EXPORTS)), 'a valuation export with no reader in src: delete it, or list it here with why').toEqual([]);
    expect(Object.keys(DEAD_VALUATION_EXPORTS).filter(k => !dead.includes(k)), 'it has a reader now: take it off the list').toEqual([]);
  });

  // src/ai's total may only go down. Stage B ends at 13,938: beta at 545f146 is 13,851 (the Runner draws branch added 52
  // to the Stage A tree's 13,799), Stage B adds 77 (corp/core.ts's pipeline and the B5 time fix; AI Coordinator
  // 2026-11-14 21:05Z) and review R8 adds 10 (board.ts and corpPorts.ts, the seam that takes corp/ out of the cycle).
  // Stage C repays this when the ranking is deleted; target after C is below 13,799 on the Corp side.
  // Raised to 14,189 by ai-runner-fixes for the Runner audit's new owners (icePrice's credits/value split, breachRest, the
  // steal-damage owner, damageWorth's draw-back, the whole-ice damage count, tankDamage: the one lethal-tank test the encounter also reads, +16), named in review-runner-fixes.md as a recorded debt (AI Coordinator
  // 2026-11-15 01:29Z). Stage C's target after its deletions is unchanged (below 13,799) and this guard goes back down then.
  // ai-runner-unknowns adds 141 (trapHit/accessDamage, unrezzedDamageRisk, runPrices, drawBackClicks, the rules text in
  // subroutineDamage, the damageThreat key): pending the AI Coordinator's yes in its review
  // ai-prompt-time adds 14 (prompts.ts: the Archives-shuffle family answer and its test, agendaFirst shared with Peer Review;
  // Jeff and the AI Coordinator 2026-11-15 15:20Z): approved by the AI Coordinator 2026-11-15 16:21Z (stop-1615 ruling).
  // Stage C hand-off (AI Coordinator 18:26Z): corp/ is set to the measured figure after the C7 deletions, 2,217, above the
  // brief's 2,150 and listed as a deviation with its breakdown by file; src/ai to the measured 13,824 (the Corp side
  // below 13,799 once the Runner branches' 157 and ai-prompt-time's 14 are set aside). Both down only
  // ai-corp-honest-order (brief rev 2: the guards rise only by the view function's measured lines) adds 23 to src/ai: the
  // Corp's view in turnPlanner.ts (corpDecisionView, its comment and memo, the import: +22) and its one line in corpAI.ts
  // rankMainActions (+1); corp/ is unchanged (the comment rewording holds its line count)
  // ai-honest-runner-view (brief rev 2: guards rise only by the measured lines) adds 138 to src/ai: runnerReply.ts +70
  // (the one deal of the Corp's hidden cards lifted from determinize, runnerUnknownSlots, the copy and the view; +3 of it
  // review R1, the advanced slots dealt first), search.ts -27 (determinize calls the deal), valueModel.ts +53 (corpIceMean, boardNeed's Runner branch by odds, the odds port),
  // evaluate.ts +14 (unseenCorpPool, the port's fill), turnPlanner.ts +17 (runnerDecisionView memoised, memory), runnerAI.ts
  // +8 (the baseline and runs on the view, the prompt guard), handValues.ts +3 (the deck-average key with codes)
  // ai-playout-lines (A1, brief-playout-lines.md: the guards rise only by the wiring's measured lines) adds 63 to src/ai:
  // corp/core.ts +40 (lineAsk, the Q4/Q5 sequence taken out of corpDecide, and playoutLine, the playout's Corp, with
  // their comments and its measurement hook), turnPlanner.ts +10 (the PlannerAI `line` hook and its three uses in
  // playout), diagnostics.ts +13 (the playoutLine counters, the onPlayoutLine hook and unsunk); corpAI.ts is unchanged
  // Stage C (brief-stage-c.md): corpAI.ts is the agent shell. Its size is the measured figure, down only, and it holds no
  // rule and no number: no number other than 0 and 1 outside comments, and no `score` field or scoring function.
  // ai-corp-honest-order: 109 to 110, the line that gives the order the deciding Corp's own view (rule 10.2.2a)
  it('keeps corpAI.ts a shell with no scoring function and no number', () => {
    const code = aiText('corpAI.ts')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\/\*\*|\*)/.test(l))
      .join('\n');
    // ai-honest-corp-decision +8 measured: decide hands its view to corpDecide with the snapshot, chooseRez decides on the view
    expect(lines('corpAI.ts')).toBeLessThanOrEqual(118);
    expect(code.match(/(?<![\w.])\d+(\.\d+)?(?![\w.])/g)?.filter(n => n !== '0' && n !== '1') ?? []).toEqual([]);
    expect(code).not.toMatch(/\bscore\s*:|\bscore\w*\s*\(/i);
  });

  // ai-value-time: src/ai +11 measured (the tag clock kept on the original board, evaluate.ts +7 and runs.ts +2; the lazy
  // tag input, effectValues.ts +2); src/ai/corp unchanged. With ai-playout-lines' +63 (above): 13,847 + 11 + 63 = 13,921
  // ai-honest-runner-view on top of it: +138 (above), 13,921 to 14,059
  // ai-honest-corp-decision, measured: src/ai/corp +33 (corp/core.ts: corpDecide's view, the legality check before the
  // commits, honestCorpCounts), corpAI.ts +8, turnPlanner.ts +85 (corpDecisionView's mark, promptNamedIds,
  // promptCardsInPlace, keepNamed): 2,257 + 33 = 2,290 and 14,059 + 126 = 14,185
  // ai-value-owners (valuation V-A, brief rev 2: rises only by the measured lines) adds 37: the disagreement log's one
  // writer, valueModel.ts logValue (+23), the owner doc comments and the hooks that hand each owner's or copy's value to it
  // unchanged (+14 over the eight valuation files and diagnostics.ts' onValue field). V-B takes the hooks back when the
  // copies are gone; logValue stays while the log is the registry's evidence. 14,185 + 37 = 14,222; ai-corp-rd-memory + 36 (the Corp's known R&D slots and the Runner's memory on its deal, runnerReply.ts) = 14,258;
  // V-B B1 - 1 (handValues; review M1) = 14,257; V-B B2 - 7 (econValue's price deleted, the type test isEconAsset) = 14,250;
  // ai-hold-reentry + 13 (the countingHold guard: pricing.ts + 4, iceValues.ts + 1, hold.ts + 7; its second commit, the rez
  // worked out before the set is priced, hold.ts + 1; corp/ + 8) = 14,263 and corp/ 2,298;
  // V-B B3 + 4 (assetRisk, the owner's risk as one export; the formula context's risk and its doc line; corpEffect works it out); B3 paidOut + 1 (its import of the owner; inIcedServer moved, not added): + 5 = 14,268 (accepted by the AI Coordinator)
  // ai-tag-loss-time arm 0 + 7 (evaluate.ts tagLoss: the three exact skips' comment and if-block, the rule cited) = 14,275;
  // V-B B6 - 38 (Jeff's dead list, part A without centralExposure: creditValue and its two rates, FLATLINE, topDownWorth, shownIceShare, three re-exports) = 14,237; B6 - 12 (dead list part B: six unread RATES fields, PAYOUT_RISK.corpIced, the drawnCardOff branch, Smartware's and Fermenter's default branches with their two rates) = 14,225
  // ai-threat-delete - 580 (commit 1 - 555, the Corp's threat model and every src path only it read; commit 2 - 29, the run
  // record: plan.runRecord, its pricing field and key part, corpAI noteRuns; commit 3 + 4, Jeff's open-remote rule for a new
  // bare remote kept under plan.openSteal) = 13,645;
  // ai-breaker-guard-key - 2 (the depth guard as a pricing field in the key: handValues.ts - 6, its Set's add, try and
  // delete gone; pricing.ts + 4, the key segment and deckPricingKey) = 13,643
  // ai-tag-loss-bp + 13 (evaluate.ts + 8: addRigCard's header, doc and return, the clock's own-term-plus-plans lines and their
  // comment; cardPlans.ts + 5: the shared card list boardPlanCards and the predicate hasBoardPlan) = 13,656
  // V-B B6 rest - 39 (centralExposure and its imports - 46; the card-coded conditions into their entries + 8 with the four
  // CardAI fields' doc lines; Spin Doctor's spent worth into its entry - 3; counterWorthOf's default + 1; item 17 + 1) = 13,617
  // V-B B6 review M1 + 6 (Spin Doctor's spent worth prices Archives as the viewer knows it: the Corp's own cards by what
  // they are, a look-ahead discard by the odds; two imports) = 13,623 (up to + 6 allowed by the AI Coordinator)
  // M1 (a) + 2 (the Corp's option at one turn's assetRisk where the card sits, the Runner's line kept) = 13,625 (up to 13,627 allowed)
  // M1b + 3 (the cards the Corp cannot know are the decision root's R&D, not those outside the hand it noted) = 13,628 (up to 13,629 allowed)
  // Stage D item 1 branch 1 (ai-hold-facts) + 281: runs.ts + 218 (subroutineFacts, the literal facts of every pool
  // subroutine for the hold walk, ~150; each price rule's `blocks` condition and subroutineBlocks, ~40; breakPlans with
  // PlanSpends, ~25), cards/types.ts + 37 (HoldFacts), the card entries + 26 (holdFacts of 11 cards) = 13,909 (13,895 measured on beta ebc21b8)
  // Stage D item 1 branch 2 (ai-hold-walk) + 937 over ebc21b8: corp/hold.ts + 888 (the hold count as a walk through the
  // Runner's turn, brief rev 2 section 5: the gathered board and its plans, the click-by-click search, the run sequence and
  // the 'thisRun' walk, the pure per-decision answer cache; the old count, its five switches' off paths and their helpers
  // deleted), corp/rezMoney.ts + 13 (keepFor reads the run sequence), runs.ts + 8 (Thunderbolt's trash-unless fact, the
  // subroutineBlocks reader), synergy.ts + 3 (the five folded names), cards/types.ts + 13 and liberation.ts + 12 (Lycian's
  // subtype choice at rez, HoldFacts doc): corp/ 2,298 + 901 = 3,199, src/ai 13,895 + 937 = 14,832
  // Then + 168 (the 14:39Z ruling on keepFor's wide-board time): corp/hold.ts + 165 (the run sequence gathered once,
  // reachQuestion and reachOrder, and its per-decision cache of sets and orders, reachSets; a server's walked ice once
  // per board), corp/rezMoney.ts + 3: corp/ 3,367, src/ai 15,000 (3,364 and 14,997 measured on beta 85c2955)
  // Stage D item 1 follow-up 1 (ai-hold-retry), corp/hold.ts over 85c2955: review R2 + 4 (WalkStart.runnerTurn, its doc
  // line and the encounter read on 'thisRun' only); the failed run + 111 (comments + 75: the walk's file comment on what
  // a failed run leaves and what it does not count, the cut's list of what moves a retry, the Hold doc lines for rev 2;
  // code + 36: the gate `passes`, the memos by kind `WalkMemos`, the self-trashed ice `trashed`, the retry off by
  // default): corp/ 3,479, src/ai 15,112. R3 0, R4 corp/ - 2 (Botulus a fact, Audrey's flag read from its plans), src/ai 0.
  // The liability rez (design answer of 16:29Z, 2) + 25: corp/hold.ts + 17 (the walk's `liability` with its doc, the
  // walk state's `bp` and the fund it fills, the Corp's choice), cards/types.ts + 6 and liberation.ts + 2 (the fact on
  // Valentão and Piranhas): corp/ 3,494, src/ai 15,137. Then + 15 measured from beta dae0bb8 (ai-flood-bound: the
  // placesCounters fact on the card entry, its accessor, and places() reading it, with the soundness comment; its guard
  // counts + 12 over a cap with 3 lines spare): src/ai 15,152
  // Then + 128 over beta dae0bb8 (ai-winnow-reach: win-now's kill side canStillKill and its soundness comment, the
  // hidden-grip check, usableSources shared, the install into an empty iced remote and places()' re-derived bound, the
  // own-turn damage facts of Neurospike, Mindscaping and Phật Gioan Baotixita, damageThreat's key on the facts that read
  // the board): src/ai 15,280
  // Then + 23 (ai-hold-stealth: found-list row 31, corp/hold.ts runCredits splitting the run-time credits into
  // stealth and the rest with its comment, pay's stealth spend in the engine's fixed order (spendCredits),
  // duringRuns and the 'thisRun' hosted sum deleted, + 17; owner hygiene, audit AI-HOLD-OWNER-HYGIENE, comments and
  // turnIce's key with its start's kind, + 6): corp/ 3,517, src/ai 15,303
  // Then + 89 (ai-rez-keep, Stage D item 3, exploit F1: hold.ts's 'restOfTurn' start, TurnFrom, nextTurn, restOfTurn,
  // afterRun and the start threaded through runnerEarnings, walkStart, turnInput, runTarget, turnQuestion and
  // reachQuestion, + 50; rezMoney's restOfTurn keep with except, + 19; countedRez's toll pass and spendsKept, + 21; with
  // their comments): corp/ 3,606, src/ai 15,392. Then + 5 (ai-rez-keep review R1, R3, R4: spendsKept's second world and
  // its comment + 6, afterRun on memo - 3, runnerBudget one expression - 1, its comment + 3): corp/ 3,611, src/ai 15,397
  // Then + 176 in corp/ (ai-runner-money, Stage D item 1 follow-up 4, part 1: hold.ts's four readers with their
  // comments: counterCredits in runnerEarnings and 'thisRun''s budget; RunBegin, runBegins, Walk.runBegins and the runs
  // key for Side Hustle and Knickknack; turnEndDerezPicks, the pick through walkStart and turnIce, walkPick, reachPick,
  // reachPickQuestion and reachSetsOf for Lightning Laboratory) and + 31 elsewhere (the four facts' types and entries):
  // corp/ 3,787, src/ai 15,604
  // Then + 335 (ai-run-answers, Stage D item 1 follow-up 3, row 13: hold.ts's run stand, 'thisRun' split into its
  // question and its search, the stand from inside an encounter (resolving: no more breaking, a half-resolved subroutine
  // read both ways), the Movement Phase and an approach, an ice trashed under the run, a run over short of the server, a
  // Runner prompt the walk cannot read, a granted subroutine's prompt as the ice's own, its per-decision answers, with
  // comments, + 151; prompts.ts's run term, the priced pick before the per-card blocks, Shred's reveal as chance on HQ's
  // subsets, the settle as the Corp's choice (ruling 10) with its depth cap (ruling 11.1) and its "not known" past it
  // (ruling 12), its counts, with comments, + 175; the two ports and their registration + 9): corp/ 3,938, src/ai 15,939
  // Then + 10 (ai-hold-audit-fixes, audit 2026-11-18: hold.ts + 9, the locked pool's reason at 'thisRun''s budget, the
  // empty position's at runStands, the one-reading argument and the line that would make it false (ruling on found row
  // 68 b) in place of the two readings, and `lends`, the lender rule the tripwire reads; runs.ts + 1, runRestWorth's
  // empty position): corp/ 3,947, src/ai 15,949
  // Then + 21 in corp/ (ai-rez-set, Stage D rez-follow: rez.ts + 15, countedRez's R2 on rezStops with the set further in,
  // the free gate's countNeeds with its strict test and comments; hold.ts + 6, Saci's rezPays on the walk's ice and its
  // reader where the walk rezzes a set's ice) and + 7 elsewhere (the hostRezPays fact's type and Saci's entry):
  // corp/ 3,968, src/ai 15,977
  // Then + 2 in corp/ (ai-hold-inputs fix 1, the review's AI-HOLD-KNICKKNACK-MOVED: Knickknack's gain sets `moved` in
  // Walk.runBegins, with its comment):
  // corp/ 3,970, src/ai 15,979
  // Then + 15 (ai-hold-inputs fix 2, AI-HOLD-AUDREY-EMPTY-GRIP: runs.ts + 11, breakPlans' view input PlanView with
  // its comment, Audrey v2's discards bounded by it; hold.ts + 4, planFor passes the grip's and the stack's sizes):
  // corp/ 3,974, src/ai 15,994
  // Then + 11 in corp/ (ai-hold-inputs fix 3, AI-HOLD-BOOST-LEAK: hold.ts, outsideEncounter, walkBoard's plans of the
  // ice other than the encountered one and runQuestion's bypass ranking without the encounter, with comments):
  // corp/ 3,985, src/ai 16,005
  it('keeps src/ai/corp at or under 3,985 lines and src/ai at or under 16,005 (Stage C hand-off, ai-corp-honest-order, ai-value-time, ai-playout-lines, ai-honest-runner-view, ai-honest-corp-decision, ai-value-owners, ai-corp-rd-memory, ai-value-b1, ai-value-b2, ai-hold-reentry, ai-value-b3, ai-tag-loss-time, ai-value-b6, ai-threat-delete, ai-breaker-guard-key, ai-tag-loss-bp, ai-hold-facts, ai-hold-walk, ai-flood-bound, ai-hold-retry, ai-winnow-reach, ai-hold-stealth, ai-rez-keep, ai-runner-money, ai-run-answers, ai-hold-audit-fixes, ai-rez-set, ai-hold-inputs)', () => {
    const corp = aiFiles().filter(f => f.replace(/\\/g, '/').startsWith('corp/')).reduce((n, f) => n + lines(f), 0);
    expect(corp).toBeLessThanOrEqual(3985);
    expect(aiFiles().reduce((n, f) => n + lines(f), 0)).toBeLessThanOrEqual(16005);
  });
});
