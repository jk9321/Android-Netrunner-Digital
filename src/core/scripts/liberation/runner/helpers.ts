import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { runBlocked, startRun } from '../../../engine/actions/run';
import { installedRunnerCards, trashInstalledRunnerCard } from '../../../engine/damage';
import { addCounters, counters, drawForEffect, removeCounters, removeFromGame, removeTags, threatLevel } from '../../../engine/cardEffects';
import { bypassIce, encounteredIce } from '../../../engine/ice';
import { cards, choice, ChoiceQuestion, prompts, RunnerHostData } from '../../steps';
import { EffectContext } from '../../types';
import { installableRunnerCards, installRunnerHostChoice } from '../../effects';

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

// Bahia Bands (Run): Run any server. If successful, resolve 2 of the following in any order: Draw 2
// cards. / Install 1 card from your grip, paying 1 credit less. / Remove 1 tag. / Place 4 credits on
// this event. You can spend hosted credits to pay trash costs for the remainder of this run.
const BAHIA_MODES = [
  { id: 'draw', label: 'Draw 2 cards' },
  { id: 'install', label: 'Install 1 card from your grip, paying 1 [credit] less' },
  { id: 'tag', label: 'Remove 1 tag' },
  { id: 'credits', label: 'Place 4 [credit] here to pay trash costs this run' },
];

type BahiaData = { done: string };

export const bahiaFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
  mode: choice<BahiaData>((ctx, a, d) => {
    const { state, card } = ctx;
    const next = [...bahiaDone(d), a.optionId];
    if (a.optionId === 'draw') drawForEffect(state, 'runner', 2, 'Bahia Bands');
    else if (a.optionId === 'tag') removeTags(state, 1);
    else if (a.optionId === 'credits') {
      place(card, 'credit', 4);
      if (state.activeRun) state.activeRun.trashCreditHosts = [...(state.activeRun.trashCreditHosts ?? []), card.instanceId];
    } else if (a.optionId === 'install') {
      const options = installableRunnerCards(state, state.runner.grip, 1);
      if (options.length > 0) {
        bahiaFlow.runnerInstall(ctx, 'install', { message: 'Bahia Bands: install 1 card from your grip, paying 1 [credit] less.', candidateIds: ids(options), min: 0, max: 1 }, { done: next.join(',') });
        return;
      }
    }
    bahiaAsk(ctx, next);
  }),
  install: cards<BahiaData>((ctx, a, d) => {
    if (a.ids.length > 0 && !bahiaFlow.installRunner(ctx, a.ids[0], 'host', 1, a.trashFirst, { done: bahiaDone(d).join(',') })) return;
    bahiaAsk(ctx, bahiaDone(d));
  }),
  host: choice<BahiaData & RunnerHostData>((ctx, a, d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    bahiaAsk(ctx, bahiaDone(d));
  }),
});

const bahiaDone = (d: Partial<BahiaData>) => String(d.done ?? '').split(',').filter(Boolean);

export const bahiaAsk = (ctx: EffectContext, done: string[]) => {
  if (done.length >= 2) return;
  const options = BAHIA_MODES.filter(m => !done.includes(m.id));
  bahiaFlow.choice(ctx, 'mode', { side: 'runner', message: `Bahia Bands: choose ${done.length === 0 ? 'the first' : 'the second'} effect.`, options }, { done: done.join(',') });
};

// Privileged Access (Run): Play only if you are not tagged. Run Archives. If successful, instead of
// breaching Archives, take 1 tag. When you take a tag with this event, you may install 1 resource
// from your heap, paying 2 credits less. Threat 3 -> When you take a tag with this event, you may
// install 1 program from your heap.
export const heapOf = (state: GameState, kind: string, discount: number) => installableRunnerCards(state, state.runner.heap.filter(c => type(c) === kind), discount);

export const privilegedFlow = prompts({
  resource: cards((ctx, a) => {
    if (a.ids[0] && !privilegedFlow.installRunner(ctx, a.ids[0], 'host-resource', 2)) return;
    privilegedProgram(ctx);
  }),
  program: cards((ctx, a) => {
    if (a.ids[0]) privilegedFlow.installRunner(ctx, a.ids[0], 'host-program', 0);
  }),
  'host-resource': choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    privilegedProgram(ctx);
  }),
  'host-program': choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export function privilegedProgram(ctx: EffectContext): void {
  if (threatLevel(ctx.state) < 3) return;
  const options = heapOf(ctx.state, 'program', 0);
  if (options.length > 0) privilegedFlow.runnerInstall(ctx, 'program', { message: 'Privileged Access: you may install 1 program from your heap.', candidateIds: ids(options), min: 0, max: 1 });
}

// Pressure Spike (Fracter): Interface -> 1 credit: Break 1 barrier subroutine. 2 credits: +3
// strength. Threat 4 -> 2 credits: +9 strength. Use this ability only once per run.
/** Pressure Spike's once-per-run +9 (a run flag), read by the AI's break plans too. */
export const spikeKey = (card: CardInstance) => `pressure-spike:${card.instanceId}`;
