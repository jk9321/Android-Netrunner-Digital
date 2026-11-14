import { CardScript } from './types';
import { operationScripts } from './operations';
import { eventScripts } from './events';
import { iceScripts } from './ice';
import { breakerScripts } from './breakers';
import { corpCardScripts } from './corpCards';
import { runnerCardScripts } from './runnerCards';
import { elevationRunnerScripts } from './elevationRunner';
import { elevationCorpScripts } from './elevationCorp';
import { vantageRunnerScripts } from './vantageRunner';
import { vantageCorpScripts } from './vantageCorp';
import { liberationCorpScripts } from './liberationCorp';
import { liberationRunnerScripts } from './liberationRunner';

export type { CardScript, EffectContext, EffectAnswer } from './types';

/** Each script file's cards, in load order. A card code may appear in only one of them. */
export const SCRIPT_GROUPS: Record<string, Record<string, CardScript>> = {
  operationScripts,
  eventScripts,
  iceScripts,
  breakerScripts,
  corpCardScripts,
  runnerCardScripts,
  elevationRunnerScripts,
  elevationCorpScripts,
  vantageRunnerScripts,
  vantageCorpScripts,
  liberationCorpScripts,
  liberationRunnerScripts,
};

/**
 * Joins the script files into one registry. A card defined in two files would silently take the later
 * one's script (an object spread), so it throws instead.
 */
export function mergeScriptGroups(groups: Record<string, Record<string, CardScript>>): Record<string, CardScript> {
  const merged: Record<string, CardScript> = {};
  const from: Record<string, string> = {};
  for (const [group, scripts] of Object.entries(groups)) {
    for (const [code, script] of Object.entries(scripts)) {
      if (from[code]) throw new Error(`Card ${code} has a script in both ${from[code]} and ${group}`);
      from[code] = group;
      merged[code] = script;
    }
  }
  return merged;
}

const SCRIPTS = mergeScriptGroups(SCRIPT_GROUPS);

/** The script for a card code, if its abilities are implemented. */
export function getCardScript(cardCode: string): CardScript | undefined {
  return SCRIPTS[cardCode];
}

/** Card codes with scripted abilities (for docs and UI badges). */
export function scriptedCardCodes(): string[] {
  return Object.keys(SCRIPTS);
}
