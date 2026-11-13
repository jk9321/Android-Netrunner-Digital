import { writeFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const seed = Number(process.env.SEED);
const p = Math.floor((seed - 1001) / 10);
const t = (s: GameState, a: GameAction) => { const id = (a as { cardInstanceId?: string }).cardInstanceId; const c = id ? findCardAnywhere(s, id) : undefined; return `${a.player}:${a.type}${c ? ':' + cardDef(c).title : ''}`; };
function play(on: boolean) {
  tuning.plan = { ...tuning.plan, moneyAbility: on };
  valueLoops.clear();
  const g = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const log: { s: GameState; a: GameAction; text: string; n: GameState }[] = [];
  for (let i = 0; i < 8000; i++) { const s = g.state; if (!g.step()) break; log.push({ s, a: g.last!, text: t(s, g.last!), n: g.state }); }
  return { log, end: g.state };
}
const off = play(false), on = play(true);
let k = 0;
while (k < off.log.length && k < on.log.length && off.log[k].text === on.log[k].text) k++;
const s = off.log[k].s;
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(s));
console.log(`seed ${seed}: winner off ${off.end.winner} (${off.end.corp.score}-${off.end.runner.score}, T${off.end.turnNumber}), on ${on.end.winner} (${on.end.corp.score}-${on.end.runner.score}, T${on.end.turnNumber})`);
console.log(`first difference at step ${k}, turn ${s.turnNumber}, Corp ${s.corp.clicks} clicks ${s.corp.credits} cr, HQ: ${s.corp.hq.map(c => cardDef(c).title).join(', ')}`);
console.log(`  remotes: ${Object.values(s.corp.servers).map(v => `${v.id}[${v.ice.map(c => cardDef(c).title).join(',')}|${v.root.map(c => cardDef(c).title).join(',')}]`).join(' ')}`);
const drawn = (x: { s: GameState; n: GameState }) => x.n.corp.hq.filter(c => !x.s.corp.hq.some(y => y.instanceId === c.instanceId)).map(c => cardDef(c).title);
for (const [name, g] of [['off', off], ['on', on]] as const) {
  const rest = g.log.slice(k).filter(x => x.a.player === 'corp' && x.a.type !== 'RESOLVE_PROMPT').slice(0, 14);
  console.log(`  ${name}: ${rest.map(x => `T${x.s.turnNumber} ${x.text.replace('corp:', '')}${x.a.type === 'DRAW_CARD' ? ' [' + drawn(x).join(',') + ']' : ''}`).join(' | ')}`);
  const scores = g.log.filter(x => x.n.corp.score !== x.s.corp.score || x.n.runner.score !== x.s.runner.score).map(x => `T${x.s.turnNumber} ${x.n.corp.score}-${x.n.runner.score}`);
  console.log(`  ${name} scores: ${scores.join(', ')}`);
}
