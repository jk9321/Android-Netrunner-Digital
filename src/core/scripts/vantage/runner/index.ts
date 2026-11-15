import { vantageRunnerEventsScripts } from './events';
import { vantageRunnerHardwareScripts } from './hardware';
import { vantageRunnerIdentitiesScripts } from './identities';
import { vantageRunnerProgramsScripts } from './programs';
import { vantageRunnerResourcesScripts } from './resources';

/** Runner cards from Vantage Point, one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const vantageRunnerScriptGroups = {
  vantageRunnerEventsScripts,
  vantageRunnerHardwareScripts,
  vantageRunnerIdentitiesScripts,
  vantageRunnerProgramsScripts,
  vantageRunnerResourcesScripts,
};
