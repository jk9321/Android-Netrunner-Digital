/**
 * Vitest setup for scripts/step-coverage.ts: notes every card prompt step a unit test answers. Wraps each
 * card script's onPromptAnswer in this test worker only; nothing in src changes.
 */
import { appendFileSync } from 'node:fs';
import { afterAll } from 'vitest';
import '../src/core'; // first: importing the scripts alone hits an import cycle
import { getCardScript, scriptedCardCodes } from '../src/core/scripts';
import type { CardScript } from '../src/core/scripts/types';

const answered = new Set<string>();
const WRAPPED = Symbol('step-coverage');
type Answer = NonNullable<CardScript['onPromptAnswer']>;

for (const code of scriptedCardCodes()) {
  const script = getCardScript(code);
  const answer = script?.onPromptAnswer as (Answer & { [WRAPPED]?: true }) | undefined;
  if (!script || !answer || answer[WRAPPED]) continue;
  const wrapped: Answer & { [WRAPPED]?: true } = (ctx, source, a) => {
    // A Psi Game's bids carry the step behind a psi-corp: / psi-runner: prefix
    answered.add(`${source.cardCode} ${source.step.replace(/^psi-(corp|runner):/, '')}`);
    return answer(ctx, source, a);
  };
  wrapped[WRAPPED] = true;
  script.onPromptAnswer = wrapped;
}

afterAll(() => {
  const out = process.env.STEP_COVERAGE_OUT;
  if (out && answered.size > 0) appendFileSync(out, [...answered].join('\n') + '\n');
});
