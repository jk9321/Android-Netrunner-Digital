/**
 * Corp redesign stage 0: does the current Corp have intent that survives a turn, and does it miss scores plain counting
 * finds? (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0.md, measures M1-M3). Measurement only.
 *
 *   npx vite-node scripts/plan-measure.ts -- [--ai=dir] [--human=tests/fixtures/human-games] [--out=file.json]
 *        [--sample=file.txt] [--labels=tests/fixtures/plan-measure/hand-labels.json] [--runnerExtra=4]
 *
 * Sources: --ai is a folder of scripts/plan-measure-record.ts outputs (AI Corp vs AI Runner, Normal); the human-games
 * reports split by who the computer played: config.ai 'runner' = Jeff as Corp, 'corp' = our Corp against Jeff as Runner.
 * Prints the M1 and M2 tables per source; --out writes every counted case (the M3 examples come from it); --sample
 * writes 20 AI and 20 Jeff Corp turns as plain text for labelling by hand (no labels shown); --labels scores the
 * labeller against the hand labels. The pieces are in plan-measure-lib.ts.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, findCardAnywhere, installedIcebreakers } from '../src/core';
import { CHECK, CorpTurn, ReplayedGame, Shape, blocked, cheaperDraw, commitments, continues, isAgenda, labelTurn, reasonsBetween, replayGame, scoreInTwo, scoreThisTurn, serverOf, turnFacts, uncostable } from './plan-measure-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const aiDir = opt('ai');
const humanDir = opt('human') ?? 'tests/fixtures/human-games';
const limit = Number(opt('limit') ?? Infinity);
// --runnerExtra=4: the two-turn check with 4 more credits for the Runner's run (a Sure Gamble it may hold)
CHECK.runnerExtra = Number(opt('runnerExtra') ?? 0);

type Source = 'ai' | 'jeffCorp' | 'aiVsJeff';
interface Game {
  source: Source;
  id: string;
  report: Parameters<typeof replayGame>[0];
}

const games: Game[] = [];
if (aiDir)
  for (const f of readdirSync(aiDir).filter(f => f.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b)))
    for (const g of JSON.parse(readFileSync(join(aiDir, f), 'utf8')) as (Game['report'] & { crashed?: string })[]) if (!g.crashed && g.moves) games.push({ source: 'ai', id: `deal ${g.config.seed}`, report: g });
for (const f of readdirSync(humanDir).filter(f => /^report-\d+\.json$/.test(f))) {
  const r = JSON.parse(readFileSync(join(humanDir, f), 'utf8'));
  if (!r.moves?.length) continue;
  const source: Source | null = r.config.ai === 'runner' ? 'jeffCorp' : r.config.ai === 'corp' ? 'aiVsJeff' : null;
  if (source) games.push({ source, id: f.replace('.json', ''), report: r });
}

// ------------------------------------------------------------------------------------------------------------ text
const titleOf = (s: GameState, id?: string) => {
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '?';
};
const serverName = (id?: string) => (id === 'hq' ? 'HQ' : id === 'rd' ? 'R&D' : id === 'archives' ? 'Archives' : id ?? '?');
function describe(s: GameState, a: GameAction, after: GameState): string {
  const x = a as { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean; choice?: unknown };
  switch (a.type) {
    case 'GAIN_CREDIT':
      return 'click for a credit';
    case 'DRAW_CARD':
      return 'draw';
    case 'INSTALL_CARD':
      return `install ${titleOf(s, x.cardInstanceId)} in ${serverName(serverOf(after, x.cardInstanceId ?? '') ?? x.targetServerId)}`;
    case 'PLAY_OPERATION_OR_EVENT':
      return `play ${titleOf(s, x.cardInstanceId)}`;
    case 'ADVANCE_CARD':
      return `advance ${titleOf(s, x.cardInstanceId)} (${serverName(serverOf(s, x.cardInstanceId ?? ''))})`;
    case 'SCORE_AGENDA':
      return `score ${titleOf(s, x.cardInstanceId)}`;
    case 'REZ_CARD':
      return `rez ${titleOf(s, x.cardInstanceId)}${s.activeRun ? ' (in a run)' : ''}`;
    case 'USE_ABILITY':
      return `use ${titleOf(s, x.cardInstanceId)}`;
    case 'TRASH_RESOURCE':
      return `trash ${titleOf(s, x.cardInstanceId)}`;
    case 'PURGE_VIRUS':
      return 'purge';
    default:
      return '';
  }
}
/** The board in a few lines, as the Corp sees it. */
function board(s: GameState): string {
  const ice = (c: CardInstance) => `${cardDef(c).title}${c.isRezzed ? '' : '*'}`;
  const servers = Object.values(s.corp.servers)
    .filter(v => v.ice.length || v.root.length)
    .map(v => `${serverName(v.id)}: [${v.ice.map(ice).join(', ')}]${v.root.length ? ' root ' + v.root.map(c => `${cardDef(c).title}${c.advancementCounters ? '+' + c.advancementCounters : ''}${c.isRezzed ? '' : '*'}`).join(', ') : ''}`);
  const hqAgendas = s.corp.hq.filter(isAgenda).map(c => `${cardDef(c).title} (${cardDef(c).advancement_cost}/${cardDef(c).agenda_points})`);
  const hqIce = s.corp.hq.filter(c => cardDef(c).type_code === 'ice').map(c => `${cardDef(c).title} (rez ${cardDef(c).cost})`);
  return [
    `Corp ${s.corp.score} pts, ${s.corp.credits} cr, ${s.corp.clicks} clicks; Runner ${s.runner.score} pts, ${s.runner.credits} cr, breakers ${installedIcebreakers(s).map(c => cardDef(c).title).join(', ') || 'none'}${s.runner.tags ? `, ${s.runner.tags} tags` : ''}`,
    `HQ agendas: ${hqAgendas.join(', ') || 'none'}; HQ ice: ${hqIce.join(', ') || 'none'}`,
    ...servers,
  ].join('\n    ');
}
const turnText = (t: CorpTurn) =>
  t.steps
    .map(st => describe(st.before, st.action, st.after))
    .filter(Boolean)
    .join('; ') || 'nothing';

// ------------------------------------------------------------------------------------------------------------ count
interface Tally {
  games: number;
  turns: number;
  shapes: Record<Shape, number>;
  committed: number;
  continued: number;
  blocked: number;
  flipsStrict: number;
  flipsNarrow: number;
  reasons: Record<string, number>;
  agendasInstalled: number;
  neverAdvanced: number;
  neverAdvancedStolen: number;
  builtRemotes: number;
  remotesNeverUsed: number;
  stalledAdvances: number;
  agendaTurns: number;
  nowFeasible: number;
  nowTaken: number;
  nowUsedCard: number;
  twoFeasible: number;
  twoTaken: number;
  twoStartedLost: number;
  untakenInstead: Record<string, number>;
  untakenWins: number;
  untakenGames: Set<string>;
  corpWins: number;
  corpPoints: number;
  runnerPoints: number;
  firstScoreTurns: number[];
  flipsRetarget: number;
  /** Agenda turns with a card in HQ that places advancement counters (the winNow prompt blind spot) */
  placeCardTurns: number;
  /** Untaken two-turn lines on the Corp's turns 1-2 (the Runner's rig is still empty: its grip is the blind spot) */
  earlyMissedTwo: number;
}
const tally = (): Tally => ({
  games: 0,
  turns: 0,
  shapes: { score: 0, kill: 0, build: 0, shore: 0, money: 0, mixed: 0 },
  committed: 0,
  continued: 0,
  blocked: 0,
  flipsStrict: 0,
  flipsNarrow: 0,
  reasons: {},
  agendasInstalled: 0,
  neverAdvanced: 0,
  neverAdvancedStolen: 0,
  builtRemotes: 0,
  remotesNeverUsed: 0,
  stalledAdvances: 0,
  agendaTurns: 0,
  nowFeasible: 0,
  nowTaken: 0,
  nowUsedCard: 0,
  twoFeasible: 0,
  twoTaken: 0,
  twoStartedLost: 0,
  untakenInstead: {},
  untakenWins: 0,
  untakenGames: new Set(),
  corpWins: 0,
  corpPoints: 0,
  runnerPoints: 0,
  firstScoreTurns: [],
  flipsRetarget: 0,
  placeCardTurns: 0,
  earlyMissedTwo: 0,
});
const tallies: Record<Source, Tally> = { ai: tally(), jeffCorp: tally(), aiVsJeff: tally() };
const cases: Record<string, unknown>[] = [];
const sampleable: Record<Source, { id: string; turn: CorpTurn }[]> = { ai: [], jeffCorp: [], aiVsJeff: [] };
const uncostableDecks = new Set<string>();
const labelled = new Map<string, Shape>();

for (const g of games.slice(0, limit)) {
  let game: ReplayedGame;
  try {
    game = replayGame(g.report);
  } catch (err) {
    console.error(`${g.id}: ${err}`);
    continue;
  }
  const T = tallies[g.source];
  T.games++;
  if (game.winner === 'corp') T.corpWins++;
  T.corpPoints += game.final.corp.score;
  T.runnerPoints += game.final.runner.score;
  const first = game.turns.findIndex(t => t.end.corp.score > 0);
  if (first >= 0) T.firstScoreTurns.push(first + 1);
  const deck = g.report.config.corpDeck;
  if (game.turns[0] && [...game.turns[0].start.corp.hq, ...game.turns[0].start.corp.rd].some(uncostable)) uncostableDecks.add(deck.name);
  const facts = game.turns.map(turnFacts);
  const labels = game.turns.map(labelTurn);
  game.turns.forEach((t, i) => {
    T.turns++;
    T.shapes[labels[i].shape]++;
    labelled.set(`${g.id}#${t.turn}`, labels[i].shape);
    sampleable[g.source].push({ id: g.id, turn: t });
    const next = game.turns[i + 1];
    // ---- M1 flips
    const commits = commitments(t, facts[i]);
    if (commits.length && next) {
      T.committed++;
      const nf = facts[i + 1];
      if (commits.some(c => continues(c, next, nf))) T.continued++;
      else if (commits.every(c => blocked(c, next))) T.blocked++;
      else {
        const target = commits.map(c => ('server' in c ? c.server : undefined)).find(Boolean);
        const r = reasonsBetween(t, next, target);
        const cheaper = commits.some(c => cheaperDraw(c, t, next));
        const strict = r.successfulRun || r.lostCard || r.rigChanged || r.eventPlayed || cheaper;
        const narrow = r.runOnTarget || r.lostCard || r.rigChanged || cheaper;
        for (const [k, v] of Object.entries({ ...r, cheaper })) if (v) T.reasons[k] = (T.reasons[k] ?? 0) + 1;
        if (!strict) T.flipsStrict++;
        if (!narrow) T.flipsNarrow++;
        if (!narrow && labels[i + 1].shape === 'score') T.flipsRetarget++;
        if (!narrow)
          cases.push({ kind: 'flip', strict: !strict, source: g.source, game: g.id, turn: t.turn, commits: commits.map(c => c.kind + ('server' in c ? ' ' + c.server : '') + ('id' in c ? ' ' + titleOf(t.end, c.id) : '')), next: labels[i + 1], nextDid: turnText(next), did: turnText(t), board: board(next.start), winner: game.winner });
      }
    }
    // ---- M2
    const agendaAvailable = t.start.corp.hq.some(isAgenda) || Object.values(t.start.corp.servers).some(v => v.root.some(isAgenda));
    if (!agendaAvailable) return;
    T.agendaTurns++;
    if (t.start.corp.hq.some(c => cardDef(c).type_code === 'operation' && /place \d+ advancement counter/i.test(cardDef(c).stripped_text ?? '')) && Object.values(t.start.corp.servers).some(v => v.root.some(isAgenda))) T.placeCardTurns++;
    const scoredThis = t.end.corp.score > t.start.corp.score;
    const now = scoreThisTurn(t.start);
    if (now.feasible) {
      T.nowFeasible++;
      if (now.usedCard) T.nowUsedCard++;
      if (scoredThis) T.nowTaken++;
      else miss('now', t, labels[i].shape, { line: now.line.map((a, k) => k).length + ' actions', agenda: now.agenda, usedCard: now.usedCard });
      return;
    }
    const two = scoreInTwo(t.start);
    if (!two) return;
    T.twoFeasible++;
    const scoredByNext = (next ? next.end.corp.score : game.final.corp.score) > t.start.corp.score;
    if (scoredByNext) {
      T.twoTaken++;
      return;
    }
    const lost = !!next && !serverOf(next.start, two.agendaId) && !next.start.corp.hq.some(c => c.instanceId === two.agendaId);
    if (lost && t.end.corp.hq.every(c => c.instanceId !== two.agendaId)) {
      T.twoStartedLost++;
      cases.push({ kind: 'two-lost', source: g.source, game: g.id, turn: t.turn, line: two, did: turnText(t), board: board(t.start), winner: game.winner });
      return;
    }
    if (t.turn <= 3) T.earlyMissedTwo++;
    miss('two', t, labels[i].shape, two);
  });

  function miss(kind: 'now' | 'two', t: CorpTurn, shape: Shape, line: unknown) {
    const T2 = tallies[g.source];
    T2.untakenInstead[`${kind}:${shape}`] = (T2.untakenInstead[`${kind}:${shape}`] ?? 0) + 1;
    if (game.winner === 'corp') T2.untakenWins++;
    T2.untakenGames.add(g.id);
    cases.push({ kind: `missed-${kind}`, source: g.source, game: g.id, turn: t.turn, shape, did: turnText(t), line, board: board(t.start), winner: game.winner });
  }

  // ---- abandoned commitments over the whole game
  const installs = new Map<string, { advanced: boolean; scored: boolean; stolen: boolean }>();
  const built = new Map<string, boolean>();
  const lastAdvance = new Map<string, number>();
  game.turns.forEach((t, i) => {
    const f = facts[i];
    for (const m of f.agendaMoves) {
      const e = installs.get(m.id) ?? { advanced: false, scored: false, stolen: false };
      if (m.kind === 'advance') e.advanced = true;
      if (m.kind === 'score') e.scored = true;
      installs.set(m.id, e);
      if (m.kind === 'advance') lastAdvance.set(m.id, i);
    }
    for (const r of f.builtRemotes) if (!built.has(r)) built.set(r, false);
    for (const m of f.agendaMoves) if (built.has(m.server)) built.set(m.server, true);
    // advanced agendas left 2+ Corp turns with no advance (counted once each, when the second idle turn ends)
    for (const [id, at] of lastAdvance) {
      const card = findCardAnywhere(t.end, id);
      if (i - at === 2 && card && serverOf(t.end, id) && card.advancementCounters > 0) T.stalledAdvances++;
    }
  });
  for (const [id, e] of installs) {
    T.agendasInstalled++;
    if (!e.advanced && !e.scored) {
      T.neverAdvanced++;
      if (game.final.runner.scoreArea.some(c => c.instanceId === id)) T.neverAdvancedStolen++;
    }
  }
  T.builtRemotes += built.size;
  T.remotesNeverUsed += [...built.values()].filter(v => !v).length;
}

// ------------------------------------------------------------------------------------------------------------ print
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const se = (a: number, b: number) => (b ? `±${(100 * Math.sqrt(((a / b) * (1 - a / b)) / b)).toFixed(1)}` : '');
const out: string[] = [];
const say = (s = '') => out.push(s);
const names: Record<Source, string> = { ai: 'AI vs AI (Normal)', jeffCorp: 'Jeff as Corp', aiVsJeff: 'AI Corp vs Jeff' };
say('## M1 intent');
say('| source | games | Corp turns | score | kill | build | shore | money | mixed |');
say('|---|---|---|---|---|---|---|---|---|');
for (const s of Object.keys(names) as Source[]) {
  const T = tallies[s];
  say(`| ${names[s]} | ${T.games} | ${T.turns} | ${(['score', 'kill', 'build', 'shore', 'money', 'mixed'] as Shape[]).map(k => pct(T.shapes[k], T.turns)).join(' | ')} |`);
}
say();
say('| source | committed turns | continued | blocked | re-opened by an event | flips, spec list | flips, narrow list | reasons seen (turn pairs) |');
say('|---|---|---|---|---|---|---|---|');
for (const s of Object.keys(names) as Source[]) {
  const T = tallies[s];
  const reopened = T.committed - T.continued - T.blocked - T.flipsStrict;
  say(`| ${names[s]} | ${T.committed} | ${pct(T.continued, T.committed)} | ${T.blocked} | ${reopened} | ${T.flipsStrict} (${pct(T.flipsStrict, T.committed)} ${se(T.flipsStrict, T.committed)}) | ${T.flipsNarrow} (${pct(T.flipsNarrow, T.committed)} ${se(T.flipsNarrow, T.committed)}) | ${Object.entries(T.reasons).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
}
say();
say('Narrow flips whose next turn was a score move on another agenda or server (re-targeted, arguably not a flip): ' + (Object.keys(names) as Source[]).map(s => `${names[s]} ${tallies[s].flipsRetarget}`).join(', '));
say();
say('| source | agendas installed | never advanced or scored (stolen so) | remotes built | built remotes never used | advanced agendas left 2+ turns |');
say('|---|---|---|---|---|---|');
for (const s of Object.keys(names) as Source[]) {
  const T = tallies[s];
  say(`| ${names[s]} | ${T.agendasInstalled} | ${T.neverAdvanced} (${T.neverAdvancedStolen}) | ${T.builtRemotes} | ${T.remotesNeverUsed} | ${T.stalledAdvances} |`);
}
say();
say('## Outcomes');
say('| source | Corp wins | Corp points a game | Runner points a game | Corp turn of its first score (median) |');
say('|---|---|---|---|---|');
for (const s of Object.keys(names) as Source[]) {
  const T = tallies[s];
  const f = [...T.firstScoreTurns].sort((a, b) => a - b);
  say(`| ${names[s]} | ${T.corpWins}/${T.games} (${pct(T.corpWins, T.games)}) | ${(T.corpPoints / Math.max(1, T.games)).toFixed(1)} | ${(T.runnerPoints / Math.max(1, T.games)).toFixed(1)} | ${f.length ? f[Math.floor(f.length / 2)] : '-'} (${f.length} games scored) |`);
}
say();
say('## M2 countable scores');
say('| source | turns with an agenda | score this turn feasible | taken | used a card | two-turn feasible (not this turn) | scored by next turn | started, then lost | untaken two-turn, share of agenda turns | games with a miss (Corp won) |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const s of Object.keys(names) as Source[]) {
  const T = tallies[s];
  const untakenTwo = T.twoFeasible - T.twoTaken - T.twoStartedLost;
  say(`| ${names[s]} | ${T.agendaTurns} | ${T.nowFeasible} | ${T.nowTaken} (${pct(T.nowTaken, T.nowFeasible)}) | ${T.nowUsedCard} | ${T.twoFeasible} | ${T.twoTaken} (${pct(T.twoTaken, T.twoFeasible)}) | ${T.twoStartedLost} | ${untakenTwo} (${pct(untakenTwo, T.agendaTurns)} ${se(untakenTwo, T.agendaTurns)}) | ${T.untakenGames.size} (${[...T.untakenGames].filter(id => cases.some(c => c.game === id && String(c.kind).startsWith('missed') && c.winner === 'corp')).length}) |`);
}
say();
say('What the Corp did instead (untaken lines, by M1 label):');
for (const s of Object.keys(names) as Source[]) say(`- ${names[s]}: ${Object.entries(tallies[s].untakenInstead).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
say('Blind-spot bounds: agenda turns with a counter-placing card in HQ (winNow prunes those lines): ' + (Object.keys(names) as Source[]).map(s => `${names[s]} ${tallies[s].placeCardTurns}`).join(', '));
say('Untaken two-turn lines on game turns 1-3 (rig still near empty; the Runner may install a breaker from its grip): ' + (Object.keys(names) as Source[]).map(s => `${names[s]} ${tallies[s].earlyMissedTwo}`).join(', '));
say(`Corp decks with an agenda the counting can't cost: ${[...uncostableDecks].join('; ') || 'none'}`);
// ---- M3: where the missed turns go (the AI's, per source), top patterns with one example each
const patternOf = (c: Record<string, unknown>): string => {
  if (c.kind === 'flip') return `flip: ${(c.commits as string[]).map(x => x.split(' ')[0]).join('+')} -> ${(c.next as { shape: string }).shape}`;
  if (c.kind === 'missed-now') return `score now missed -> ${c.shape}${(c.line as { usedCard: boolean }).usedCard ? ' (card line)' : ''}`;
  const l = c.line as { form: string };
  return `two-turn missed (${l.form}) -> ${c.shape}`;
};
for (const s of Object.keys(names) as Source[]) {
  const mine = cases.filter(c => c.source === s && c.kind !== 'two-lost' && (c.kind !== 'flip' || true));
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const c of mine) groups.set(patternOf(c), [...(groups.get(patternOf(c)) ?? []), c]);
  say();
  say(`M3 patterns, ${names[s]}:`);
  for (const [k, v] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
    const e = v[0];
    say(`- ${k}: ${v.length}. e.g. ${e.game} turn ${e.turn}: did ${e.did}${e.kind === 'flip' ? ` -> next turn ${e.nextDid}` : `; counted line ${JSON.stringify(e.line)}`}`);
  }
}
console.log(out.join('\n'));

const outFile = opt('out');
if (outFile) writeFileSync(outFile, JSON.stringify({ tallies: Object.fromEntries(Object.entries(tallies).map(([k, v]) => [k, { ...v, untakenGames: [...v.untakenGames] }])), cases }, null, 1));

// ------------------------------------------------------------------------------------------------------------ sample
// A fixed pick (every k-th Corp turn), written without labels, for labelling by hand
const sampleFile = opt('sample');
if (sampleFile) {
  const lines: string[] = [];
  for (const s of ['ai', 'jeffCorp'] as Source[]) {
    const pool = sampleable[s];
    const step = Math.max(1, Math.floor(pool.length / 20));
    for (let k = 0; k < 20 && k * step < pool.length; k++) {
      const { id, turn } = pool[(k * step + 7) % pool.length];
      lines.push(`${id}#${turn.turn} (${s})\n    ${board(turn.start)}\n  did: ${turnText(turn)}\n  end tags ${turn.end.runner.tags}\n`);
    }
  }
  writeFileSync(sampleFile, lines.join('\n'));
}
const labelsFile = opt('labels');
if (labelsFile) {
  const hand = JSON.parse(readFileSync(labelsFile, 'utf8')) as Record<string, Shape>;
  let agree = 0;
  let n = 0;
  const off: string[] = [];
  for (const [k, v] of Object.entries(hand)) {
    if (k.startsWith("_")) continue;
    const got = labelled.get(k);
    if (!got) continue;
    n++;
    if (got === v) agree++;
    else off.push(`${k}: hand ${v}, labeller ${got}`);
  }
  console.log(`\nLabeller vs hand labels: ${agree}/${n} (${pct(agree, n)})\n${off.join('\n')}`);
}
