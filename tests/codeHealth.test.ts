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
  // B1b: the pricing context is immutable frames and this one pointer (the version, key, base plan and root ids went;
  // the three F3 by-position maps are const again behind a generation key, valueModel clearStateEntries, L-26)
  'pricing:current': 'the current pricing frame: withPricing points it at a new frame and back, installTop replaces it at the top level',
  'worker:agent': 'the web worker holds its one agent',
  'synergyTags:SYNERGY': 'the card tag table, filled once from src/ai/cards at load',
  'synergy:debug': 'a debug print switch',
  'evaluate:AGENDA_CLICK': 'a measured rate a script sets (setAgendaClick), not per call',
  'valueModel:deckCard': 'the deck-average hook handValues registers once (an import cycle otherwise)',
  'valueModel:agendaOdds': "the Runner's agenda-odds port evaluate.ts registers once (runs.ts remoteAgendaOdds; an import cycle otherwise, ai-honest-runner-view)",
  'valueModel:nextStateId': "guardLoop's id counter for positions",
};

/**
 * B1b bar 3: every top-level declaration of pricing.ts, `const` included, so module state can't come back unseen. The
 * only state is `current` (the pointer); `frameChecks` is a test-only switch, `keysOf` a cache of each immutable frame's
 * keys (a frame never changes, so its keys never go stale). A new declaration goes here with its reason.
 */
const PRICING_DECLARATIONS: Record<string, string> = {
  'type Plan': 'a type',
  'interface Anchor': 'a type',
  'interface Pricing': 'a type',
  'const frameChecks': "test-only switch (tests/setup.ts): frames frozen and their Sets sealed; off in play",
  'function valueSet': 'makes a known or rezzingToUse set (sealed under frameChecks)',
  'const refuse': "frameChecks' throwing Set write",
  'function sealed': "makes a Set throw on writes (frameChecks; the top-level frame's empty set always)",
  'function checked': 'frameChecks helper: freezes a new frame',
  'let current': 'THE pointer: the one piece of module state',
  'const pricing': 'reads the pointer',
  'const plan': 'reads the pointer',
  'function framed': 'makes a frame from a patch (or returns the current one when nothing changes)',
  'function withPricing': 'the scope setter',
  'function installTop': 'the top-level setter (throws inside a scope)',
  'function asSide': 'a side scope (a frame through withPricing)',
  'function leafHandByCard': 'reads the pointer',
  'const actingSide': 'reads the pointer',
  'interface FrameKeys': 'a type',
  'const keysOf': "a cache of each frame's keys, keyed by the frame object (frames are immutable)",
  'function frameKeys': 'the key method',
  'function buildKeys': "the key method's builder",
};

/**
 * Code audit 2026-11-26 (AI-LATER-MONEY-HANDMADE-MEMO's guard): the module-level WeakMaps keyed by GameState outside
 * valueModel, each named with how a board edited in place after it was asked is caught. `stateEntries`: the F3 maps,
 * filled through valueModel stateEntries, whose tripwire freezes an asked board in the tests (askedFreeze). `freezeAsked`:
 * a map whose set calls freezeAsked, the same tripwire. The others predate F3 and are not tripwired; a new one goes on
 * this list, through stateEntries or memo, or with its reason.
 */
const STATE_CACHES: Record<string, 'stateEntries' | string> = {
  'effectValues:threats': 'stateEntries',
  'handValues:deckAverage': 'stateEntries',
  'handValues:clickCache': 'stateEntries',
  'turnPlanner:runnerViews': 'not tripwired: the guessed view per decision board, checked by its signature (sig)',
  'turnPlanner:corpViews': 'not tripwired: the guessed view per decision board, checked by its signature (sig)',
  'synergy:ownCache': "not tripwired: a side's own card profile per board (outside F3)",
  'synergy:oppCache': "not tripwired: the other side's card profile per board (outside F3)",
  'prompts:runAfters': 'not tripwired: the one-step boards the run term simulated, per answer (outside F3)',
  'prompts:rootRdIds': "not tripwired: the R&D cards the Corp knows the place of, per board (F117 D1 (ii); read from the board's rdKnownToCorp only)",
  'prompts:facesShown': "not tripwired: the cards a prompt board's active prompt shows by face (F117 D1 (i); core/view.ts's face rule, read once per prompt state)",
  'cards/systemGateway:rootRd': "not tripwired: the decision root's R&D, carried to its look-aheads (not a value)",
  'runner/prompt:shownByState': "freezeAsked: the cards the engine's view shows the Runner in its prompt, per board (B3; tripwired since B4a, brief rev 1d)",
};

/**
 * Exported mutable module objects that are on-hit audits (a script switches one on and reads its counts; off in play):
 * the module-let guard above sees `let` only (audit SB-AUDIT-FLAG). May only shrink.
 */
const AUDIT_FLAGS = ['corp/rezMoney:rezMoneyAudit', 'effectValues:threatsAudit', 'handValues:clickAudit', 'handValues:drawAudit'];

/**
 * R-A A-move (spec r-a.md Files, red team A4): every comparison with a card in runs.ts, runnerAI.ts and (R-B B2, red team
 * 2026-11-25 finding 4) every file under runner/, that is a
 * `cardCode ===`/`!==`, a use of a card-code constant (defined there or imported from runs.ts), a card code literal, or a
 * `.title` compared, keyed by its line's text, with the reason it stays (R-B's work). May only shrink: a card fact goes to
 * its entry (src/ai/cards, RunFacts), not into a new comparison.
 */
const CARD_COMPARISONS: Record<string, string> = {
  'runs.ts: return state.runner.rig.programs.filter(c => c.cardCode === code && c.hostedOnId === ice.instanceId);':
    'hostedTrojans: generic, the code its caller passes (counterValues.ts hostShare since B3b: the first copy of an idle trojan on a host)',
  'runs.ts: if (!card.isRezzed || card.cardCode !== MANEGARM) continue;': 'Manegarm (class P): approachCost, one of three toll readers with three formulas; R-B: one approach toll owner',
  "runs.ts: if (state.runner.clicks - 1 - bioroidClicks(state, server.ice) < 2) known += 5 * server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;":
    "Manegarm (class P): runShortfall's own flat 5; R-B: one approach toll owner",
  'runs.ts: const card = state.runner.grip.find(c => c.cardCode === CHAIN_REACTION);':
    "Chain Reaction: chainReactionBonus's worth is the card's own procedure (its servers are its entry's); R-B/B5: a run's bonus worth (successBonus)",
  "runnerAI.ts: if (cardCode === WINDOW_OF_OPPORTUNITY && plan().bypass && prompt?.side === 'runner' && !state.activeRun) {":
    'Window of Opportunity (class P): its install simulated, then its run priced on the result; R-B: one door for a card that installs and runs',
  "runnerAI.ts: const options = { ...runEventOptions(WINDOW_OF_OPPORTUNITY, ready), memory: this.memory, wary: this.synergy && tuning.wary };":
    'Window of Opportunity (class P): the same procedure reads its run entry by its code; R-B',
  'runner/run.ts: const count = server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;':
    "Manegarm (class P): approachClickReserve's 5 credits a copy or 2 clicks; R-B: one approach toll owner",
  'runnerAI.ts: const full = state.runner.rig.programs.find(p => p.cardCode === READ_WRITE_SHARE && (p.hostedCards?.length ?? 0) >= 4);':
    "Read-Write Share (class P): the full-share rule, R-B decision 1's counted-question slot",
  'runner/prompt.ts: if (mine.cardCode === want) {': "honestPromptView: no card fact, the dealt code against the card's real one (already kept; B3 commit 2)",
  'runner/prompt.ts: const other = all.find(c => c.instanceId !== id && c.cardCode === want && !kept.has(c.instanceId) && !shown.has(c.instanceId) && fits(c, mine.cardCode));':
    "honestPromptView: no card fact, the slot the deal gave the shown card's identity (the swap; B3 commit 2)",
};

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

  it('holds no module state in pricing.ts but the current frame (B1b bar 3): every top-level declaration is named', () => {
    const text = readFileSync(new URL('../src/ai/pricing.ts', import.meta.url), 'utf8');
    const found = [...text.matchAll(/^(?:export )?(const|let|var|function|interface|type|class|enum) (\w+)/gm)].map(m => `${m[1]} ${m[2]}`);
    expect(found.filter(d => !(d in PRICING_DECLARATIONS)), 'name it in PRICING_DECLARATIONS, with why it is not module state').toEqual([]);
    expect(Object.keys(PRICING_DECLARATIONS).filter(d => !found.includes(d))).toEqual([]);
    expect(found.filter(d => /^(let|var) /.test(d))).toEqual(['let current']);
  });

  it('names every module-level WeakMap keyed by GameState outside valueModel, and fills the tripwired ones through stateEntries (audit 2026-11-26)', () => {
    const dir = new URL('../src/ai/', import.meta.url);
    const text = (file: string) => readFileSync(new URL(file, dir), 'utf8');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts') && f !== 'valueModel.ts');
    const found = files.flatMap(file => [...text(file).matchAll(/^(?:export )?(?:const|let) (\w+)\b[^\n]*new WeakMap<GameState\b/gm)].map(m => `${file.replace(/\\/g, '/').replace(/\.ts$/, '')}:${m[1]}`));
    expect(found.filter(key => !(key in STATE_CACHES)), 'name it in STATE_CACHES: through stateEntries, or why not').toEqual([]);
    expect(Object.keys(STATE_CACHES).filter(key => !found.includes(key))).toEqual([]);
    for (const [key, how] of Object.entries(STATE_CACHES).filter(([, how]) => how === 'stateEntries')) {
      const [file, name] = key.split(':');
      expect(text(`${file}.ts`), key).toMatch(new RegExp(`stateEntries\\(${name}, state\\)`));
      expect(how).toBe('stateEntries');
    }
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

  it('compares with a card in runs.ts, runnerAI.ts and runner/ only where the list says why (R-A A-move; R-B B2)', () => {
    // runner/ stays inside this guard (R-B B2, red team finding 4): the branches after B2 (O3, B5) edit runner/run.ts
    const runner = (readdirSync(new URL('../src/ai/runner/', import.meta.url)) as string[]).filter(f => f.endsWith('.ts')).map(f => `runner/${f}`);
    expect(runner).toContain('runner/run.ts');
    const files = ['runs.ts', 'runnerAI.ts', ...runner];
    const source = (f: string) => readFileSync(new URL(`../src/ai/${f}`, import.meta.url), 'utf8');
    // Card-code constants: defined in either file (`const NAME = '3dddd'`), whether used there or imported from runs.ts
    const constants = files.flatMap(f => [...source(f).matchAll(/const ([A-Z_]+) = '3\d{4}'/g)].map(m => m[1]));
    expect(constants.length).toBeGreaterThan(0);
    const usesConstant = new RegExp(`\\b(${constants.join('|')})\\b`);
    const found = files.flatMap(f =>
      source(f)
        .split('\n')
        .map(line => line.trim())
        .filter(line => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('import ') && !/^(export )?const [A-Z_]+ = '3\d{4}';/.test(line))
        .filter(line => /\bcardCode\s*[!=]==/.test(line) || usesConstant.test(line) || /'3\d{4}'/.test(line) || /\.title\s*[!=]==/.test(line))
        .map(line => `${f}: ${line}`),
    );
    expect(found.filter(key => !(key in CARD_COMPARISONS)), 'move the card fact to its entry (src/ai/cards, RunFacts)').toEqual([]);
    // A listed comparison that's gone: take it off the list
    expect(Object.keys(CARD_COMPARISONS).filter(key => !found.includes(key))).toEqual([]);
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
      ['runner/run.ts', "if (run.phase === 'movement' && run.icePosition !== null && server) {", `the jack-out check: a null check; creditsAhead reads ${INWARD}`],
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

  // 16 to 17 (R-14h fix commit 3, ruled in rulings 16 (f)): handValues.ts imports nextTurnMoney.ts (the Runner's next-turn
  // money, read for a card drawn 'later'), and nextTurnMoney.ts imports cards/ (turnIncomeOf, clickMoneyOf), which is in
  // the valuation cycle, so nextTurnMoney.ts joins it: cardPlans, cardProfiles, cardValues, cards/{elevation, index,
  // liberation, systemGateway, vantagePoint}, counterValues, effectValues, evaluate, handValues, iceValues, nextTurnMoney,
  // prompts, runs, threatModel. A copy of the money in handValues would keep 16 and break one owner per quantity.
  it('keeps corp/ and runner/ out of every import cycle, and the largest cycle in src/ai at or under 17 modules (29 before R8)', () => {
    const found = cycles(importGraph());
    expect(found.filter(c => c.some(f => f.startsWith('corp/'))), 'corp/ reads the valuation layer; the layer reads corp/ only through corpPorts.ts').toEqual([]);
    // R-B B1 (and the Corp side's conditions for parking the cycle below, tracker R-28): runner/ holds the order only
    expect(found.filter(c => c.some(f => f.startsWith('runner/'))), 'runner/ reads the agent only through its context (runner/core.ts RunnerContext)').toEqual([]);
    expect(Math.max(...found.map(c => c.length))).toBeLessThanOrEqual(17);
  });

  // R-B B1, tracker R-28 (parked by both coordinators 2026-11-24): the cycle that holds the Runner agent is these four and
  // does not grow; ending it needs a registrar every entry loads (red team 2026-11-24 finding 5)
  it('keeps the cycle holding runnerAI.ts to exactly {corpAI, runnerAI, runnerReply, turnPlanner}', () => {
    const found = cycles(importGraph()).filter(c => c.includes('runnerAI.ts'));
    expect(found.map(c => [...c].sort())).toEqual([['corpAI.ts', 'runnerAI.ts', 'runnerReply.ts', 'turnPlanner.ts']]);
  });

  // R-B B1 (brief b1-core.md point 7): who reaches the Runner agent from outside runnerAI.ts. May only shrink.
  it('constructs HeuristicRunnerAI or calls a rankMainActions outside runnerAI.ts only in these files', () => {
    const ALLOWED: Record<string, string> = {
      'index.ts': 'createAgent: the Normal Runner',
      'search.ts': "the Hard Runner's base and the search playouts' Runners (heuristicFor); the Hard Corp's and Runner's rankMainActions",
      'runnerReply.ts': "the reply's Runner and the oracle playout's Runner",
      'corpAI.ts': "the Corp agent's own rankMainActions (not the Runner's)",
    };
    const found = aiFiles().map(f => f.replace(/\\/g, '/')).filter(f => f !== 'runnerAI.ts' && /\brankMainActions\(|new HeuristicRunnerAI\b/.test(aiText(f)));
    expect(found.filter(f => !(f in ALLOWED))).toEqual([]);
    expect(Object.keys(ALLOWED).filter(f => !found.includes(f)), 'a file left the list: take it out of ALLOWED').toEqual([]);
  });

  // R-B B1 (brief b1-core.md point 7): the run's worth before it starts. May only shrink.
  it('calls runScore only in these files', () => {
    const ALLOWED: Record<string, string> = {
      'runs.ts': 'the owner (runScore itself)',
      'runnerAI.ts': "the Runner's ranking, its planner's runWorth and its run events",
      'prompts.ts': 'a prompt that picks a server to run (run events)',
      'cards/liberation.ts': "Alarm Clock's prompt answer, its HQ run (its entry since B3 commit 1)",
    };
    const found = aiFiles().map(f => f.replace(/\\/g, '/')).filter(f => /\brunScore\(/.test(aiText(f)));
    expect(found.filter(f => !(f in ALLOWED))).toEqual([]);
    expect(Object.keys(ALLOWED).filter(f => !found.includes(f)), 'a file left the list: take it out of ALLOWED').toEqual([]);
  });

  // Red team 2026-11-24 finding 11 (a): about 18 scripts snapshot, restore and cast the agent's own fields by name
  it("keeps the Runner agent's own fields, under today's names, in today's order", async () => {
    const { HeuristicRunnerAI } = await import('../src/ai/runnerAI');
    expect(Object.keys(new HeuristicRunnerAI())).toEqual(['side', 'freeActions', 'memory', 'digForBreakers', 'savingFor', 'synergy', 'debug', 'planner', 'planMemory']);
  });

  // R-B B2 (brief b2-run.md rev 1, Guards): the files of src/ai that choose an in-run action. May only shrink
  it('chooses an in-run action (jack out, break, a bioroid click, a boost, continue) only in these files', () => {
    const ALLOWED: Record<string, string> = {
      'runner/run.ts': "the Runner's decision during a run (runAction, encounterAction; R-B B2)",
    };
    const chosen = /'(JACK_OUT|BREAK_SUBROUTINE|BIOROID_BREAK|BOOST_BREAKER|CONTINUE_RUN)'/;
    const found = aiFiles().map(f => f.replace(/\\/g, '/')).filter(f => chosen.test(aiText(f)));
    expect(found.filter(f => !(f in ALLOWED))).toEqual([]);
    expect(Object.keys(ALLOWED).filter(f => !found.includes(f)), 'a file left the list: take it out of ALLOWED').toEqual([]);
  });

  // R-B B2 (part 3, red team 2026-11-25 finding 3): the context holds what the order reads, and the two fields B3 reads next
  it("keeps RunnerContext's keys to this list, each read by runner/core.ts or listed with its reason", () => {
    const core = aiText('runner/core.ts');
    const body = core.slice(core.indexOf('export interface RunnerContext {'), core.indexOf('\n}\n', core.indexOf('export interface RunnerContext {')));
    const keys = [...body.matchAll(/^ {2}(\w+)\??[(:]/gm)].map(m => m[1]);
    expect(keys).toEqual(['view', 'memory', 'remember', 'base', 'prompt', 'counted', 'noteCounted', 'rank', 'lookahead', 'offTurnRank', 'note', 'debug']);
    const UNREAD: Record<string, string> = {
      view: "read by B3's prompt answer; until then the handle of table (a) in tests/runnerCore.test.ts",
      memory: "read by B3's prompt answer; until then the handle of table (a) in tests/runnerCore.test.ts",
    };
    const read = (k: string) => new RegExp(`\\bctx\\.${k}\\b`).test(core);
    expect(keys.filter(k => !read(k) && !(k in UNREAD)), 'a context field with no reader: read it in runner/core.ts or delete it').toEqual([]);
    expect(Object.keys(UNREAD).filter(k => read(k)), 'a listed field is read now: take it off UNREAD').toEqual([]);
  });

  // R-B B2 (part 2, red team 2026-11-25 finding 5): the ranking's flat numbers are named in RUNNER_TERMS, one key per site
  it('reads each RUNNER_TERMS key at exactly one site in src, and keeps the table to these keys', async () => {
    const { RUNNER_TERMS } = await import('../src/ai/runner/terms');
    const KEYS = [
      'endTurn', 'tagRemovalResource', 'tagRemovalNoResource', 'runCard', 'bigHandDraw', 'digDraw', 'savingGain', 'savingSpend', 'freeActionCut', 'facedownTrojanHost',
      'bigHandClicks', 'digStackFloor', 'savingSpendFloor', 'saveUpWorthFloor', 'saveUpShortfallCap',
    ];
    expect(Object.keys(RUNNER_TERMS)).toEqual(KEYS);
    expect(Object.isFrozen(RUNNER_TERMS)).toBe(true);
    const sites = aiFiles().flatMap(f => [...aiText(f).matchAll(/\bRUNNER_TERMS\.(\w+)/g)].map(m => m[1]));
    for (const k of KEYS) expect(sites.filter(x => x === k).length, `RUNNER_TERMS.${k}: one key per site`).toBe(1);
    expect(sites.filter(x => !KEYS.includes(x))).toEqual([]);
  });

  // R-B B2 (part 2): no numeric literal but 0 and 1 in the ranking's four functions, outside this list (may only shrink)
  it('holds no numeric literal other than 0 and 1 in scoreMain, rankMainActions, offTurnRank and saveUpTarget but the listed ones', async () => {
    const ts = (await import('typescript')).default;
    const LISTED: Record<string, string> = {
      'rankMainActions: rigCoverage(state.runner.rig.programs).covered.size < 3 &&': 'the three breaker types (barrier, code gate, sentry): a count of the game, not a score',
      'scoreMain: for (let i = 0; i < 3; i++) {': 'the prompt-follow depth (twice: Window of Opportunity, our own prompts): a loop bound, not a score',
    };
    const text = aiText('runnerAI.ts');
    const src = ts.createSourceFile('runnerAI.ts', text, ts.ScriptTarget.Latest, true);
    const lines = text.split('\n');
    const want = new Set(['scoreMain', 'rankMainActions', 'offTurnRank', 'saveUpTarget']);
    const found: string[] = [];
    const seen = new Set<string>();
    const visit = (n: import('typescript').Node, fn?: string) => {
      let name = fn;
      if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && want.has(n.name.getText(src))) {
        name = n.name.getText(src);
        seen.add(name);
      }
      if (name && ts.isNumericLiteral(n) && n.text !== '0' && n.text !== '1') found.push(`${name}: ${lines[src.getLineAndCharacterOfPosition(n.getStart(src)).line].trim()}`);
      ts.forEachChild(n, c => visit(c, name));
    };
    visit(src);
    expect([...seen].sort()).toEqual([...want].sort());
    expect(found.filter(k => !(k in LISTED)), 'name the number in runner/terms.ts RUNNER_TERMS (R-C2 replaces it), or list it with a reason').toEqual([]);
    expect(Object.keys(LISTED).filter(k => !found.includes(k)), 'a listed literal is gone: take it off the list').toEqual([]);
  });

  it('imports corp/ from outside it only in these files', () => {
    const ALLOWED: Record<string, string> = {
      'corpAI.ts': 'the Corp agent, and the one corpPorts registration',
      'search.ts': 'the Hard Corp agent (corpDecide)',
      'index.ts': 'the AI entry',
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
  // Then + 13 in corp/ (ai-hold-inputs fix 4, AI-HOLD-RESOLVING-BYPASS: hold.ts, WalkIce.begun gathered once with
  // its comment, read by the hosted bypassers, the toll and runQuestion's bypass list, with comments):
  // corp/ 3,998, src/ai 16,018
  // Then + 8 in corp/ (ai-hold-inputs fix 5, AI-HOLD-RUNNER-TURN-ACTIVERUN: hold.ts + 2, serverHold's 'runnerTurn'
  // reads afterRun, with its comment; rezMoney.ts + 6, rezMoney, holdingRezIds and lineFloor start from afterRun, with
  // rezMoney's comment):
  // corp/ 4,006, src/ai 16,026
  // Then + 21 in corp/ (ai-hold-inputs fix 5b, red team M5: hold.ts + 20, nextTurnBoard with its comment, the
  // Runner cards' once-per-turn flags by the engine's naming; rezMoney.ts + 1, its next-turn forms read it):
  // corp/ 4,027, src/ai 16,047
  // Then + 10 in corp/ (ai-hold-inputs fix 6, AI-HOLD-MINOR-GAPS 1 and 3: hold.ts, Saci's payout read as nothing
  // under the run's pool lock in walkIce, and the lender views read the walk's start, with comments):
  // corp/ 4,037, src/ai 16,057
  // Then + 2 in corp/ (ai-rez-fixes A, AI-RUN-STOPPER-LEO-BLOCKS-OTHERS: rez.ts, runStopper falls through after LEO's
  // priced no, its comment + 3, the LEO line in the loop - 1; measured on beta 522ed85, corp/ 4,037 -> 4,039, src/ai
  // 16,054 -> 16,056, under its cap): corp/ 4,039, src/ai 16,057
  // Then + 1 in corp/ (ai-rez-fixes B, AI-STAKED-SERVERS-EMPTY-RD: rezMoney.ts, stakedServers reads agendasUnseen, its
  // import + 1, the file comment's R&D line reworded + 0; corp/ 4,039 -> 4,040, src/ai 16,056 -> 16,057, at its cap):
  // corp/ 4,040, src/ai 16,057
  // Then + 20 in corp/ (ai-placement-wiring fix 1, AI-SCORING-SHORT-DOUBLE-COUNT: rezMoney.ts + 8, `except` on the next
  // turn with its memo and comment, lineKeep's server; placement.ts + 12, scoringShort's floor with the remote out and its
  // doc naming its readers, the known double count named above reservedForAgenda (1b)): corp/ 4,060, src/ai 16,077
  // Then + 6 in corp/ (ai-placement-wiring fix 2, AI-ASSET-COVER-PLANNER-MISMATCH: candidates.ts, the asset cover's
  // waiting form a candidate at place's install, asked of isLegalAction (legalOr), with its comment): corp/ 4,066, src/ai 16,083
  // Then - 2 in corp/ (ai-placement-wiring fix 3: candidates.ts, freeInstallTarget's order on valueModel's memo, keyed by
  // the pricing context; the hand-made WeakMap deleted): corp/ 4,064, src/ai 16,081
  // Then + 4 in corp/ (ai-placement-wiring fix 4: placement.ts, the comment above iceRedirect says what the code does,
  // with the count's numbers): corp/ 4,068, src/ai 16,085. The branch's + 28 on top of ai-rez-fixes' caps (merged after
  // beta 6e254bee; measured on the merged tree: corp/ 4,068, src/ai 16,085, at the caps)
  // Then + 7 in src/ai/cards (ai-foaf-click-money, V-C checkpoint hunt finding 1: liberation.ts, Friend of a Friend's
  // clickMoney entry + 1 and its comment + 6; corp/ unchanged): corp/ 4,068, src/ai 16,092
  // Then + 147 in src/ai, corp/ unchanged (ai-runner-facts, R-A A-move: the Runner's card facts into the card entries,
  // measured against beta 920b6fa: cards/types.ts + 49 (RunFacts and its condition vocabulary), the card entries + 55 (the
  // facts with their card text), runs.ts + 35 (the vocabulary's readers in place of 25 card constants), runnerAI.ts + 8):
  // corp/ 4,068, src/ai 16,239
  // Then + 124 in src/ai, corp/ unchanged (ai-runner-core, R-B B1: the Runner's order of questions in one function,
  // measured against beta ff04f60: runner/core.ts + 107 (runnerDecide, runnerOffTurn, RunnerContext with a comment per
  // field), runnerAI.ts + 7 (runnerContext, offTurnRank; mainAction deleted), search.ts + 10 (the Hard Runner's context
  // and runnerLookahead)): corp/ 4,068, src/ai 16,363
  // Then + 61 in src/ai, corp/ unchanged (ai-runner-run, R-B B2: the decision during a run moved and the Runner's terms
  // named, measured against beta 57b02d6: runner/run.ts + 149 (runAction, encounterAction and approachClickReserve moved
  // verbatim, 118 lines, with the file comment and imports), runner/terms.ts + 44 (RUNNER_TERMS, 14 keys with a comment
  // each), runnerAI.ts - 127 (the three bodies out, the terms read), runner/core.ts - 5 (the run field and four unread
  // fields out)): corp/ 4,068, src/ai 16,424
  // Then + 19 in src/ai, corp/ unchanged (ai-runner-trash-owner, R-B O1b: the price of a trash reads the engine's cost and
  // offer and the tag a trash gives, measured against beta ad25482: runs.ts + 14 (trashNet's engine test and the tag, its
  // comment, two imports), cards/types.ts + 3 (RunFacts.trashedByRunner and its comment), cards/elevation.ts + 2 (the
  // Plaza's fact and its card text)): corp/ 4,068, src/ai 16,442
  // Then + 15 in src/ai, corp/ - 86 (ai-runner-last-credits-fix, R-14h commit 1: the next-turn money moved out of corp/,
  // bodies unchanged, measured against beta 4d85e9f (16,440): nextTurnMoney.ts + 101 (the moved bodies, the file comment,
  // three imports), corp/hold.ts - 64, corp/lines.ts - 24, the callers' import lines + 2): corp/ 3,982, src/ai 16,455
  // Then + 20 in src/ai, corp/ unchanged (R-14h commit 2: every read of the deck's average card says when the card is
  // played: valueModel.ts + 6 (DrawWhen and its comment), handValues.ts + 14 (drawMoney and its comment, the money in
  // drawWorth's key, heldFromPlayed's credits argument)): corp/ 3,982, src/ai 16,475
  // Then + 9 in src/ai, corp/ unchanged (R-14h commit 3: the Runner's 'later' money, handValues.ts + 9 (drawMoney's body
  // reads runnerEarnings once per board, laterMoneys, the import and the comment's form)): corp/ 3,982, src/ai 16,484
  // Then + 47 in src/ai, corp/ unchanged (ai-runner-prompt-view, B3 commits 0 and 1, measured against beta 8005562 (16,484):
  // runnerReply.ts + 2 (commit 0's rule 1.12.5 comment); commit 1, the Runner's per-card prompt answers moved into the
  // cards' entries, bodies unchanged: prompts.ts - 129 (14 cases, taoSwap, breaksRezzedIce and their imports out, the
  // dispatch point in), the entries + 150 (liberation.ts + 27, vantagePoint.ts + 42, elevation.ts + 34 with
  // breaksRezzedIce, systemGateway.ts + 47 with taoSwap: each entry restates its card's guard and keeps its comment),
  // cards/types.ts + 17 (PromptAsk and the promptAnswer field), cards/answers.ts + 7 (the two helpers the three
  // effect_cards answers share)): corp/ 3,982, src/ai 16,531
  // Then + 67 in src/ai, corp/ unchanged (ai-runner-prompt-view, B3b: a trojan's host gets one owner, issue #68, measured
  // against beta 58ced2b (16,531): counterValues.ts + 65 (trojanHostWorth's two inputs, unseenHostPool and hostShare, their
  // comments, two imports), runs.ts + 10 (unseenIcePool extracted from unrezzedDamageRisk with its comment), runner/terms.ts
  // + 3 (facedownTrojanHost and its comment), runnerAI.ts - 11 (trojanHostValue and two imports out, the term read)):
  // corp/ 3,982, src/ai 16,598
  // Then + 199 in src/ai, corp/ unchanged (ai-runner-prompt-view, B3 commit 2: the honest prompt view, measured against beta
  // 9c10d7f (16,598)): runner/prompt.ts + 197 (new: the three classes, the swap, the fallbacks, today's path for in-run
  // hosts and R-93's class, their comments), cards/elevation.ts + 4 and cards/types.ts + 3 (MuslihaT's promptShows and
  // the field), runnerAI.ts - 5 (promptAnswer reads runner/prompt.ts): corp/ 3,982, src/ai 16,797
  // Then + 16 in src/ai, corp/ unchanged (ai-cache-keys, F3: the three value maps by position, measured against beta
  // 12ee4b4, merged onto B3's 16,797: valueModel.ts + 24 (stateEntries, freezeAsked and the askedFreeze tripwire with their comments, scopeToGame
  // and mapGames out), pricing.ts + 22 (contextKey, its root ids and comment), effectValues.ts - 16 (threats' string key,
  // its counts and boardFacts out), handValues.ts - 14 (two string keys, their cap clears and comments out, laterMoneys to
  // memo)): corp/ 3,982, src/ai 16,813
  // Then + 66 in src/ai, corp/ - 1 (ai-pricing-frames, B1b: immutable pricing frames, measured against beta 9154f02):
  // pricing.ts + 37 (the frame checks: freeze and sealed Sets, framed, installTop, frameKeys with its per-frame cache,
  // their comments; holdPricing, version, the key functions and rootIds out), handValues.ts + 14 (inDecision and anchorAt
  // for decisionContext), valueModel.ts + 13 (the generation key, L-26), runner/core.ts + 6 and corp/core.ts + 3 (the
  // decision entries), runnerAI.ts + 2, corpAI.ts + 1, oracle.ts - 1, effectValues.ts - 2, search.ts - 3 (the
  // re-notes), corp/rez.ts - 4 (rezzingToUse a patch): corp/ 3,981, src/ai 16,879
  // Then + 8 in src/ai, corp/ unchanged (ai-runner-hidden-zones, B4a 7(a): hqAgendaOdds reads the HQ count by code and
  // count, its comment and import, measured against beta 85a89eb (16,797)): runs.ts + 8: corp/ 3,982, src/ai 16,805
  // Then + 4 in src/ai (ai-runner-hidden-zones, B4a 7(b): rdWorth reads a shuffle's shares, with its comment and import):
  // corp/ 3,982, src/ai 16,809
  // Then + 4 in src/ai (ai-runner-hidden-zones, B4a 7(c): the Archives price reads the facedown cards the Runner surely
  // knows, with its comment and import): corp/ 3,982, src/ai 16,813
  // Then + 4 in src/ai (ai-runner-hidden-zones, B4a 7(d): unseenTraps reads the hidden zones' marks by code and count,
  // the map for installed cards only, with its comments): corp/ 3,982, src/ai 16,817
  // Then + 28 in src/ai (ai-runner-hidden-zones, B4a 7(e): the deal places what the Runner knows by code and count, the
  // Corp's guess of a shuffle's share at a random place, no id read, with their comments): corp/ 3,982, src/ai 16,845
  // Then + 3 in src/ai (ai-runner-hidden-zones, B4a 7(h): the Runner's view key reads the map for installed cards and
  // the marks): corp/ 3,982, src/ai 16,848
  // Then + 2 in src/ai (ai-runner-hidden-zones, B4a 7(i): the map's entries for cards back in a hidden zone go):
  // corp/ 3,982, src/ai 16,850
  // Then + 2 in src/ai (ai-runner-hidden-zones, B4a ruling 6: corpSeenGrip reads the grip by code and count):
  // corp/ 3,982, src/ai 16,852
  // Then + 2 in src/ai (ai-runner-hidden-zones, B4a ruling 6: muWorth reads the grip by code and count, its import):
  // corp/ 3,982, src/ai 16,854
  // Then + 2 in src/ai (ai-runner-hidden-zones, B4a ruling 6: winNow's blind grip by code and count, its import):
  // corp/ 3,982, src/ai 16,856
  // Then the merge of beta 9154f02 (F3) into ai-runner-hidden-zones: B4a's + 59 above, measured on 16,797, on F3's
  // 16,813: corp/ 3,982, src/ai 16,872
  // Then + 1 in src/ai (ai-runner-hidden-zones, B4 brief rev 1d: runner/prompt.ts's shownByState freezes the asked
  // board, F3's tripwire, its import): corp/ 3,982, src/ai 16,873
    // Then the merge of beta 3680b7f (B1b) into ai-runner-hidden-zones: B4a's + 60 above, measured on 16,813, on
    // B1b's 16,879: corp/ 3,981, src/ai 16,939
  // Then + 112 in src/ai (ai-deck-arrivals, F117 commit 1: the iceProtects and centralAccess keys carry the unseen HQ
  // ids, handValues.ts unseenKey; valueModel.ts memo's test-only on-hit audit, item 14): src/ai 17,051
  // Then + 6 (F117 commit 2: evaluate.ts handCount, handAndClicks' count line as its own export): src/ai 17,057
  // Then + 5 (F117 commit 3: runner/prompt.ts promptShownIds on core/view.ts's one face rule): src/ai 17,062
  // Then + 315 (F117 commit 4, the design: prompts.ts D1 seen arrivals, D2 M - C, D3 chain test and its budget, the
  // one-answer scorer the Runner's 'again' path reads; turnPlanner.ts the line frame; handValues.ts withKnownCards):
  // corp/ 3,981, src/ai 17,377
  // Then + 30 (F117 bars 6 and 7: a chain's later unseen draws go back to the deck on the staying cards' keep board,
  // toDeck; a tie between search answers goes by card code, deckTie): src/ai 17,407
  // Then + 14 (F117 departures, the Mercia ruling: a card leaving the own hand priced by its owner, arrivalTerms):
  // src/ai 17,421
  // Then + 81 (F117 departures red team, ruled: chance departures keep base's term averaged over every set the damage
  // could take, chanceBoards; byChance; C at the board before's limit; the before keep sum without the chosen D): src/ai 17,502
  // Then + 8 (F117 chanceBoards ruling: one chance-set enumerator, chanceSets, shared with hqChanceLoss): src/ai 17,510
  // Then + 21 (F117 time levers, ruled: ownHandValue(before) once per prompt state, ownHandBefore; chanceBoards' scores
  // memoised per scored board, knownKey, serial): src/ai 17,531
  it('keeps src/ai/corp at or under 3,981 lines and src/ai at or under 17,531 (Stage C hand-off, ai-corp-honest-order, ai-value-time, ai-playout-lines, ai-honest-runner-view, ai-honest-corp-decision, ai-value-owners, ai-corp-rd-memory, ai-value-b1, ai-value-b2, ai-hold-reentry, ai-value-b3, ai-tag-loss-time, ai-value-b6, ai-threat-delete, ai-breaker-guard-key, ai-tag-loss-bp, ai-hold-facts, ai-hold-walk, ai-flood-bound, ai-hold-retry, ai-winnow-reach, ai-hold-stealth, ai-rez-keep, ai-runner-money, ai-run-answers, ai-hold-audit-fixes, ai-rez-set, ai-hold-inputs, ai-rez-fixes, ai-placement-wiring, ai-foaf-click-money, ai-runner-facts, ai-runner-core, ai-runner-run, ai-runner-trash-owner, ai-runner-last-credits-fix, ai-runner-prompt-view, ai-cache-keys, ai-pricing-frames, ai-runner-hidden-zones, ai-deck-arrivals)', () => {
    const corp = aiFiles().filter(f => f.replace(/\\/g, '/').startsWith('corp/')).reduce((n, f) => n + lines(f), 0);
    expect(corp).toBeLessThanOrEqual(3981);
    const all = aiFiles().reduce((n, f) => n + lines(f), 0);
    expect(all).toBeLessThanOrEqual(17531);
    // The caps are the counts (audit 2026-11-20 AI-LINE-CAP-SLACK, found row 99 c: + 24 lines once went in under a cap
    // with slack and no ledger line above). A cap more than SLACK lines over its count fails: lower it to the count and
    // add the ledger line, so the next growth is stated.
    const SLACK = 8;
    expect(3982 - corp).toBeLessThanOrEqual(SLACK);
    expect(17531 - all).toBeLessThanOrEqual(SLACK);
  });
});
