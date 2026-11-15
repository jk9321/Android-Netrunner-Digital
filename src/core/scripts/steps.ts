import { SideCode } from '../types/card';
import { EffectSource } from '../types/prompts';
import { CardScript, EffectAnswer, EffectContext } from './types';
import {
  answerPsiGame,
  askCards,
  askChoice,
  askCorpInstall,
  askEvenIfNone,
  askRunnerInstall,
  CorpInstallChoice,
  installRunnerChoice,
  isPsiStep,
  playPsiGame,
} from './effects';

/**
 * Typed multi-step card prompts.
 *
 * A card that asks questions declares its steps once, with prompts():
 *
 *   const flow = prompts({
 *     pick: cards((ctx, a) => { if (a.ids[0]) flow.corpInstall(ctx, a.ids[0], 'server'); }),
 *     server: choice<{ cardId: string }>((ctx, a, d, src) => installCorpChoice(ctx.state, src, a.raw)),
 *   });
 *   const script: CardScript = { ..., ...flow.script };
 *
 * Each step says whether it asks for cards (cards), one option (choice) or a Psi Game (psi), and the
 * type of the data it carries. The compiler then rejects a question asked with a step the card never
 * declared, a step asked as the wrong kind, and missing or mistyped data; the engine rejects an answer
 * to a step the card doesn't declare instead of letting it pass as a decline.
 *
 * What is stored in the game state doesn't change: a prompt's source is still the card, a step string
 * and JSON data, so saved games, bug reports, the online view and the AI's prompt answers (which read
 * cardCode and step) are untouched.
 */

/** The data a step carries between questions: plain JSON, as stored in the prompt (EffectSource.data). */
export type StepData = NonNullable<EffectSource['data']>;
/** A step that carries no data. */
export type NoData = Record<string, never>;

/** An answer to a card question. `ids` is empty when the player chose none, or declined a question asked
 * even though nothing qualified (askEvenIfNone, rules 4.2.2 and 4.6.3). */
export interface CardsAnswer {
  ids: string[];
  /** Installed cards to trash first, on a question that installs the chosen card (rules 8.5.6). */
  trashFirst: string[];
  raw: EffectAnswer;
}

/** An answer to a choice question. */
export interface ChoiceAnswer {
  optionId: string;
  /** Installed cards to trash first, on a question that installs a card (rules 8.5.6). */
  trashFirst: string[];
  raw: EffectAnswer;
}

type Handler<A, D> = (ctx: EffectContext, answer: A, data: D, source: EffectSource) => void;

export interface CardsStep<D extends StepData> {
  kind: 'cards';
  handle: Handler<CardsAnswer, D>;
}
export interface ChoiceStep<D extends StepData> {
  kind: 'choice';
  handle: Handler<ChoiceAnswer, D>;
}
/** A Psi Game (rules 10.14): both bids are asked under this step, then `handle` gets whether they matched. */
export interface PsiStep<D extends StepData> {
  kind: 'psi';
  handle: Handler<boolean, D>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the data type of each step is checked where it is used
type AnyStep = CardsStep<any> | ChoiceStep<any> | PsiStep<any>;
type Steps = Record<string, AnyStep>;

/** A step that asks for cards. */
export const cards = <D extends StepData = NoData>(handle: Handler<CardsAnswer, D>): CardsStep<NoInfer<D>> => ({ kind: 'cards', handle });
/** A step that asks for one option. */
export const choice = <D extends StepData = NoData>(handle: Handler<ChoiceAnswer, D>): ChoiceStep<NoInfer<D>> => ({ kind: 'choice', handle });
/** A step that plays a Psi Game; `handle` gets whether the bids matched. */
export const psi = <D extends StepData = NoData>(handle: Handler<boolean, D>): PsiStep<NoInfer<D>> => ({ kind: 'psi', handle });

type DataOf<S> = S extends CardsStep<infer D> ? D : S extends ChoiceStep<infer D> ? D : S extends PsiStep<infer D> ? D : never;
type StepsOfKind<T extends Steps, K extends AnyStep['kind']> = { [P in keyof T]: T[P]['kind'] extends K ? P : never }[keyof T] & string;
/** The data argument: optional when the step carries none. */
type DataArg<D> = Record<never, never> extends D ? [data?: D] : [data: D];

/** The data installRunner gives its host step (a trojan's ice), beside the step's own. */
export type RunnerHostData = { cardId: string; discount: number; trashIds: string[] };

export interface CardsQuestion {
  side: SideCode;
  message: string;
  candidateIds: string[];
  min: number;
  max: number;
}
export interface ChoiceQuestion {
  side: SideCode;
  message: string;
  options: { id: string; label: string }[];
}

export interface Flow<T extends Steps> {
  /** The steps, for the card's script: `...flow.script`. */
  script: Required<Pick<CardScript, 'onPromptAnswer' | 'promptSteps'>>;
  /** Asks for cards under a cards step. */
  cards<K extends StepsOfKind<T, 'cards'>>(ctx: EffectContext, step: K, q: CardsQuestion, ...data: DataArg<DataOf<T[K]>>): void;
  /** Asks for one option under a choice step. */
  choice<K extends StepsOfKind<T, 'choice'>>(ctx: EffectContext, step: K, q: ChoiceQuestion, ...data: DataArg<DataOf<T[K]>>): void;
  /** Asks the Runner for a card to install (the answer may name programs to trash first, rules 8.5.6c). */
  runnerInstall<K extends StepsOfKind<T, 'cards'>>(
    ctx: EffectContext,
    step: K,
    q: Omit<CardsQuestion, 'side'>,
    ...data: DataArg<DataOf<T[K]>>
  ): void;
  /** Asks the Corp where to install `cardId` (askCorpInstall); false if it can't go anywhere. The step's data gets cardId. */
  corpInstall<K extends StepsOfKind<T, 'choice'>>(
    ctx: EffectContext,
    cardId: string,
    step: K,
    opts?: CorpInstallChoice,
    ...data: DataArg<Omit<DataOf<T[K]>, 'cardId' | 'install'>>
  ): boolean;
  /**
   * Installs a Runner card an effect chose (installRunnerChoice), paying `discount` less, after trashing
   * `trashIds` (rules 8.5.6c). A program that installs on ice first asks which ice under `hostStep`, whose
   * data gets RunnerHostData; answer it with installRunnerHostChoice. True if the card was installed now.
   */
  installRunner<K extends StepsOfKind<T, 'choice'>>(
    ctx: EffectContext,
    cardId: string,
    hostStep: K,
    discount?: number,
    trashIds?: string[],
    ...data: DataArg<Omit<DataOf<T[K]>, keyof RunnerHostData>>
  ): boolean;
  /** Plays a Psi Game under a psi step. */
  psiGame<K extends StepsOfKind<T, 'psi'>>(ctx: EffectContext, step: K, ...data: DataArg<DataOf<T[K]>>): void;
  /**
   * askEvenIfNone (rules 4.2.2, 4.6.3) with a declared step to go on to after the decline: `ask` runs
   * when something qualifies; otherwise, at stops ALL, the player is asked anyway with only a decline,
   * whose answer comes back to `then` (or resolves nothing). Returns whether a prompt was pushed.
   */
  evenIfNone<K extends keyof T & string>(
    ctx: EffectContext,
    side: SideCode,
    qualifies: boolean,
    ask: () => void,
    noneMessage: string,
    declineLabel?: string,
    then?: { step: K; data?: DataOf<T[K]> }
  ): boolean;
}

/** Answer a psi step gets while its first bid is pending: never used, answerPsiGame asks the Runner. */
const noData = {} as StepData;

/** Declares a card's prompt steps; see the module comment. */
export function prompts<T extends Steps>(steps: T): Flow<T> {
  const names = Object.keys(steps);

  function onPromptAnswer(ctx: EffectContext, source: EffectSource, answer: EffectAnswer): void {
    const data = (source.data ?? noData) as StepData;
    if (isPsiStep(source.step)) {
      answerPsiGame(ctx, source, answer, (match, step, rest) => {
        const s = steps[step];
        if (s?.kind !== 'psi') throw new Error(`${ctx.card.cardCode}: Psi Game step '${step}' is not a declared psi step`);
        s.handle(ctx, match, rest ?? noData, source);
      });
      return;
    }
    const s = steps[source.step];
    if (!s) throw new Error(`${ctx.card.cardCode}: no step '${source.step}' (declared: ${names.join(', ')})`);
    if (s.kind === 'cards') {
      if (answer.kind === 'effect_cards') return s.handle(ctx, { ids: answer.cardInstanceIds, trashFirst: answer.trashFirst ?? [], raw: answer }, data, source);
      // The decline of a question asked even though nothing qualified (askEvenIfNone's `then`)
      if (answer.optionId !== 'no') throw new Error(`${ctx.card.cardCode}: cards step '${source.step}' got option '${answer.optionId}'`);
      return s.handle(ctx, { ids: [], trashFirst: [], raw: answer }, data, source);
    }
    if (s.kind === 'choice') {
      if (answer.kind !== 'effect_choice') throw new Error(`${ctx.card.cardCode}: choice step '${source.step}' got a card answer`);
      return s.handle(ctx, { optionId: answer.optionId, trashFirst: answer.trashFirst ?? [], raw: answer }, data, source);
    }
    throw new Error(`${ctx.card.cardCode}: psi step '${source.step}' answered outside a Psi Game`);
  }

  const flow: Flow<T> = {
    script: { onPromptAnswer, promptSteps: names },
    cards: (ctx, step, q, ...data) => askCards(ctx, q.side, q.message, q.candidateIds, q.min, q.max, step, data[0]),
    choice: (ctx, step, q, ...data) => askChoice(ctx, q.side, q.message, q.options, step, data[0]),
    runnerInstall: (ctx, step, q, ...data) => askRunnerInstall(ctx, q.message, q.candidateIds, q.min, q.max, step, data[0]),
    corpInstall: (ctx, cardId, step, opts = {}, ...data) => askCorpInstall(ctx, cardId, step, opts, data[0] as StepData | undefined),
    installRunner: (ctx, cardId, hostStep, discount = 0, trashIds = [], ...data) =>
      installRunnerChoice(ctx, cardId, hostStep, discount, data[0] as StepData | undefined, trashIds),
    psiGame: (ctx, step, ...data) => playPsiGame(ctx, step, data[0]),
    evenIfNone: (ctx, side, qualifies, ask, noneMessage, declineLabel, then) =>
      askEvenIfNone(ctx, side, qualifies, ask, noneMessage, declineLabel, then && { step: then.step, data: then.data }),
  };
  return flow;
}

/** The steps a card's script declares with prompts(), or undefined for a script that dispatches by hand. */
export function declaredSteps(script: CardScript | undefined): readonly string[] | undefined {
  return script?.promptSteps;
}
