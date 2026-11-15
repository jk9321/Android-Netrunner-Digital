import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { runBlocked } from '../../../engine/actions/run';
import { installedRunnerCards, trashInstalledRunnerCard } from '../../../engine/damage';
import { addCounters, counters, removeCounters, removeFromGame } from '../../../engine/cardEffects';
import { bypassIce, encounteredIce } from '../../../engine/ice';
import { ChoiceQuestion } from '../../steps';
import { EffectContext } from '../../types';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const type = (card: CardInstance) => cardDef(card).type_code;

const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const hasKeyword = (card: CardInstance, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(keywords(card));

export const title = (card: CardInstance) => cardDef(card).title;

export const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

export const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;

export const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

export const yesNo = (yes: string, no = 'No') => [
  { id: 'yes', label: yes },
  { id: 'no', label: no },
];

export const isInstalled = (state: GameState, card: CardInstance) => installedRunnerCards(state).some(c => c.instanceId === card.instanceId);

export const runnerTurn = (state: GameState) => state.activePlayer === 'runner';

export const centralServers = ['hq', 'rd', 'archives'];

export const remoteServers = (state: GameState) => Object.values(state.corp.servers).filter(s => s.isRemote && !runBlocked(state, s.id)).map(s => s.id);

export const allServers = (state: GameState) => Object.keys(state.corp.servers);

/** "Run which server?" among `ids` the Runner can run now (Front Company), or null if none; `optional` ("you may run") adds a "Don't run" answer, 'no'. */
export function runQuestion(ctx: EffectContext, label: string, ids: string[], optional = false): ChoiceQuestion | null {
  const serverIds = ids.filter(id => !runBlocked(ctx.state, id)); // Front Company
  if (serverIds.length === 0) return null;
  const options = serverIds.map(id => ({ id, label: ctx.state.corp.servers[id].name }));
  return { side: 'runner', message: `${label}: run which server?`, options: optional ? [...options, { id: 'no', label: "Don't run" }] : options };
}

/** Puts `n` power counters on a card ("load" cards are trashed when empty by their own scripts). */
export const place = (card: CardInstance, kind: 'power' | 'credit' | 'virus', n: number) => addCounters(card, kind, n);

/** Removes 1 power counter from a "load" card; trashes it (or removes it from the game) once empty. */
export function spendLoad(state: GameState, card: CardInstance, n = 1, whenEmpty: 'trash' | 'remove' = 'trash'): void {
  removeCounters(card, 'power', n);
  if (counters(card, 'power') > 0 || !isInstalled(state, card)) return;
  if (whenEmpty === 'trash') trashInstalledRunnerCard(state, card);
  else removeFromGame(state, card);
  addLog(state, 'runner', `${title(card)} is empty and was ${whenEmpty === 'trash' ? 'trashed' : 'removed from the game'}.`);
}

/** Bypass the encountered ice if it is still the one this ability was about. */
export function bypassIfStill(state: GameState, iceId: unknown): void {
  if (encounteredIce(state)?.instanceId === iceId) bypassIce(state);
}

// Pressure Spike (Fracter): Interface -> 1 credit: Break 1 barrier subroutine. 2 credits: +3
// strength. Threat 4 -> 2 credits: +9 strength. Use this ability only once per run.
/** Pressure Spike's once-per-run +9 (a run flag), read by the AI's break plans too. */
export const spikeKey = (card: CardInstance) => `pressure-spike:${card.instanceId}`;
